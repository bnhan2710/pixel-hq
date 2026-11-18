import os
import sys
import json
import time
import shutil
import signal
import urllib.parse
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

def get_subprocess_kwargs(**kwargs):
    if sys.platform == "win32":
        flags = kwargs.get("creationflags", 0)
        DETACHED_PROCESS = 0x00000008
        CREATE_NO_WINDOW = 0x08000000
        kwargs["creationflags"] = flags | DETACHED_PROCESS | CREATE_NO_WINDOW
        startupinfo = kwargs.get("startupinfo")
        if startupinfo is None:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0
        kwargs["startupinfo"] = startupinfo
    return kwargs

def run_cmd(*args, **kwargs):
    return subprocess.run(*args, **get_subprocess_kwargs(**kwargs))

def popen_cmd(*args, **kwargs):
    return subprocess.Popen(*args, **get_subprocess_kwargs(**kwargs))

CACHE_DIR = "/mnt/c/Users/ADMIN/.cache/pixel-hq/music" if (sys.platform != "win32" and os.path.isdir("/mnt/c/Users/ADMIN")) else os.path.expanduser("~/.cache/pixel-hq/music")
STATE_FILE = os.path.join(CACHE_DIR, "state.json")
QUEUE_FILE = os.path.join(CACHE_DIR, "queue.json")
PREFETCH_PID_FILE = os.path.join(CACHE_DIR, "prefetch.pid")
HISTORY_FILE = os.path.join(CACHE_DIR, "history.json")
POOL_SIZE = 5
MAX_HISTORY = 3

DEFAULT_PRESETS = [
    {"title": "SomaFM Groove Salad", "url": "https://ice2.somafm.com/groovesalad-128-mp3"},
    {"title": "Nightwave Plaza", "url": "https://radio.plaza.one/mp3"},
    {"title": "SomaFM DEF CON", "url": "https://ice1.somafm.com/defcon-128-mp3"},
    {"title": "SomaFM Drone Zone", "url": "https://ice6.somafm.com/dronezone-128-mp3"},
]

def ensure_cache_dir():
    try:
        os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
        if sys.platform != "win32":
            os.chmod(CACHE_DIR, 0o700)
    except OSError:
        pass

def validate_url(raw_url):
    if not isinstance(raw_url, str):
        return False, "URL must be a string."
    url = raw_url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        return False, "Only http:// and https:// URLs are allowed."
    if any(c in url for c in ("\r", "\n", "\0", "\t")):
        return False, "URL contains illegal characters."
    return True, url

def is_valid_player_proc(pid):
    if not pid or pid <= 0:
        return False
    if sys.platform.startswith("linux"):
        exe_path = f"/proc/{pid}/exe"
        try:
            target = os.path.realpath(exe_path)
            base = os.path.basename(target).lower()
            if base in ("ffplay", "mpv"):
                return True
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
        cmd_path = f"/proc/{pid}/cmdline"
        try:
            with open(cmd_path, "rb") as f:
                parts = [p.decode("utf-8", errors="ignore").strip().lower() for p in f.read().split(b"\x00") if p]
                if parts:
                    base0 = os.path.basename(parts[0])
                    if base0 in ("ffplay", "mpv"):
                        return True
                    if base0 in ("python", "python3", "sh", "bash", "dash", "env") and len(parts) > 1:
                        target_arg = parts[1]
                        if base0 == "env" and target_arg in ("python", "python3", "sh", "bash") and len(parts) > 2:
                            target_arg = parts[2]
                        base_script = os.path.basename(target_arg)
                        if base_script in ("ffplay", "mpv"):
                            return True
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            return False
        return False
    elif sys.platform == "darwin":
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        try:
            r = run_cmd(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, timeout=3)
            if r.returncode == 0 and r.stdout.strip():
                out = r.stdout.lower()
                return "ffplay" in out or "mpv" in out
        except Exception:
            pass
        return True
    elif sys.platform == "win32":
        try:
            import ctypes
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h:
                return False
            exit_code = ctypes.c_ulong()
            if ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(exit_code)):
                ctypes.windll.kernel32.CloseHandle(h)
                STILL_ACTIVE = 259
                if exit_code.value != STILL_ACTIVE:
                    return False
            else:
                ctypes.windll.kernel32.CloseHandle(h)
                return False
            return True
        except Exception:
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def read_state():
    if not os.path.exists(STATE_FILE):
        return None
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_state(data):
    ensure_cache_dir()
    tmp_file = f"{STATE_FILE}.tmp.{os.getpid()}"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(tmp_file, flags, 0o600)
        with open(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_file, STATE_FILE)
        if sys.platform != "win32":
            try:
                os.chmod(STATE_FILE, 0o600)
            except OSError:
                pass
    except Exception:
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass

