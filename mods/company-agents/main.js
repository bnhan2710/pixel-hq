// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";
import { figureFor, load } from "./figures.js";
import { speciesOf, duckWidth, DUCK_CENTER } from "./duck.js";
import { scene, SLOTS, yHorizon } from "./scene.js";
import { Editor } from "./editor.js";

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
    // Now and then (every 14 to 32 s) one idle pet steps out beside its desk for about 3.6 s, then comes back.
    this.out = null;
    this.breakerList = [];
    this.nextAt = Date.now() + 6000;
    cx.timer.every(1000, (cx) => {
      const now = Date.now();
      if (this.out) {
        if (now >= this.out.until) { this.out = null; this.nextAt = now + 14000 + Math.random() * 18000; cx.notify(); }
        return;
      }
      if (now < this.nextAt) return;
      this.nextAt = now + 3000;
      const c = this.breakerList.filter((x) => this.drag?.addr !== x);
      if (c.length) { this.out = { addr: c[Math.floor(Math.random() * c.length)], until: now + 3600 }; cx.notify(); }
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
      const v = Number.parseInt(k.labels?.["claude.context"], 10);
      return Number.isFinite(v) ? [[k.address, { pct: Math.max(0, Math.min(100, v)), model: k.labels?.["claude.model"] || null }]] : [];
    }));

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
    const PET = 46;
    const petW = duckWidth(PET);
    const horizon = yHorizon(sz.height);
    const fieldTop = horizon + 20;
    const fieldH = Math.max(40, sz.height - fieldTop - (PET + 46));
    const endDrag = (cx) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!d.moved) run("pane.focus", { pane: d.pane });
      else localStorage.setItem("petpos", JSON.stringify(this.petpos));
      cx.notify();
    };
    const ROLES = (a) => { const k = String(a.program?.key ?? "").toLowerCase(); return k.includes("claude") ? "staff engineer" : k.includes("codex") ? "code reviewer" : k.includes("opencode") ? "platform engineer" : (k.includes("antigravity") || k === "agy") ? "systems architect" : ""; };
    const STATE = { working: "typing working busy", idle: "idle break coffee", done: "shipped done finished", blocked: "needs you blocked waiting" };
    const q = this.query.trim().toLowerCase();
    const hitOf = (a) => !q || q.split(/\s+/).every((w) => [detail.get(a.address), a.space_name, label(a), a.program?.name, ROLES(a), STATE[a.status]].join(" ").toLowerCase().includes(w));
    const hits = list.filter(hitOf);
    this.firstHit = q ? hits[0]?.pane ?? null : null;
    const breakers = list.filter((x) => x.status === "idle" && !x.focused).map((x) => x.address);
    this.breakerList = breakers;
    const stable = list.map((x) => x.address).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const pets = list.map((a, i) => {
      // A pet keeps its desk: slots follow a stable order, not the status sort.
      const slot = stable.indexOf(a.address);
      const [sx, sy] = SLOTS[slot % SLOTS.length];
      const lap = Math.floor(slot / SLOTS.length) * 0.07;
      const own = this.petpos[a.address];
      const left = own ? own[0] * sz.width : Math.max(2, Math.min(sz.width - petW - 2, sz.width * Math.min(0.92, sx + lap) - petW / 2));
      const top = own ? own[1] * sz.height : fieldTop + fieldH * ((sy + lap) % 1);
      const more = detail.get(a.address);
      const text = more ?? a.space_name ?? label(a);
      const when = this.since(a);
      const hot = a.status === "blocked";
      // The pet sits on a chair behind a wooden desk (the MacBook is part of the pet).
      const ctr = DUCK_CENTER * petW;
      const k = breakers.indexOf(a.address);
      const away = k >= 0;
      // On a break the pet steps out beside its desk for a moment and comes right back, over and over.
      const dir = left + petW / 2 < sz.width / 2 ? 1 : -1;
      const dx = dir * (petW + 14);
      const dy = Math.round(PET * 0.3);
      const seat = div().relative().w(petW).h(PET + 28)
        // Office chair: tall padded back with an orange headrest, side bolsters, a pole and wheels under the desk.
        .child(div().absolute().left(ctr - petW * 0.4).top(-8).w(petW * 0.8).h(PET * 0.84).bg("#5a6393"))
        .child(div().absolute().left(ctr - petW * 0.4 + 4).top(-4).w(petW * 0.8 - 8).h(PET * 0.84 - 4).bg("#464e7a"))
        .child(div().absolute().left(ctr - petW * 0.4).top(-8).w(petW * 0.8).h(5).bg("#89b4fa"))
        .child(div().absolute().left(ctr - 2).top(PET * 0.84 + 8).w(4).h(10).bg("#2b2f45"))
        .child(div().absolute().left(ctr - 15).top(PET * 0.84 + 18).w(30).h(4).bg("#2b2f45"))
        .child(div().absolute().left(ctr - 17).top(PET * 0.84 + 22).w(5).h(4).bg("#14172a"))
        .child(div().absolute().left(ctr + 12).top(PET * 0.84 + 22).w(5).h(4).bg("#14172a"))
        .child(div().id(`walker-${a.address}`).absolute()
          .left(away && this.out?.addr === a.address ? dx : 0).top(away && this.out?.addr === a.address ? dy : 0)
          // Glide out and back, but not while it is being dragged, so it follows the pointer exactly.
          .when(this.drag?.addr !== a.address, (el) => el.transition("left", 800).transition("top", 800))
          .child(figureFor(a.space_name, away ? "idle" : a.status, PET, now - when, speciesOf(a.program?.key))))
        // Shipped: pixel confetti rains over the desk until someone looks at it.
        .when(a.status === "done", (el) => el.children([["#f9e2af", 0.10, 900], ["#f38ba8", 0.22, 1300], ["#a6e3a1", 0.34, 1000], ["#89b4fa", 0.46, 1500], ["#cba6f7", 0.58, 1100], ["#fab387", 0.70, 1400], ["#94e2d5", 0.82, 950]]
          .map(([c, fx0, p], j) => div().absolute().left(petW * fx0).top(-20).w(4).h(4).bg(c).loop("top", { from: -22 - (j % 3) * 6, to: PET * 0.55, period: p, easing: "linear" }))))
        .child(div().absolute().left(-6).top(PET * 0.84).w(petW + 12).h(8).bg("#7a5436"))
        .child(div().absolute().left(-6).top(PET * 0.84).w(petW + 12).h(3).bg("#9a7048"))
        .child(div().absolute().left(-2).top(PET * 0.84 + 8).w(4).h(8).bg("#4d3522"))
        .child(div().absolute().left(petW - 2).top(PET * 0.84 + 8).w(4).h(8).bg("#4d3522"));
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
        .tooltip(`${a.program?.name ?? ""} · ${a.status} · ${text} · drag to move`)
        .child(seat)
        .child(div().mt(6).max_w(petW + 22).px(5).h(15).flex().items_center().rounded(3)
          .bg(a.focused || (q && hitOf(a)) ? "#f9e2af" : hot ? "#f38ba8" : "#0f111acc")
          .text_size(10.5).text_color(a.focused || (q && hitOf(a)) ? "#2a1a14" : "#ffffff").truncate()
          .child(`${text}${when ? ` · ${duration(now - when)}` : ""}`));
    });
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
      .when(list.length === 0, (el) => el.child(div().absolute().left(12).top(sz.height * 0.5).w(sz.width - 24).px(8).py(6).rounded(3).bg("#0f111acc").text_size(12).text_color("#ffffff").child("No agents yet. They show up here when they report a status.")))
      .children(this.drag?.moved ? [...pets.filter((_, i) => list[i].address !== this.drag.addr), ...pets.filter((_, i) => list[i].address === this.drag.addr)] : pets);

    return v_flex()
      .id("farm-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("The Engineering Floor"))
            .child(h_flex().gap(10).items_center()
              .when(Boolean(this.fileError), (el) => el.child(div().id("ag-file-error").text_size(11).font_bold().text_color(t.blocked)
                .tooltip(`${this.fileError}. Using the last good figures.`).child("!")))
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
            )),
        ),
      )
      .when(!collapsed, (el) => el.child(h_flex().id("staff-search").mx(10).mt(2).mb(6).h(30).px(9).gap(7).flex_none().items_center().rounded(8).border_1()
        .border_color(this.typing ? "#89b4fa" : "#ffffff1f").bg("#ffffff0a")
        .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).h_full().flex().items_center().cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.searchInput).h_full().text_size(12).text_color(t.foreground)))
        .when(Boolean(q), (e2) => e2
          .child(div().flex_none().text_size(11).text_color(t.dim).child(`${hits.length}/${list.length}`))
          .child(div().id("staff-clear").flex_none().px(4).rounded(4).text_size(14).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { this.searchInput.set_value(""); this.query = ""; cx.notify(); }).child("×")))))
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
