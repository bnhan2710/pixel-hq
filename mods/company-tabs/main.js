import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

const MONO = "JetBrains Mono";
// A notched rectangle, drawn as two overlapping blocks with 2px cut corners. Insets are
// [left, right, top, bottom] from the container, so a shape can sit inside another.
const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];
// A pixel box: a 2px frame and a hard 2px shadow, both notched. The container leaves the
// shadow's 2px on its right and bottom; the content sits 2px inside the frame.
const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];
// A pixel X: 2px steps down both diagonals, so it reads as a cross, not a plus.
const cross = (c, size) => {
  const step = size / 4;
  return [0, 1, 2, 3].flatMap((i) => [
    div().absolute().left(i * step).top(i * step).w(step).h(step).bg(c),
    div().absolute().left(size - step - i * step).top(i * step).w(step).h(step).bg(c),
  ]);
};

// Status marks, drawn in 2px pixels so they read at a glance.
// A pixel ring: eight 4px cells around a 12px square, a bright head and a fading tail.
const RING = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const spinner = (c, f) => div().relative().flex_none().size(14)
  .children(RING.map(([x, y], i) => div().absolute().left(x * 5).top(y * 5).size(4).bg(c).opacity([1, 0.8, 0.55, 0.35, 0.2, 0.12, 0.12, 0.12][(f - i + 8) % 8])));
const tick = (c) => div().relative().flex_none().w(10).h(10)
  .children([[0, 6], [2, 8], [4, 6], [6, 4], [8, 2]].map(([x, y]) => div().absolute().left(x).top(y - 2).w(2).h(4).bg(c)));
const bang = (c) => div().relative().flex_none().w(4).h(10)
  .children([div().absolute().left(1).top(0).w(2).h(6).bg(c), div().absolute().left(1).top(8).w(2).h(2).bg(c)]);
const plus = (c) => div().relative().flex_none().w(10).h(10)
  .children([div().absolute().left(3).top(0).w(4).h(10).bg(c), div().absolute().left(0).top(3).w(10).h(4).bg(c)]);

