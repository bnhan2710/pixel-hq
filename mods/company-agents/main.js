// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, settings, openOverlay, closeOverlay, props, window, layout, appHome, exec, readTextFile, writeTextFile, nextCommand, hc, knownAgents, checking } from "herdr";
import { figureFor, load } from "./figures.js";
import { agentOf, speciesOf, duckWidth, duckMood, mood, DUCK_CENTER, IDLE_SNOOZE, IDLE_URGE } from "./duck.js";
import { scene, sceneLayout, yHorizon } from "./scene.js";
import { Editor } from "./editor.js";
import { checkPixelHqUpdate, executePixelHqUpdate } from "./updater.js";
import { snapshot, clashes, hire, agentTaskArgv } from "./crew.js";

// The figure editor, as a dialog; `space` opens it on that space's pick.
const openFigures = (space) => openOverlay({ mod: "company-agents", kind: "dialog", frame: "none", width: 860, height: 640, props: { figures: true, ...(space ? { space } : {}) } });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];
const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

// How much is going on at each desk, from any agent that reports it: Hermes through its plugin, Claude Code through a hook
// (see README). Interns: running sub-agents (agent.threads) plus the live child terminals the agent started with `hc run`
// (each in its own species and mood). Runners and the server rack: shell work (agent.jobs: commands in flight plus background
// processes). A job turns amber past a minute: agent.jobs_long says how many, or agent.jobs_started lists start times (ms)
// for reporters that only run when a job starts or ends.
function activityAll(all) {
  return new Map(all.map((k) => {
    const labels = k.labels ?? {};
    const n = (v) => { const x = Number.parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : 0; };
    const kids = all.filter((c) => c.parent === k.address && c.state === "live");
    const interns = [
      ...Array.from({ length: Math.min(n(labels["agent.threads"]), 50) }, () => ({ status: "working", species: speciesOf(progOf(k)) })),
      ...kids.map((c) => ({ status: String(c.status?.state ?? c.status ?? "idle"), species: speciesOf(progOf(c)) })),
    ];
    const jobs = Math.min(n(labels["agent.jobs"]), 99);
    const now = Date.now();
    const aged = String(labels["agent.jobs_started"] ?? "").split(",").filter((t) => { const ms = Number(t); return ms > 0 && now - ms > 60000; }).length;
    return [k.address, { interns, jobs, long: Math.min(jobs, Math.max(n(labels["agent.jobs_long"]), aged)) }];
  }));
}

// Today, for the plant and the clock: tasks shipped (an agent going from working to idle or done), time agents spent working, and
// where. Kept by the office copy in localStorage and shared ("pixel-hq.today") for the clock's popup; it starts over each day.
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const freshDay = () => ({ day: dayKey(), shipped: 0, workMs: 0, bySpace: {} });

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function thinBar(t, pct, color, width) {
  const fill = pct > 0 ? Math.max(2, Math.round((width * pct) / 100)) : 0;
  return div().w(width).h(3).flex_none().bg(t.border)
    .child(div().h_full().bg(color).w(fill));
}
const hpColor = (t, pct) => (pct >= 80 ? t.ansi1 : pct >= 60 ? t.ansi3 : t.ansi2);
const spColor = (t, left) => (left <= 10 ? t.ansi1 : left <= 30 ? t.ansi3 : "#89b4fa");
const modelOf = (ctx) => (ctx.model ? [ctx.model, ctx.effort].filter(Boolean).join(" · ") : ctx.effort ? `effort ${ctx.effort}` : "");
const vitalsTip = (ctx) => [ctx.pct != null ? `Context ${ctx.pct}% used` : null, ctx.quota != null ? `${ctx.quota}% of the quota window left` : null, modelOf(ctx)].filter(Boolean).join(" · ");
function vitalsBars(t, ctx, id, width) {
  return v_flex().id(id).gap(2)
    .when(ctx.pct != null, (el) => el.child(thinBar(t, ctx.pct, hpColor(t, ctx.pct), width)))
    .when(ctx.quota != null, (el) => el.child(thinBar(t, ctx.quota, spColor(t, ctx.quota), width)));
}

// Reads the Antigravity transcript for a workspace: the last conversation the CLI logged for it, then the last
// usage line with token counts. Pure file reads through the mod's own file API, so it behaves the same on every
// platform (the former lsof-based path needed sh and Unix).
const homeDir = () => process.env.HOME ?? process.env.USERPROFILE ?? "";
const agyHome = () => process.env.AGY_HOME ?? `${homeDir()}/.gemini/antigravity-cli`;
const progOf = (a) => {
  const fg = a?.foreground;
  const fgArgv = Array.isArray(fg?.argv) ? fg.argv.join(" ") : "";
  const argv = Array.isArray(a?.argv) ? a.argv.join(" ") : "";
  const pool = [
    a?.program?.key,
    a?.program?.name,
    a?.agent,
    a?.report?.app,
    a?.status?.app,
    a?.app,
    fg?.name,
    a?.name,
    a?.title,
    fgArgv,
    argv,
    a?.labels?.["codex.model"] ? "codex" : null,
    a?.labels?.["claude.model"] ? "claude" : null,
    a?.labels?.["agy.model"] ? "antigravity" : null,
  ];
  for (const item of pool) {
    if (!item) continue;
    const s = String(item).toLowerCase();
    // Hermes first: it can run on a Claude or Codex model, and its argv may name one.
    if (/hermes/.test(s)) return "hermes";
    if (/claude/.test(s)) return "claude";
    if (/antigravity|agy/.test(s)) return "antigravity";
    if (/opencode/.test(s)) return "opencode";
    if (/codex/.test(s)) return "codex";
  }
  return String(a?.program?.key ?? a?.program?.name ?? a?.agent ?? fg?.name ?? a?.name ?? a?.title ?? "");
};

const CODEX_VITALS_PY = `import glob, json, os, subprocess, sys, time
pid_str = sys.argv[1].strip() if len(sys.argv) > 1 else ""
cwd = sys.argv[2].strip() if len(sys.argv) > 2 else ""
home = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
sessions_dir = os.path.join(home, "sessions")
fpath = None
if pid_str and pid_str.isdigit():
  try:
    r = subprocess.run(["lsof", "-p", str(pid_str), "-Fn"], capture_output=True, text=True, timeout=2)
    if r.returncode == 0:
      for line in r.stdout.splitlines():
        if line.startswith("n") and "/rollout-" in line and line.endswith(".jsonl"):
          cand = line[1:].strip()
          if os.path.isfile(cand):
            fpath = cand
            break
  except Exception: pass
if not fpath and os.path.isdir(sessions_dir):
  files = glob.glob(os.path.join(sessions_dir, "**", "rollout-*.jsonl"), recursive=True)
  if files:
    files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    if cwd:
      norm_cwd = cwd.replace('\\\\', '/').rstrip('/')
      for cand in files[:40]:
        try:
          with open(cand, "r", encoding="utf-8") as f:
            first = f.readline()
            if f'"cwd":"{cwd}"' in first or f'"cwd": "{cwd}"' in first or norm_cwd in first.replace('\\\\\\\\', '/'):
              fpath = cand
              break
        except Exception: pass
    if not fpath:
      fpath = files[0]
model = None
token_ev = None
if fpath and os.path.isfile(fpath):
  for _ in range(3):
    try:
      with open(fpath, "r", encoding="utf-8") as f:
        for line in f:
          if '"model":' in line:
            try:
              d = json.loads(line)
              p = d.get("payload") or {}
              m = p.get("model") or (p.get("thread_settings") or {}).get("model") or ((p.get("state") or {}).get("collaboration_mode") or {}).get("model")
              if m and isinstance(m, str): model = m
            except Exception: pass
          if '"type":"token_count"' in line:
            try: token_ev = json.loads(line)
            except Exception: pass
      if token_ev and model: break
    except Exception: pass
    time.sleep(0.05)
if not model:
  cfg = os.path.join(home, "config.toml")
  if os.path.isfile(cfg):
    try:
      for line in open(cfg, "r", encoding="utf-8"):
        s = line.strip()
        if s.startswith("model =") or s.startswith("model="):
          model = s.split("=", 1)[1].strip().strip('"').strip("'")
          break
    except Exception: pass
pct = None
quota = None
if token_ev:
  info = (token_ev.get("payload") or {}).get("info") or {}
  used = (info.get("last_token_usage") or {}).get("total_tokens") or (info.get("total_token_usage") or {}).get("total_tokens") or 0
  win = info.get("model_context_window") or 0
  if win > 0:
    pct = max(0, min(100, round(used * 100 / win)))
  rl = (token_ev.get("payload") or {}).get("rate_limits") or {}
  primary = rl.get("primary") or {}
  used_pct = primary.get("used_percent")
  if isinstance(used_pct, (int, float)) and 0 <= used_pct <= 100:
    quota = max(0, min(100, round(100 - used_pct)))
print(json.dumps({"pct": pct, "model": model or "codex", "quota": quota}))
`;

const AGY_VITALS_PY = `import json, os, sys
cwd = sys.argv[1] if len(sys.argv) > 1 else ""
home = os.environ.get("AGY_HOME") or os.path.expanduser("~/.gemini/antigravity-cli")
hist = os.path.join(home, "history.jsonl")
if os.path.exists(hist):
  cid = None
  needle = f'"workspace":"{cwd}"'
  needle_sp = f'"workspace": "{cwd}"'
  try:
    for line in open(hist, "r", encoding="utf-8"):
      if needle in line or needle_sp in line:
        try:
          d = json.loads(line)
          if d.get("conversationId"): cid = d["conversationId"]
        except Exception: pass
  except Exception: pass
  if cid:
    tp = os.path.join(home, "brain", cid, ".system_generated", "logs", "transcript.jsonl")
    if os.path.exists(tp):
      last = None
      try:
        for line in open(tp, "r", encoding="utf-8"):
          if '"input_tokens":' in line:
            try: last = json.loads(line)
            except Exception: pass
        if last:
          used = int(last.get("input_tokens") or 0) + int(last.get("cache_read_tokens") or 0)
          pct = max(0, min(100, round(used * 100 / 1000000)))
          print(json.dumps({"pct": pct, "model": last.get("model") or "agy"}))
      except Exception: pass
`;

