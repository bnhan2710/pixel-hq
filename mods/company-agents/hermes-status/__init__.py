# pixel-hq-hermes v4
"""Hermes plugin for the Herdr app: makes Hermes Agent show up as staff in Pixel HQ.

Herdr only counts a terminal as an agent when its program reports a status (an OSC 7501 escape
sequence). Claude Code does that by itself; Hermes does not, so without this plugin a Hermes pane
gets no desk in the office. This plugin writes the sequence on Hermes' lifecycle hooks:

  working  a user turn starts, an approval or question was answered
  blocked  Hermes waits on you: a dangerous-command approval or a clarify question
  idle     the turn finished, was interrupted, or the session ended

Two ways Hermes runs, both covered:

- Classic CLI (`hermes`): the agent runs in the terminal's own process. HC_TERMINAL_ID is in its
  environment and the sequence goes to /dev/tty.
- TUI (`hermes --tui`): the terminal shows a Node UI, and the agent runs in a shared background
  host that serves every TUI session and has no terminal. Each session carries the HC_TERMINAL_ID of
  the terminal it was started from, because Pixel HQ adds that name to the profile's
  `terminal.client_env_passthrough`. The plugin finds that terminal's tty with `hc get` and `ps`, and
  writes the sequence there, only while the terminal's foreground program is still Hermes.

Delegated sub-agents never mark their parent idle, but their approvals mark it blocked (they wait on
you too). After each model call the terminal is labelled with how full the context is
(agent.context, 0-100) and the model (agent.model), for the paper pile on the desk.

Hermes run outside Herdr is untouched: with no HC_TERMINAL_ID anywhere, nothing is written.

Install: copy this folder to ~/.hermes/plugins/pixel-hq-status/ (or a profile's plugins/ folder),
run `hermes plugins enable pixel-hq-status`, and add HC_TERMINAL_ID to
`terminal.client_env_passthrough` for the TUI. Pixel HQ does all three. Delete the folder to remove.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time

_APP = "hermes"
_INTERACTIVE = {"cli", "tui"}
_OWN = os.environ.get("HC_TERMINAL_ID", "").strip()  # set when the agent runs in the terminal (classic CLI)
_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}

_lock = threading.RLock()
_children: dict[str, str] = {}   # sub-agent session id -> its parent's session id
_term_of: dict[str, str] = {}    # session id or session key -> Herdr terminal
_desks: dict[str, "_Desk"] = {}


class _Desk:
    def __init__(self, term: str):
        self.term = term
        self.last = None
        self.main = None      # the session id of the conversation shown in that terminal
        self.waiting = 0      # approvals or questions outstanding
        self.label_at = 0.0
        self.label_last = None


def _desk(term: str) -> _Desk:
    with _lock:
        d = _desks.get(term)
        if d is None:
            d = _desks[term] = _Desk(term)
        return d


# --- where a report goes ------------------------------------------------------------------------

def _bound_terminal() -> str | None:
    """The HC_TERMINAL_ID the executing TUI session brought from its client, if any."""
    try:
        from agent.session_client_env import bound_client_env
        env = bound_client_env()
    except Exception:
        return None
    value = env.get("HC_TERMINAL_ID") if isinstance(env, dict) else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def _session_key() -> str:
    try:
        from tools import approval_context
        return str(approval_context.get_current_session_key(default="") or "")
    except Exception:
        return ""


def _terminal(kwargs) -> str | None:
    """The Herdr terminal this hook is about. Learns session id/key -> terminal whenever it can see both."""
    if _OWN:
        return _OWN
    ids = [v for v in (kwargs.get("session_id"), kwargs.get("session_key"), kwargs.get("parent_session_id")) if isinstance(v, str) and v]
    with _lock:
        parent = _children.get(ids[0]) if ids else None
        term = _bound_terminal()
        if term:
            key = _session_key()
            for name in ids[:2] + ([key] if key else []):
                _term_of[name] = term
            return term
        for name in ids + ([parent] if parent else []):
            if name in _term_of:
                return _term_of[name]
    # A session created before HC_TERMINAL_ID was passed through and then resumed (`hermes --tui --resume <id>`):
    # its frozen client env has no terminal, but the TUI showing it has that id on its command line.
    key = kwargs.get("session_key") or _session_key()
    term = _resumed_terminal(key, ids)
    if term:
        with _lock:
            for name in ids[:2] + ([key] if key else []):
                _term_of[name] = term
    return term  # otherwise never guess: the shared host also runs sessions that belong to no Herdr terminal


_scanned: dict[str, float] = {}  # session key -> when its terminal was last looked for


def _resumed_terminal(key: str, ids: list) -> str | None:
    """The live local Herdr terminal running `hermes ... --resume <id>` (or `-r`/`--continue <id>`) where <id> is part
    of this session's key or id. At most one look per session every 20 s; ids shorter than 12 characters never match."""
    names = [n for n in [key, *ids] if isinstance(n, str) and n]
    if not names or os.name == "nt":
        return None
    now = time.monotonic()
    tag = names[0]
    with _lock:
        if now - _scanned.get(tag, -1e9) < 20:
            return None
        _scanned[tag] = now
    hc = _hc()
    if not hc:
        return None
    try:
        listed = json.loads(subprocess.run([hc, "ls", "--json"], capture_output=True, text=True, timeout=3, **_NO_WINDOW).stdout or "{}")
    except Exception:
        return None
    for t in listed.get("terminals") or []:
        addr = t.get("address") or ""
        if "/" in addr or t.get("state", "live") != "live":
            continue
        try:
            info = json.loads(subprocess.run([hc, "get", addr, "--json"], capture_output=True, text=True, timeout=3, **_NO_WINDOW).stdout or "{}")
        except Exception:
            continue
        fg = info.get("foreground") or {}
        if fg.get("name") != "hermes":
            continue
        argv = [str(a) for a in fg.get("argv") or []]
        for i, a in enumerate(argv[:-1]):
            if a in ("--resume", "-r", "--continue", "-c"):
                want = argv[i + 1]
                if len(want) >= 12 and any(want in n for n in names):
                    return addr
    return None


