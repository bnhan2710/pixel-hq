import os
import sys
import json
import time
import shutil
import signal
import urllib.parse
import subprocess

CACHE_DIR = os.path.expanduser("~/.cache/pixel-hq/music")
STATE_FILE = os.path.join(CACHE_DIR, "state.json")

DEFAULT_PRESETS = [
    {"title": "SomaFM Groove Salad", "url": "https://ice2.somafm.com/groovesalad-128-mp3"},
    {"title": "Nightwave Plaza", "url": "https://stream.plaza.one/mp3"},
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
            r = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, timeout=2)
            if r.returncode == 0 and r.stdout.strip():
                parts = r.stdout.strip().split()
                if parts:
                    base = os.path.basename(parts[0]).lower()
                    return base in ("ffplay", "mpv")
        except Exception:
            return False
        return False
    elif sys.platform == "win32":
        try:
            r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=2)
            out = r.stdout.lower()
            return '"ffplay.exe"' in out or '"mpv.exe"' in out
        except Exception:
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
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=3)
        except Exception:
            pass

def find_running_player_pid():
    if sys.platform == "win32":
        try:
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq ffplay.exe", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=2)
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
            r = subprocess.run(["pgrep", "-x", "ffplay"], capture_output=True, text=True, timeout=2)
            pids = [int(p) for p in r.stdout.splitlines() if p.strip().isdigit()]
            if pids:
                return pids[0]
        except Exception:
            pass
    return None

def stop_all_players():
    current = read_state()
    if current and current.get("pid"):
        stop_process(current["pid"], current.get("status") == "paused")
    if sys.platform == "win32":
        try:
            subprocess.run(["taskkill", "/F", "/IM", "ffplay.exe"], capture_output=True, timeout=2)
            subprocess.run(["taskkill", "/F", "/IM", "mpv.exe"], capture_output=True, timeout=2)
        except Exception:
            pass
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
    if sys.platform == "win32":
        candidates = [
            os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe"),
            os.path.expanduser(r"~\AppData\Local\Programs\Python\Python311\Scripts\yt-dlp.exe"),
            os.path.expanduser(r"~\AppData\Local\Programs\Python\Python312\Scripts\yt-dlp.exe"),
            os.path.expanduser(r"~\scoop\shims\yt-dlp.exe"),
        ]
        for path in candidates:
            if os.path.isfile(path):
                return path
    return None

def is_extractor_url(url):
    u = url.lower()
    return "youtube.com" in u or "youtu.be" in u or "soundcloud.com" in u

def extract_stream_info(url):
    yt_dlp = find_ytdlp_bin()
    if not yt_dlp:
        return None, None, "yt-dlp is required for YouTube and SoundCloud streams. Install via pip install yt-dlp or your package manager."
    clean_url = url
    if "youtube.com/watch" in clean_url and "&list=" in clean_url:
        try:
            parsed = urllib.parse.urlparse(clean_url)
            qs = urllib.parse.parse_qs(parsed.query)
            if "v" in qs:
                clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?v={qs['v'][0]}"
        except Exception:
            pass
    try:
        r = subprocess.run(
            [yt_dlp, "--no-warnings", "--no-playlist", "-f", "ba/b", "--print", "%(title)s", "-g", clean_url],
            capture_output=True,
            text=True,
            timeout=18
        )
        if r.returncode == 0 and r.stdout.strip():
            lines = [line.strip() for line in r.stdout.strip().splitlines() if line.strip()]
            if len(lines) >= 2:
                title = lines[0]
                stream_url = lines[1]
                return title, stream_url, None
            elif len(lines) == 1 and (lines[0].startswith("http://") or lines[0].startswith("https://")):
                return derive_direct_title(url), lines[0], None
    except Exception as e:
        return None, None, f"Failed to extract stream: {str(e)}"

    return None, None, "Extractor error. YouTube or SoundCloud stream could not be resolved. Try running 'yt-dlp -U'."

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

