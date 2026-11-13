// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, appHome, exec, readTextFile, nextCommand, hc } from "herdr";
import { figureFor, load } from "./figures.js";
import { agentOf, speciesOf, duckWidth, DUCK_CENTER } from "./duck.js";
import { scene, yHorizon } from "./scene.js";
import { Editor } from "./editor.js";
import { snapshot, clashes, hire } from "./crew.js";

// The figure editor, as a dialog; `space` opens it on that space's pick.
const openFigures = (space) => openOverlay({ mod: "company-agents", kind: "dialog", width: 860, height: 640, props: { figures: true, ...(space ? { space } : {}) } });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

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

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A thin context-use bar with its %, colored like Claude's status line:
// green, yellow from 60%, red from 80%.
// Then the model, when the status line reported one.
function contextBar(t, pct, model, address) {
  const color = pct >= 80 ? t.ansi1 : pct >= 60 ? t.ansi3 : t.ansi2;
  return h_flex().id(`ctx-${address}`).mt(2).gap(5).items_center().tooltip(`Context ${pct}% used${model ? ` · ${model}` : ""}`)
    .child(div().w(72).h(3).flex_none().rounded(2).bg(t.border)
      .child(div().h_full().rounded(2).bg(color).w(Math.max(2, (72 * pct) / 100))))
    .child(div().flex_none().text_size(10).text_color(t.dim).child(`${pct}%`))
    .when(Boolean(model), el => el.child(div().min_w(0).truncate().text_size(10).text_color(t.muted).child(`· ${model}`)));
}

// What the Update button hands to an agent.
const UPDATE_PROMPT = "Read ~/.config/herdr-app/AGENTS.md, then update my Pixel HQ layout to the latest version from herdr.dev/layouts/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended; keep my other layouts and mods.";

// Finds a Codex terminal's session file (the one its process, or a child of it, has open; else the newest recent one that began in the
// same folder) and prints its last token_count event, whose last_token_usage and model_context_window say how full the context is.
const CODEX_SH = `home="\${CODEX_HOME:-$HOME/.codex}/sessions"
pids="$1"; for i in 1 2 3; do pids="$pids $(for p in $pids; do pgrep -P "$p" 2>/dev/null; done)"; done
f=""
[ -n "$1" ] && f=$(lsof -p "$(echo $pids | tr -s ' ' ',')" -Fn 2>/dev/null | sed -n 's/^n//p' | grep -E '/rollout-[^/]*\\.jsonl$' | head -1)
if [ -z "$f" ]; then
  for c in $(find "$home" -name 'rollout-*.jsonl' -mmin -720 2>/dev/null | xargs ls -t 2>/dev/null | head -20); do
    case "$(head -n 1 "$c")" in *'"cwd":"'"$2"'"'*) f="$c"; break;; esac
  done
fi
[ -n "$f" ] || exit 3
tail -n 600 "$f" | grep '"type":"token_count"' | tail -1`;