# --- writing the sequence -----------------------------------------------------------------------

_tty_fd = None  # classic CLI: /dev/tty, opened once


def _write_own(seq: bytes) -> None:
    global _tty_fd
    if _tty_fd is None:
        try:
            _tty_fd = os.open("CONOUT$" if os.name == "nt" else "/dev/tty", os.O_WRONLY | getattr(os, "O_NOCTTY", 0))
        except OSError:
            _tty_fd = -1
    if _tty_fd >= 0:
        try:
            os.write(_tty_fd, seq)
        except OSError:
            pass


def _hc() -> str | None:
    return shutil.which("hc") or next((p for p in (os.path.expanduser("~/.local/bin/hc"),) if os.path.isfile(p)), None)


def _device(term: str) -> str | None:
    """The tty of a local Herdr terminal whose foreground program is Hermes, else None (never write elsewhere)."""
    hc = _hc()
    if not hc or "/" in term or os.name == "nt":
        return None
    try:
        out = subprocess.run([hc, "get", term, "--json"], capture_output=True, text=True, timeout=3, **_NO_WINDOW)
        info = json.loads(out.stdout or "{}")
    except Exception:
        return None
    fg = info.get("foreground") or {}
    # The process name, not argv: a terminal showing `vim ~/.hermes/config.yaml` must never be written to.
    if info.get("state") != "live" or fg.get("name") != "hermes":
        return None
    try:
        tty = subprocess.run(["ps", "-o", "tty=", "-p", str(int(info["pid"]))], capture_output=True, text=True, timeout=3).stdout.strip()
    except Exception:
        return None
    return f"/dev/{tty}" if tty and tty not in ("?", "??") else None


_jobs: "queue.Queue[tuple]" = queue.Queue()
_worker = None