def cmd_play(url, preset_title=None):
    valid, res = validate_url(url)
    if not valid:
        return {"status": "error", "error": res, "playing": False}

    stop_all_players()

    write_state({
        "pid": None,
        "startTime": int(time.time()),
        "url": res,
        "title": preset_title or "Buffering stream...",
        "status": "buffering",
        "playing": False,
        "source": "youtube" if is_extractor_url(res) else "direct"
    })

    player_bin = find_player_bin()
    if not player_bin:
        clear_state()
        return {"status": "error", "error": "Neither ffplay nor mpv found. Install ffmpeg or mpv to enable playback.", "playing": False}

    source = "direct"
    title = preset_title
    stream_url = res

    if is_extractor_url(res):
        source = "youtube" if "youtu" in res.lower() else "soundcloud"
        ext_title, ext_stream, err = extract_stream_info(res)
        if err:
            clear_state()
            return {"status": "error", "error": err, "playing": False}
        stream_url = ext_stream
        title = ext_title or title or derive_direct_title(res)
    else:
        if not title:
            title = derive_direct_title(res)

    is_ffplay = "ffplay" in os.path.basename(player_bin).lower()
    args = [player_bin, "-nodisp", "-autoexit", "-loglevel", "quiet", stream_url] if is_ffplay else [player_bin, "--no-video", "--really-quiet", stream_url]

    try:
        proc = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True if sys.platform != "win32" else False
        )
    except Exception as e:
        clear_state()
        return {"status": "error", "error": f"Failed to start player process: {str(e)}", "playing": False}

    state = {
        "pid": proc.pid,
        "startTime": int(time.time()),
        "url": res,
        "title": title,
        "status": "playing",
        "playing": True,
        "source": source
    }
    write_state(state)
    return state

def cmd_pause():
    current = read_state()
    if not current or not current.get("pid"):
        return {"status": "idle", "playing": False, "title": "", "url": ""}
    pid = current["pid"]
    if not is_valid_player_proc(pid):
        clear_state()
        return {"status": "idle", "playing": False, "title": "", "url": ""}

    suspend_process(pid)
    current["status"] = "paused"
    current["playing"] = False
    write_state(current)
    return current

def cmd_resume():
    current = read_state()
    if not current or not current.get("pid"):
        return {"status": "idle", "playing": False, "title": "", "url": ""}
    pid = current["pid"]
    if not is_valid_player_proc(pid):
        clear_state()
        return {"status": "idle", "playing": False, "title": "", "url": ""}

    resume_process(pid)
    current["status"] = "playing"
    current["playing"] = True
    write_state(current)
    return current

def cmd_stop():
    stop_all_players()
    return {"status": "idle", "playing": False, "title": "", "url": "", "source": "direct"}

def cmd_status():
    current = read_state()
    if current and current.get("pid") and is_valid_player_proc(current["pid"]):
        return current
    if current and current.get("status") == "buffering":
        if int(time.time()) - current.get("startTime", 0) <= 35:
            return current

    orphan_pid = find_running_player_pid()
    if orphan_pid:
        state = {
            "pid": orphan_pid,
            "startTime": int(time.time()),
            "url": current.get("url", "") if current else "",
            "title": current.get("title", "Audio Stream") if (current and current.get("title") and current.get("title") != "Buffering stream...") else "Audio Stream",
            "status": "playing",
            "playing": True,
            "source": current.get("source", "direct") if current else "direct"
        }
        write_state(state)
        return state

    clear_state()
    return {"status": "idle", "playing": False, "title": "", "url": ""}

def cmd_next():
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
        json.dump(out, sys.stdout)
        sys.stdout.write("\n")
        return

    action = sys.argv[1].lower()
    if action == "play":
        url = sys.argv[2] if len(sys.argv) > 2 else ""
        preset = sys.argv[3] if len(sys.argv) > 3 else None
        out = cmd_play(url, preset)
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
    else:
        out = {"status": "error", "error": f"Unknown action: {action}", "playing": False}

    json.dump(out, sys.stdout)
    sys.stdout.write("\n")

if __name__ == "__main__":
    main()
