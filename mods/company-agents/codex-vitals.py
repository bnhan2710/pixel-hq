#!/usr/bin/env python3
"""
Codex vitals extractor for Pixel HQ.
Given an optional PID and workspace CWD, finds the active or most recent Codex session file
(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl), extracts:
- Context fill % (last_token_usage vs model_context_window)
- Model name (thread_settings or turn_context or config.toml)
- Quota remaining % (100 - rate_limits.primary.used_percent)
Outputs JSON: {"pct": int|null, "model": str, "quota": int|null}
"""

import glob
import json
import os
import subprocess
import sys

def find_session_file(pid_str, cwd, home):
    sessions_dir = os.path.join(home, "sessions")
    if not os.path.isdir(sessions_dir):
        return None

    # 1. If PID given, check open rollout files via lsof
    if pid_str and pid_str.isdigit():
        try:
            r = subprocess.run(["lsof", "-p", str(pid_str), "-Fn"], capture_output=True, text=True, timeout=2)
            if r.returncode == 0:
                for line in r.stdout.splitlines():
                    if line.startswith("n") and "/rollout-" in line and line.endswith(".jsonl"):
                        cand = line[1:].strip()
                        if os.path.isfile(cand):
                            return cand
        except Exception:
            pass

    # 2. Search recent rollout files matching cwd
    files = glob.glob(os.path.join(sessions_dir, "*", "*", "*", "rollout-*.jsonl"))
    if not files:
        return None

    # Sort newest first
    files.sort(key=lambda x: os.path.getmtime(x), reverse=True)

    if cwd:
        needle1 = f'"cwd":"{cwd}"'
        needle2 = f'"cwd": "{cwd}"'
        for fpath in files[:40]:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    first_line = f.readline()
                    if needle1 in first_line or needle2 in first_line:
                        return fpath
            except Exception:
                continue

    return files[0] if files else None

def extract_vitals(fpath, home):
    model = None
    token_ev = None

    if fpath and os.path.isfile(fpath):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                for line in f:
                    if not model and '"model":' in line:
                        try:
                            d = json.loads(line)
                            p = d.get("payload") or {}
                            m = p.get("model") or (p.get("thread_settings") or {}).get("model")
                            if m and isinstance(m, str):
                                model = m
                        except Exception:
                            pass
                    if '"type":"token_count"' in line:
                        try:
                            token_ev = json.loads(line)
                        except Exception:
                            pass
        except Exception:
            pass

    # Fallback model from config.toml if not found in rollout
    if not model:
        cfg_path = os.path.join(home, "config.toml")
        if os.path.isfile(cfg_path):
            try:
                for cline in open(cfg_path, "r", encoding="utf-8"):
                    s = cline.strip()
                    if s.startswith("model =") or s.startswith("model="):
                        model = s.split("=", 1)[1].strip().strip('"\'')
                        break
            except Exception:
                pass

    pct = None
    quota = None

    if token_ev:
        info = (token_ev.get("payload") or {}).get("info") or {}
        used = (info.get("last_token_usage") or {}).get("total_tokens") or (info.get("total_token_usage") or {}).get("total_tokens") or 0
        win = info.get("model_context_window") or 0
        if win > 0 and used > 0:
            pct = max(0, min(100, round(used * 100 / win)))

        rl = (token_ev.get("payload") or {}).get("rate_limits") or {}
        primary = rl.get("primary") or {}
        used_pct = primary.get("used_percent")
        if isinstance(used_pct, (int, float)) and 0 <= used_pct <= 100:
            quota = max(0, min(100, round(100 - used_pct)))

    return {
        "pct": pct,
        "model": model or "codex",
        "quota": quota,
    }

def main():
    pid_str = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    cwd = sys.argv[2].strip() if len(sys.argv) > 2 else ""

    home = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
    fpath = find_session_file(pid_str, cwd, home)
    vitals = extract_vitals(fpath, home)
    print(json.dumps(vitals))

if __name__ == "__main__":
    main()