def _work() -> None:
    while True:
        kind, term, payload = _jobs.get()
        try:
            if kind == "report":
                dev = _device(term)
                if dev:
                    fd = os.open(dev, os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
                    try:
                        os.write(fd, payload)
                    finally:
                        os.close(fd)
            elif kind == "label":
                hc = _hc()
                if hc:
                    subprocess.run([hc, "label", term, *payload], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=5, **_NO_WINDOW)
        except Exception:
            pass


def _queue(kind: str, term: str, payload) -> None:
    global _worker
    with _lock:
        if _worker is None:
            _worker = threading.Thread(target=_work, name="pixel-hq-status", daemon=True)
            _worker.start()
    _jobs.put((kind, term, payload))


def _report(desk: _Desk, state: str) -> None:
    with _lock:
        if state == desk.last:
            return
        desk.last = state
    seq = f"\x1b]7501;state={state}:app={_APP}\x1b\\".encode()
    if _OWN and desk.term == _OWN:
        with _lock:
            _write_own(seq)
    else:
        _queue("report", desk.term, seq)


# --- hooks --------------------------------------------------------------------------------------

def _interactive(kwargs) -> bool:
    return str(kwargs.get("platform") or "").lower() in _INTERACTIVE


def _session_start(**kwargs) -> None:
    term = _terminal(kwargs)
    if term:
        _report(_desk(term), "idle")


def _turn_start(**kwargs) -> None:
    if not _interactive(kwargs):
        return
    sid = kwargs.get("session_id")
    if sid in _children:
        return
    term = _terminal(kwargs)
    if not term:
        return
    desk = _desk(term)
    parent = kwargs.get("parent_session_id")
    with _lock:
        if not parent or desk.main is None or (sid != desk.main and parent == desk.main):
            desk.main = sid  # a new conversation, or a compressed one continuing under a new id
    _report(desk, "working")


def _turn_end(**kwargs) -> None:
    sid = kwargs.get("session_id")
    if sid in _children or (kwargs.get("platform") is not None and not _interactive(kwargs)):
        return
    term = _terminal(kwargs)
    if not term:
        return
    desk = _desk(term)
    if desk.main is not None and sid != desk.main:
        return
    desk.waiting = 0
    _report(desk, "idle")


def _stopped(**kwargs) -> None:
    term = _terminal(kwargs)
    if term:
        desk = _desk(term)
        desk.waiting = 0
        _report(desk, "idle")


def _ask(**kwargs) -> None:
    term = _terminal(kwargs)
    if term:
        desk = _desk(term)
        desk.waiting += 1
        _report(desk, "blocked")


def _answered(**kwargs) -> None:
    term = _terminal(kwargs)
    if term:
        desk = _desk(term)
        desk.waiting = max(0, desk.waiting - 1)
        if desk.waiting == 0 and desk.last == "blocked":
            _report(desk, "working")


def _subagent(**kwargs) -> None:
    child, parent = kwargs.get("child_session_id"), kwargs.get("parent_session_id")
    if isinstance(child, str) and child:
        with _lock:
            _children[child] = parent if isinstance(parent, str) else ""
            if parent in _term_of:
                _term_of[child] = _term_of[parent]


def _busy(**kwargs) -> None:
    """A tool call: the agent is at work even if this plugin missed the turn's start (it was loaded, or the session was
    resumed, mid-turn). Never overrides `blocked`: a person is still needed."""
    term = _terminal(kwargs)
    if term:
        desk = _desk(term)
        if desk.last != "blocked":
            _report(desk, "working")


def _api_done(**kwargs) -> None:
    """Mark the desk working (as _busy) and label the terminal with context fill, at most every 3 s and only when the
    number moves. The turn's end (post_llm_call) comes after its last model response and sets idle."""
    if kwargs.get("session_id") in _children or not _interactive(kwargs):
        return
    term = _terminal(kwargs)
    if not term:
        return
    if _desk(term).last != "blocked":
        _report(_desk(term), "working")
    usage = kwargs.get("usage") or {}
    try:
        used = int(usage.get("total_tokens") or 0)
        limit = int(kwargs.get("context_length") or 0)
    except (TypeError, ValueError, AttributeError):
        return
    if used <= 0 or limit <= 0:
        return
    pct = max(0, min(100, round(used * 100 / limit)))
    model = str(kwargs.get("response_model") or kwargs.get("model") or "hermes")
    desk, now = _desk(term), time.monotonic()
    if (pct, model) == desk.label_last or now - desk.label_at < 3:
        return
    desk.label_last, desk.label_at = (pct, model), now
    _queue("label", term, [f"agent.context={pct}", f"agent.model={model}"])


def _announce() -> None:
    """Classic CLI: Hermes fires on_session_start only with the first message, so report `idle` once it is
    up and the desk appears at launch. Only for an interactive run on a terminal, and only if the process is
    still alive 2 s later (one-off commands such as `hermes plugins list` are gone by then). Herdr clears the
    status when the shell gets the terminal back. (For the TUI, Pixel HQ itself announces the desk.)"""
    import sys
    if any(a in ("-Q", "--quiet", "--oneshot", "-z", "--tui") for a in sys.argv[1:]):
        return
    try:
        if not (os.isatty(0) and os.isatty(1)):
            return
    except OSError:
        return

    def later() -> None:
        time.sleep(2)
        desk = _desk(_OWN)
        if desk.last is None:
            _report(desk, "idle")

    threading.Thread(target=later, name="pixel-hq-status-announce", daemon=True).start()


def register(ctx) -> None:
    if _OWN:
        _announce()
    ctx.register_hook("on_session_start", _session_start)
    ctx.register_hook("on_session_reset", _session_start)
    ctx.register_hook("on_session_end", _stopped)
    ctx.register_hook("pre_llm_call", _turn_start)
    ctx.register_hook("post_llm_call", _turn_end)
    ctx.register_hook("agent_loop_stopped", _stopped)
    ctx.register_hook("pre_approval_request", _ask)
    ctx.register_hook("post_approval_response", _answered)
    ctx.register_hook("on_human_input_request", _ask)
    ctx.register_hook("on_human_input_resolved", _answered)
    ctx.register_hook("subagent_start", _subagent)
    ctx.register_hook("post_api_request", _api_done)
    ctx.register_hook("pre_tool_call", _busy)