def clear_state():
    if os.path.exists(STATE_FILE):
        try:
            os.remove(STATE_FILE)
        except OSError:
            pass

def read_queue():
    if not os.path.exists(QUEUE_FILE):
        return None
    try:
        with open(QUEUE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_queue(data):
    ensure_cache_dir()
    tmp_file = f"{QUEUE_FILE}.tmp.{os.getpid()}"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(tmp_file, flags, 0o600)
        with open(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_file, QUEUE_FILE)
        if sys.platform != "win32":
            try:
                os.chmod(QUEUE_FILE, 0o600)
            except OSError:
                pass
    except Exception:
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass

def kill_prefetch_worker():
    if os.path.exists(PREFETCH_PID_FILE):
        try:
            with open(PREFETCH_PID_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
                pid = int(content) if content.isdigit() else None
            if pid and pid > 0:
                if sys.platform == "win32":
                    run_cmd(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=2)
                else:
                    os.kill(pid, signal.SIGKILL)
        except Exception:
            pass
        try:
            os.remove(PREFETCH_PID_FILE)
        except OSError:
            pass

def clear_queue():
    kill_prefetch_worker()
    if os.path.exists(QUEUE_FILE):
        try:
            os.remove(QUEUE_FILE)
        except OSError:
            pass

def suspend_process(pid):
    if not pid or pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes
            PROCESS_SUSPEND_RESUME = 0x0800
            handle = ctypes.windll.kernel32.OpenProcess(PROCESS_SUSPEND_RESUME, False, pid)
            if handle:
                try:
                    res = ctypes.windll.ntdll.NtSuspendProcess(handle)
                    return res == 0
                finally:
                    ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            return False
        return False
    else:
        try:
            os.kill(pid, signal.SIGSTOP)
            return True
        except OSError:
            return False

def resume_process(pid):
    if not pid or pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes
            PROCESS_SUSPEND_RESUME = 0x0800
            handle = ctypes.windll.kernel32.OpenProcess(PROCESS_SUSPEND_RESUME, False, pid)
            if handle:
                try:
                    res = ctypes.windll.ntdll.NtResumeProcess(handle)
                    return res == 0
                finally:
                    ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            return False
        return False
    else:
        try:
            os.kill(pid, signal.SIGCONT)
            return True
        except OSError:
            return False

def stop_process(pid, is_paused=False):
    if not is_valid_player_proc(pid):
        return
    if is_paused:
        resume_process(pid)
    if sys.platform != "win32":
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            return
        deadline = time.time() + 1.2
        while time.time() < deadline:
            if not is_valid_player_proc(pid):
                return
            time.sleep(0.08)
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    else:
        try:
            run_cmd(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=3)
        except Exception:
            pass

def find_running_player_pid():
    if sys.platform == "win32":
        try:
            r = run_cmd(["tasklist", "/FI", "IMAGENAME eq ffplay.exe", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=2)
            for line in r.stdout.splitlines():
                parts = [p.strip(' "') for p in line.split(",") if p.strip()]
                if len(parts) >= 2 and parts[0].lower() == "ffplay.exe":
                    try:
                        return int(parts[1])
                    except ValueError:
                        pass
        except Exception:
            pass
    elif sys.platform.startswith("linux") or sys.platform == "darwin":
        try:
            r = run_cmd(["pgrep", "-f", "ffplay"], capture_output=True, text=True, timeout=2)
            pids = [int(p) for p in r.stdout.splitlines() if p.strip().isdigit() and int(p) != os.getpid()]
            if pids:
                return pids[0]
        except Exception:
            pass
        try:
            r = run_cmd(["pgrep", "-f", "mpv"], capture_output=True, text=True, timeout=2)
            pids = [int(p) for p in r.stdout.splitlines() if p.strip().isdigit() and int(p) != os.getpid()]
            if pids:
                return pids[0]
        except Exception:
            pass
    return None

def stop_all_players(keep_queue=False):
    kill_prefetch_worker()
    current = read_state()
    if current and current.get("pid"):
        stop_process(current["pid"], current.get("status") == "paused")
    if sys.platform == "win32":
        try:
            run_cmd(["taskkill", "/F", "/IM", "ffplay.exe"], capture_output=True, timeout=2)
            run_cmd(["taskkill", "/F", "/IM", "mpv.exe"], capture_output=True, timeout=2)
        except Exception:
            pass
    if not keep_queue:
        clear_queue()
    clear_state()

def find_player_bin():
    for name in ("ffplay", "mpv"):
        p = shutil.which(name)
        if p:
            return p
    if sys.platform == "win32":
        candidates = [
            os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Links\ffplay.exe"),
            os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Links\mpv.exe"),
            r"C:\Program Files\ffmpeg\bin\ffplay.exe",
            r"C:\ProgramData\chocolatey\bin\ffplay.exe",
            os.path.expanduser(r"~\scoop\shims\ffplay.exe"),
        ]
        winget_pkgs = os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Packages")
        if os.path.isdir(winget_pkgs):
            try:
                for root, _dirs, files in os.walk(winget_pkgs):
                    if "ffplay.exe" in files:
                        candidates.append(os.path.join(root, "ffplay.exe"))
                        break
            except Exception:
                pass
        for path in candidates:
            if os.path.isfile(path):
                return path
    elif sys.platform == "darwin":
        for path in ("/opt/homebrew/bin/ffplay", "/usr/local/bin/ffplay", "/opt/homebrew/bin/mpv", "/usr/local/bin/mpv"):
            if os.path.isfile(path):
                return path
    return None

def find_ytdlp_bin():
    p = shutil.which("yt-dlp")
    if p:
        return p
    exe_name = "yt-dlp.exe" if sys.platform == "win32" else "yt-dlp"
    scripts_dir = os.path.join(os.path.dirname(sys.executable), "Scripts" if sys.platform == "win32" else "bin")
    cand = os.path.join(scripts_dir, exe_name)
    if os.path.isfile(cand):
        return cand
    try:
        import site
        if hasattr(site, "USER_BASE") and site.USER_BASE:
            cand = os.path.join(site.USER_BASE, "Scripts" if sys.platform == "win32" else "bin", exe_name)
            if os.path.isfile(cand):
                return cand
    except Exception:
        pass
    if sys.platform == "win32":
        candidates = [
            os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe"),
            os.path.expanduser(r"~\scoop\shims\yt-dlp.exe"),
        ]
        local_py = os.path.expanduser(r"~\AppData\Local\Programs\Python")
        if os.path.isdir(local_py):
            for entry in os.listdir(local_py):
                c = os.path.join(local_py, entry, "Scripts", "yt-dlp.exe")
                if os.path.isfile(c):
                    return c
        for path in candidates:
            if os.path.isfile(path):
                return path
    elif sys.platform == "darwin":
        for path in ("/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"):
            if os.path.isfile(path):
                return path
    try:
        import yt_dlp
        return [sys.executable, "-m", "yt_dlp"]
    except ImportError:
        pass
    return None

def is_extractor_url(url):
    u = url.lower()
    return "youtube.com" in u or "youtu.be" in u or "soundcloud.com" in u

def extract_stream_info(url):
    yt_dlp = find_ytdlp_bin()
    if not yt_dlp:
        return None, None, 0, "yt-dlp is required for YouTube and SoundCloud streams. Install via pip install yt-dlp or your package manager."
    clean_url = url
    if "youtube.com/watch" in clean_url and "&list=" in clean_url:
        try:
            parsed = urllib.parse.urlparse(clean_url)
            qs = urllib.parse.parse_qs(parsed.query)
            if "v" in qs:
                clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?v={qs['v'][0]}"
        except Exception:
            pass
    cmd = yt_dlp if isinstance(yt_dlp, list) else [yt_dlp]
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        r = run_cmd(
            [*cmd, "--encoding", "utf-8", "--no-warnings", "--no-playlist", "-f", "ba/b", "--print", "%(title)s", "--print", "%(duration)s", "-g", clean_url],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=22
        )
        if r.returncode == 0 and r.stdout.strip():
            lines = [line.strip() for line in r.stdout.strip().splitlines() if line.strip()]
            stream_url = next((line for line in reversed(lines) if line.startswith("http://") or line.startswith("https://")), None)
            if stream_url:
                non_url = [l for l in lines if not (l.startswith("http://") or l.startswith("https://"))]
                duration = 0
                title_parts = []
                for l in non_url:
                    if duration == 0 and (l.isdigit() or (l.replace(".", "", 1).isdigit() and "." in l)):
                        try:
                            duration = int(float(l))
                            continue
                        except Exception:
                            pass
                    title_parts.append(l)
                title = " ".join(title_parts).strip() if title_parts else derive_direct_title(url)
                return title, stream_url, duration, None
    except Exception as e:
        return None, None, 0, f"Failed to extract stream: {str(e)}"

    return None, None, 0, "Extractor error. YouTube or SoundCloud stream could not be resolved. Try running 'yt-dlp -U'."

def derive_direct_title(url):
    try:
        parsed = urllib.parse.urlparse(url)
        path = parsed.path.rstrip("/")
        name = os.path.basename(path)
        if name:
            clean = os.path.splitext(name)[0].replace("-", " ").replace("_", " ")
            if clean:
                return clean.title()
        if parsed.netloc:
            return parsed.netloc
    except Exception:
        pass
    return "Audio Stream"

def is_playlist_url(url):
    u = url.lower()
    return ("youtube.com" in u or "youtu.be" in u) and ("list=" in u)

def extract_video_id(url):
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        if "youtube.com" in netloc or "youtu.be" in netloc:
            if "youtu.be" in netloc:
                path = parsed.path.strip("/")
                if path:
                    return path.split("/")[0].split("?")[0]
            qs = urllib.parse.parse_qs(parsed.query)
            if "v" in qs and qs["v"]:
                return qs["v"][0]
            path = parsed.path.strip("/").split("/")
            if len(path) >= 2 and path[0] in ("shorts", "embed", "v"):
                return path[1]
    except Exception:
        pass
    return None

def extract_playlist_items(url, limit=25):
    yt_dlp = find_ytdlp_bin()
    if not yt_dlp:
        return []
    cmd = yt_dlp if isinstance(yt_dlp, list) else [yt_dlp]
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        r = run_cmd(
            [*cmd, "--encoding", "utf-8", "--no-warnings", "--flat-playlist", "--playlist-end", str(limit), "--print", "%(id)s\t%(title)s\t%(duration)s", url],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=18
        )
        items = []
        if r.returncode == 0 and r.stdout.strip():
            for line in r.stdout.strip().splitlines():
                parts = line.split("\t")
                if len(parts) >= 2 and parts[0].strip():
                    v_id = parts[0].strip()
                    t = parts[1].strip() or "YouTube Track"
                    d_str = parts[2].strip() if len(parts) > 2 else ""
                    dur = 0
                    try:
                        if d_str and d_str != "NA":
                            dur = int(float(d_str))
                    except Exception:
                        pass
                    items.append({
                        "id": v_id,
                        "title": t,
                        "duration": dur,
                        "url": f"https://www.youtube.com/watch?v={v_id}",
                        "stream_url": None,
                        "resolved_at": 0
                    })
        return items
    except Exception:
        return []

def launch_prefetch_worker():
    if os.path.exists(PREFETCH_PID_FILE):
        try:
            with open(PREFETCH_PID_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
                pid = int(content) if content.isdigit() else None
            if pid and pid == os.getpid():
                return
            if pid and pid > 0:
                try:
                    os.kill(pid, 0)
                    return
                except OSError:
                    pass
        except Exception:
            pass
    kill_prefetch_worker()
    py = sys.executable
    if sys.platform == "win32" and py.lower().endswith("python.exe"):
        pyw = py[:-4] + "w.exe"
        if os.path.isfile(pyw):
            py = pyw
    script = os.path.abspath(__file__)
    args = [py, script, "prefetch"]
    try:
        ensure_cache_dir()
        proc = popen_cmd(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True if sys.platform != "win32" else False
        )
        with open(PREFETCH_PID_FILE, "w", encoding="utf-8") as f:
            f.write(str(proc.pid))
    except Exception:
        pass

def cmd_prefetch():
    idle_count = 0
    while True:
        queue = read_queue()
        if not queue:
            break

        if queue.get("needs_expansion") and queue.get("playlist_url"):
            p_url = queue["playlist_url"]
            full_items = extract_playlist_items(p_url, limit=25)
            q_fresh = read_queue()
            if q_fresh and q_fresh.get("needs_expansion"):
                if full_items:
                    cur_items = q_fresh.get("items", [])
                    cur_id = cur_items[0]["id"] if cur_items else None
                    matched_idx = 0
                    if cur_id:
                        for idx, it in enumerate(full_items):
                            if it["id"] == cur_id:
                                matched_idx = idx
                                if cur_items:
                                    full_items[idx] = cur_items[0]
                                break
                    q_fresh["items"] = full_items
                    q_fresh["current_index"] = matched_idx
                    q_fresh["needs_expansion"] = False
                    write_queue(q_fresh)

                    st = read_state()
                    if st and st.get("playing"):
                        title = full_items[matched_idx].get("title") or "YouTube Track"
                        st["playlist"] = {
                            "index": matched_idx + 1,
                            "total": len(full_items)
                        }
                        st["title"] = f"[{matched_idx + 1}/{len(full_items)}] {title}"
                        write_state(st)
                        update_history_title(p_url, f"Playlist: {title}")
                else:
                    q_fresh["needs_expansion"] = False
                    write_queue(q_fresh)
            queue = read_queue()
            if not queue:
                break

        if not queue.get("items"):
            break

        cur_idx = queue.get("current_index", 0)
        items = queue.get("items", [])
        now = int(time.time())

        target_indices = list(range(cur_idx + 1, min(len(items), cur_idx + 1 + POOL_SIZE)))
        for idx in target_indices:
            q_now = read_queue()
            if not q_now or q_now.get("current_index") != cur_idx:
                break
            it = q_now["items"][idx]
            if it.get("stream_url") and (now - it.get("resolved_at", 0) < 14400):
                continue
            ext_title, ext_stream, ext_dur, err = extract_stream_info(it["url"])
            if ext_stream:
                q_update = read_queue()
                if not q_update or q_update.get("current_index") != cur_idx:
                    break
                q_update["items"][idx]["stream_url"] = ext_stream
                q_update["items"][idx]["resolved_at"] = int(time.time())
                if ext_title:
                    q_update["items"][idx]["title"] = ext_title
                if ext_dur:
                    q_update["items"][idx]["duration"] = ext_dur
                write_queue(q_update)

        time.sleep(2)
        current = read_state()
        if not current:
            idle_count += 1
            if idle_count > 5:
                break
            continue
        idle_count = 0

    return {"status": "ok"}

def cmd_play_queue_index(index):
    queue = read_queue()
    if not queue or not queue.get("items") or index < 0 or index >= len(queue["items"]):
        return {"status": "error", "error": "Invalid queue index", "playing": False}

    stop_all_players(keep_queue=True)
    item = queue["items"][index]
    queue["current_index"] = index
    write_queue(queue)

    stream_url = item.get("stream_url")
    title = item.get("title") or "YouTube Track"
    url = item.get("url")
    duration = item.get("duration", 0)
    now = int(time.time())

    if not stream_url or (now - item.get("resolved_at", 0) >= 14400):
        write_state({
            "pid": None,
            "startTime": now,
            "elapsed": 0,
            "duration": duration,
            "currentElapsed": 0,
            "url": url,
            "title": f"[{index + 1}/{len(queue['items'])}] {title}",
            "status": "buffering",
            "playing": False,
            "source": "youtube"
        })
        ext_title, ext_stream, ext_dur, err = extract_stream_info(url)
        if err or not ext_stream:
            if index + 1 < len(queue["items"]):
                return cmd_play_queue_index(index + 1)
            clear_queue()
            clear_state()
            return {"status": "error", "error": err or "Failed to extract stream", "playing": False}
        stream_url = ext_stream
        if ext_title:
            title = ext_title
        if ext_dur:
            duration = ext_dur
        queue = read_queue()
        if queue and index < len(queue["items"]):
            queue["items"][index]["stream_url"] = stream_url
            queue["items"][index]["title"] = title
            queue["items"][index]["duration"] = duration
            queue["items"][index]["resolved_at"] = int(time.time())
            write_queue(queue)

    player_bin = find_player_bin()
    if not player_bin:
        clear_queue()
        clear_state()
        return {"status": "error", "error": "Neither ffplay nor mpv found. Install ffmpeg or mpv to enable playback.", "playing": False}

    is_ffplay = "ffplay" in os.path.basename(player_bin).lower()
    args = [player_bin, "-nodisp", "-autoexit", "-loglevel", "quiet", stream_url] if is_ffplay else [player_bin, "--no-video", "--really-quiet", stream_url]
    env = os.environ.copy()
    env["SDL_VIDEODRIVER"] = "dummy"

    try:
        proc = popen_cmd(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True if sys.platform != "win32" else False
        )
    except Exception as e:
        clear_queue()
        clear_state()
        return {"status": "error", "error": f"Failed to start player process: {str(e)}", "playing": False}

    display_title = f"[{index + 1}/{len(queue['items'])}] {title}"
    state = {
        "pid": proc.pid,
        "startTime": int(time.time()),
        "elapsed": 0,
        "duration": duration,
        "currentElapsed": 0,
        "url": url,
        "title": display_title,
        "status": "playing",
        "playing": True,
        "source": "youtube",
        "playlist": {
            "index": index + 1,
            "total": len(queue["items"])
        },
        "history": read_history()
    }
    write_state(state)
    launch_prefetch_worker()
    return state

def read_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data[:MAX_HISTORY]
            return []
    except Exception:
        return []

def write_history(data):
    ensure_cache_dir()
    tmp_file = f"{HISTORY_FILE}.tmp.{os.getpid()}"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(tmp_file, flags, 0o600)
        with open(fd, "w", encoding="utf-8") as f:
            json.dump(data[:MAX_HISTORY], f)
        os.replace(tmp_file, HISTORY_FILE)
        if sys.platform != "win32":
            try:
                os.chmod(HISTORY_FILE, 0o600)
            except OSError:
                pass
    except Exception:
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass

def clear_history():
    if os.path.exists(HISTORY_FILE):
        try:
            os.remove(HISTORY_FILE)
        except OSError:
            pass

def add_history(url, title=None, item_type=None):
    if not url:
        return
    if not item_type:
        if is_playlist_url(url):
            item_type = "playlist"
        elif is_extractor_url(url):
            item_type = "youtube"
        else:
            item_type = "direct"
    if not title:
        title = derive_direct_title(url) or "Audio Stream"

    current = read_history()
    filtered = [item for item in current if item.get("url") != url]
    entry = {
        "url": url,
        "title": title,
        "type": item_type,
        "played_at": int(time.time())
    }
    updated = [entry] + filtered
    write_history(updated[:MAX_HISTORY])

def update_history_title(url, title):
    if not url or not title:
        return
    current = read_history()
    updated = False
    for item in current:
        if item.get("url") == url:
            item["title"] = title
            updated = True
            break
    if updated:
        write_history(current)

def cmd_play(url, preset_title=None):
    valid, res = validate_url(url)
    if not valid:
        return {"status": "error", "error": res, "playing": False, "history": read_history()}

    if is_playlist_url(res):
        add_history(res, preset_title or "YouTube Playlist", "playlist")
        stop_all_players(keep_queue=False)
        write_state({
            "pid": None,
            "startTime": int(time.time()),
            "url": res,
            "title": "Buffering stream...",
            "status": "buffering",
            "playing": False,
            "source": "youtube",
            "history": read_history()
        })
        video_id = extract_video_id(res)
        first_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else None
        if not first_url:
            init_items = extract_playlist_items(res, limit=1)
            if init_items:
                first_url = init_items[0]["url"]
                video_id = init_items[0]["id"]
            else:
                first_url = res

        ext_title, ext_stream, ext_dur, err = extract_stream_info(first_url)
        if err or not ext_stream:
            init_items = extract_playlist_items(res, limit=5)
            if len(init_items) > 1:
                queue_data = {
                    "playlist_url": res,
                    "current_index": 0,
                    "items": init_items,
                    "needs_expansion": True
                }
                write_queue(queue_data)
                return cmd_play_queue_index(0)
            clear_state()
            return {"status": "error", "error": err or "Failed to extract stream", "playing": False, "history": read_history()}

        player_bin = find_player_bin()
        if not player_bin:
            clear_state()
            return {"status": "error", "error": "Neither ffplay nor mpv found. Install ffmpeg or mpv to enable playback.", "playing": False, "history": read_history()}

        is_ffplay = "ffplay" in os.path.basename(player_bin).lower()
        args = [player_bin, "-nodisp", "-autoexit", "-loglevel", "quiet", ext_stream] if is_ffplay else [player_bin, "--no-video", "--really-quiet", ext_stream]
        env = os.environ.copy()
        env["SDL_VIDEODRIVER"] = "dummy"

        try:
            proc = popen_cmd(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True if sys.platform != "win32" else False
            )
        except Exception as e:
            clear_state()
            return {"status": "error", "error": f"Failed to start player process: {str(e)}", "playing": False, "history": read_history()}

        queue_data = {
            "playlist_url": res,
            "current_index": 0,
            "items": [{
                "id": video_id or "track-1",
                "title": ext_title or "YouTube Track",
                "duration": ext_dur or 0,
                "url": first_url,
                "stream_url": ext_stream,
                "resolved_at": int(time.time())
            }],
            "needs_expansion": True
        }
        write_queue(queue_data)

        display_title = ext_title or "YouTube Track"
        state = {
            "pid": proc.pid,
            "startTime": int(time.time()),
            "elapsed": 0,
            "duration": ext_dur or 0,
            "currentElapsed": 0,
            "url": first_url,
            "title": display_title,
            "status": "playing",
            "playing": True,
            "source": "youtube",
            "playlist": {
                "index": 1,
                "total": 1
            },
            "history": read_history()
        }
        write_state(state)
        update_history_title(res, f"Playlist: {display_title}")
        launch_prefetch_worker()
        return state

    item_type = "youtube" if is_extractor_url(res) else "direct"
    init_title = preset_title or (derive_direct_title(res) if item_type == "direct" else "YouTube Track")
    add_history(res, init_title, item_type)

    stop_all_players(keep_queue=False)

    write_state({
        "pid": None,
        "startTime": int(time.time()),
        "url": res,
        "title": preset_title or "Buffering stream...",
        "status": "buffering",
        "playing": False,
        "source": item_type,
        "history": read_history()
    })

    player_bin = find_player_bin()
    if not player_bin:
        clear_state()
        return {"status": "error", "error": "Neither ffplay nor mpv found. Install ffmpeg or mpv to enable playback.", "playing": False, "history": read_history()}

    source = "direct"
    title = preset_title
    stream_url = res
    duration = 0

    if is_extractor_url(res):
        source = "youtube" if "youtu" in res.lower() else "soundcloud"
        ext_title, ext_stream, ext_dur, err = extract_stream_info(res)
        if err:
            clear_state()
            return {"status": "error", "error": err, "playing": False, "history": read_history()}
        stream_url = ext_stream
        title = ext_title or title or derive_direct_title(res)
        if ext_dur:
            duration = ext_dur
        if ext_title:
            update_history_title(res, ext_title)
    else:
        if not title:
            title = derive_direct_title(res)
            update_history_title(res, title)

    is_ffplay = "ffplay" in os.path.basename(player_bin).lower()
    args = [player_bin, "-nodisp", "-autoexit", "-loglevel", "quiet", stream_url] if is_ffplay else [player_bin, "--no-video", "--really-quiet", stream_url]
    env = os.environ.copy()
    env["SDL_VIDEODRIVER"] = "dummy"

    try:
        proc = popen_cmd(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True if sys.platform != "win32" else False
        )
    except Exception as e:
        clear_state()
        return {"status": "error", "error": f"Failed to start player process: {str(e)}", "playing": False, "history": read_history()}

    state = {
        "pid": proc.pid,
        "startTime": int(time.time()),
        "elapsed": 0,
        "duration": duration,
        "currentElapsed": 0,
        "url": res,
        "title": title,
        "status": "playing",
        "playing": True,
        "source": source,
        "history": read_history()
    }
    write_state(state)
    return state

def cmd_pause():
    current = read_state()
    if not current or not current.get("pid"):
        return {"status": "idle", "playing": False, "title": "", "url": "", "elapsed": 0, "duration": 0, "currentElapsed": 0, "history": read_history()}
    pid = current["pid"]
    if not is_valid_player_proc(pid):
        clear_state()
        return {"status": "idle", "playing": False, "title": "", "url": "", "elapsed": 0, "duration": 0, "currentElapsed": 0, "history": read_history()}

    suspend_process(pid)
    now = int(time.time())
    start = current.get("startTime", now)
    current["elapsed"] = current.get("elapsed", 0) + max(0, now - start)
    current["startTime"] = now
    current["currentElapsed"] = current["elapsed"]
    current["status"] = "paused"
    current["playing"] = False
    current["history"] = read_history()
    write_state(current)
    return current

def cmd_resume():
    current = read_state()
    if not current or not current.get("pid"):
        return {"status": "idle", "playing": False, "title": "", "url": "", "elapsed": 0, "duration": 0, "currentElapsed": 0, "history": read_history()}
    pid = current["pid"]
    if not is_valid_player_proc(pid):
        clear_state()
        return {"status": "idle", "playing": False, "title": "", "url": "", "elapsed": 0, "duration": 0, "currentElapsed": 0, "history": read_history()}

    resume_process(pid)
    current["startTime"] = int(time.time())
    current["status"] = "playing"
    current["playing"] = True
    current["history"] = read_history()
    write_state(current)
    return current

def cmd_stop():
    stop_all_players(keep_queue=False)
    return {"status": "idle", "playing": False, "title": "", "url": "", "source": "direct", "elapsed": 0, "duration": 0, "currentElapsed": 0, "history": read_history()}

def cmd_status():
    current = read_state()
    if current and current.get("pid"):
        now = int(time.time())
        base = current.get("elapsed", 0)
        dur = current.get("duration", 0)
        is_playing = current.get("playing", False)
        current_elapsed = base + (max(0, now - current.get("startTime", now)) if is_playing else 0)
        current["currentElapsed"] = current_elapsed
        current["history"] = read_history()

        proc_alive = is_valid_player_proc(current["pid"])
        is_expired = is_playing and dur > 0 and current_elapsed >= dur + 1.5

        if proc_alive and not is_expired:
            return current

        if is_playing and (now - current.get("startTime", now) < 6) and not is_expired:
            orphan = find_running_player_pid()
            if orphan:
                current["pid"] = orphan
                write_state(current)
                return current
            return current

    if current and current.get("status") == "buffering":
        if int(time.time()) - current.get("startTime", 0) <= 35:
            current["currentElapsed"] = current.get("elapsed", 0)
            current["history"] = read_history()
            return current

    queue = read_queue()
    if queue and queue.get("items"):
        cur_idx = queue.get("current_index", 0)
        items = queue.get("items", [])
        if cur_idx + 1 < len(items):
            res = cmd_play_queue_index(cur_idx + 1)
            res["history"] = read_history()
            return res
        else:
            clear_queue()

    orphan_pid = find_running_player_pid()
    if orphan_pid:
        state = {
            "pid": orphan_pid,
            "startTime": int(time.time()),
            "elapsed": 0,
            "duration": 0,
            "currentElapsed": 0,
            "url": current.get("url", "") if current else "",
            "title": current.get("title", "Audio Stream") if (current and current.get("title") and current.get("title") != "Buffering stream...") else "Audio Stream",
            "status": "playing",
            "playing": True,
            "source": current.get("source", "direct") if current else "direct",
            "history": read_history()
        }
        write_state(state)
        return state

    clear_state()
    return {"status": "idle", "playing": False, "title": "", "url": "", "source": "direct", "elapsed": 0, "duration": 0, "currentElapsed": 0, "history": read_history()}

def cmd_next():
    queue = read_queue()
    if queue and queue.get("items"):
        if queue.get("needs_expansion") and queue.get("playlist_url"):
            full_items = extract_playlist_items(queue["playlist_url"], limit=25)
            if full_items:
                cur_items = queue.get("items", [])
                cur_id = cur_items[0]["id"] if cur_items else None
                matched_idx = 0
                if cur_id:
                    for idx, it in enumerate(full_items):
                        if it["id"] == cur_id:
                            matched_idx = idx
                            if cur_items:
                                full_items[idx] = cur_items[0]
                            break
                queue["items"] = full_items
                queue["current_index"] = matched_idx
            queue["needs_expansion"] = False
            write_queue(queue)
        cur_idx = queue.get("current_index", 0)
        items = queue.get("items", [])
        if cur_idx + 1 < len(items):
            return cmd_play_queue_index(cur_idx + 1)
        else:
            return cmd_play_queue_index(0)

    current = read_state()
    cur_url = current.get("url") if current else None
    idx = -1
    for i, p in enumerate(DEFAULT_PRESETS):
        if p["url"] == cur_url:
            idx = i
            break
    next_idx = (idx + 1) % len(DEFAULT_PRESETS)
    return cmd_play(DEFAULT_PRESETS[next_idx]["url"], DEFAULT_PRESETS[next_idx]["title"])

def cmd_prev():
    queue = read_queue()
    if queue and queue.get("items"):
        if queue.get("needs_expansion") and queue.get("playlist_url"):
            full_items = extract_playlist_items(queue["playlist_url"], limit=25)
            if full_items:
                cur_items = queue.get("items", [])
                cur_id = cur_items[0]["id"] if cur_items else None
                matched_idx = 0
                if cur_id:
                    for idx, it in enumerate(full_items):
                        if it["id"] == cur_id:
                            matched_idx = idx
                            if cur_items:
                                full_items[idx] = cur_items[0]
                            break
                queue["items"] = full_items
                queue["current_index"] = matched_idx
            queue["needs_expansion"] = False
            write_queue(queue)
        cur_idx = queue.get("current_index", 0)
        if cur_idx > 0:
            return cmd_play_queue_index(cur_idx - 1)
        else:
            return cmd_play_queue_index(0)

    current = read_state()
    cur_url = current.get("url") if current else None
    idx = 0
    for i, p in enumerate(DEFAULT_PRESETS):
        if p["url"] == cur_url:
            idx = i
            break
    prev_idx = (idx - 1) % len(DEFAULT_PRESETS)
    return cmd_play(DEFAULT_PRESETS[prev_idx]["url"], DEFAULT_PRESETS[prev_idx]["title"])

def cmd_toggle():
    current = read_state()
    if not current or current.get("status") == "idle":
        return cmd_play(DEFAULT_PRESETS[0]["url"], DEFAULT_PRESETS[0]["title"])
    if current.get("status") == "paused":
        return cmd_resume()
    if current.get("status") == "playing":
        return cmd_pause()
    return current

def cmd_check():
    player_bin = find_player_bin()
    yt_dlp = find_ytdlp_bin()
    return {
        "status": "ok",
        "has_player": bool(player_bin),
        "player": player_bin,
        "has_ytdlp": bool(yt_dlp),
        "platform": sys.platform
    }

def main():
    if len(sys.argv) < 2:
        out = cmd_status()
        json.dump(out, sys.stdout, ensure_ascii=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return

    action = sys.argv[1].lower()
    if action == "play":
        url = sys.argv[2] if len(sys.argv) > 2 else ""
        preset = sys.argv[3] if len(sys.argv) > 3 else None
        out = cmd_play(url, preset)
    elif action == "prefetch":
        out = cmd_prefetch()
    elif action == "pause":
        out = cmd_pause()
    elif action == "resume":
        out = cmd_resume()
    elif action == "stop":
        out = cmd_stop()
    elif action == "next":
        out = cmd_next()
    elif action == "prev":
        out = cmd_prev()
    elif action == "toggle":
        out = cmd_toggle()
    elif action == "status":
        out = cmd_status()
    elif action == "check":
        out = cmd_check()
    elif action == "history":
        out = {"status": "ok", "history": read_history()}
    elif action == "clear-history":
        clear_history()
        out = {"status": "ok", "history": []}
    else:
        out = {"status": "error", "error": f"Unknown action: {action}", "playing": False}

    json.dump(out, sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")
    sys.stdout.flush()

if __name__ == "__main__":
    main()
