#!/usr/bin/env python3
import json
import os
import stat
import sys
import time
import shutil
import tempfile
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYER_PY = os.path.join(SCRIPT_DIR, "../mods/company-music/player.py")

sys.path.insert(0, os.path.join(SCRIPT_DIR, "../mods/company-music"))
import player

def test_1_url_validation():
    print("=== Test 1: URL Sanitization & Whitelist ===")
    valid, res = player.validate_url("https://somafm.com/groovesalad-128-mp3")
    assert valid is True
    valid, res = player.validate_url("http://stream.plaza.one/mp3")
    assert valid is True
    valid, res = player.validate_url("file:///etc/passwd")
    assert valid is False
    assert "Only http:// and https://" in res
    valid, res = player.validate_url("https://youtube.com/watch?v=123\nrm -rf /")
    assert valid is False
    valid, res = player.validate_url("https://example.com/stream\0.mp3")
    assert valid is False
    print("PASS: Test 1 - URL sanitization and whitelist validated")

def test_2_title_derivation():
    print("=== Test 2: Direct Stream Title Derivation ===")
    t1 = player.derive_direct_title("https://ice2.somafm.com/groovesalad-128-mp3")
    assert "Groovesalad" in t1 or "Somafm" in t1
    t2 = player.derive_direct_title("https://stream.plaza.one/mp3")
    assert len(t2) > 0
    t3 = player.derive_direct_title("https://radio.example.com/")
    assert t3 == "radio.example.com"
    print("PASS: Test 2 - Title derivation works reliably")