export default class Tabs extends View {
  init(_props, cx) {
    this.drag = null; this.widths = {};
    this.frame = 0; this.spin = false;
    cx.timer.every(110, (cx) => { if (this.spin) { this.frame = (this.frame + 1) % 8; cx.notify(); } });
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  zoom() { return Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1; }

  // Chrome-style: the held tab follows the pointer, the others slide aside once it passes their middle.
  dragMove(e, cx) {
    const d = this.drag;
    if (!d) return;
    if (e.pressed_button !== "left") { this.drag = null; cx.notify(); return; }
    const raw = e.position.x - d.sx;
    if (!d.moved && Math.abs(raw) < 4) return;
    d.moved = true;
    const G = 3 * this.zoom(), W = d.ids.map(id => this.widths[id] ?? 0);
    const before = W.slice(0, d.i).reduce((a, w) => a + w + G, 0), after = W.slice(d.i + 1).reduce((a, w) => a + w + G, 0);
    d.dx = Math.max(-before, Math.min(after, raw));
    let t = d.i, acc = 0;
    if (d.dx > 0) for (let j = d.i + 1; j < W.length && d.dx > acc + W[j] / 2; j++) { t = j; acc += W[j] + G; }
    else for (let j = d.i - 1; j >= 0 && -d.dx > acc + W[j] / 2; j--) { t = j; acc += W[j] + G; }
    d.t = t; d.slot = d.dx > 0 ? acc : -acc;
    cx.notify();
  }

  dragEnd(cx) {
    const d = this.drag;
    if (!d) return;
    this.drag = null; this.last = d;
    if (d.moved && d.t !== d.i) {
      const ids = d.ids.slice();
      ids.splice(d.t, 0, ...ids.splice(d.i, 1));
      this.order = { ids, until: Date.now() + 1000 };
      run("tab.move", { id: d.id, index: d.t + 1 });
    }
    if (d.moved) {
      run("tab.select", { id: d.id });
      this.settle = { id: d.id, off: d.dx - d.slot };
      cx.timer.after(16, (cx) => { if (this.settle?.id === d.id) { this.settle.off = 0; cx.notify(); } });
      cx.timer.after(220, (cx) => { if (this.settle?.id === d.id) { this.settle = null; cx.notify(); } });
    }
    cx.notify();
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    let shown = space?.tabs ?? [];
    // Until Herdr reports the move, show the order the drop asked for, so nothing jumps back for a frame.
    const p = this.order;
    if (p) {
      const ids = shown.map(x => x.id);
      if (Date.now() > p.until || ids.join() === p.ids.join() || ids.length !== p.ids.length || !p.ids.every(id => ids.includes(id))) this.order = null;
      else shown = p.ids.map(id => shown.find(x => x.id === id));
    }
    const d = this.drag, z = this.zoom(), lift = d?.moved ? (this.widths[d.id] ?? 0) + 3 * z : 0;
    const shift = (c, j) => {
      if (d?.moved) {
        if (c.id === d.id) return d.dx;
        if (j > d.i && j <= d.t) return -lift;
        if (j < d.i && j >= d.t) return lift;
        return 0;
      }
      return this.settle?.id === c.id ? this.settle.off : 0;
    };
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    this.spin = shown.some(tab => tab.status === "working");
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, glyph, action) => div().id(id).relative().size(28).flex_none().flex().items_center().justify_center()
      .children(box(t.raised, t.chrome, t.surface)).font_family(MONO).font_bold().text_size(11).text_color(t.muted)
      .hover(s => s.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(glyph === "+" ? plus(t.accent) : glyph);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      const dragged = d?.moved && d.id === c.id;
      return h_flex().id(`tab-${c.id}`).relative().left(dragged ? 0 : shift(c, i) / z).h(32).pl(9).pr(11).pt(4).pb(6).gap(7).items_center().flex_none()
        .children([...box(c.active ? t.muted : t.raised, c.active ? t.raised : t.chrome, t.surface), ...(c.active ? [div().absolute().left(8).right(10).bottom(4).h(2).bg(t.accent)] : [])])
        // A rename or status dot on this or an earlier tab can push the active one out.
        .on_size_change((size, cx) => { this.widths[c.id] = size.width; if (i <= active) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .when(d?.moved ? !dragged : this.settle?.id === c.id, el => el.transition("left", { duration: 180, easing: "ease-out" }))
        .when(Boolean(d?.moved), el => el.cursor_grabbing())
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.drag = { i, id: c.id, ids: shown.map(x => x.id), sx: e.position.x, dx: 0, t: i, slot: 0, moved: false }; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => { const g = this.drag ?? this.last; if (g?.id === c.id && !g.moved) run("tab.select", { id: c.id }); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(c.active ? t.accent : t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().font_family(MONO).font_bold().text_size(11).text_color(c.active ? t.foreground : t.muted).child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(spinner(t.working, this.frame)))
        .when(c.status === "blocked", el => el.child(bang(t.blocked)))
        .when(c.status === "done", el => el.child(tick(t.done)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).flex_none().relative().w(8).h(8).cursor_pointer().on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .children(cross(t.muted, 8))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, text) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).relative().h(28).pl(9).pr(11).pt(4).pb(6).flex_none().items_center()
        .children([...box(on ? t.muted : t.raised, on ? t.raised : t.chrome, t.surface), ...(on ? [div().absolute().left(8).right(10).bottom(4).h(2).bg(t.accent)] : [])])
        .font_family(MONO).font_bold().text_size(10).text_color(on ? t.foreground : t.muted).hover(s => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        })
        .child(text.toUpperCase());
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.surface)
      .on_window_mouse_move((e, cx) => this.dragMove(e, cx))
      .on_window_mouse_up("left", (_e, cx) => this.dragEnd(cx))
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .relative()
        // No z-index here: the held tab leaves a gap in its slot and is drawn last, so it rides over the others.
        .children(shown.map((c, i) => d?.moved && c.id === d.id ? div().flex_none().w((this.widths[c.id] ?? 0) / z).h(32) : item(c, i)))
        .when(Boolean(d?.moved && shown[d.i]?.id === d.id), el => el.child(div().absolute().top(0).bottom(0)
          .left((d.ids.slice(0, d.i).reduce((a, id) => a + (this.widths[id] ?? 0) + 3 * z, 0) + d.dx) / z)
          .flex().items_center().child(item(shown[d.i], d.i)))))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/company-tabs/win-min.svg").size(14) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/company-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(14) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/company-tabs/win-close.svg").size(14) : svg("mods/company-pane/close.svg").size(13), () => run("window.close"))));
  }
}