export default class Agents extends View {
  init(_props, cx) {
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
    // Codex does not report its context, but it writes it to its session file: read it for each Codex desk.
    this.ctxRead = new Map();
    this.scanCodex(cx);
    cx.timer.every(8000, (cx) => this.scanCodex(cx));
    // `company-agents.hire` (a key binding, or herdr-app do) opens the hire form.
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "hire") this.openHire(cx); if (c === "update") this.runUpdate(cx); } });
    // OpenCode 1.x does not report a status by itself, so without help it never gets a desk. Once, if OpenCode is installed, drop its
    // status plugin (this mod's opencode-status.js) into OpenCode's plugins folder. Only ever replaces Pixel HQ's own older copy;
    // deleting the file removes it for good.
    this.notice = null;
    this.setupOpenCode(cx);
    // Tell the person when a newer Pixel HQ is out: read the tiny version.json from GitHub at start and every 6 hours.
    // Nothing is sent. Deleting this mod's own version.json turns the check off.
    this.update = null;
    this.checkUpdate(cx);
    cx.timer.every(6 * 3600 * 1000, (cx) => this.checkUpdate(cx));
    // Now and then (every 14 to 32 s) one idle pet steps out beside its desk for about 3.6 s, then comes back.
    this.out = null;
    this.breakerList = [];
    this.nextAt = Date.now() + 6000;
    this.hint = null;
    cx.timer.every(1000, (cx) => {
      const now = Date.now();
      if (this.hint && now > this.hint.until) { this.hint = null; cx.notify(); }
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
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
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
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
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
    const pic = this.figure(space, st, 27, Date.now() - (this.changed[k.address]?.at ?? Date.now()), `fig-${k.address}`, k.program?.key);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(44)
      .pr(8)
      .rounded(8)
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
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(6).child(pic))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
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
    if (this.scanningCodex || window()?.platform === "windows") return;
    this.scanningCodex = true;
    try {
      const remote = new Set(spaces().filter((x) => x.machine).map((x) => x.id));
      const paneBy = new Map(panes().map((p) => [p.pane, p]));
      const next = new Map();
      for (const a of agents().filter((x) => String(x.program?.key ?? "").toLowerCase().includes("codex") && !remote.has(x.space))) {
        const info = JSON.parse((await hc(["get", a.address, "--json"]).catch(() => ({ stdout: "{}" }))).stdout || "{}");
        const pid = info?.foreground?.pid;
        const cwd = paneBy.get(a.pane)?.cwd;
        if (!pid && !cwd) continue;
        const r = await exec("sh", ["-c", CODEX_SH, "sh", String(pid ?? ""), cwd ?? "/dev/null/none"], { timeout: 8000 }).catch(() => null);
        const ev = r?.code === 0 && r.stdout ? JSON.parse(r.stdout.trim().split("\n").pop()) : null;
        const used = ev?.payload?.info?.last_token_usage?.total_tokens, win = ev?.payload?.info?.model_context_window;
        if (used > 0 && win > 0) next.set(a.address, { pct: Math.max(0, Math.min(100, Math.round((used * 100) / win))), model: null });
      }
      const sig = JSON.stringify([...next]);
      if (sig !== JSON.stringify([...this.ctxRead])) { this.ctxRead = next; cx.notify(); }
    } catch { /* no codex, no lsof, odd output: no pile */ }
    this.scanningCodex = false;
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
      const argv = { claude: ["claude"], codex: ["codex"], opencode: ["opencode"], agy: ["agy"] }[h.program] ?? [h.program];
      run("tab.new", { name: branch, folder: path, argv, space: spaces().find((x) => x.active)?.id });
      h.open = false;
      this.ticketInput.set_value("");
    } catch (e) { h.error = String(e?.message ?? e); }
    h.busy = false;
    cx.notify();
  }

  // The Update button: opens a new tab in the shown space with an agent (the one you are in, else Claude) that starts on the update prompt.
  runUpdate(cx) {
    // Once per click: every copy of this mod hears the same command, and a double click must not open two agents.
    if (Date.now() - Number(shared("pixel-hq.update-at") ?? 0) < 5000) return;
    setShared("pixel-hq.update-at", Date.now());
    const sp = spaces().find((x) => x.active);
    const here = agents().find((a) => a.address === focused()?.agent);
    const key = String(here?.program?.key ?? "").toLowerCase();
    const argv = key.includes("codex") ? ["codex"] : key.includes("opencode") ? ["opencode"] : ["claude"];
    if (this.update) localStorage.setItem("upd-dismissed", this.update.version);
    this.update = null;
    run("tab.new", { name: "update Pixel HQ", folder: appHome(), argv, task: UPDATE_PROMPT, space: sp?.id });
    cx.notify();
  }

  // The paper pile on a desk: the first click arms it, the second (within 6 s) sends the agent /compact (which already summarizes).
  // Only when the agent is idle, so nothing is typed into a busy terminal.
  pileClick(a, cx) {
    const now = Date.now();
    if (a.status === "working" || a.status === "blocked") { this.hint = { addr: a.address, text: a.status === "working" ? "busy: wait for it" : "answer it first", until: now + 3000 }; cx.notify(); return; }
    if (this.hint?.armed && this.hint.addr === a.address && now < this.hint.until) {
      this.hint = { addr: a.address, text: "compacting...", until: now + 8000 };
      hc(["send", a.address, "/compact"]).catch(() => null);
    } else this.hint = { addr: a.address, text: "click the papers again to /compact", armed: true, until: now + 6000 };
    cx.notify();
  }

  async checkUpdate(cx) {
    try {
      const mine = JSON.parse(await readTextFile(`${appHome()}/mods/company-agents/version.json`));
      const res = await fetch("https://raw.githubusercontent.com/bnhan2710/pixel-hq/main/mods/company-agents/version.json");
      if (!res.ok) return;
      const latest = JSON.parse(await res.text());
      const num = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
      const [a, b] = [num(latest.version), num(mine.version)];
      const newer = [0, 1, 2].map((i) => (a[i] ?? 0) - (b[i] ?? 0)).find((d) => d !== 0) > 0;
      if (!newer || localStorage.getItem("upd-dismissed") === String(latest.version)) return;
      this.update = { version: String(latest.version), notes: latest.notes ? String(latest.notes) : "" };
      cx.notify();
    } catch { /* offline, no version.json, or not valid: stay quiet */ }
  }

  async setupOpenCode(cx) {
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
    if (!r || ![0, 4, 5].includes(r.code)) return; // no OpenCode here (yet), or a failed copy: try again next launch
    localStorage.setItem("oc-plugin", "1");
    if (r.code === 0) { this.notice = "OpenCode plugin added · restart OpenCode to see it here"; cx.notify(); }
    if (r.code === 5) { this.notice = "OpenCode plugin updated · restart OpenCode to apply"; cx.notify(); }
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (this.editor) return this.editor.render(cx);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    // Each floor is its own office: only the agents of the shown space sit here.
    const activeId = spaces().find((x) => x.active)?.id;
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
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
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

    // Context use (0–100) and model that Claude's status line labels its terminal with.
    const contextOf = new Map(all.flatMap((k) => {
      const v = Number.parseInt(k.labels?.["agent.context"] ?? k.labels?.["claude.context"], 10);
      return Number.isFinite(v) ? [[k.address, { pct: Math.max(0, Math.min(100, v)), model: k.labels?.["agent.model"] || k.labels?.["claude.model"] || null }]] : [];
    }));
    for (const [addr, c] of this.ctxRead) if (!contextOf.has(addr)) contextOf.set(addr, c);

    const row = (a, i, subs = []) => {
      const pic = figureFor(a.space_name, a.status, 45, now - this.since(a), speciesOf(a.program?.key));
      const ctx = contextOf.get(a.address);
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
        .rounded(4)
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
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .pl(4)
        .pr(8)
        .h(66)
        .flex_none()
        .border_b(2)
        .border_color("#5B8C3A66")
        .rounded(8)
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
          .when(full && Boolean(more), el => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(more)))
          .when(ctx != null, el => el.child(contextBar(t, ctx.pct, ctx.model, a.address))))
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
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
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
    const plan = (sc) => {
      const P = Math.round(46 * sc), pw = duckWidth(P), cw = Math.max(pw + Math.round(24 * sc), 76), ch = P + Math.round(28 * sc) + 26 + (withBranch ? 15 : 0);
      return { sc, P, pw, cw, ch, cols: Math.max(1, Math.floor((sz.width - 8) / cw)), rows: Math.max(1, Math.floor((sz.height - fieldTop - 4) / ch)) };
    };
    const P0 = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42].map(plan);
    const pick = P0.find((p) => p.cols * p.rows >= nAgents) ?? P0[P0.length - 1];
    const S = pick.sc, PET = pick.P, petW = pick.pw, cellW = pick.cw, cellH = pick.ch;
    const kk = (v) => Math.round(v * S);
    const fieldH = Math.max(0, sz.height - fieldTop - cellH);
    const endDrag = (cx) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!d.moved) run("pane.focus", { pane: d.pane });
      else localStorage.setItem("petpos", JSON.stringify(this.petpos));
      cx.notify();
    };
    const ROLES = (a) => (agentOf(a.program?.key)?.role ?? "").toLowerCase();
    const STATE = { working: "typing working busy", idle: "idle break coffee", done: "shipped done finished", blocked: "needs you blocked waiting" };
    const q = this.query.trim().toLowerCase();
    const hitOf = (a) => !q || q.split(/\s+/).every((w) => [detail.get(a.address), a.space_name, label(a), a.program?.name, ROLES(a), STATE[a.status]].join(" ").toLowerCase().includes(w));
    const hits = list.filter(hitOf);
    this.firstHit = q ? hits[0]?.pane ?? null : null;
    const breakers = list.filter((x) => x.status === "idle" && !x.focused).map((x) => x.address);
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
      const left = own ? own[0] * sz.width : Math.max(2, Math.min(sz.width - petW - 2, sz.width * Math.min(0.92, sx + lap) - petW / 2));
      const top = own ? own[1] * sz.height : fieldTop + fieldH * Math.min(1, sy + lap);
      posOf.set(a.address, { x: left + petW / 2, y: top + PET * 0.5 });
      const ctxPct = contextOf.get(a.address)?.pct ?? null;
      const more = detail.get(a.address);
      const text = more ?? a.space_name ?? label(a);
      // The desk's branch (its own worktree, ideally) and whether another desk is about to step on it.
      const branch = paneBy.get(a.pane)?.branch ?? null;
      const cl = this.clash.get(a.address) ?? null;
      const clText = cl ? (cl.kind === "file" ? `clash: ${String(cl.files[0] ?? "").split("/").pop()}${cl.files.length > 1 ? ` +${cl.files.length - 1}` : ""}` : "same folder") : "";
      const clTip = cl ? (cl.kind === "file" ? `Another desk also changed ${cl.files.join(", ")}` : "Another desk is working in this same folder") : "";
      const when = this.since(a);
      const hot = a.status === "blocked";
      // The pet sits on a chair behind a wooden desk (the MacBook is part of the pet).
      const ctr = DUCK_CENTER * petW;
      const k = breakers.indexOf(a.address);
      const away = k >= 0;
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
          .left(away && this.out?.addr === a.address ? dx : 0).top(away && this.out?.addr === a.address ? dy : 0)
          // Glide out and back, but not while it is being dragged, so it follows the pointer exactly.
          .when(this.drag?.addr !== a.address, (el) => el.transition("left", 800).transition("top", 800))
          .child(figureFor(a.space_name, away ? "idle" : a.status, PET, now - when, speciesOf(a.program?.key))))
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
          return el.child(full ? pile.loop("top", { from: PET * 0.84 - n * sh - kk(4), to: PET * 0.84 - n * sh - kk(6), period: 600, easing: "ease-in-out" }) : pile);
        });
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
        .tooltip(`${a.program?.name ?? ""} · ${a.status} · ${text}${branch ? ` · ${branch}` : ""}${clTip ? ` · ${clTip}` : ""} · drag to move`)
        .child(seat)
        .child(div().mt(6).max_w(Math.max(petW + 22, cellW - 4)).px(5).h(15).flex().items_center().rounded(3)
          .bg(this.hint?.addr === a.address ? "#cba6f7" : cl ? (cl.kind === "file" ? "#ff5370" : "#f9b84a") : a.focused || (q && hitOf(a)) ? "#f9e2af" : hot ? "#f38ba8" : "#0f111acc")
          .text_size(10.5).text_color(this.hint?.addr === a.address ? "#1e1233" : cl ? "#2a0f16" : a.focused || (q && hitOf(a)) ? "#2a1a14" : "#ffffff").truncate()
          .child(this.hint?.addr === a.address ? this.hint.text : cl ? clText : `${text}${when && cellW >= 90 ? ` · ${duration(now - when)}` : ""}`))
        // The branch on the desk's nameplate, with a small git-branch glyph.
        .when(Boolean(branch), (el) => el.child(h_flex().mt(2).gap(3).items_center().max_w(Math.max(petW + 22, cellW - 4)).text_size(9.5)
          .child(div().relative().w(8).h(10).flex_none().children([[0, 0, 2, 2], [0, 8, 2, 2], [5, 2, 2, 2], [0, 2, 1, 6], [1, 4, 5, 1]].map(([x, y, w, h]) => div().absolute().left(x).top(y).w(w).h(h).bg("#89b4fa"))))
          .child(div().min_w(0).truncate().font_family(monoF).text_color("#89b4fa").child(branch))));
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
    const farm = div().id("farm-area").relative().flex_1().min_h(0).overflow_hidden()
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        if (!d.moved && Math.hypot(e.position.x - d.sx, e.position.y - d.sy) < 4) return;
        d.moved = true;
        const x = Math.max(0, Math.min(sz.width - petW, e.local_position.x - d.dx));
        const y = Math.max(0, Math.min(sz.height - PET - 34, e.local_position.y - d.dy));
        this.petpos[d.addr] = [x / sz.width, y / sz.height];
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endDrag(cx))
      .on_mouse_down("right", () => { this.petpos = {}; localStorage.removeItem("petpos"); })
      .on_size_change((s, cx) => {
        if (!this.size || Math.abs(s.width - this.size.width) > 2 || Math.abs(s.height - this.size.height) > 2) { this.size = s; cx.notify(); }
      })
      .child(scene(sz.width, sz.height))
      .when(list.length === 0, (el) => el.child(div().absolute().left(12).top(sz.height * 0.5).w(sz.width - 24).px(8).py(6).rounded(3).bg("#0f111acc").text_size(12).text_color("#ffffff").child("No staff on this floor yet. Hire one with the + above, or start an agent in this space.")))
      .when(Boolean(this.update || this.notice), (el) => {
        const btn = (id, text, fill, ink, act) => div().id(id).px(10).h(22).flex().items_center().cursor_pointer().bg(fill).text_size(10.5).font_family(monoF).font_bold().text_color(ink).on_click(act).child(text);
        const box = v_flex().id("oc-notice").absolute().left(8).right(8).top(horizon + 6).px(8).py(6).gap(6).rounded(8).bg("#11111bee").border_1().border_color("#89b4fa").text_size(11).text_color("#cdd6f4");
        return el.child(this.update
          ? box.child(div().child(`Pixel HQ ${this.update.version} is out${this.update.notes ? ` · ${this.update.notes}` : ""}`))
            .child(h_flex().gap(6)
              .child(btn("upd-go", "Update now", "#89b4fa", "#11111b", (_e, cx) => this.runUpdate(cx)))
              .child(btn("upd-later", "Later", "#313244", "#cdd6f4", (_e, cx) => { localStorage.setItem("upd-dismissed", this.update.version); this.update = null; cx.notify(); })))
          : box.cursor_pointer().on_click((_e, cx) => { this.notice = null; cx.notify(); }).child(this.notice));
      })
      .when(hidden > 0, (el) => el.child(div().absolute().right(8).top(horizon + 6).px(8).py(3).rounded(8).bg("#11111bdd").border_1().border_color("#45475a").text_size(11).text_color("#cdd6f4").child(`+${hidden} more · narrow the panel to list all`)))
      .children(links)
      .children(this.drag?.moved ? [...pets.filter((_, i) => seated[i].address !== this.drag.addr), ...pets.filter((_, i) => seated[i].address === this.drag.addr)] : pets);

    // Pixel UI: notched 2px frames, a hard bottom shadow, a mono caps title and a hand-drawn magnifier.
    const frame = (bc, bg) => [
      div().absolute().left(2).right(2).top(0).bottom(0).bg(bg),
      div().absolute().left(0).top(2).bottom(2).w(2).bg(bc), div().absolute().right(0).top(2).bottom(2).w(2).bg(bc),
      div().absolute().left(2).right(2).top(0).h(2).bg(bc), div().absolute().left(2).right(2).bottom(0).h(2).bg(bc),
    ];
    const MAG = [[2, 0, 4, 1], [1, 1, 1, 1], [6, 1, 1, 1], [0, 2, 1, 4], [7, 2, 1, 4], [1, 6, 1, 1], [6, 6, 1, 1], [2, 7, 4, 1], [7, 7, 2, 1], [8, 8, 2, 1], [9, 9, 1, 1]];
    const magnifier = (c) => div().relative().w(15).h(15).flex_none().children(MAG.map(([x, y, w, h]) => div().absolute().left(x * 1.5).top(y * 1.5).w(w * 1.5).h(h * 1.5).bg(c)));
        const corgi = image("mods/company-brand/logo.png").size(24).flex_none().rounded(4);
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
                .when(Boolean(this.fileError), (el) => el.child(div().id("ag-file-error").text_size(11).font_bold().text_color(t.blocked)
                  .tooltip(`${this.fileError}. Using the last good figures.`).child("!")))
                .child(div().id("ag-hire").relative().w(14).h(14).flex_none().cursor_pointer()
                  .tooltip("Hire staff: a new agent in its own git worktree")
                  .on_click((_e, cx) => this.openHire(cx))
                  .children([[6, 0, 2, 14], [0, 6, 14, 2]].map(([x, y, w, h]) => div().absolute().left(x).top(y).w(w).h(h).bg(this.hiring.open ? "#f9e2af" : "#89b4fa"))))
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
                    .on_click(() => openOverlay({ mod: "company-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                    .tooltip(`Sort agents: ${sort.label}`)
                    .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
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
            .child(h_flex().gap(4).children(["claude", "codex", "opencode", "agy"].map((pg) => div().id(`hire-${pg}`).px(8).h(22).flex().items_center().cursor_pointer().border_1()
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