const agyTranscriptVitals = async (cwd, machine) => {
  if (!cwd) return null;
  if (machine) {
    try {
      const r = await exec("python3", ["-c", AGY_VITALS_PY, cwd], { on: machine, timeout: 6000 }).catch(() => null);
      if (r?.code === 0 && r.stdout) {
        const ev = JSON.parse(r.stdout.trim().split("\n").pop());
        if (ev && typeof ev.pct === "number") return ev;
      }
    } catch {}
    return null;
  }
  let hist;
  try { hist = await readTextFile(`${agyHome()}/history.jsonl`); } catch { return null; }
  const needle = `"workspace":${JSON.stringify(cwd)}`;
  let conversationId = null;
  for (const line of String(hist).split("\n")) {
    if (!line.includes(needle)) continue;
    const m = line.match(/"conversationId":"([^"]+)"/);
    if (m) conversationId = m[1];
  }
  if (!conversationId) return null;
  let transcript;
  try { transcript = await readTextFile(`${agyHome()}/brain/${conversationId}/.system_generated/logs/transcript.jsonl`); } catch { return null; }
  const lines = String(transcript).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"input_tokens":')) continue;
    try {
      const ev = JSON.parse(lines[i]);
      const used = (Number(ev?.input_tokens) || 0) + (Number(ev?.cache_read_tokens) || 0);
      if (!(used > 0)) return null;
      return { pct: Math.max(0, Math.min(100, Math.round((used * 100) / 1000000))), model: ev?.model ?? "agy" };
    } catch { return null; }
  }
  return null;
};

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.needsYou || props()?.workload || props()?.today) return;
    if (props()?.sortMenu) return;
    if (props()?.figures) { this.editor = new Editor(cx); return; }
    // Figure sets come from ~/.config/herdr-app/pond-agents.json; hand edits show within seconds.
    this.file = {};
    const reload = (cx) => cx.spawn(async (cx) => {
      const error = await load(this.file);
      if (error !== this.fileError) { this.fileError = error; cx.notify(); }
    });
    reload(cx);
    cx.timer.every(4000, reload);
    // Names and roles set from a pane header (company-pane writes this file), shared for the desk labels.
    const namesFile = `${appHome()}/pixel-hq-names.json`;
    const loadNames = (cx) => cx.spawn(async (cx) => {
      const raw = await readTextFile(namesFile).catch(() => null);
      if (raw === this.namesRaw) return;
      this.namesRaw = raw;
      try { const v = JSON.parse(raw ?? "{}"); if (v && typeof v === "object") { setShared("pixel-hq.names", v); cx.notify(); } } catch {}
    });
    loadNames(cx);
    cx.timer.every(3000, loadNames);
    this.folded = new Set();
    // Where the person dragged each pet: fractions of the panel, kept across restarts.
    try { this.petpos = JSON.parse(localStorage.getItem("petpos") ?? "{}"); } catch { this.petpos = {}; }
    this.drag = null;
    // Find staff: typing dims everyone who does not match; Enter jumps to the first match.
    this.query = "";
    this.typing = false;
    this.firstHit = null;
    this.searchInput = InputState.new({ placeholder: "Find staff" });
    this.searchInput.on("change", (_e, cx) => { this.query = this.searchInput.value(); cx.notify(); });
    this.searchInput.on("submit", () => { if (this.firstHit) run("pane.focus", { pane: this.firstHit }); });
    this.searchInput.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.searchInput.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    // Hiring: a new staff member gets their own git worktree and branch, named after the ticket.
    this.hiring = { open: false, program: "claude", busy: false, error: "" };
    this.ticketInput = InputState.new({ placeholder: "Ticket, e.g. UC-1234" });
    this.repoInput = InputState.new({ placeholder: "Repo folder" });
    this.ticketInput.on("submit", (_e, cx) => this.doHire(cx));
    this.repoInput.on("submit", (_e, cx) => this.doHire(cx));
    // Who is about to step on whom: every few seconds, ask git what each desk has changed.
    this.clash = new Map();
    this.clashSig = "";
    this.scanning = false;
    this.scan(cx);
    cx.timer.every(6000, (cx) => this.scan(cx));
    // Codex & Antigravity do not report context via OSC, but write session/transcript files: read them for each desk.
    this.ctxRead = new Map();
    this.scanCodex(cx);
    cx.timer.every(8000, (cx) => this.scanCodex(cx));
    // `company-agents.hire` (a key binding, or herdr-app do) opens the hire form.
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "hire") this.openHire(cx); if (c === "update") this.runUpdate(); if (c === "needsYou") this.openNeedsYou(); } });
    // OpenCode 1.x does not report a status by itself, so without help it never gets a desk. Once, if OpenCode is installed, drop its
    // status plugin (this mod's opencode-status.js) into OpenCode's plugins folder. Only ever replaces Pixel HQ's own older copy;
    // deleting the file removes it for good.
    this.notice = null;
    this.pendingSetupClaude = false;
    this.pendingSetupAntigravity = false;
    this.pendingSetupOpenCode = false;
    this.pendingSetupCodex = false;
    this.lastSetupClaudeAttempt = 0;
    this.lastSetupAntigravityAttempt = 0;
    this.lastSetupOpenCodeAttempt = 0;
    this.lastSetupCodexAttempt = 0;
    this.setupOpenCode(cx);
    // The OpenCode HP plugin (directory package) is auto-discovered by every TUI from the global plugins folder:
    // it labels the terminal with the context fill for the desk's HP bar. Same discipline as the status plugin.
    this.setupOpenCodeHp(cx);
    // Ensure Claude Code and Antigravity statusLine are configured to report context, model, and quota.
    this.setupClaude(cx);
    this.setupAntigravity(cx);
    this.setupCodex(cx);
    // Hermes Agent does not report a status either: give every Hermes home (~/.hermes and each profile) this mod's status plugin.
    this.setupHermes(cx);
    this.announceHermes(cx);
    cx.timer.every(5000, (cx) => this.announceHermes(cx));
    checkPixelHqUpdate(true).then(() => cx.notify()).catch(() => {});
    cx.timer.every(6 * 3600 * 1000, (cx) => checkPixelHqUpdate(true).then(() => cx.notify()).catch(() => {}));
    // Now and then (every 14 to 32 s) one idle pet steps out beside its desk for about 3.6 s, then comes back.
    this.out = null;
    this.breakerList = [];
    this.nextAt = Date.now() + 6000;
    this.hint = null;
    this.nudged = new Map();
    cx.timer.every(1000, (cx) => {
      const now = Date.now();
      if (this.hint && now > this.hint.until) { this.hint = null; cx.notify(); }
      if (this.nudged.size) {
        for (const [addr, until] of this.nudged) if (now > until) this.nudged.delete(addr);
        cx.notify();
      }
      this.flushPending(cx);
      if (this.out) {
        if (now >= this.out.until) { this.out = null; this.nextAt = now + 14000 + Math.random() * 18000; cx.notify(); }
        return;
      }
      if (now < this.nextAt) return;
      this.nextAt = now + 3000;
      const c = this.breakerList.filter((x) => this.drag?.addr !== x);
      if (c.length) { this.out = { addr: c[Math.floor(Math.random() * c.length)], until: now + 9000 }; cx.notify(); }
    });
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    // The board's ticker: the last few things that happened (a desk shipped, a desk needs you), newest first.
    try { this.events = JSON.parse(localStorage.getItem("events") ?? "[]"); } catch { this.events = []; }
    if (!Array.isArray(this.events)) this.events = [];
    try { this.today = JSON.parse(localStorage.getItem("today") ?? "null"); } catch { this.today = null; }
    if (!this.today || this.today.day !== dayKey()) this.today = freshDay();
    if (JSON.stringify(shared("pixel-hq.today")) !== JSON.stringify(this.today)) setShared("pixel-hq.today", this.today);
    // The clock on the wall and the sky in the windows: one redraw a minute.
    cx.timer.every(60000, (cx) => cx.notify());
    try { this.seen = JSON.parse(localStorage.getItem("seen") ?? "{}"); } catch { this.seen = {}; }
    try { this.settled = new Set(JSON.parse(localStorage.getItem("settled") ?? "[]")); } catch { this.settled = new Set(); }
    this.watching = null;
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now, cx) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      const prev = this.changed[a.address];
      if (prev?.s === s) continue;
      if (prev?.s === "working") this.tally(a, s, prev.at, now);
      if (prev && (s === "blocked" || (prev.s === "working" && s === "idle"))) this.logEvent(a, s === "blocked" ? "needs" : "shipped", now);
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    if (this.hasPending()) this.flushPending(cx);
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    try { localStorage.setItem("changed", JSON.stringify(this.changed)); } catch { /* storage blocked: the shared stamps still carry for this session */ }
    // The floor copy and the needs-you popup are separate copies with separate storage: share the stamps so the popup sorts truthfully.
    setShared("pixel-hq.changed", this.changed);
  }

  logEvent(a, kind, at) {
    const who = String(a.space_name || a.program?.name || a.address).toUpperCase(), prog = String(a.program?.name || "").toUpperCase();
    this.events = [{ who, prog, kind, at, addr: a.address }, ...this.events].slice(0, 6);
    try { localStorage.setItem("events", JSON.stringify(this.events)); } catch { /* storage blocked: kept in memory */ }
  }

  // An agent stopped working: add its time to today (counted from midnight at most, six hours at most) and, if it finished
  // rather than waiting on you, one task shipped.
  tally(a, s, from, now) {
    if (!this.today || this.today.day !== dayKey()) this.today = freshDay();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const ms = Math.max(0, Math.min(6 * 3600000, now - Math.max(from, midnight.getTime())));
    this.today.workMs += ms;
    const where = a.space_name || "?";
    this.today.bySpace[where] = (this.today.bySpace[where] ?? 0) + ms;
    if (s === "idle") this.today.shipped += 1;
    try { localStorage.setItem("today", JSON.stringify(this.today)); } catch { /* storage blocked: kept in memory */ }
    setShared("pixel-hq.today", this.today);
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  watch(list, now) {
    const cur = list.find((a) => a.focused)?.address ?? null;
    if (cur === this.watching) return;
    if (this.watching) {
      this.seen[this.watching] = now;
      for (const k of Object.keys(this.seen)) if (!this.changed[k]) delete this.seen[k];
      localStorage.setItem("seen", JSON.stringify(this.seen));
    }
    this.watching = cur;
  }

  waitOf(address, status, now) {
    const at = this.changed[address]?.at ?? now;
    if (status !== "idle") return now - at;
    if (address === this.watching) return 0;
    return now - Math.max(at, this.seen[address] ?? 0);
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return div()
      .relative()
      .w(200)
      .children(box("#45475a", "#181825", "#11111b"))
      .child(
        v_flex()
          .relative()
          .p(6)
          .font_family("JetBrains Mono")
          .text_size(11)
          .child(
            h_flex()
              .px(6)
              .pt(2)
              .pb(4)
              .border_b(1)
              .border_color("#313244")
              .justify_between()
              .items_center()
              .child(div().font_bold().text_size(10).text_color(t.dim).child("SORT AGENTS"))
              .child(
                h_flex()
                  .relative()
                  .h(20)
                  .px(6)
                  .items_center()
                  .justify_center()
                  .cursor_pointer()
                  .children(box("#45475a", "#313244", "#11111b"))
                  .hover((s) => s.text_color("#ffffff"))
                  .on_click(() => closeOverlay(props().overlay))
                  .child(div().font_family("JetBrains Mono").text_size(8.5).font_bold().text_color("#a6adc8").child("ESC"))
              )
          )
          .child(
            v_flex()
              .py(2)
              .gap(2)
              .children(
                SORTS.map((s) =>
                  h_flex()
                    .id(`sort-${s.id}`)
                    .h(28)
                    .px(8)
                    .gap(8)
                    .items_center()
                    .cursor_pointer()
                    .text_color(t.foreground)
                    .hover((el) => el.bg("#313244"))
                    .on_click(() => {
                      setShared("agents.sort", s.id);
                      closeOverlay(props().overlay);
                    })
                    .child(svg(`mods/company-agents/${s.icon}.svg`).size(13).flex_none().text_color(t.muted))
                    .child(div().flex_1().child(s.label.toUpperCase()))
                    .when(s.id === on, (el) => el.child(div().size(6).bg(t.accent)))
                )
              )
          )
      );
  }

  needsYou(t) {
    const now = Date.now();
    const raw = shared("pixel-hq.changed");
    const changed = raw && typeof raw === "object" ? raw : {};
    const stamp = (a) => changed[a.address]?.at ?? null;
    const waiting = agents()
      .filter((a) => a.status === "blocked")
      .sort((a, b) => {
        const [sa, sb] = [stamp(a), stamp(b)];
        if (sa !== null && sb !== null) return sa - sb;
        if (sa !== null) return -1;
        if (sb !== null) return 1;
        return a.seq - b.seq;
      });
    const mono = "JetBrains Mono";
    const paneList = panes();
    const leads = leadPanes(paneList);
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const tabCounts = new Map();
    for (const a of waiting) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const nameOf = (a) => {
      const tab = tabs.get(a.tab);
      const many = (tabCounts.get(a.tab) ?? 0) > 1;
      const label = tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (clean(a.title) || a.program?.name || a.tab_name || a.address);
      return /^\d+$/.test(label) ? (a.program?.name || label) : label;
    };
    const h = Math.min(440, Math.max(150, 52 + waiting.length * 56));
    return div()
      .relative()
      .w(340)
      .h(h)
      .children(box("#45475a", "#181825", "#11111b"))
      .child(
        v_flex()
          .relative()
          .size_full()
          .p(8)
          .gap(6)
          .font_family(mono)
          .child(
            h_flex()
              .h(28)
              .px(6)
              .pb(4)
              .border_b(1)
              .border_color("#313244")
              .items_center()
              .justify_between()
              .child(
                h_flex().gap(6).items_center()
                  .child(div().font_family(mono).font_bold().text_size(11).text_color("#f9e2af").child("NEEDS YOU"))
                  .when(waiting.length > 0, (el) => el.child(div().text_size(9.5).text_color(t.dim).child(`(${waiting.length})`)))
              )
              .child(
                h_flex()
                  .relative()
                  .h(20)
                  .px(6)
                  .items_center()
                  .justify_center()
                  .cursor_pointer()
                  .children(box("#45475a", "#313244", "#11111b"))
                  .hover((s) => s.text_color("#ffffff"))
                  .on_click(() => closeOverlay(props()?.overlay))
                  .child(div().text_size(9).font_bold().text_color("#a6adc8").child("ESC"))
              )
          )
          .child(
            v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .gap(4)
              .when(waiting.length === 0, (el) => el.child(div().px(10).py(18).text_size(11.5).text_color(t.dim).child("All hands on deck. Nobody needs you right now.")))
              .children(waiting.map((a) => {
                const at = stamp(a);
                const name = nameOf(a);
                const sub = [a.space_name, a.program?.name, at ? `waiting ${duration(now - at)}` : null].filter(Boolean).join(" · ");
                return h_flex()
                  .id(`ny-${a.address}`)
                  .relative()
                  .h(50)
                  .px(6)
                  .gap(8)
                  .items_center()
                  .cursor_pointer()
                  .children(box("#313244", "#1e1e2e", "#11111b"))
                  .hover((s) => s.bg("#313244"))
                  .on_click(() => {
                    run("pane.focus", { pane: a.pane });
                    closeOverlay(props()?.overlay);
                  })
                  .child(div().flex_none().child(figureFor(a.space_name, "blocked", 34, at ? Math.max(0, now - at) : 0, speciesOf(progOf(a)))))
                  .child(v_flex().flex_1().min_w(0).gap(1)
                    .child(div().truncate().font_family(mono).font_bold().text_size(11.5).text_color(t.foreground).child(name))
                    .child(div().truncate().font_family(mono).text_size(9.5).text_color(t.muted).child(sub)))
                  .child(div().flex_none().font_family(mono).font_bold().text_size(12).text_color("#89b4fa").child("→"));
              }))
          )
      );
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  isBusy(pattern) {
    try {
      const list = agents();
      if (!Array.isArray(list)) return false;
      return list.some((a) => {
        const name = String(a.program?.key ?? a.report?.app ?? a.status?.app ?? a.app ?? a.name ?? "").toLowerCase();
        return pattern.test(name) && (a.status === "working" || a.status === "typing");
      });
    } catch {
      return false;
    }
  }

  hasPending() {
    return Boolean(this.pendingSetupClaude || this.pendingSetupAntigravity || this.pendingSetupOpenCode || this.pendingSetupCodex);
  }

  flushPending(cx) {
    if (!this.hasPending()) return;
    const now = Date.now();
    if (this.pendingSetupClaude && now - this.lastSetupClaudeAttempt > 4000 && !this.isBusy(/claude/)) {
      this.setupClaude(cx);
    }
    if (this.pendingSetupAntigravity && now - this.lastSetupAntigravityAttempt > 4000 && !this.isBusy(/antigravity|agy/)) {
      this.setupAntigravity(cx);
    }
    if (this.pendingSetupOpenCode && now - this.lastSetupOpenCodeAttempt > 4000 && !this.isBusy(/opencode/)) {
      this.setupOpenCode(cx);
      this.setupOpenCodeHp(cx);
    }
    if (this.pendingSetupCodex && now - this.lastSetupCodexAttempt > 4000 && !this.isBusy(/codex/)) {
      this.setupCodex(cx);
    }
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  // A figure that opens the figure editor on its space when right-clicked.
  figure(space, status, height, waited, id, program) {
    return div().id(id).on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openFigures(space); })
      .child(figureFor(space, status, height, waited, speciesOf(program)));
  }

  subRow(t, s, shown, compact, space) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = this.figure(space, st, 27, this.waitOf(k.address, st, Date.now()), `fig-${k.address}`, progOf(k));
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(44)
      .pr(8)
      .h(34)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5))))
      .child(div().mr(6).child(pic))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/company-agents/pixel-spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().border(1).border_color(t.blocked + "88").bg(t.blocked + "26").text_size(9).font_bold().font_family("JetBrains Mono").text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).border(1).border_color(t.blocked + "88").bg(t.blocked + "26").text_size(9.5).font_bold().font_family("JetBrains Mono").text_color(t.blocked).flex().items_center().child("NEEDS YOU");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(6).mx(3).flex_none().border(1).border_color(t.idle ?? t.dim);
    return div().size(6).mx(3).flex_none().bg(a.status === "done" ? color : "transparent");
  }

  async scan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const remote = new Set(spaces().filter((x) => x.machine).map((x) => x.id));
      const paneBy = new Map(panes().map((p) => [p.pane, p]));
      const ags = agents().filter((a) => !remote.has(a.space));
      const snap = await snapshot(exec, ags.map((a) => ({ address: a.address, cwd: paneBy.get(a.pane)?.cwd })).filter((i) => i.cwd));
      const status = new Map(ags.map((a) => [a.address, a.status]));
      const next = clashes(snap, (addr) => status.get(addr) === "working");
      const sig = JSON.stringify([...next].map(([k, v]) => [k, v.kind, v.others, v.files]));
      if (sig !== this.clashSig) { this.clashSig = sig; this.clash = next; cx.notify(); }
    } catch { /* git missing or a folder vanished: keep the last answer */ }
    this.scanning = false;
  }

  async scanCodex(cx) {
    if (this.scanningCodex) return;
    this.scanningCodex = true;
    try {
      const paneBy = new Map(panes().map((p) => [p.pane, p]));
      const allTerms = terminals();
      const termMap = new Map(allTerms.map((t) => [t.address, t]));
      const codexTargets = new Set();
      for (const x of [...agents(), ...allTerms]) {
        const s = progOf(x).toLowerCase();
        if (/codex/.test(s)) codexTargets.add(x.address);
      }
      const next = new Map();
      const cleanAddr = (addr) => (typeof addr === "string" && addr.includes("/") ? addr.split("/").pop() : addr);
      for (const addr of codexTargets) {
        try {
          const a = agents().find((x) => x.address === addr);
          const t = termMap.get(addr);
          const spaceId = a?.space ?? t?.labels?.["herdr.space"];
          const sp = spaces().find((s) => s.id === spaceId || (spaceId && s.id.endsWith("/" + spaceId)));
          const machine = (typeof addr === "string" && addr.includes("/")) ? addr.split("/")[0] : (sp?.machine || undefined);
          const targetAddr = cleanAddr(addr);
          let info = JSON.parse((await hc(["get", addr, "--json"]).catch(() => ({ stdout: "{}" }))).stdout || "{}");
          if ((!info?.foreground && !info?.cwd) && targetAddr !== addr) {
            info = JSON.parse((await hc(["get", targetAddr, "--json"]).catch(() => ({ stdout: "{}" }))).stdout || "{}");
          }
          const pid = info?.foreground?.pid;
          const cwd = info?.foreground?.cwd || info?.cwd || (a?.pane ? paneBy.get(a.pane)?.cwd : null);
          const candidates = window()?.platform === "windows" && !machine ? ["python", "python3", "py"] : ["python3", "python"];
          for (const bin of candidates) {
            const r = await exec(bin, ["-c", CODEX_VITALS_PY, String(pid ?? ""), cwd ?? ""], { timeout: 8000, on: machine }).catch(() => null);
            if (!r) continue;
            const ev = r.code === 0 && r.stdout ? JSON.parse(r.stdout.trim().split("\n").pop()) : null;
            if (ev && (ev.pct != null || ev.model || ev.quota != null)) {
              next.set(addr, { pct: ev.pct ?? null, model: ev.model ?? "codex", quota: ev.quota ?? null });
              if (targetAddr !== addr) {
                next.set(targetAddr, { pct: ev.pct ?? null, model: ev.model ?? "codex", quota: ev.quota ?? null });
              }
              for (const tgt of [addr, targetAddr]) {
                if (!tgt) continue;
                hc(["label", tgt,
                  `agent.context=${ev.pct ?? ""}`,
                  `codex.context=${ev.pct ?? ""}`,
                  `agent.model=${ev.model ?? ""}`,
                  `codex.model=${ev.model ?? ""}`,
                  `agent.quota=${ev.quota ?? ""}`,
                  `codex.quota=${ev.quota ?? ""}`,
                ]).catch(() => null);
              }
            }
            break;
          }
        } catch {
          continue;
        }
      }
      for (const a of agents().filter((x) => /antigravity|agy/.test(progOf(x).toLowerCase()))) {
        try {
          const sp = spaces().find((s) => s.id === a.space || (a.space && s.id.endsWith("/" + a.space)));
          const machine = (typeof a.address === "string" && a.address.includes("/")) ? a.address.split("/")[0] : sp?.machine;
          const cwd = paneBy.get(a.pane)?.cwd;
          const quota = await this.agyQuota(machine);
          const vitals = await agyTranscriptVitals(cwd, machine);
          if (!vitals && quota == null) continue;
          next.set(a.address, { pct: vitals?.pct ?? null, model: vitals?.model ?? "agy", quota });
          const targetAddr = cleanAddr(a.address);
          if (targetAddr !== a.address) {
            next.set(targetAddr, { pct: vitals?.pct ?? null, model: vitals?.model ?? "agy", quota });
          }
          for (const tgt of [a.address, targetAddr]) {
            if (!tgt) continue;
            hc(["label", tgt,
              `agent.context=${vitals?.pct ?? ""}`,
              `agy.context=${vitals?.pct ?? ""}`,
              `agent.model=${vitals?.model ?? ""}`,
              `agy.model=${vitals?.model ?? ""}`,
              `agent.quota=${quota ?? ""}`,
              `agy.quota=${quota ?? ""}`,
            ]).catch(() => null);
          }
        } catch {
          continue;
        }
      }
      const sig = JSON.stringify([...next]);
      if (sig !== JSON.stringify([...this.ctxRead])) { this.ctxRead = next; cx.notify(); }
    } catch { /* no codex/agy, no lsof, odd output: no pile */ }
    this.scanningCodex = false;
  }

  async agyQuota(machine) {
    const key = machine ?? "local";
    const memo = this.agyQuotaMemo?.get(key);
    if (memo && Date.now() - memo.at < 60000) return memo.value;
    if (this.agyQuotaBusy?.has(key)) return memo?.value ?? null;
    this.agyQuotaBusy ??= new Set();
    this.agyQuotaBusy.add(key);
    this.agyQuotaMemo ??= new Map();
    let value = memo?.value ?? null;
    try {
      const script = `${appHome()}/mods/company-agents/agy-quota.py`;
      const candidates = window()?.platform === "windows" && !machine ? ["python", "python3", "py"] : ["python3", "python"];
      for (const bin of candidates) {
        const r = await exec(bin, [script], { timeout: 12000, on: machine }).catch(() => null);
        if (!r) continue;
        const parsed = r.code === 0 && r.stdout ? JSON.parse(r.stdout.trim().split("\n").pop()) : null;
        if (parsed && typeof parsed.quota === "number" && Number.isFinite(parsed.quota)) {
          value = Math.max(0, Math.min(100, Math.round(parsed.quota)));
        }
        break;
      }
    } catch { /* keep the previous answer */ }
    this.agyQuotaMemo.set(key, { at: Date.now(), value });
    this.agyQuotaBusy.delete(key);
    return value;
  }

  // Clickable spots over the wall, at the places sceneLayout() gives the drawing.
  sceneSpots(sz, everyone, o) {
    const Lo = sceneLayout(sz.width, sz.height);
    const spot = (id, x, y, w, h, tip, act) => div().id(id).absolute().left(x).top(y).w(w).h(h).cursor_pointer().tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); });
    const word = { working: "at work", blocked: "needs you", done: "shipped", idle: "quiet" };
    const out = [];
    Lo.buildings.forEach((b, k) => {
      const sp = o.spaces[k];
      if (sp) out.push(spot(`bld-${sp.id}`, b.x, b.y - 4, b.w, b.h + 4, `${sp.name} · ${word[sp.status] ?? "quiet"}${sp.active ? " · you are here" : " · click to go there"}`,
        () => run("space.select", { id: sp.id })));
    });
    const openToday = () => openOverlay({ mod: "company-agents", kind: "popup", frame: "none", width: 300, height: 214, props: { today: true } });
    out.push(spot("wall-clock", Lo.cx - Lo.rr, Lo.cy - Lo.rr, Lo.rr * 2, Lo.rr * 2, "Today: tasks shipped, time at work, busiest floor", openToday));
    if (!Lo.sign && o.needYou > 0) out.push(spot("wall-badge", Lo.cx + Lo.rr - 6, Lo.cy + Lo.rr - 8, 12, 10,
      `${o.needYou} ${o.needYou > 1 ? "agents need" : "agent needs"} you · click to see who`, () => this.openNeedsYou()));
    if (Lo.board) out.push(this.wallBoard(Lo.board, o, spot));
    if (Lo.sign && o.needYou) out.push(spot("wall-sign", Lo.sign.x, Lo.sign.y, Lo.sign.w, Lo.sign.h,
      o.needYou ? `${o.needYou} ${o.needYou > 1 ? "agents need" : "agent needs"} you · click to see who` : "Nobody needs you right now", () => this.openNeedsYou()));
    out.push(spot("wall-rack", Lo.rackX, Lo.rackTop, Lo.rackCab, Lo.base - Lo.rackTop,
      o.load ? `${o.load} running across the office (sub-agents and shell jobs) · click for the list` : "Nothing running in the background · click for the list", () => this.openWorkload()));
    const done = everyone.filter((a) => a.status === "done" && !this.settled.has(a.address));
    out.push(spot("wall-cooler", Lo.cooler.x, Lo.cooler.y, Lo.cooler.w, Lo.cooler.h,
      done.length ? `Break room: send ${done.length} finished staff on a break` : "Break room: nobody has finished a task", (cx) => {
        for (const a of done) this.settled.add(a.address);
        try { localStorage.setItem("settled", JSON.stringify([...this.settled])); } catch { /* storage disabled: settled until restart */ }
        cx.notify();
      }));
    out.push(spot("wall-plant", Lo.plant.x, Lo.plant.y, Lo.plant.w, Lo.plant.h,
      `${o.shipped} task${o.shipped === 1 ? "" : "s"} shipped today${o.droop ? " · drooping: someone has waited on you for over 5 minutes" : ""}`, openToday));
    return out;
  }

  // The board under the windows: a fuel gauge for the lowest usage window left, and an amber dot-matrix panel cycling through
  // what just happened, today's score and any context running full. Red, and still, while someone needs you. Native frames only.
  wallBoard(B, o, spot) {
    const d = o.board ?? {}, now = Date.now();
    const ago = (t) => { const m = Math.max(0, Math.round((now - t) / 60000)); return m < 1 ? "NOW" : m < 60 ? `${m}M` : `${Math.floor(m / 60)}H`; };
    const hm = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}M` : `${Math.floor(m / 60)}H${String(m % 60).padStart(2, "0")}M`; };
    const fuel = d.fuel?.[0] ?? null;
    const gw = fuel ? 24 : 0, tx = B.x + gw + 5, tw = B.w - gw - 8;
    const fit = Math.max(8, Math.floor((tw - 2) / 4.55));
    const needs = o.needYou > 0;
    const panels = needs
      ? [`! ${[...new Set(d.blocked ?? [])].filter(Boolean).join(", ") || `${o.needYou}`} NEED${o.needYou > 1 ? "" : "S"} YOU`]
      : [
          ...(d.events ?? []).filter((e) => now - e.at < 6 * 3600000).slice(0, 3).map((e) => `${e.who} ${e.kind === "shipped" ? "SHIPPED" : "WAITED"} ${ago(e.at)}`),
          `${o.shipped ?? 0} SHIPPED TODAY`,
          ...((d.workMs ?? 0) >= 60000 ? [`${hm(d.workMs)} AT WORK`] : []),
          ...(d.hot ?? []).slice(0, 2).map((h) => `${h.who} CONTEXT ${h.p}%`),
          ...(o.load ? [`${o.load} HELPER${o.load > 1 ? "S" : ""} AT WORK`] : []),
        ];
    // Short panels hold for 3 s; long ones scroll through once, then hold. 250 ms a frame.
    const frames = [];
    for (const raw of panels) {
      const t = raw.replace(/\s+/g, " ").trim();
      if (t.length <= fit) { for (let i = 0; i < 12; i++) frames.push(t); continue; }
      const head = t.slice(0, fit);
      for (let i = 0; i < 6; i++) frames.push(head);
      for (let i = 1; i <= t.length - fit; i++) frames.push(t.slice(i, i + fit));
      for (let i = 0; i < 6; i++) frames.push(t.slice(t.length - fit));
    }
    const ink = needs ? "#f38ba8" : "#f9b84a";
    const text = div().absolute().left(tx).top(B.y + 3).w(tw).h(B.h - 6).overflow_hidden().flex().items_center()
      .font_family("JetBrains Mono").font_bold().text_size(7.5).text_color(ink);
    const shown = frames.length > 1 ? text.frames(frames.slice(0, 600), 250) : text.child(frames[0] ?? "");
    const fc = fuel ? (fuel.q <= 10 ? "#f38ba8" : fuel.q <= 25 ? "#f9b84a" : "#a6e3a1") : null;
    const gauge = fuel ? [
      // five segments, 20% each
      ...Array.from({ length: 5 }, (_, i) => {
        const lit = i < Math.ceil(fuel.q / 20);
        const seg = div().absolute().left(B.x + 3 + i * 4).top(B.y + 4).w(3).h(B.h - 8).bg(lit ? fc : "#2a2e48");
        return lit && fuel.q <= 10 ? seg.loop("opacity", { from: 0.3, to: 1, period: 700, easing: "ease-in-out" }) : seg;
      }),
      div().absolute().left(B.x + gw + 1).top(B.y + 3).w(1).h(B.h - 6).bg("#2e3250"),
    ] : [];
    const fuelTip = (d.fuel ?? []).map((f) => `${f.who} ${f.q}% left${f.reset ? ` (resets ${new Date(f.reset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}`).join(" · ");
    const tip = [...panels.map((p) => p.charAt(0) + p.slice(1).toLowerCase()), fuelTip ? `Usage window: ${fuelTip}` : null].filter(Boolean).join("\n");
    const board = div().absolute().left(0).top(0).w(B.x + B.w + 4).h(B.y + B.h + 4)
      // the bezel, a dark face with faint scanlines, two bolts
      .child(div().absolute().left(B.x - 2).top(B.y - 2).w(B.w + 4).h(B.h + 4).bg("#0a0c1a"))
      .child(div().absolute().left(B.x).top(B.y).w(B.w).h(B.h).bg("#14110c").border_1().border_color(needs ? "#5a2234" : "#3a2f1c"))
      .when(needs, (el) => el.child(div().absolute().left(B.x - 2).top(B.y - 2).w(B.w + 4).h(B.h + 4).border_1().border_color("#f38ba8")
        .loop("opacity", { from: 0.2, to: 1, period: 900, easing: "ease-in-out" })))
      .children(gauge)
      .child(shown)
      .children([4, 8, 12].map((y) => div().absolute().left(B.x + 1).top(B.y + y).w(B.w - 2).h(1).bg("#00000033")))
      .child(div().absolute().left(B.x + 1).top(B.y - 5).w(2).h(2).bg("#6b7194"))
      .child(div().absolute().left(B.x + B.w - 3).top(B.y - 5).w(2).h(2).bg("#6b7194"));
    const openToday = () => openOverlay({ mod: "company-agents", kind: "popup", frame: "none", width: 300, height: 214, props: { today: true } });
    return spot("wall-board", B.x - 2, B.y - 6, B.w + 4, B.h + 8, tip, () => (needs ? this.openNeedsYou() : openToday()))
      .child(board.left(-(B.x - 2)).top(-(B.y - 6)));
  }

  openWorkload() {
    const act = activityAll(terminals());
    const n = agents().filter((a) => { const x = act.get(a.address); return x && (x.interns.length || x.jobs); }).length;
    openOverlay({ mod: "company-agents", kind: "popup", frame: "none", width: 340, height: Math.min(440, Math.max(150, 52 + n * 56)), props: { workload: true } });
  }

  // The rack's list: every desk with sub-agents or shell jobs running, busiest first; a click shows that agent.
  workloadView(t) {
    const act = activityAll(terminals());
    const load = (x) => x.interns.length + x.jobs;
    const rows = agents().map((a) => ({ a, x: act.get(a.address) })).filter(({ x }) => x && load(x) > 0).sort((p, q) => load(q.x) - load(p.x));
    const total = rows.reduce((n, { x }) => n + load(x), 0);
    const mono = "JetBrains Mono";
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const h = Math.min(440, Math.max(150, 52 + rows.length * 56));
    return div()
      .relative()
      .w(340)
      .h(h)
      .children(box("#45475a", "#181825", "#11111b"))
      .child(
        v_flex()
          .relative()
          .size_full()
          .p(8)
          .gap(6)
          .font_family(mono)
          .child(
            h_flex()
              .h(28)
              .px(6)
              .pb(4)
              .border_b(1)
              .border_color("#313244")
              .items_center()
              .justify_between()
              .child(
                h_flex().gap(6).items_center()
                  .child(div().font_family(mono).font_bold().text_size(11).text_color("#a6e3a1").child("SERVER RACK"))
                  .when(rows.length > 0, (el) => el.child(div().text_size(9.5).text_color(t.dim).child(`(${total} running)`)))
              )
              .child(
                h_flex()
                  .relative()
                  .h(20)
                  .px(6)
                  .items_center()
                  .justify_center()
                  .cursor_pointer()
                  .children(box("#45475a", "#313244", "#11111b"))
                  .hover((s) => s.text_color("#ffffff"))
                  .on_click(() => closeOverlay(props()?.overlay))
                  .child(div().text_size(9).font_bold().text_color("#a6adc8").child("ESC"))
              )
          )
          .child(
            v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .gap(4)
              .when(rows.length === 0, (el) => el.child(div().px(10).py(18).text_size(11.5).text_color(t.dim).child("Quiet: no sub-agents or shell jobs running.")))
              .children(rows.map(({ a, x }) => {
                const parts = [x.interns.length ? plural(x.interns.length, "sub-agent") : null, x.jobs ? `${plural(x.jobs, "shell job")}${x.long ? ` (${x.long} over a minute)` : ""}` : null].filter(Boolean).join(" · ");
                return h_flex().id(`wl-${a.address}`).relative().h(52).px(6).gap(8).items_center().cursor_pointer()
                  .children(box("#313244", "#1e1e2e", "#11111b"))
                  .hover((st) => st.bg("#313244"))
                  .on_click(() => { run("agent.focus", { terminal: a.address }); closeOverlay(props().overlay); })
                  .child(div().flex_none().child(figureFor(a.space_name, a.status, 34, 0, speciesOf(progOf(a)))))
                  .child(v_flex().flex_1().min_w(0).gap(1)
                    .child(div().truncate().font_family(mono).font_bold().text_size(11.5).text_color(t.foreground).child([a.space_name, a.program?.name].filter(Boolean).join(" · ")))
                    .child(div().truncate().font_family(mono).text_size(9.5).text_color(t.muted).child(parts)))
                  .child(div().flex_none().font_family(mono).font_bold().text_size(12).text_color("#89b4fa").child("→"));
              }))
          )
      );
  }

  // The clock's summary of the day.
  todayView(t) {
    const raw = shared("pixel-hq.today");
    const d = raw && raw.day === dayKey() ? raw : freshDay();
    const top = Object.entries(d.bySpace ?? {}).sort((p, q) => q[1] - p[1])[0];
    const list = agents();
    const mono = "JetBrains Mono";
    const hm = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
    const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
    const line = (label, value) => h_flex().justify_between().px(10).py(4)
      .child(div().text_size(11.5).text_color(t.muted).child(label))
      .child(div().text_size(12).font_family(mono).font_bold().text_color(t.foreground).child(value));
    return div()
      .relative()
      .w(300)
      .children(box("#45475a", "#181825", "#11111b"))
      .child(
        v_flex()
          .relative()
          .p(8)
          .gap(4)
          .font_family(mono)
          .child(
            h_flex()
              .h(28)
              .px(6)
              .pb(4)
              .border_b(1)
              .border_color("#313244")
              .items_center()
              .justify_between()
              .child(
                h_flex().gap(6).items_center()
                  .child(div().font_family(mono).font_bold().text_size(11).text_color("#f9e2af").child("TODAY STATS"))
                  .child(div().text_size(9.5).text_color(t.dim).child(`${day} ${d.day}`))
              )
              .child(
                h_flex()
                  .relative()
                  .h(20)
                  .px(6)
                  .items_center()
                  .justify_center()
                  .cursor_pointer()
                  .children(box("#45475a", "#313244", "#11111b"))
                  .hover((s) => s.text_color("#ffffff"))
                  .on_click(() => closeOverlay(props()?.overlay))
                  .child(div().text_size(9).font_bold().text_color("#a6adc8").child("ESC"))
              )
          )
          .child(
            v_flex().gap(2).pt(2)
              .child(line("Tasks shipped", String(d.shipped)))
              .child(line("Time agents worked", hm(d.workMs)))
              .child(line("Busiest floor", top ? `${top[0]} · ${hm(top[1])}` : "none yet"))
              .child(line("Working now", String(list.filter((a) => a.status === "working").length)))
              .child(line("Waiting on you", String(list.filter((a) => a.status === "blocked").length)))
          )
      );
  }

  openNeedsYou() {
    const n = agents().filter((a) => a.status === "blocked").length;
    openOverlay({ mod: "company-agents", kind: "popup", frame: "none", width: 340, height: Math.min(440, Math.max(150, 52 + n * 56)), props: { needsYou: true } });
  }

  openHire(cx) {
    const h = this.hiring;
    h.open = !h.open;
    h.error = "";
    if (h.open) {
      const sp = spaces().find((x) => x.active);
      const cwd = panes().find((p) => p.focused)?.cwd;
      this.repoInput.set_value(sp?.folder || cwd || "");
      this.ticketInput.set_value("");
    }
    cx.notify();
  }

  async doHire(cx) {
    const h = this.hiring;
    if (h.busy) return;
    h.busy = true;
    h.error = "";
    cx.notify();
    try {
      const { path, branch } = await hire(exec, { ticket: this.ticketInput.value(), repo: this.repoInput.value() });
      const argv = { claude: ["claude"], codex: ["codex"], opencode: ["opencode"], agy: ["agy"], hermes: ["hermes"] }[h.program] ?? [h.program];
      run("tab.new", { name: branch, folder: path, argv, space: spaces().find((x) => x.active)?.id });
      h.open = false;
      this.ticketInput.set_value("");
    } catch (e) { h.error = String(e?.message ?? e); }
    h.busy = false;
    cx.notify();
  }

  runUpdate() {
    executePixelHqUpdate();
  }

  // The paper pile on a desk: the first click arms it, the second (within 6 s) sends the agent /compact (which already summarizes).
  // Only when the agent is idle, so nothing is typed into a busy terminal.
  pileClick(a, cx) {
    const now = Date.now();
    if (a.status === "working" || a.status === "blocked") { this.hint = { addr: a.address, text: a.status === "working" ? "busy: wait for it" : "answer it first", until: now + 3000 }; cx.notify(); return; }
    if (this.hint?.armed && this.hint.addr === a.address && now < this.hint.until) {
      this.hint = { addr: a.address, text: "compacting...", until: now + 8000 };
      const targetAddr = typeof a.address === "string" && a.address.includes("/") ? a.address.split("/").pop() : a.address;
      hc(["send", targetAddr, "/compact"]).catch(() => null);
    } else this.hint = { addr: a.address, text: "click the papers again to /compact", armed: true, until: now + 6000 };
    cx.notify();
  }

  nudge(a, cx) {
    const now = Date.now();
    this.hint = { addr: a.address, text: "nudged! ⚡", until: now + 3500 };
    this.nudged.set(a.address, now + 3000);
    run("pane.focus", { pane: a.pane });
    cx.notify();
  }

  async setupOpenCode(cx) {
    this.lastSetupOpenCodeAttempt = Date.now();
    if (this.isBusy(/opencode/)) {
      this.pendingSetupOpenCode = true;
      return;
    }
    const src = `${appHome()}/mods/company-agents/opencode-status.js`;
    const had = localStorage.getItem("oc-plugin") ? "1" : "0";
    // Exit codes: 0 added, 3 no OpenCode folder, 4 nothing to do, 5 updated to this mod's newer version of its own plugin.
    // Never touches a file that is not this plugin, and respects a plugin the person deleted.
    const sh = 'D="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"; [ -d "$D" ] || exit 3; T="$D/plugins/opencode-status.js"; '
      + 'if [ -e "$T" ]; then grep -q PixelHqStatus "$T" || exit 4; '
      + '[ "$(grep -o "pixel-hq-plugin v[0-9]*" "$T" | head -1)" = "$(grep -o "pixel-hq-plugin v[0-9]*" "$1" | head -1)" ] && exit 4; '
      + 'cp "$1" "$T" || exit 1; exit 5; fi; [ "$2" = 1 ] && exit 4; mkdir -p "$D/plugins" || exit 1; cp "$1" "$T" || exit 1';
    const ps = "param($src, $had); $c = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $env:USERPROFILE '.config' }; $d = Join-Path $c 'opencode'; "
      + "if (-not (Test-Path -LiteralPath $d)) { exit 3 }; $p = Join-Path $d 'plugins'; $t = Join-Path $p 'opencode-status.js'; "
      + "if (Test-Path -LiteralPath $t) { $cur = Get-Content -Raw -LiteralPath $t; if ($cur -notmatch 'PixelHqStatus') { exit 4 }; "
      + "$a = [regex]::Match($cur, 'pixel-hq-plugin v\\d+').Value; $b = [regex]::Match((Get-Content -Raw -LiteralPath $src), 'pixel-hq-plugin v\\d+').Value; "
      + "if ($a -eq $b) { exit 4 }; Copy-Item -LiteralPath $src -Destination $t -Force -ErrorAction Stop; exit 5 }; "
      + "if ($had -eq '1') { exit 4 }; New-Item -ItemType Directory -Force -Path $p | Out-Null; Copy-Item -LiteralPath $src -Destination $t -ErrorAction Stop";
    const r = await (window()?.platform === "windows"
      ? exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${ps} } '${src.replace(/'/g, "''")}' '${had}'`])
      : exec("sh", ["-c", sh, "sh", src, had])).catch(() => null);
    if (!r || ![0, 4, 5].includes(r.code)) {
      if (r && r.code !== 3) this.pendingSetupOpenCode = true;
      return;
    }
    this.pendingSetupOpenCode = false;
    localStorage.setItem("oc-plugin", "1");
    if (r.code === 0) { this.notice = "OpenCode plugin added · restart OpenCode to see it here"; cx.notify(); }
    if (r.code === 5) { this.notice = "OpenCode plugin updated · restart OpenCode to apply"; cx.notify(); }
  }

  async setupOpenCodeHp(cx) {
    if (this.isBusy(/opencode/)) {
      this.pendingSetupOpenCode = true;
      return;
    }
    const src = `${appHome()}/mods/company-agents/opencode-hp`;
    const had = localStorage.getItem("oc-hp-plugin") ? "1" : "0";
    // Exit codes mirror setupOpenCode: 0 added, 3 no OpenCode folder, 4 nothing to do, 5 updated to a newer version of this plugin.
    const sh = 'SRC="$1"; D="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"; [ -d "$D" ] || exit 3; T="$D/plugins/pixel-hq-hp"; '
      + 'if [ -d "$T" ]; then grep -q "pixel-hq-opencode-hp" "$T/tui.tsx" 2>/dev/null || exit 4; '
      + '[ "$(grep -o "pixel-hq-opencode-hp v[0-9]*" "$T/tui.tsx" | head -1)" = "$(grep -o "pixel-hq-opencode-hp v[0-9]*" "$SRC/tui.tsx" | head -1)" ] && exit 4; '
      + 'rm -rf "$T" && cp -r "$SRC" "$T" || exit 1; exit 5; fi; [ "$2" = 1 ] && exit 4; mkdir -p "$D/plugins" || exit 1; cp -r "$SRC" "$T" || exit 1';
    const ps = "param($src, $had); $c = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $env:USERPROFILE '.config' }; $d = Join-Path $c 'opencode'; "
      + "if (-not (Test-Path -LiteralPath $d)) { exit 3 }; $p = Join-Path $d 'plugins'; $t = Join-Path $p 'pixel-hq-hp'; "
      + "if (Test-Path -LiteralPath $t) { $cur = Get-Content -Raw -LiteralPath (Join-Path $t 'tui.tsx') -ErrorAction Stop; if ($cur -notmatch 'pixel-hq-opencode-hp') { exit 4 }; "
      + "$a = [regex]::Match($cur, 'pixel-hq-opencode-hp v\\d+').Value; $b = [regex]::Match((Get-Content -Raw -LiteralPath (Join-Path $src 'tui.tsx')), 'pixel-hq-opencode-hp v\\d+').Value; "
      + "if ($a -eq $b) { exit 4 }; Remove-Item -LiteralPath $t -Recurse -Force; Copy-Item -Recurse -LiteralPath $src -Destination $t -ErrorAction Stop; exit 5 }; "
      + "if ($had -eq '1') { exit 4 }; New-Item -ItemType Directory -Force -Path $p | Out-Null; Copy-Item -Recurse -LiteralPath $src -Destination $t -ErrorAction Stop";
    const r = await (window()?.platform === "windows"
      ? exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${ps} } '${src.replace(/'/g, "''")}' '${had}'`])
      : exec("sh", ["-c", sh, "sh", src, had])).catch(() => null);
    if (!r || ![0, 4, 5].includes(r.code)) {
      if (r && r.code !== 3) this.pendingSetupOpenCode = true;
      return;
    }
    localStorage.setItem("oc-hp-plugin", "1");
    if (r.code === 0) { this.notice = "OpenCode HP plugin added"; cx.notify(); }
    if (r.code === 5) { this.notice = "OpenCode HP plugin updated"; cx.notify(); }
  }

  // Hermes loads user plugins from <home>/plugins and runs only the ones listed in that home's config.yaml, per home: ~/.hermes and
  // every ~/.hermes/profiles/<name>. For each, once: copy hermes-status/ to plugins/pixel-hq-status and enable it with Hermes' own CLI.
  // Later launches only refresh Pixel HQ's own older copy (never re-enable it). A home where it was installed and then deleted
  // keeps a tombstone (.pixel-hq-status-installed) and is left alone for good. Each home with the plugin also gets HC_TERMINAL_ID
  // in terminal.client_env_passthrough, once, so `hermes --tui` sessions (run by a shared host with no terminal) know their terminal.
  // The steps are in hermes-setup.sh. Unix only; Hermes reads all of it on its next start.
  async setupHermes(cx) {
    if (checking() || window()?.platform === "windows") return; // a check must not touch ~/.hermes
    const dir = `${appHome()}/mods/company-agents`;
    const r = await exec("sh", [`${dir}/hermes-setup.sh`, `${dir}/hermes-status`], { timeout: 300000 }).catch(() => null);
    if (!r || r.code !== 0) return; // no Hermes here: nothing to do
    const [added, updated, , tui] = r.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
    if (added) { this.notice = `Hermes status plugin added${added > 1 ? ` to ${added} homes` : ""} · restart Hermes to get a desk`; cx.notify(); }
    else if (updated || tui) { this.notice = "Hermes status plugin updated · restart Hermes, and `hermes gateway restart` for the TUI"; cx.notify(); }
  }

  // `hermes --tui` runs its agent in a background host, so nothing reports until the first message. Give such a terminal its desk
  // at launch: hermes-announce.sh writes `idle` to the tty of a live local terminal whose foreground program is Hermes and that has
  // no status yet. Each terminal is tried at most every 30 s; never one on another machine.
  announceHermes(cx) {
    if (checking() || window()?.platform === "windows") return;
    const now = Date.now();
    this.hermesTried ??= new Map();
    const due = terminals().filter((t) => {
      if (t.state !== "live" || t.status || String(t.address).includes("/")) return false;
      // The process name, not argv: `vim ~/.hermes/config.yaml` must not get a desk.
      return t.foreground?.name === "hermes" && now - (this.hermesTried.get(t.address) ?? 0) > 30000;
    });
    if (!due.length) return;
    for (const t of due) this.hermesTried.set(t.address, now);
    const script = `${appHome()}/mods/company-agents/hermes-announce.sh`;
    cx.spawn(async () => { await exec("sh", [script, ...due.map((t) => String(t.address))], { timeout: 15000 }).catch(() => null); });
  }

  async setupClaude(cx) {
    this.lastSetupClaudeAttempt = Date.now();
    if (this.isBusy(/claude/)) {
      this.pendingSetupClaude = true;
      return;
    }
    const src = `${appHome()}/mods/company-agents/claude-statusline.sh`;
    const sh = 'SRC="$1"; D="$HOME/.claude"; [ -d "$D" ] || exit 3; T="$D/pixel-hq-statusline.sh"; '
      + 'cp "$SRC" "$T" && chmod +x "$T" || exit 1; '
      + 'python3 -c \'import json, os, sys, time; p = os.path.expanduser("~/.claude/settings.json"); '
      + 'cmd = "sh " + os.path.expanduser("~/.claude/pixel-hq-statusline.sh"); '
      + 'd = None; '
      + 'if os.path.exists(p): '
      + '  for _ in range(5): '
      + '    try: '
      + '      with open(p, "r", encoding="utf-8") as f: d = json.load(f); '
      + '      break; '
      + '    except Exception: time.sleep(0.2); '
      + '  if d is None: sys.exit(1); '
      + 'else: d = {}; '
      + 'cur = d.get("statusLine"); '
      + 'cur_cmd = cur.get("command") if isinstance(cur, dict) else str(cur or ""); '
      + 'if cur_cmd == cmd: sys.exit(0); '
      + 'if not cur or "pixel-hq" in cur_cmd or "claude-statusline" in cur_cmd: '
      + '  d["statusLine"] = {"type": "command", "command": cmd}; '
      + '  tmp = f"{p}.tmp.{os.getpid()}"; '
      + '  try: '
      + '    with open(tmp, "w", encoding="utf-8") as f: '
      + '      json.dump(d, f, indent=2); f.flush(); os.fsync(f.fileno()); '
      + '    os.replace(tmp, p); '
      + '  except Exception: '
      + '    if os.path.exists(tmp): '
      + '      try: os.remove(tmp) '
      + '      except Exception: pass; '
      + '    sys.exit(1); '
      + 'sys.exit(0)\' 2>/dev/null || exit 1; exit 0';
    const ps = "param($src); $d = Join-Path $env:USERPROFILE '.claude'; if (-not (Test-Path -LiteralPath $d)) { exit 3 }; "
      + "$t = Join-Path $d 'pixel-hq-statusline.sh'; Copy-Item -LiteralPath $src -Destination $t -Force; "
      + "$cfg = Join-Path $d 'settings.json'; $cmd = 'sh ' + ($t -replace '\\\\', '/'); "
      + "$obj = $null; "
      + "if (Test-Path -LiteralPath $cfg) { "
      + "  for ($i = 0; $i -lt 5; $i++) { "
      + "    try { $raw = Get-Content -Raw -LiteralPath $cfg -ErrorAction Stop; "
      + "      $obj = if ($raw.Trim().Length -gt 0) { $raw | ConvertFrom-Json -ErrorAction Stop } else { [pscustomobject]@{} }; break; "
      + "    } catch { Start-Sleep -Milliseconds 200 } "
      + "  }; if ($null -eq $obj) { exit 1 } "
      + "} else { $obj = [pscustomobject]@{} }; "
      + "$cur = if ($obj.statusLine) { $obj.statusLine.command } else { '' }; "
      + "if ($cur -eq $cmd) { exit 0 }; "
      + "if (-not $cur -or $cur -match 'pixel-hq' -or $cur -match 'claude-statusline') { "
      + "  if (-not $obj.statusLine) { $obj | Add-Member -NotePropertyName statusLine -NotePropertyValue ([pscustomobject]@{ type='command'; command=$cmd }) } else { $obj.statusLine.command = $cmd }; "
      + "  $tmp = \"$cfg.tmp.$PID\"; $json = $obj | ConvertTo-Json -Depth 10; "
      + "  for ($i = 0; $i -lt 5; $i++) { "
      + "    try { [System.IO.File]::WriteAllText($tmp, $json, [System.Text.Encoding]::UTF8); Move-Item -LiteralPath $tmp -Destination $cfg -Force -ErrorAction Stop; break } "
      + "    catch { Start-Sleep -Milliseconds 200 } "
      + "  } "
      + "}";
    const machines = [undefined, ...new Set(spaces().map((s) => s.machine).filter(Boolean))];
    let ok = true;
    for (const on of machines) {
      const isWin = !on && window()?.platform === "windows";
      let r;
      if (isWin) {
        r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${ps} } '${src.replace(/'/g, "''")}'`]).catch(() => null);
      } else {
        r = await exec("sh", ["-c", sh, "sh", src], { on, timeout: 8000 }).catch(() => null);
      }
      if (r && r.code !== 0 && r.code !== 3) ok = false;
      else if (!r) ok = false;
    }
    this.pendingSetupClaude = !ok;
  }

  async setupAntigravity(cx) {
    this.lastSetupAntigravityAttempt = Date.now();
    if (this.isBusy(/antigravity|agy/)) {
      this.pendingSetupAntigravity = true;
      return;
    }
    const src = `${appHome()}/mods/company-agents/claude-statusline.sh`;
    const sh = 'SRC="$1"; D="$HOME/.gemini/antigravity-cli"; [ -d "$D" ] || exit 3; T="$D/pixel-hq-statusline.sh"; '
      + 'cp "$SRC" "$T" && chmod +x "$T" || exit 1; '
      + 'python3 -c \'import json, os, sys, time; p = os.path.expanduser("~/.gemini/antigravity-cli/settings.json"); '
      + 'cmd = "sh " + os.path.expanduser("~/.gemini/antigravity-cli/pixel-hq-statusline.sh"); '
      + 'd = None; '
      + 'if os.path.exists(p): '
      + '  for _ in range(5): '
      + '    try: '
      + '      with open(p, "r", encoding="utf-8") as f: d = json.load(f); '
      + '      break; '
      + '    except Exception: time.sleep(0.2); '
      + '  if d is None: sys.exit(1); '
      + 'else: d = {}; '
      + 'cur = d.get("statusLine"); '
      + 'cur_cmd = cur.get("command") if isinstance(cur, dict) else str(cur or ""); '
      + 'cur_en = cur.get("enabled", True) if isinstance(cur, dict) else True; '
      + 'if cur_cmd == cmd and cur_en is True: sys.exit(0); '
      + 'if not cur or "pixel-hq" in cur_cmd or "statusline-probe" in cur_cmd or "claude-statusline" in cur_cmd: '
      + '  d["statusLine"] = {"type": "command", "command": cmd, "enabled": True}; '
      + '  tmp = f"{p}.tmp.{os.getpid()}"; '
      + '  try: '
      + '    with open(tmp, "w", encoding="utf-8") as f: '
      + '      json.dump(d, f, indent=2); f.flush(); os.fsync(f.fileno()); '
      + '    os.replace(tmp, p); '
      + '  except Exception: '
      + '    if os.path.exists(tmp): '
      + '      try: os.remove(tmp) '
      + '      except Exception: pass; '
      + '    sys.exit(1); '
      + 'sys.exit(0)\' 2>/dev/null || exit 1; exit 0';
    const ps = "param($src); $d = Join-Path $env:USERPROFILE '.gemini\\antigravity-cli'; if (-not (Test-Path -LiteralPath $d)) { exit 3 }; "
      + "$t = Join-Path $d 'pixel-hq-statusline.sh'; Copy-Item -LiteralPath $src -Destination $t -Force; "
      + "$cfg = Join-Path $d 'settings.json'; $cmd = 'sh ' + ($t -replace '\\\\', '/'); "
      + "$obj = $null; "
      + "if (Test-Path -LiteralPath $cfg) { "
      + "  for ($i = 0; $i -lt 5; $i++) { "
      + "    try { $raw = Get-Content -Raw -LiteralPath $cfg -ErrorAction Stop; "
      + "      $obj = if ($raw.Trim().Length -gt 0) { $raw | ConvertFrom-Json -ErrorAction Stop } else { [pscustomobject]@{} }; break; "
      + "    } catch { Start-Sleep -Milliseconds 200 } "
      + "  }; if ($null -eq $obj) { exit 1 } "
      + "} else { $obj = [pscustomobject]@{} }; "
      + "$cur = if ($obj.statusLine) { $obj.statusLine.command } else { '' }; "
      + "$en = if ($obj.statusLine -and ($obj.statusLine | Get-Member -Name enabled)) { $obj.statusLine.enabled } else { $true }; "
      + "if ($cur -eq $cmd -and $en -eq $true) { exit 0 }; "
      + "if (-not $cur -or $cur -match 'pixel-hq' -or $cur -match 'claude-statusline' -or $cur -match 'statusline-probe') { "
      + "  if (-not $obj.statusLine) { $obj | Add-Member -NotePropertyName statusLine -NotePropertyValue ([pscustomobject]@{ type='command'; command=$cmd; enabled=$true }) } else { $obj.statusLine.command = $cmd; $obj.statusLine.enabled = $true }; "
      + "  $tmp = \"$cfg.tmp.$PID\"; $json = $obj | ConvertTo-Json -Depth 10; "
      + "  for ($i = 0; $i -lt 5; $i++) { "
      + "    try { [System.IO.File]::WriteAllText($tmp, $json, [System.Text.Encoding]::UTF8); Move-Item -LiteralPath $tmp -Destination $cfg -Force -ErrorAction Stop; break } "
      + "    catch { Start-Sleep -Milliseconds 200 } "
      + "  } "
      + "}";
    const machines = [undefined, ...new Set(spaces().map((s) => s.machine).filter(Boolean))];
    let ok = true;
    for (const on of machines) {
      const isWin = !on && window()?.platform === "windows";
      let r;
      if (isWin) {
        r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${ps} } '${src.replace(/'/g, "''")}'`]).catch(() => null);
      } else {
        r = await exec("sh", ["-c", sh, "sh", src], { on, timeout: 8000 }).catch(() => null);
      }
      if (r && r.code !== 0 && r.code !== 3) ok = false;
      else if (!r) ok = false;
    }
    this.pendingSetupAntigravity = !ok;
  }

  async setupCodex(cx) {
    this.lastSetupCodexAttempt = Date.now();
    if (this.isBusy(/codex/)) {
      this.pendingSetupCodex = true;
      return;
    }
    const src = `${appHome()}/mods/company-agents/codex-vitals.py`;
    const sh = 'SRC="$1"; D="$HOME/.codex"; [ -d "$D" ] || exit 3; T="$D/pixel-hq-vitals.py"; '
      + 'cp "$SRC" "$T" && chmod +x "$T" || exit 1; exit 0';
    const ps = "param($src); $d = Join-Path $env:USERPROFILE '.codex'; if (-not (Test-Path -LiteralPath $d)) { exit 3 }; "
      + "$t = Join-Path $d 'pixel-hq-vitals.py'; Copy-Item -LiteralPath $src -Destination $t -Force -ErrorAction Stop";
    const machines = [undefined, ...new Set(spaces().map((s) => s.machine).filter(Boolean))];
    let ok = true;
    for (const on of machines) {
      const isWin = !on && window()?.platform === "windows";
      let r;
      if (isWin) {
        r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${ps} } '${src.replace(/'/g, "''")}'`]).catch(() => null);
      } else {
        r = await exec("sh", ["-c", sh, "sh", src], { on, timeout: 8000 }).catch(() => null);
      }
      if (r && r.code !== 0 && r.code !== 3) ok = false;
      else if (!r) ok = false;
    }
    this.pendingSetupCodex = !ok;
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.needsYou) return this.needsYou(t);
    if (props()?.workload) return this.workloadView(t);
    if (props()?.today) return this.todayView(t);
    if (this.editor) return this.editor.render(cx);
    const dismissed = shared("pixel-hq.dismissed-version") || localStorage.getItem("upd-dismissed");
    if (this.update && dismissed === String(this.update.version)) {
      this.update = null;
    }
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    const everyone = list;
    const blockedAll = list.filter((a) => a.status === "blocked");
    let settleDirty = false;
    for (const a of list) if ((a.status === "working" || a.status === "blocked") && this.settled.delete(a.address)) settleDirty = true;
    const live = new Set(list.map((a) => a.address));
    for (const s of [...this.settled]) if (!live.has(s)) { this.settled.delete(s); settleDirty = true; }
    if (settleDirty) { try { localStorage.setItem("settled", JSON.stringify([...this.settled])); } catch { /* storage full: retry next render */ } }
    const settledCount = list.filter((a) => this.settled.has(a.address)).length;
    const settledBySpace = new Map();
    for (const a of list) if (this.settled.has(a.address)) settledBySpace.set(a.space, (settledBySpace.get(a.space) ?? 0) + 1);
    list = list.filter((a) => !this.settled.has(a.address));
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now, cx);
    this.watch(list, now);
    this.hold(list);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    // Each floor is its own office: only the agents of the shown space sit here.
    const activeId = spaces().find((x) => x.active)?.id;
    const settledFloor = activeId ? (settledBySpace.get(activeId) ?? 0) : settledCount;
    if (activeId) list = list.filter((a) => a.space === activeId);
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority, a.space_name))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/company-agents/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // Labels are program-scoped: claude.* only while Claude is the foreground program, or a
    // recycled pane would forever show the previous session's numbers.
    const contextOf = new Map(all.flatMap((k) => {
      const labels = k.labels ?? {};
      const prog = progOf(k).toLowerCase();
      const isClaude = /claude/.test(prog);
      const isAgy = /antigravity|agy/.test(prog);
      const isCodex = /codex/.test(prog);
      const own = isClaude ? labels["claude.context"] ?? labels["agent.context"] : (isAgy ? labels["agy.context"] ?? labels["agent.context"] : (isCodex ? labels["codex.context"] ?? labels["agent.context"] : labels["agent.context"]));
      const model = isClaude ? (labels["claude.model"] || labels["agent.model"] || null) : (labels["agent.model"] || labels["agy.model"] || labels["codex.model"] || null);
      const v = Number.parseInt(own, 10);
      const q = Number.parseInt((isClaude ? labels["claude.quota"] ?? labels["agent.quota"] : (isAgy ? labels["agy.quota"] ?? labels["agent.quota"] : (isCodex ? labels["codex.quota"] ?? labels["agent.quota"] : labels["agent.quota"]))), 10);
      if (!Number.isFinite(v) && !Number.isFinite(q) && !model) return [];
      return [[k.address, {
        pct: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null,
        model,
        quota: Number.isFinite(q) ? Math.max(0, Math.min(100, q)) : null,
        effort: (isClaude ? labels["claude.effort"] || labels["agent.effort"] : labels["agent.effort"]) || null,
      }]];
    }));
    const activityOf = activityAll(all);
    for (const [addr, c] of this.ctxRead) {
      const prev = contextOf.get(addr);
      contextOf.set(addr, {
        pct: c.pct ?? prev?.pct ?? null,
        model: c.model ?? prev?.model ?? null,
        quota: c.quota ?? prev?.quota ?? null,
        effort: prev?.effort ?? null,
      });
    }

    const row = (a, i, subs = []) => {
      const pic = figureFor(a.space_name, a.status, 45, this.waitOf(a.address, a.status, now), speciesOf(progOf(a)));
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/company-agents/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = (shared("pixel-hq.names") ?? {})[a.pane]?.name ?? (full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a)));
      return h_flex()
        .id(`ag-${a.address}`)
        .pl(4)
        .pr(8)
        .h(66)
        .flex_none()
        .border_b(2)
        .border_color("#5B8C3A66")
        .items_center()
        .gap(6)
        .bg("#10121ccc")
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(div().id(`agent-fold-${a.address}`)
          .tooltip(`${a.program?.name ? `${a.program.name} · ` : ""}${a.status} · right-click to change figures`)
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openFigures(a.space_name); })
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(more))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/company-agents/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    // Expanded: a pixel farm with one small pet per agent, scattered over the field.
    const sz = this.size ?? { width: 268, height: 640 };
    // Every agent gets a desk. The more agents, the smaller the desks (never below 0.42x), so all of them stay visible.
    const horizon = yHorizon(sz.height);
    const fieldTop = horizon + 20;
    const nAgents = list.length;
    const paneBy = new Map(panes().map((p) => [p.pane, p]));
    const withBranch = list.some((a) => paneBy.get(a.pane)?.branch);
    const withVitals = list.some((a) => contextOf.get(a.address));
    const plan = (sc, extraVitals) => {
      const P = Math.round(46 * sc), pw = duckWidth(P), cw = Math.max(pw + Math.round(24 * sc), 76), ch = P + Math.round(28 * sc) + 26 + (withBranch ? 15 : 0) + extraVitals;
      return { sc, P, pw, cw, ch, cols: Math.max(1, Math.floor((sz.width - 8) / cw)), rows: Math.max(1, Math.floor((sz.height - fieldTop - 4) / ch)) };
    };
    const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42];
    const base = scales.map((s) => plan(s, 0));
    const vitalsOn = withVitals && (base.find((p) => p.cols * p.rows >= nAgents) ?? base[base.length - 1]).cw >= 90;
    const P0 = scales.map((s) => plan(s, vitalsOn ? 11 : 0));
    const pick = P0.find((p) => p.cols * p.rows >= nAgents) ?? P0[P0.length - 1];
    const S = pick.sc, PET = pick.P, petW = pick.pw, cellW = pick.cw, cellH = pick.ch;
    const kk = (v) => Math.round(v * S);
    const fieldH = Math.max(0, sz.height - fieldTop - cellH);
    const endDrag = (cx) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!d.moved) {
        const clicked = list.find((x) => x.address === d.addr);
        const isLongIdle = clicked?.status === "idle" && this.waitOf(clicked.address, clicked.status, now) >= IDLE_SNOOZE;
        if (isLongIdle) this.nudge(clicked, cx);
        else run("pane.focus", { pane: d.pane });
      } else localStorage.setItem("petpos", JSON.stringify(this.petpos));
      cx.notify();
    };
    const ROLES = (a) => ((shared("pixel-hq.names") ?? {})[a.pane]?.role ?? agentOf(a.program?.key)?.role ?? "").toLowerCase();
    const STATE = { working: "typing working busy", idle: "idle break coffee snooze urge sleeping", done: "shipped done finished", blocked: "needs you blocked waiting" };
    const q = this.query.trim().toLowerCase();
    const hitOf = (a) => !q || q.split(/\s+/).every((w) => [detail.get(a.address), a.space_name, label(a), a.program?.name, ROLES(a), STATE[a.status]].join(" ").toLowerCase().includes(w));
    const hits = list.filter(hitOf);
    this.firstHit = q ? hits[0]?.pane ?? null : null;
    const breakers = list.filter((x) => x.status === "idle" && !x.focused && this.waitOf(x.address, x.status, now) < IDLE_SNOOZE).map((x) => x.address);
    this.breakerList = breakers;
    const stable = list.map((x) => x.address).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const seated = list.slice(0, pick.cols * pick.rows);
    const shownSet = new Set(seated.map((x) => x.address));
    const order = stable.filter((x) => shownSet.has(x));
    const colsUsed = Math.min(pick.cols, Math.max(2, Math.ceil(seated.length / pick.rows)));
    const rowsUsed = Math.ceil(seated.length / colsUsed);
    const hidden = list.length - seated.length;
    const posOf = new Map();
    const monoF = "JetBrains Mono";
    const pets = seated.map((a, i) => {
      // A pet keeps its desk: slots follow a stable order, not the status sort.
      const slot = order.indexOf(a.address);
      const sx = ((slot % colsUsed) + 0.5) / colsUsed;
      const sy = rowsUsed > 1 ? (Math.floor(slot / colsUsed) + ((slot % colsUsed) % 2) * (rowsUsed < 3 ? 0.12 : 0)) / (rowsUsed - 1 + (rowsUsed < 3 ? 0.12 : 0)) : 0;
      const lap = 0;
      const own = this.petpos[a.address];
      // Room for the cubicle panels (9 units each side) and the server rack (11 units right), so an edge desk shows them.
      const left = own ? own[0] * sz.width : Math.max(kk(10), Math.min(sz.width - petW - kk(12), sz.width * Math.min(0.92, sx + lap) - petW / 2));
      const top = own ? own[1] * sz.height : fieldTop + fieldH * Math.min(1, sy + lap);
      posOf.set(a.address, { x: left + petW / 2, y: top + PET * 0.5 });
      const ctx = contextOf.get(a.address);
      const ctxPct = ctx?.pct ?? null;
      const act = activityOf.get(a.address) ?? { interns: [], jobs: 0, long: 0 };
      // Typing speeds up with every intern and job at the desk, up to twice as fast.
      const pace = 1 + Math.min(1, 0.25 * (act.interns.length + act.jobs));
      const modelTxt = ctx ? modelOf(ctx) : "";
      const more = detail.get(a.address);
      const text = (shared("pixel-hq.names") ?? {})[a.pane]?.name ?? more ?? a.space_name ?? label(a);
      // The desk's branch (its own worktree, ideally) and whether another desk is about to step on it.
      const branch = paneBy.get(a.pane)?.branch ?? null;
      const cl = this.clash.get(a.address) ?? null;
      const clText = cl ? (cl.kind === "file" ? `clash: ${String(cl.files[0] ?? "").split("/").pop()}${cl.files.length > 1 ? ` +${cl.files.length - 1}` : ""}` : "same folder") : "";
      const clTip = cl ? (cl.kind === "file" ? `Another desk also changed ${cl.files.join(", ")}` : "Another desk is working in this same folder") : "";
      const when = this.since(a);
      const waited = now - when;
      const unseen = this.waitOf(a.address, a.status, now);
      const hot = a.status === "blocked";
      const isIdle = a.status === "idle";
      const isUrge = isIdle && unseen >= IDLE_URGE;
      const isSnooze = isIdle && unseen >= IDLE_SNOOZE && !isUrge;
      const isNudged = this.nudged.has(a.address);
      // The pet sits on a chair behind a wooden desk (the MacBook is part of the pet).
      const ctr = DUCK_CENTER * petW;
      const away = this.out?.addr === a.address && breakers.includes(a.address);
      // On a break the pet steps out beside its desk for a moment and comes right back, over and over.
      const dir = left + petW / 2 < sz.width / 2 ? 1 : -1;
      const dx = dir * (petW + kk(30));
      const dy = Math.round(PET * 0.42);
      const seat = div().relative().w(petW).h(PET + kk(28))
        // Office chair seen from behind: a tall rounded back with a headrest, a lighter cushion with a centre seam,
        // two rounded armrests, then a pole and a star base with wheels under the desk.
        .child(div().absolute().left(ctr - petW * 0.4 - kk(2)).top(-kk(12)).w(petW * 0.8 + kk(4)).h(PET * 0.9 + kk(2)).rounded_t(11).bg("#1c1e2c"))
        .child(div().absolute().left(ctr - kk(15)).top(-kk(17)).w(kk(30)).h(kk(11)).rounded_t(6).bg("#1c1e2c"))
        .child(div().absolute().left(ctr - kk(13)).top(-kk(15)).w(kk(26)).h(kk(9)).rounded_t(5).bg("#4d5273"))
        .child(div().absolute().left(ctr - petW * 0.4).top(-kk(10)).w(petW * 0.8).h(PET * 0.9).rounded_t(9).bg("#3c4054"))
        .child(div().absolute().left(ctr - petW * 0.4 + kk(5)).top(-kk(1)).w(petW * 0.8 - kk(10)).h(PET * 0.9 - kk(12)).rounded_t(6).bg("#474c66"))
        .child(div().absolute().left(ctr - kk(1)).top(kk(0)).w(kk(2)).h(PET * 0.9 - kk(13)).bg("#363a4f"))
        .child(div().absolute().left(ctr - petW * 0.4 + kk(7)).top(-kk(8)).w(petW * 0.8 - kk(14)).h(kk(3)).rounded(2).bg("#60668a"))
        .child(div().absolute().left(ctr - petW * 0.4 - kk(9)).top(PET * 0.34).w(kk(11)).h(kk(19)).rounded(4).bg("#1c1e2c"))
        .child(div().absolute().left(ctr - petW * 0.4 - kk(7)).top(PET * 0.34 + kk(2)).w(kk(8)).h(kk(16)).rounded(3).bg("#32364b"))
        .child(div().absolute().left(ctr - petW * 0.4 - kk(6)).top(PET * 0.34 + kk(3)).w(kk(6)).h(kk(3)).rounded(1).bg("#585e82"))
        .child(div().absolute().left(ctr + petW * 0.4 - kk(2)).top(PET * 0.34).w(kk(11)).h(kk(19)).rounded(4).bg("#1c1e2c"))
        .child(div().absolute().left(ctr + petW * 0.4 - kk(1)).top(PET * 0.34 + kk(2)).w(kk(8)).h(kk(16)).rounded(3).bg("#32364b"))
        .child(div().absolute().left(ctr + petW * 0.4).top(PET * 0.34 + kk(3)).w(kk(6)).h(kk(3)).rounded(1).bg("#585e82"))
        .child(div().absolute().left(ctr - kk(2)).top(PET * 0.84 + kk(8)).w(kk(4)).h(kk(10)).bg("#2b2f45"))
        .child(div().absolute().left(ctr - kk(15)).top(PET * 0.84 + kk(18)).w(kk(30)).h(kk(4)).bg("#2b2f45"))
        .child(div().absolute().left(ctr - kk(17)).top(PET * 0.84 + kk(22)).w(kk(5)).h(kk(4)).bg("#14172a"))
        .child(div().absolute().left(ctr + kk(12)).top(PET * 0.84 + kk(22)).w(kk(5)).h(kk(4)).bg("#14172a"))
        // Cubicle panels on both sides of the desk.
        .child(div().absolute().left(-kk(9)).top(PET * 0.34).w(kk(5)).h(PET * 0.62).bg("#8b92b4"))
        .child(div().absolute().left(-kk(9)).top(PET * 0.34).w(kk(2)).h(PET * 0.62).bg("#aab1d2"))
        .child(div().absolute().left(petW + kk(4)).top(PET * 0.34).w(kk(5)).h(PET * 0.62).bg("#8b92b4"))
        .child(div().absolute().left(petW + kk(7)).top(PET * 0.34).w(kk(2)).h(PET * 0.62).bg("#6f7698"))
        .when(Boolean(cl), (el) => el.child(div().absolute().left(petW - kk(8)).top(-kk(26)).w(kk(12)).h(kk(18))
          .children([[6, 0, 6, 4], [3, 4, 6, 4], [0, 8, 10, 4], [4, 12, 5, 4], [2, 16, 4, 2]].map(([x, y, w, h]) => div().absolute().left(kk(x)).top(kk(y)).w(kk(w)).h(kk(h)).bg(cl.kind === "file" ? "#ff5370" : "#f9b84a")))
          .loop("opacity", { from: 0.25, to: 1, period: 520, easing: "ease-in-out" })))
        .child(div().id(`walker-${a.address}`).absolute()
          .left(away ? dx : 0).top(away ? dy : 0)
          // Glide out and back, but not while it is being dragged, so it follows the pointer exactly.
          .when(this.drag?.addr !== a.address, (el) => el.transition("left", 800).transition("top", 800))
          .child(figureFor(a.space_name, isNudged ? "done" : a.status, PET, unseen, speciesOf(progOf(a)), pace)))
        // Shipped: pixel confetti rains over the desk until someone looks at it.
        .when(a.status === "done", (el) => el.children([["#f9e2af", 0.10, 900], ["#f38ba8", 0.22, 1300], ["#a6e3a1", 0.34, 1000], ["#89b4fa", 0.46, 1500], ["#cba6f7", 0.58, 1100], ["#fab387", 0.70, 1400], ["#94e2d5", 0.82, 950]]
          .map(([c, fx0, p], j) => div().absolute().left(petW * fx0).top(-20).w(4).h(4).bg(c).loop("top", { from: -22 - (j % 3) * 6, to: PET * 0.55, period: p, easing: "linear" }))))
        // A steel-grey desk with a front panel, and a mouse on top.
        .child(div().absolute().left(-kk(6)).top(PET * 0.84).w(petW + kk(12)).h(kk(9)).bg("#646a8c"))
        .child(div().absolute().left(-kk(6)).top(PET * 0.84).w(petW + kk(12)).h(kk(3)).bg("#7a81a6"))
        .child(div().absolute().left(-kk(6)).top(PET * 0.84 + kk(9)).w(petW + kk(12)).h(kk(3)).bg("#454a68"))
        .child(div().absolute().left(-kk(3)).top(PET * 0.84 + kk(12)).w(petW + kk(6)).h(kk(10)).bg("#3b3f5a"))
        .child(div().absolute().left(ctr - kk(8)).top(PET * 0.84 + kk(15)).w(kk(16)).h(kk(3)).bg("#262a40"))
        .child(div().absolute().left(petW - kk(6)).top(PET * 0.84 - kk(4)).w(kk(7)).h(kk(4)).rounded(2).bg("#c9cee6"))
        // A server rack on the right cubicle panel: one blinking LED per shell job, amber once it has run over a minute.
        .when(act.jobs > 0, (el) => {
          const rackTop = PET * 0.3, rackH = PET * 0.66, fit = Math.max(1, Math.floor((rackH - kk(4)) / kk(5)));
          const leds = Array.from({ length: Math.min(act.jobs, fit) }, (_, i) => div().absolute().left(kk(2)).top(kk(3) + i * kk(5)).w(kk(5)).h(Math.max(2, kk(3))).rounded(1)
            .bg(i < act.long ? "#f9b84a" : "#a6e3a1").loop("opacity", { from: 0.3, to: 1, period: 360 + ((i * 137) % 420), easing: "linear" }));
          return el.child(div().absolute().left(petW + kk(2)).top(rackTop).w(kk(9)).h(rackH).rounded(2).bg("#161827").border_1().border_color("#2e3250")
            .child(div().absolute().left(kk(2)).top(rackH - kk(4)).w(kk(5)).h(kk(1)).bg("#2e3250"))
            .children(leds));
        })
        // Runners: a little helper bot per running shell job (three at most, then "+N"), pacing the floor between the desk and
        // the rack with a parcel, hopping as it goes; amber once its job has run over a minute. All motion is native loops.
        .when(act.jobs > 0, (el) => {
          // Sized like an intern (13 units tall), on the floor below the desk, clear of the interns at its front.
          const u = Math.max(1.4, (PET * 0.4) / 13), ru = (v) => Math.round(v * u);
          const rh = ru(13), floor = PET * 0.84 + kk(22) - rh + kk(13), shown = Math.min(act.jobs, 3), extra = act.jobs - shown;
          const x0 = ctr - ru(4), x1 = petW + kk(4);
          const bot = (i) => {
            const c = i < act.long ? "#f9b84a" : "#a6e3a1", leg = 150 + i * 30;
            // Paced by an offset from x0, not absolute positions: Herdr doesn't scale loop values by the zoom.
            return div().absolute().left(x0).top(floor + (i % 2) * ru(2)).w(x1 - x0 + ru(9)).h(rh)
              .child(div().absolute().top(0).left(0).w(ru(9)).h(rh).loop("left", { from: i % 2 ? x1 - x0 : 0, to: i % 2 ? 0 : x1 - x0, period: 1700 + i * 600, easing: "ease-in-out" })
              .child(div().absolute().left(0).top(0).w(ru(9)).h(rh).loop("top", { from: 0, to: -ru(2), period: 320 + i * 40, easing: "ease-out" })
                .child(div().absolute().left(ru(1)).top(0).w(ru(7)).h(ru(6)).rounded(2).bg(c))
                .child(div().absolute().left(ru(2)).top(ru(2)).w(ru(5)).h(ru(2)).bg("#1e2030")
                  .child(div().absolute().left(ru(1)).top(0).w(ru(1)).h(ru(2)).bg(c).loop("left", { from: 0, to: ru(3), period: 900, easing: "linear" })))
                .child(div().absolute().left(ru(2)).top(ru(6)).w(ru(5)).h(ru(4)).bg("#585e82"))
                .child(div().absolute().left(ru(4)).top(ru(5)).w(ru(5)).h(ru(4)).rounded(1).bg("#e9d8b4").border_1().border_color("#a8946a"))
                .child(div().absolute().left(ru(2)).top(ru(10)).w(ru(2)).bg("#2b2f45").loop("height", { from: ru(1), to: ru(3), period: leg, easing: "linear" }))
                .child(div().absolute().left(ru(5)).top(ru(10)).w(ru(2)).bg("#2b2f45").loop("height", { from: ru(3), to: ru(1), period: leg, easing: "linear" }))));
          };
          return el.children(Array.from({ length: shown }, (_, i) => bot(i)))
            .when(extra > 0, (e2) => e2.child(div().absolute().left(x1 + ru(4)).top(floor + ru(3)).px(2).rounded(3)
              .bg("#0f111acc").text_size(Math.max(8, kk(9))).text_color("#cdd6f4").child(`+${extra}`)));
        })
        // Interns in front of the desk, one tiny pet per running sub-agent (three at most, then "+N").
        .when(act.interns.length > 0, (el) => {
          const ih = Math.max(12, Math.round(PET * 0.38)), iw = duckWidth(ih), step = Math.round(iw * 0.62);
          const top = PET * 0.84 + kk(22) - ih, shown = act.interns.slice(0, 3), extra = act.interns.length - shown.length;
          return el
            .children(shown.map((it, j) => div().absolute().left(kk(2) + j * step).top(top).child(duckMood(mood(it.status, 0), ih, { species: it.species }))))
            .when(extra > 0, (e2) => e2.child(div().absolute().left(kk(2) + shown.length * step + Math.round(iw * 0.45)).top(top + Math.round(ih * 0.3)).px(3).rounded(3)
              .bg("#0f111acc").text_size(Math.max(8, kk(9))).text_color("#cdd6f4").child(`+${extra}`)));
        })
        // Papers pile up on the desk as the agent's context fills: one sheet per 10%, the top ones turn pink past 80%.
        .when(Boolean(ctxPct != null && ctxPct >= 5), (el) => {
          const n = Math.max(1, Math.min(10, Math.ceil(ctxPct / 10)));
          const sh = Math.max(2, kk(3)), hot = ctxPct >= 80, full = ctxPct >= 95;
          const sheets = Array.from({ length: n }, (_, k) => div().absolute().left(kk(1) + ((k * 7) % 3 - 1) * kk(1)).top((n - 1 - k) * sh + kk(2)).w(kk(15)).h(sh)
            .bg(k >= n - 2 && hot ? (k === n - 1 ? "#f5b8c0" : "#f0cbd0") : k % 2 ? "#e9e2d4" : "#f6f1e7").border_b(1).border_color("#b9b19f"));
          const pile = div().id(`pile-${a.address}`).absolute().left(petW - kk(25)).top(PET * 0.84 - n * sh - kk(4)).w(kk(18)).h(n * sh + kk(6)).cursor_pointer()
            .tooltip(`Context ${ctxPct}% used · click to /compact`)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.pileClick(a, cx); })
            .children(sheets);
          // A full pile bobs by a small offset inside a normally placed box (loop values aren't scaled by the zoom).
          return el.child(full ? div().absolute().left(0).top(PET * 0.84 - n * sh - kk(6)).w(petW).h(n * sh + kk(8))
            .child(pile.top(kk(2)).loop("top", { from: kk(2), to: 0, period: 600, easing: "ease-in-out" })) : pile);
        })
        .when(a.status === "done", (el) => el.child(div().id(`settle-${a.address}`).absolute().left(-kk(3)).top(-kk(13)).w(kk(13)).h(kk(13))
          .bg("#a6e3a1").flex().items_center().justify_center().cursor_pointer()
          .tooltip("Settle: this staff clocks out until their next task")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.settled.add(a.address);
            try { localStorage.setItem("settled", JSON.stringify([...this.settled])); } catch { /* storage full: stays settled until restart */ }
            cx.notify();
          })
          .child(div().text_size(kk(9)).font_bold().text_color("#17351f").child("✓"))));
      return v_flex()
        .id(`pet-${a.address}`)
        .absolute()
        .opacity(hitOf(a) ? 1 : 0.14)
        .left(left)
        .top(top)
        .w(petW)
        .items_center()
        .cursor_pointer()
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.drag = { addr: a.address, pane: a.pane, dx: e.local_position?.x ?? 0, dy: e.local_position?.y ?? 0, sx: e.position.x, sy: e.position.y, moved: false };
        })
        .on_mouse_up("left", (_e, cx) => endDrag(cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openFigures(a.space_name); })
        .tooltip(`${a.program?.name ?? ""} · ${isUrge ? `idle for ${duration(waited)} · click to focus` : isSnooze ? `snoozing (${duration(waited)}) · click to focus` : a.status} · ${text}${branch ? ` · ${branch}` : ""}${clTip ? ` · ${clTip}` : ""}${ctx ? ` · ${vitalsTip(ctx)}` : ""}${act.interns.length ? ` · ${act.interns.length} sub-agent${act.interns.length > 1 ? "s" : ""}` : ""}${act.jobs ? ` · ${act.jobs} shell job${act.jobs > 1 ? "s" : ""}${act.long ? ` (${act.long} over a minute)` : ""}` : ""} · drag to move`)
        .child(seat)
        .child(div().mt(6).max_w(Math.max(petW + 22, cellW - 4)).px(5).h(15).flex().items_center()
          .bg(this.hint?.addr === a.address ? "#cba6f7" : cl ? (cl.kind === "file" ? "#ff5370" : "#f9b84a") : a.focused || (q && hitOf(a)) ? "#f9e2af" : hot ? "#f38ba8" : isUrge ? "#fab387" : isSnooze ? "#45475a" : "#0f111acc")
          .text_size(10.5).text_color(this.hint?.addr === a.address ? "#1e1233" : cl ? "#2a0f16" : a.focused || (q && hitOf(a)) ? "#2a1a14" : isUrge ? "#1e1e2e" : isSnooze ? "#cdd6f4" : "#ffffff").truncate()
          .child(this.hint?.addr === a.address ? this.hint.text : cl ? clText : `${text}${when && cellW >= 90 ? (isUrge ? ` · idle ${duration(waited)} ⏰` : isSnooze ? ` · zzz ${duration(waited)}` : ` · ${duration(waited)}`) : ""}`))
        .when(Boolean(branch) || Boolean(modelTxt), (el) => el.child(h_flex().mt(2).gap(3).items_center().max_w(Math.max(petW + 22, cellW - 4)).text_size(9.5)
          .when(Boolean(branch), (el) => el
            .child(div().relative().w(8).h(10).flex_none().children([[0, 0, 2, 2], [0, 8, 2, 2], [5, 2, 2, 2], [0, 2, 1, 6], [1, 4, 5, 1]].map(([x, y, w, h]) => div().absolute().left(x).top(y).w(w).h(h).bg("#89b4fa"))))
            .child(div().min_w(0).truncate().font_family(monoF).text_color("#89b4fa").child(branch)))
          .when(Boolean(modelTxt), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(branch ? `· ${modelTxt}` : modelTxt)))))
        .when(ctx != null && cellW >= 90, (el) => el.child(div().mt(2).max_w(Math.max(petW + 22, cellW - 4)).child(vitalsBars(t, ctx, `farm-vitals-${a.address}`, Math.max(petW + 22, cellW - 4)))));
    });
    // A dotted line of sparks between two desks that are about to clash.
    const links = [];
    for (const [addr, c] of this.clash) {
      for (const o of c.others) {
        const A = posOf.get(addr), B = posOf.get(o);
        if (addr >= o || !A || !B) continue;
        const n = Math.max(3, Math.min(40, Math.floor(Math.hypot(B.x - A.x, B.y - A.y) / 10)));
        for (let k = 1; k < n; k++) links.push(div().absolute().left(A.x + ((B.x - A.x) * k) / n - 2).top(A.y + ((B.y - A.y) * k) / n - 2).w(4).h(4).bg(c.kind === "file" ? "#ff5370" : "#f9b84a")
          .loop("opacity", { from: 0.1, to: 1, period: 700 + (k % 4) * 140, easing: "ease-in-out" }));
      }
    }
    // The wall shows the whole company: the time of day, a building per space, who needs you, the office's load, work shipped today.
    const todayNow = this.today?.day === dayKey() ? this.today : freshDay();
    const officeLoad = everyone.reduce((n, a) => { const x = activityOf.get(a.address); return n + (x ? x.interns.length + x.jobs : 0); }, 0);
    const sceneOpts = {
      music: Boolean(shared("pixel-hq.music")?.playing),
      now: new Date(),
      spaces: spaces().map((sp) => ({ id: sp.id, name: sp.name, status: sp.status, active: sp.active })),
      needYou: blockedAll.length,
      load: officeLoad,
      shipped: todayNow.shipped,
      droop: blockedAll.some((a) => this.waitOf(a.address, a.status, now) >= 300000),
      board: {
        events: this.events ?? [],
        workMs: todayNow.workMs,
        blocked: blockedAll.map((a) => String(a.space_name || a.program?.name || "").toUpperCase()),
        // Fuel: the lowest usage window left across agents that report one (Claude Code's 5-hour window, Antigravity, Codex).
        fuel: all.flatMap((k) => {
          const q = contextOf.get(k.address)?.quota;
          if (q == null || k.state !== "live") return [];
          const fam = progOf(k).toLowerCase(), reset = Number(k.labels?.["claude.quota_reset"]);
          return [{ q, who: /claude/.test(fam) ? "CLAUDE" : /codex/.test(fam) ? "CODEX" : /agy|antigravity/.test(fam) ? "AGY" : fam.toUpperCase(), reset: reset > 0 ? reset * 1000 : null }];
        }).sort((x, y) => x.q - y.q),
        hot: everyone.flatMap((a) => { const p = contextOf.get(a.address)?.pct; return p != null && p >= 80 ? [{ who: String(a.space_name || a.program?.name || "").toUpperCase(), p, addr: a.address }] : []; })
          .sort((x, y) => y.p - x.p),
      },
    };
    const farm = div().id("farm-area").relative().flex_1().min_h(0).overflow_hidden()
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        if (!d.moved && Math.hypot(e.position.x - d.sx, e.position.y - d.sy) < 4) return;
        d.moved = true;
        const z = Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1;
        const x = Math.max(0, Math.min(sz.width - petW, (e.local_position.x - d.dx) / z));
        const y = Math.max(0, Math.min(sz.height - PET - 34, (e.local_position.y - d.dy) / z));
        this.petpos[d.addr] = [x / sz.width, y / sz.height];
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endDrag(cx))
      .on_mouse_down("right", () => { this.petpos = {}; localStorage.removeItem("petpos"); })
      // Sizes arrive in window pixels, but everything drawn here is in the mod's own units, which Herdr scales by the zoom: divide
      // it out, or at zoom 1.2 the wall is drawn 20% too wide and its right corner (rack and monitor desk) falls off the edge.
      .on_size_change((s, cx) => {
        const z = Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1, w = s.width / z, h = s.height / z;
        if (!this.size || Math.abs(w - this.size.width) > 2 || Math.abs(h - this.size.height) > 2) { this.size = { width: w, height: h }; cx.notify(); }
      })
      .child(scene(sz.width, sz.height, sceneOpts))
      .children(this.sceneSpots(sz, everyone, sceneOpts))
      .when(Math.max(64, Math.min(110, Math.round(sz.width * 0.27 / 4) * 4)) >= 64, (el) => {
        const m = shared("pixel-hq.music");
        const isPlaying = Boolean(m?.playing);
        const title = m?.title || "Pixel MusicBox";
        const snap = (v) => Math.round(v / 4) * 4;
        const yH = snap(snap(sz.height) * 0.3);
        const base = yH - 8;
        const rackW = Math.max(64, Math.min(110, snap(sz.width * 0.27)));
        const rackX = sz.width - rackW - 10;
        const rh = snap(Math.min(base - 8, 80));
        const rt = base - rh;
        return el.child(
          div()
            .id("ag-radio-target")
            .absolute()
            .left(rackX + 2)
            .top(rt - 14)
            .w(22)
            .h(16)
            .cursor_pointer()
            .tooltip(isPlaying ? `📻 ${title} · Click to open controls` : "📻 Pixel MusicBox · Click to open")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              run("mod.open", { name: "company-music" });
            })
        );
      })
      .when(list.length === 0 && settledFloor === 0, (el) => el.child(div().absolute().left(12).top(sz.height * 0.5).w(sz.width - 24).px(8).py(6).bg("#0f111acc").border_1().border_color("#313244").text_size(12).text_color("#ffffff").child("No staff on this floor yet. Hire one with the + above, or start an agent in this space.")))
      .when(list.length === 0 && settledFloor > 0, (el) => el.child(div().absolute().left(12).top(sz.height * 0.5).w(sz.width - 24).px(8).py(6).bg("#0f111acc").border_1().border_color("#313244").text_size(12).text_color("#a6e3a1").child("Everyone shipped has clocked out. Click the ✓ settled chip in the corner to bring them back.")))
      .when(hidden > 0, (el) => el.child(div().absolute().right(8).top(horizon + 6).px(8).py(3).bg("#11111bdd").border_1().border_color("#45475a").text_size(11).text_color("#cdd6f4").child(`+${hidden} more · narrow the panel to list all`)))
      .children(links)
      .children(this.drag?.moved ? [...pets.filter((_, i) => seated[i].address !== this.drag.addr), ...pets.filter((_, i) => seated[i].address === this.drag.addr)] : pets)
      .when(Boolean(this.notice), (el) => {
        const box = v_flex().id("oc-notice").absolute().left(8).right(8).top(horizon + 6).px(8).py(6).gap(6).bg("#11111bee").border_1().border_color("#89b4fa").text_size(11).text_color("#cdd6f4")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
        return el.child(box.cursor_pointer().on_click((_e, cx) => { this.notice = null; cx.notify(); }).child(this.notice));
      })
      .when(settledCount > 0, (el) => el.child(div().id("settled-undo").absolute().right(8).top(this.notice ? horizon + 84 : horizon + 6).px(8).py(3).bg("#11111bdd").border_1().border_color("#45475a").text_size(11).text_color("#a6e3a1").cursor_pointer()
        .tooltip("Bring settled staff back on every floor")
        .on_click((_e, cx) => { this.settled.clear(); try { localStorage.removeItem("settled"); } catch { /* storage disabled: next render retries */ } cx.notify(); })
        .child(`✓ ${settledCount} settled`)));

    // Pixel UI: notched 2px frames, a hard bottom shadow, a mono caps title and a hand-drawn magnifier.
    const frame = (bc, bg) => [
      div().absolute().left(2).right(2).top(0).bottom(0).bg(bg),
      div().absolute().left(0).top(2).bottom(2).w(2).bg(bc), div().absolute().right(0).top(2).bottom(2).w(2).bg(bc),
      div().absolute().left(2).right(2).top(0).h(2).bg(bc), div().absolute().left(2).right(2).bottom(0).h(2).bg(bc),
    ];
    const MAG = [[2, 0, 4, 1], [1, 1, 1, 1], [6, 1, 1, 1], [0, 2, 1, 4], [7, 2, 1, 4], [1, 6, 1, 1], [6, 6, 1, 1], [2, 7, 4, 1], [7, 7, 2, 1], [8, 8, 2, 1], [9, 9, 1, 1]];
    const magnifier = (c) => div().relative().w(15).h(15).flex_none().children(MAG.map(([x, y, w, h]) => div().absolute().left(x * 1.5).top(y * 1.5).w(w * 1.5).h(h * 1.5).bg(c)));
    const corgi = image("mods/company-brand/logo.png").size(24).flex_none();
    const mono = "JetBrains Mono";

    return v_flex()
      .id("farm-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(div().px(10).pt(10).pb(2).flex_none().child(
          div().relative().h(30).w_full().child(div().absolute().left(2).right(2).bottom(-2).h(2).bg("#11111b"))
            .children(frame("#45475a", "#181825"))
            .child(h_flex().size_full().px(10).gap(8).items_center().justify_between()
              .child(h_flex().min_w(0).gap(7).items_center().child(corgi)
                .child(div().min_w(0).truncate().font_family(mono).font_bold().text_size(10).text_color("#89b4fa").child("ENGINEERING FLOOR")))
              .child(h_flex().gap(10).items_center().flex_none()
                .when(blockedAll.length > 0, (el) => el.child(div().id("ag-needs-you").relative().w(14).h(14).flex_none().cursor_pointer()
                  .tooltip(`${blockedAll.length} ${blockedAll.length === 1 ? "agent needs" : "agents need"} you · open the list`)
                  .on_click(() => this.openNeedsYou())
                  .children([[6, 0, 2, 1], [4, 1, 6, 1], [3, 2, 8, 1], [2, 3, 10, 7], [1, 10, 12, 2], [0, 12, 14, 1], [5, 13, 4, 1], [6, 14, 2, 1]].map(([x, y, w, h]) => div().absolute().left(x).top(y).w(w).h(h).bg("#f9e2af")))
                  .child(div().absolute().right(-5).top(-5).min_w(10).h(10).px(2).border_1().border_color("#11111b").bg("#f38ba8").flex().items_center().justify_center().text_size(7.5).font_bold().text_color("#11111b").child(String(blockedAll.length)))))
                .when(Boolean(this.fileError), (el) => el.child(div().id("ag-file-error").text_size(11).font_bold().text_color(t.blocked)
                  .tooltip(`${this.fileError}. Using the last good figures.`).child("!")))
                .child(div().id("ag-hire").relative().w(14).h(14).flex_none().cursor_pointer()
                  .tooltip("Hire staff: a new agent in its own git worktree")
                  .on_click((_e, cx) => this.openHire(cx))
                  .children([[5, 1, 4, 12], [1, 5, 12, 4]].map(([x, y, w, h]) => div().absolute().left(x).top(y).w(w).h(h).bg(this.hiring.open ? "#f9e2af" : "#89b4fa"))))
                .child(div()
                  .id("ag-figures")
                  .text_color(t.dim)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click(() => openFigures(focused()?.space ? spaces().find((s) => s.id === focused().space)?.name : null))
                  .tooltip("Pond figures: how agents look, per space")
                  .child(svg("mods/company-agents/duck-icon.svg").size(14)))
                .child(
                  div()
                    .id("ag-sort")
                    .text_size(11)
                    .text_color(t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .on_click(() => openOverlay({ mod: "company-agents", kind: "popup", frame: "none", width: 200, height: 140, props: { sortMenu: true } }))
                    .tooltip(`Sort agents: ${sort.label}`)
                    .child(svg(`mods/company-agents/${sort.icon}.svg`).size(14)),
                ))),
        )),
      )
      .when(!collapsed && this.hiring.open, (el) => {
        const h = this.hiring;
        const box = (state) => div().w_full().h(26).px(8).flex().items_center().bg("#181825").border_1().border_color("#45475a")
          .child(Input.new(state).h_full().w_full().text_size(11.5).font_family(mono).text_color(t.foreground));
        const btn = (id, text, fill, ink, act) => div().id(id).px(10).h(24).flex().items_center().cursor_pointer().bg(fill).text_size(10.5).font_family(mono).font_bold().text_color(ink).on_click(act).child(text);
        return el.child(div().relative().mx(10).mt(8).flex_none().children(frame("#89b4fa", "#11111b"))
          .child(v_flex().px(12).py(10).gap(6)
            .child(div().font_family(mono).font_bold().text_size(10).text_color("#89b4fa").child("HIRE STAFF · NEW WORKTREE"))
            .child(box(this.ticketInput))
            .child(box(this.repoInput))
            .child(h_flex().gap(4).flex_wrap().children(["claude", "codex", "opencode", "agy", "hermes"].map((pg) => div().id(`hire-${pg}`).px(8).h(22).flex().items_center().cursor_pointer().border_1()
              .border_color(h.program === pg ? "#89b4fa" : "#45475a").bg(h.program === pg ? "#89b4fa22" : "#181825").text_size(10.5).font_family(mono).text_color(h.program === pg ? "#89b4fa" : "#a6adc8")
              .on_click((_e, cx) => { h.program = pg; cx.notify(); }).child(pg))))
            .when(Boolean(h.error), (e2) => e2.child(div().text_size(10.5).text_color("#ff5370").child(h.error)))
            .child(h_flex().gap(6).child(btn("hire-go", h.busy ? "Creating..." : "Hire", "#89b4fa", "#11111b", (_e, cx) => this.doHire(cx)))
              .child(btn("hire-cancel", "Cancel", "#313244", "#cdd6f4", (_e, cx) => this.openHire(cx))))));
      })
      .when(!collapsed, (el) => el.child(div().id("staff-search").relative().mx(10).mt(4).mb(8).h(32).flex_none()
        .child(div().absolute().left(2).right(2).bottom(-2).h(2).bg("#11111b"))
        .children(frame(this.typing ? "#89b4fa" : "#45475a", "#11111b"))
        .child(h_flex().size_full().px(10).gap(8).items_center()
          .child(magnifier(this.typing ? "#89b4fa" : "#7f849c"))
          .child(div().flex_1().min_w(0).h_full().flex().items_center().cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .child(Input.new(this.searchInput).h_full().text_size(12).font_family(mono).text_color(t.foreground)))
          .when(Boolean(q), (e2) => e2
            .child(div().flex_none().text_size(10.5).font_family(mono).text_color(t.dim).child(`${hits.length}/${list.length}`))
            .child(div().id("staff-clear").flex_none().px(4).text_size(14).font_family(mono).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { this.searchInput.set_value(""); this.query = ""; cx.notify(); }).child("×"))))))
      .child(collapsed ? v_flex().id("ag-list").flex_1().min_h(0).px(0).overflow_y_scrollbar().mode("always").children(rows) : farm)
      .when(collapsed && settledCount > 0, (el) => el.child(h_flex().h(22).px(6).items_center().child(div().id("settled-undo-rail").px(6).h(17).flex().items_center().border_1().border_color("#a6e3a155").bg("#a6e3a122").text_size(10).text_color("#a6e3a1").cursor_pointer()
        .tooltip("Bring settled staff back on every floor")
        .on_click((_e, cx) => { this.settled.clear(); try { localStorage.removeItem("settled"); } catch { /* storage disabled: next render retries */ } cx.notify(); })
        .child(`✓ ${settledCount} settled`))))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}

// reloaded
// r
// r
// r
// r
// r
// r
// r
// r
// r
// r
// r
// r