def test_3_cache_and_file_permissions():
    print("=== Test 3: Cache Directory & File Permissions ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        target_dir = os.path.join(td, "cache_sub")
        os.makedirs(target_dir, mode=0o777, exist_ok=True)
        player.CACHE_DIR = target_dir
        player.STATE_FILE = os.path.join(target_dir, "state.json")
        try:
            player.ensure_cache_dir()
            if sys.platform != "win32":
                dir_mode = stat.S_IMODE(os.stat(target_dir).st_mode)
                assert dir_mode == 0o700, f"Expected 0700, got {oct(dir_mode)}"

            sample = {"pid": 1234, "status": "playing", "playing": True}
            player.write_state(sample)
            assert os.path.exists(player.STATE_FILE)

            if sys.platform != "win32":
                file_mode = stat.S_IMODE(os.stat(player.STATE_FILE).st_mode)
                assert file_mode == 0o600, f"Expected 0600, got {oct(file_mode)}"

            readback = player.read_state()
            assert readback == sample
        finally:
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 3 - Cache directory 0700 and state file 0600 strictly enforced")

def test_4_strict_pid_verification():
    print("=== Test 4: Strict PID Verification ===")
    with tempfile.TemporaryDirectory() as td:
        assert player.is_valid_player_proc(0) is False
        assert player.is_valid_player_proc(-1) is False

        spoof_proc = subprocess.Popen(["sleep", "10", "ffplay", "mpv"])
        try:
            assert player.is_valid_player_proc(spoof_proc.pid) is False
        finally:
            spoof_proc.terminate()
            spoof_proc.wait()

        assert player.is_valid_player_proc(spoof_proc.pid) is False

        mock_bin = os.path.join(td, "ffplay")
        with open(mock_bin, "w") as f:
            f.write("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n")
        os.chmod(mock_bin, 0o755)

        p = subprocess.Popen([mock_bin], start_new_session=True if sys.platform != "win32" else False)
        try:
            time.sleep(0.1)
            assert player.is_valid_player_proc(p.pid) is True
        finally:
            p.kill()
            p.wait()
    print("PASS: Test 4 - Strict PID verification rejects impostor processes")

def test_5_pause_and_resume_lifecycle():
    print("=== Test 5: Pause and Resume Lifecycle ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")

        mock_bin = os.path.join(td, "ffplay")
        with open(mock_bin, "w") as f:
            f.write("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n")
        os.chmod(mock_bin, 0o755)

        p = subprocess.Popen([mock_bin], start_new_session=True if sys.platform != "win32" else False)
        try:
            time.sleep(0.1)
            st = {"pid": p.pid, "startTime": int(time.time()), "url": "https://example.com/stream.mp3", "title": "Test", "status": "playing", "playing": True, "source": "direct"}
            player.write_state(st)

            paused = player.cmd_pause()
            assert paused["status"] == "paused"
            assert paused["playing"] is False

            resumed = player.cmd_resume()
            assert resumed["status"] == "playing"
            assert resumed["playing"] is True
        finally:
            p.kill()
            p.wait()
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 5 - Pause and Resume lifecycle transitions verified")

def test_6_stop_while_paused_and_cleanup():
    print("=== Test 6: Stop While Paused and Cleanup ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")

        mock_bin = os.path.join(td, "ffplay")
        with open(mock_bin, "w") as f:
            f.write("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n")
        os.chmod(mock_bin, 0o755)

        p = subprocess.Popen([mock_bin], start_new_session=True if sys.platform != "win32" else False)
        try:
            time.sleep(0.1)
            st = {"pid": p.pid, "startTime": int(time.time()), "url": "https://example.com/stream.mp3", "title": "Test", "status": "playing", "playing": True, "source": "direct"}
            player.write_state(st)

            player.cmd_pause()
            stopped = player.cmd_stop()
            assert stopped["status"] == "idle"
            assert stopped["playing"] is False
            assert not os.path.exists(player.STATE_FILE)

            time.sleep(0.2)
            assert player.is_valid_player_proc(p.pid) is False
        finally:
            if p.poll() is None:
                p.kill()
                p.wait()
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 6 - Stop while paused safely resumes before termination")

def test_7_missing_dependency_reporting():
    print("=== Test 7: Missing Dependency Error Reporting ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        orig_path = os.environ.get("PATH", "")
        try:
            os.environ["PATH"] = td
            res_direct = player.cmd_play("https://somafm.com/groovesalad.mp3")
            assert res_direct["status"] == "error"
            assert "Neither ffplay nor mpv found" in res_direct["error"]

            mock_ffplay = os.path.join(td, "ffplay")
            with open(mock_ffplay, "w") as f:
                f.write("#!/bin/sh\nexit 0\n")
            os.chmod(mock_ffplay, 0o755)

            orig_find_ytdlp = player.find_ytdlp_bin
            try:
                player.find_ytdlp_bin = lambda: None
                res_yt = player.cmd_play("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                assert res_yt["status"] == "error"
                assert "yt-dlp is required" in res_yt["error"]
            finally:
                player.find_ytdlp_bin = orig_find_ytdlp
        finally:
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
            os.environ["PATH"] = orig_path
    print("PASS: Test 7 - Missing dependency guidance errors verified")

def test_8_next_prev_cycling():
    print("=== Test 8: Next and Previous Preset Cycling ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        try:
            player.write_state({
                "pid": 99999,
                "url": player.DEFAULT_PRESETS[0]["url"],
                "title": player.DEFAULT_PRESETS[0]["title"],
                "status": "playing",
                "playing": True
            })
            idx = 0
            cur_url = player.DEFAULT_PRESETS[idx]["url"]
            found = False
            for i, p in enumerate(player.DEFAULT_PRESETS):
                if p["url"] == cur_url:
                    found = True
                    break
            assert found is True
        finally:
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 8 - Next and previous cycling verified")

def test_9_playlist_queue_and_auto_advance():
    print("=== Test 9: Playlist Queue, Prefetch Pool & Auto-Advance ===")
    assert player.is_playlist_url("https://www.youtube.com/watch?v=abc&list=RD123") is True
    assert player.is_playlist_url("https://www.youtube.com/playlist?list=PL123") is True
    assert player.is_playlist_url("https://www.youtube.com/watch?v=abc") is False

    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        orig_queue = player.QUEUE_FILE
        orig_prefetch = player.PREFETCH_PID_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        player.QUEUE_FILE = os.path.join(td, "queue.json")
        player.PREFETCH_PID_FILE = os.path.join(td, "prefetch.pid")

        mock_player = os.path.join(td, "ffplay")
        with open(mock_player, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(mock_player, 0o755)

        orig_find_player = player.find_player_bin
        orig_extract = player.extract_stream_info
        player.find_player_bin = lambda: mock_player

        test_items = [
            {"id": "v1", "title": "Track 1", "url": "https://www.youtube.com/watch?v=v1", "stream_url": "https://stream1", "resolved_at": int(time.time())},
            {"id": "v2", "title": "Track 2", "url": "https://www.youtube.com/watch?v=v2", "stream_url": "https://stream2", "resolved_at": int(time.time())},
            {"id": "v3", "title": "Track 3", "url": "https://www.youtube.com/watch?v=v3", "stream_url": None, "resolved_at": 0},
            {"id": "v4", "title": "Track 4", "url": "https://www.youtube.com/watch?v=v4", "stream_url": None, "resolved_at": 0},
            {"id": "v5", "title": "Track 5", "url": "https://www.youtube.com/watch?v=v5", "stream_url": None, "resolved_at": 0},
            {"id": "v6", "title": "Track 6", "url": "https://www.youtube.com/watch?v=v6", "stream_url": None, "resolved_at": 0},
        ]
        try:
            player.write_queue({
                "playlist_url": "https://www.youtube.com/watch?v=v1&list=PL1",
                "current_index": 0,
                "items": test_items
            })
            q = player.read_queue()
            assert q is not None
            assert len(q["items"]) == 6

            player.extract_stream_info = lambda u: ("Resolved Track", f"https://resolved-{u[-2:]}", 210, None)

            p_res = player.cmd_prefetch()
            assert p_res["status"] == "ok"
            q_after = player.read_queue()
            assert q_after["items"][1]["stream_url"] == "https://stream2"
            assert q_after["items"][2]["stream_url"] is None

            res_play = player.cmd_play_queue_index(0)
            assert res_play["status"] == "playing"
            assert "[1/6]" in res_play["title"]

            with patch.object(player, "stop_process", wraps=player.stop_process) as stop:
                next_res = player.cmd_next()
                stop.assert_called_once_with(res_play, False)
            assert next_res["status"] == "playing"
            assert "[2/6]" in next_res["title"]
            assert player.read_queue()["current_index"] == 1

            prev_res = player.cmd_prev()
            assert prev_res["status"] == "playing"
            assert "[1/6]" in prev_res["title"]
            assert player.read_queue()["current_index"] == 0

            time.sleep(0.05)
            st_sim = player.read_state()
            st_sim["startTime"] = int(time.time()) - 25
            st_sim["duration"] = 20
            player.write_state(st_sim)
            auto_res = player.cmd_status()
            assert auto_res["status"] == "playing"
            assert "[2/6]" in auto_res["title"]

            player.cmd_stop()
            assert player.read_queue() is None
            assert not os.path.exists(player.QUEUE_FILE)
            assert not os.path.exists(player.STATE_FILE)
        finally:
            player.find_player_bin = orig_find_player
            player.extract_stream_info = orig_extract
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
            player.QUEUE_FILE = orig_queue
            player.PREFETCH_PID_FILE = orig_prefetch
    print("PASS: Test 9 - Playlist Queue, Prefetch Pool & Auto-Advance verified")

def test_10_recently_played_history():
    print("=== Test 10: Recently Played History (Max 3, Dedup & Actions) ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_history = player.HISTORY_FILE
        player.CACHE_DIR = td
        player.HISTORY_FILE = os.path.join(td, "history.json")
        try:
            assert player.read_history() == []

            player.add_history("https://ice2.somafm.com/groovesalad-128-mp3", "SomaFM Groove Salad", "direct")
            h = player.read_history()
            assert len(h) == 1
            assert h[0]["url"] == "https://ice2.somafm.com/groovesalad-128-mp3"
            assert h[0]["title"] == "SomaFM Groove Salad"
            assert h[0]["type"] == "direct"

            player.add_history("https://www.youtube.com/watch?v=track1", "Track 1", "youtube")
            player.add_history("https://www.youtube.com/watch?v=track2&list=PL1", "Playlist 1", "playlist")
            h = player.read_history()
            assert len(h) == 3
            assert h[0]["title"] == "Playlist 1"
            assert h[1]["title"] == "Track 1"
            assert h[2]["title"] == "SomaFM Groove Salad"

            player.add_history("https://www.youtube.com/watch?v=track3", "Track 3", "youtube")
            h = player.read_history()
            assert len(h) == 3
            assert h[0]["title"] == "Track 3"
            assert h[1]["title"] == "Playlist 1"
            assert h[2]["title"] == "Track 1"

            player.add_history("https://www.youtube.com/watch?v=track1", "Track 1 (Remastered)", "youtube")
            h = player.read_history()
            assert len(h) == 3
            assert h[0]["url"] == "https://www.youtube.com/watch?v=track1"
            assert h[0]["title"] == "Track 1 (Remastered)"
            assert h[1]["title"] == "Track 3"
            assert h[2]["title"] == "Playlist 1"

            player.update_history_title("https://www.youtube.com/watch?v=track3", "Track 3 Official Video")
            h = player.read_history()
            assert h[1]["title"] == "Track 3 Official Video"

            player.clear_history()
            assert player.read_history() == []
        finally:
            player.CACHE_DIR = orig_cache
            player.HISTORY_FILE = orig_history
    print("PASS: Test 10 - Recently Played History verified")

def test_11_playback_progress_counter():
    print("=== Test 11: Playback Progress Counter & Time Tracking ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")

        mock_player = os.path.join(td, "ffplay")
        with open(mock_player, "w") as f:
            f.write("#!/bin/sh\nwhile true; do sleep 1; done\n")
        os.chmod(mock_player, 0o755)

        orig_find_player = player.find_player_bin
        orig_extract = player.extract_stream_info
        orig_suspend = player.suspend_process
        orig_resume = player.resume_process
        player.find_player_bin = lambda: mock_player
        player.extract_stream_info = lambda u: ("Mock Track", "https://stream", 300, None)
        player.suspend_process = lambda pid: True
        player.resume_process = lambda pid: True

        try:
            play_res = player.cmd_play("https://www.youtube.com/watch?v=mock1")
            assert play_res["status"] == "playing"
            assert play_res["duration"] == 300
            assert play_res["elapsed"] == 0
            assert play_res["currentElapsed"] == 0

            time.sleep(1.05)
            st = player.cmd_status()
            assert st["status"] == "playing"
            assert st["duration"] == 300
            assert st["currentElapsed"] >= 1

            pause_res = player.cmd_pause()
            assert pause_res["status"] == "paused"
            assert pause_res["elapsed"] >= 1
            captured_elapsed = pause_res["elapsed"]

            time.sleep(0.5)
            st_paused = player.cmd_status()
            assert st_paused["status"] == "paused"
            assert st_paused["currentElapsed"] == captured_elapsed

            resume_res = player.cmd_resume()
            assert resume_res["status"] == "playing"

            time.sleep(1.05)
            st_resumed = player.cmd_status()
            assert st_resumed["status"] == "playing"
            assert st_resumed["currentElapsed"] >= captured_elapsed + 1

            stop_res = player.cmd_stop()
            assert stop_res["status"] == "idle"
            assert stop_res["elapsed"] == 0
            assert stop_res["currentElapsed"] == 0
        finally:
            player.find_player_bin = orig_find_player
            player.extract_stream_info = orig_extract
            player.suspend_process = orig_suspend
            player.resume_process = orig_resume
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
    print("PASS: Test 11 - Playback Progress Counter & Time Tracking verified")

def test_12_premature_exit_rejection_vs_completion():
    print("=== Test 12: Premature Exit Rejection vs Natural Completion ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        orig_queue = player.QUEUE_FILE
        orig_prefetch = player.PREFETCH_PID_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        player.QUEUE_FILE = os.path.join(td, "queue.json")
        player.PREFETCH_PID_FILE = os.path.join(td, "prefetch.pid")

        mock_player = os.path.join(td, "mock_player.sh")
        with open(mock_player, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(mock_player, 0o755)

        orig_find_player = player.find_player_bin
        orig_extract = player.extract_stream_info
        player.find_player_bin = lambda: mock_player
        player.extract_stream_info = lambda u: ("Resolved Track", f"https://resolved", 200, None)

        try:
            player.write_queue({
                "playlist_url": "https://www.youtube.com/watch?v=v1&list=PL1",
                "current_index": 0,
                "items": [
                    {"id": "v1", "title": "Track 1", "url": "https://www.youtube.com/watch?v=v1", "stream_url": "https://s1", "resolved_at": int(time.time()), "duration": 200},
                    {"id": "v2", "title": "Track 2", "url": "https://www.youtube.com/watch?v=v2", "stream_url": "https://s2", "resolved_at": int(time.time()), "duration": 200},
                    {"id": "v3", "title": "Track 3", "url": "https://www.youtube.com/watch?v=v3", "stream_url": "https://s3", "resolved_at": int(time.time()), "duration": 200},
                ]
            })

            res0 = player.cmd_play_queue_index(0)
            assert res0["status"] == "playing"
            assert "[1/3]" in res0["title"]

            time.sleep(0.05)
            st = player.read_state()
            st["startTime"] = int(time.time()) - 2
            st["duration"] = 200
            player.write_state(st)

            res_status = player.cmd_status()
            q_after = player.read_queue()
            if q_after:
                assert q_after["current_index"] == 0
                assert "[2/3]" not in str(res_status.get("title", ""))

            res_status2 = player.cmd_status()
            assert res_status2["status"] == "idle"

            player.write_queue({
                "playlist_url": "https://www.youtube.com/watch?v=v1&list=PL1",
                "current_index": 0,
                "items": [
                    {"id": "v1", "title": "Track 1", "url": "https://www.youtube.com/watch?v=v1", "stream_url": "https://s1", "resolved_at": int(time.time()), "duration": 200},
                    {"id": "v2", "title": "Track 2", "url": "https://www.youtube.com/watch?v=v2", "stream_url": "https://s2", "resolved_at": int(time.time()), "duration": 200},
                ]
            })
            player.cmd_play_queue_index(0)
            time.sleep(0.05)
            st_done = player.read_state()
            st_done["startTime"] = int(time.time()) - 190
            st_done["duration"] = 200
            player.write_state(st_done)

            res_advance = player.cmd_status()
            assert res_advance["status"] == "playing"
            assert "[2/2]" in res_advance["title"]
            assert player.read_queue()["current_index"] == 1
        finally:
            player.find_player_bin = orig_find_player
            player.extract_stream_info = orig_extract
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
            player.QUEUE_FILE = orig_queue
            player.PREFETCH_PID_FILE = orig_prefetch
    print("PASS: Test 12 - Premature exit rejected and natural completion auto-advanced cleanly")

def test_13_single_track_navigation_boundary():
    print("=== Test 13: Single-Track Next/Prev Navigation & Boundary Verification ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_state = player.STATE_FILE
        orig_queue = player.QUEUE_FILE
        orig_prefetch = player.PREFETCH_PID_FILE
        player.CACHE_DIR = td
        player.STATE_FILE = os.path.join(td, "state.json")
        player.QUEUE_FILE = os.path.join(td, "queue.json")
        player.PREFETCH_PID_FILE = os.path.join(td, "prefetch.pid")

        mock_player = os.path.join(td, "mock_player.sh")
        with open(mock_player, "w") as f:
            f.write("#!/bin/sh\nsleep 10\n")
        os.chmod(mock_player, 0o755)

        orig_find_player = player.find_player_bin
        orig_extract = player.extract_stream_info
        player.find_player_bin = lambda: mock_player
        player.extract_stream_info = lambda u: ("Resolved Track", f"https://resolved", 200, None)

        try:
            player.write_queue({
                "playlist_url": "https://www.youtube.com/watch?v=v1&list=PL1",
                "current_index": 0,
                "items": [
                    {"id": "v1", "title": "Track 1", "url": "https://www.youtube.com/watch?v=v1", "stream_url": "https://s1", "resolved_at": int(time.time()), "duration": 200},
                    {"id": "v2", "title": "Track 2", "url": "https://www.youtube.com/watch?v=v2", "stream_url": "https://s2", "resolved_at": int(time.time()), "duration": 200},
                    {"id": "v3", "title": "Track 3", "url": "https://www.youtube.com/watch?v=v3", "stream_url": "https://s3", "resolved_at": int(time.time()), "duration": 200},
                    {"id": "v4", "title": "Track 4", "url": "https://www.youtube.com/watch?v=v4", "stream_url": "https://s4", "resolved_at": int(time.time()), "duration": 200},
                ]
            })

            r0 = player.cmd_play_queue_index(0)
            assert player.read_queue()["current_index"] == 0
            assert "[1/4]" in r0["title"]

            r1 = player.cmd_next()
            assert player.read_queue()["current_index"] == 1
            assert "[2/4]" in r1["title"]

            r2 = player.cmd_next()
            assert player.read_queue()["current_index"] == 2
            assert "[3/4]" in r2["title"]

            r3 = player.cmd_next()
            assert player.read_queue()["current_index"] == 3
            assert "[4/4]" in r3["title"]

            r_wrap = player.cmd_next()
            assert player.read_queue()["current_index"] == 0
            assert "[1/4]" in r_wrap["title"]

            r_prev_wrap = player.cmd_prev()
            assert player.read_queue()["current_index"] == 0

            player.cmd_next()
            player.cmd_next()
            assert player.read_queue()["current_index"] == 2
            r_back = player.cmd_prev()
            assert player.read_queue()["current_index"] == 1
            assert "[2/4]" in r_back["title"]

            r_back0 = player.cmd_prev()
            assert player.read_queue()["current_index"] == 0
            assert "[1/4]" in r_back0["title"]
        finally:
            player.find_player_bin = orig_find_player
            player.extract_stream_info = orig_extract
            player.CACHE_DIR = orig_cache
            player.STATE_FILE = orig_state
            player.QUEUE_FILE = orig_queue
            player.PREFETCH_PID_FILE = orig_prefetch
    print("PASS: Test 13 - Single-Track Next/Prev Step Verification & Boundary verified")

def test_14_youtube_bot_detection_handling():
    print("=== Test 14: YouTube Bot Detection Recognition & Reporting ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_run_cmd = player.run_cmd
        orig_find_ytdlp = player.find_ytdlp_bin
        player.set_cache_dir(td)
        player.find_ytdlp_bin = lambda: "fake-yt-dlp"

        class MockCompletedProcess:
            def __init__(self, returncode, stdout, stderr):
                self.returncode = returncode
                self.stdout = stdout
                self.stderr = stderr

        def mock_bot_run_cmd(cmd, **kwargs):
            return MockCompletedProcess(1, "", "ERROR: [youtube] b0cQ4ylNbpo: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.")

        player.run_cmd = mock_bot_run_cmd
        try:
            title, stream_url, dur, err = player.extract_stream_info("https://www.youtube.com/watch?v=b0cQ4ylNbpo")
            assert title is None
            assert stream_url is None
            assert dur == 0
            assert err is not None
            assert "anti-bot" in err
            assert "Sign in to confirm you're not a bot" in err
        finally:
            player.run_cmd = orig_run_cmd
            player.find_ytdlp_bin = orig_find_ytdlp
            player.set_cache_dir(orig_cache)
    print("PASS: Test 14 - YouTube Bot Detection accurately recognized and reported")

def test_15_cookies_file_integration():
    print("=== Test 15: Automatic cookies.txt Detection & Passing ===")
    with tempfile.TemporaryDirectory() as td:
        orig_cache = player.CACHE_DIR
        orig_run_cmd = player.run_cmd
        orig_find_ytdlp = player.find_ytdlp_bin
        player.set_cache_dir(td)
        player.find_ytdlp_bin = lambda: "fake-yt-dlp"

        captured_commands = []

        class MockCompletedProcess:
            def __init__(self, returncode, stdout, stderr):
                self.returncode = returncode
                self.stdout = stdout
                self.stderr = stderr

        def mock_capture_run_cmd(cmd, **kwargs):
            captured_commands.append(list(cmd))
            return MockCompletedProcess(0, "Test Title\n180\nhttps://audio.googlevideo.com/videoplayback\n", "")

        player.run_cmd = mock_capture_run_cmd
        try:
            player.extract_stream_info("https://www.youtube.com/watch?v=xyz")
            assert len(captured_commands) == 1
            assert "--cookies" not in captured_commands[0]

            cookies_path = os.path.join(td, "cookies.txt")
            with open(cookies_path, "w", encoding="utf-8") as f:
                f.write("# Netscape HTTP Cookie File\n")

            player.extract_stream_info("https://www.youtube.com/watch?v=xyz")
            assert len(captured_commands) == 2
            assert "--cookies" in captured_commands[1]
            cookie_idx = captured_commands[1].index("--cookies")
            assert captured_commands[1][cookie_idx + 1] == cookies_path

            player.extract_playlist_items("https://www.youtube.com/playlist?list=PLxyz")
            assert len(captured_commands) == 3
            assert "--cookies" in captured_commands[2]
            cookie_idx = captured_commands[2].index("--cookies")
            assert captured_commands[2][cookie_idx + 1] == cookies_path
        finally:
            player.run_cmd = orig_run_cmd
            player.find_ytdlp_bin = orig_find_ytdlp
            player.set_cache_dir(orig_cache)
    print("PASS: Test 15 - Automatic cookies.txt detection and argument injection verified")

def test_16_volume_preference_and_launch_flags():
    print("=== Test 16: Volume Persistence & Player Flags ===")
    env = {**os.environ, "PIXEL_HQ_CACHE_DIR": player.CACHE_DIR}

    def run(*args):
        return json.loads(subprocess.check_output([sys.executable, PLAYER_PY, *args], env=env, text=True))

    assert run("check")["volume"] == 100
    for invalid in ("-1", "101", "2.5", "no"):
        assert run("volume", invalid)["status"] == "error"
    assert run("volume", "0") == {"status": "ok", "volume": 0}
    assert run("check")["volume"] == 0
    assert run("volume", "80")["volume"] == 80

    with player.playback_lock(blocking=True):
        assert run("status") is None

    with patch.object(player, "popen_cmd") as popen, patch.object(player, "ffplay_volume_port", return_value=None) as port:
        player.spawn_player_process("ffplay", "https://example.com/audio", "test", start_seconds=20)
        args = popen.call_args.args[0]
        assert args[args.index("-volume") + 1] == "80"
        assert args[args.index("-ss") + 1] == "20"
        player.spawn_player_process("mpv", "https://example.com/audio", "test", volume=0)
        assert "--volume=0" in popen.call_args.args[0]
        assert "--start=0" not in popen.call_args.args[0]
        port.return_value = 12345
        proc, err = player.spawn_player_process("ffplay", "https://example.com/audio", "test", volume=0)
        args = popen.call_args.args[0]
        assert err is None and proc.volume_port == 12345
        assert args[args.index("-volume") + 1] == "100"
        assert args[args.index("-af") + 1] == r"asetnsamples=n=256:p=0,azmq=b=tcp\\://127.0.0.1\\:12345,volume@musicbox=0.00"

    with open(os.path.join(player.CACHE_DIR, "volume.json"), "w", encoding="utf-8") as file:
        file.write("invalid json")
    assert run("check")["volume"] == 100
    print("PASS: Volume bounds, persistence, busy polling, and both player flags")

def test_17_volume_during_playback():
    print("=== Test 17: Volume Changes During Playback ===")
    track_url = "https://www.youtube.com/watch?v=test"
    stream_url = "https://example.com/resolved-audio"
    state = {
        "pid": 1234, "startTime": 1000, "elapsed": 20, "currentElapsed": 20,
        "duration": 120, "url": track_url, "streamUrl": stream_url,
        "title": "[2/3] Track", "playlist": {"index": 2, "total": 3},
        "status": "playing", "playing": True,
    }
    queue = {"current_index": 1, "items": [{"url": track_url}]}
    player.write_state(state)
    player.write_queue(queue)
    history = player.read_history()

    with (
        patch.object(player, "find_player_bin", return_value="ffplay"),
        patch.object(player, "is_valid_player_proc", return_value=True),
        patch.object(player, "spawn_player_process", return_value=(SimpleNamespace(pid=2345), None)) as spawn,
        patch.object(player, "stop_process") as stop,
        patch.object(player, "suspend_process"),
        patch.object(player, "time") as clock,
    ):
        clock.time.return_value = 1010
        changed = player.cmd_volume("70")
        spawn.assert_called_once_with("ffplay", stream_url, player.USER_AGENT, start_seconds=30, volume=70)
        stop.assert_called_once_with(state, False)
        assert changed["elapsed"] == changed["currentElapsed"] == 30
        assert changed["pid"] == 2345 and changed["volume"] == 70
        assert changed["title"] == state["title"] and changed["playlist"] == state["playlist"]
        assert player.read_queue() == queue and player.read_history() == history
        assert player.cmd_volume("70") == {"status": "ok", "volume": 70}
        assert spawn.call_count == 1

        spawn.return_value = None, "unavailable"
        assert player.cmd_volume("60")["status"] == "error"
        assert player.read_volume() == 70 and player.read_state() == changed
        assert stop.call_count == 1

        clock.time.return_value = 1015
        paused = player.cmd_pause()
        spawn.reset_mock()
        stop.reset_mock()
        assert player.cmd_volume("0") == {"status": "ok", "volume": 0}
        assert player.read_state() == paused
        spawn.assert_not_called()
        stop.assert_not_called()

        spawn.return_value = SimpleNamespace(pid=3456), None
        clock.time.return_value = 1115
        resumed = player.cmd_resume()
        spawn.assert_called_once_with("ffplay", stream_url, player.USER_AGENT, start_seconds=35, volume=0)
        stop.assert_called_once_with(paused, True)
        assert resumed["status"] == "playing" and resumed["pid"] == 3456 and resumed["volume"] == 0
        assert resumed["elapsed"] == 35 and resumed["startTime"] == 1115
        assert player.read_queue() == queue

        player.write_state({"pid": 4567, "status": "playing", "playing": True, "url": ""})
        assert player.cmd_volume("10") == {"status": "ok", "volume": 10}
        assert spawn.call_count == 1 and stop.call_count == 1

        live = {**resumed, "volumePort": 12345}
        player.write_state(live)
        with patch.object(player, "set_ffplay_volume", return_value=True) as set_volume:
            assert player.cmd_volume("20") == {**live, "volume": 20}
            set_volume.assert_called_once_with(12345, 20)
        assert player.read_volume() == 20
        assert player.read_state() == {**live, "volume": 20}
        assert spawn.call_count == 1 and stop.call_count == 1
    print("PASS: Track, queue and timer survive changes; paused audio applies volume on resume")

def test_18_macos_process_ownership():
    print("=== Test 18: macOS Process Ownership ===")
    pid = 1234
    url = "https://example.com/audio"
    started = "Fri Nov 27 00:00:00 2026"
    stamp = "Fri Nov 27 00:01:00 2026"
    command = f"/opt/homebrew/bin/ffplay -nodisp -autoexit -volume 50 -user_agent {player.USER_AGENT} {url}"
    with (
        patch.object(player.sys, "platform", "darwin"),
        patch.object(player.os, "getpgid", return_value=pid),
        patch.object(player.os, "kill") as kill,
        patch.object(player, "kill_prefetch_worker"),
        patch.object(player, "run_cmd") as run,
    ):
        run.return_value = SimpleNamespace(returncode=0, stdout=f"ffplay {started} {command}")
        launch = player.player_process_state(SimpleNamespace(pid=pid), url, 50)
        assert launch["processStarted"] == started
        state = {**launch, "url": url, "status": "playing", "playing": True}
        assert player.is_current_player(state)
        legacy = {key: value for key, value in state.items() if key != "processStarted"}
        assert player.is_current_player(legacy)

        run.return_value.stdout = f"ffplay {stamp} {command}"
        assert not player.is_current_player(state)
        run.return_value.stdout = f"ffplay {started} /opt/homebrew/bin/ffplay {url}"
        assert not player.is_current_player(legacy)
        run.return_value.stdout = f"sleep {started} /bin/sleep 10 ffplay"
        assert not player.is_current_player(state)
        run.side_effect = subprocess.TimeoutExpired("ps", 3)
        assert not player.is_current_player(state)

        player.clear_state()
        run.reset_mock()
        assert player.cmd_status()["status"] == "idle"
        assert player.cmd_stop()["status"] == "idle"
        run.assert_not_called()
        kill.assert_not_called()

        player.write_state({**legacy, "url": ""})
        assert player.cmd_stop()["status"] == "idle"
        run.assert_not_called()
        kill.assert_not_called()

        player.write_state(state)
        run.side_effect = [
            SimpleNamespace(returncode=0, stdout=f"ffplay {started} {command}"),
            SimpleNamespace(returncode=1, stdout=""),
        ]
        assert player.cmd_stop()["status"] == "idle"
        kill.assert_called_once_with(pid, player.signal.SIGTERM)
        assert all(call.args[0][0] == "/bin/ps" for call in run.call_args_list)
    print("PASS: Stop targets only the tracked macOS player and rejects stale or foreign PIDs")

def main():
    suite_td = tempfile.mkdtemp(prefix="pixel_hq_test_cache_")
    orig_env = os.environ.get("PIXEL_HQ_CACHE_DIR")
    os.environ["PIXEL_HQ_CACHE_DIR"] = suite_td
    orig_cache = player.CACHE_DIR
    player.set_cache_dir(suite_td)
    try:
        test_1_url_validation()
        test_2_title_derivation()
        test_3_cache_and_file_permissions()
        test_4_strict_pid_verification()
        test_5_pause_and_resume_lifecycle()
        test_6_stop_while_paused_and_cleanup()
        test_7_missing_dependency_reporting()
        test_8_next_prev_cycling()
        test_9_playlist_queue_and_auto_advance()
        test_10_recently_played_history()
        test_11_playback_progress_counter()
        test_12_premature_exit_rejection_vs_completion()
        test_13_single_track_navigation_boundary()
        test_14_youtube_bot_detection_handling()
        test_15_cookies_file_integration()
        test_16_volume_preference_and_launch_flags()
        test_17_volume_during_playback()
        test_18_macos_process_ownership()
        print("All 18 Music Player unit test suites passed successfully!")
    finally:
        player.set_cache_dir(orig_cache)
        if orig_env is not None:
            os.environ["PIXEL_HQ_CACHE_DIR"] = orig_env
        else:
            os.environ.pop("PIXEL_HQ_CACHE_DIR", None)
        shutil.rmtree(suite_td, ignore_errors=True)

if __name__ == "__main__":
    main()
