import { View, div, svg, image } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { panes, props, run, theme, home, layout, shared, setShared, appHome, readTextFile, writeTextFile } from "herdr";
import { agentOf, duckMood, duckWidth, mood } from "./duck.js";

const MONO = "JetBrains Mono";

const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];

const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];

const RING = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const spinner = (c, f) => div().relative().flex_none().size(12)
  .children(RING.map(([x, y], i) => div().absolute().left(x * 4).top(y * 4).size(3).bg(c).opacity([1, 0.8, 0.55, 0.35, 0.2, 0.12, 0.12, 0.12][(f - i + 8) % 8])));
const bang = (c) => div().relative().flex_none().w(4).h(10)
  .children([div().absolute().left(1).top(0).w(2).h(6).bg(c), div().absolute().left(1).top(8).w(2).h(2).bg(c)]);
const tick = (c) => div().relative().flex_none().w(10).h(10)
  .children([[0, 6], [2, 8], [4, 6], [6, 4], [8, 2]].map(([x, y]) => div().absolute().left(x).top(y - 2).w(2).h(4).bg(c)));

const ROLE = (p) => agentOf(p.program?.key)?.role ?? (p.program?.shell ? "Terminal" : (p.program?.name ?? "Contractor"));

function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) { const f = paneFrame(child); if (f) return f; }
  return null;
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class CompanyPane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.editing = null;
    this.frame = 0;
    this.file = `${appHome()}/pixel-hq-names.json`;
    cx.timer.every(110, (cx) => {
      const p = this.me();
      if (p?.status === "working") {
        this.frame = (this.frame + 1) % 8;
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      if (shared("pixel-hq.names")) return;
      const raw = await readTextFile(this.file).catch(() => null);
      try { const v = JSON.parse(raw ?? "{}"); if (v && typeof v === "object" && !shared("pixel-hq.names")) { setShared("pixel-hq.names", v); cx.notify(); } } catch {}
    });
    this.input = InputState.new({ placeholder: "" });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("blur", (_e, cx) => { if (this.editing) { this.editing = null; cx.notify(); } });
  }

  start(field, pane, current, cx) {
    this.editing = { field, pane };
    this.input.set_value(current);
    cx.notify();
    cx.timer.after(40, () => this.input.focus());
  }

  commit(cx) {
    const e = this.editing;
    if (!e) return;
    const v = this.input.value().trim().slice(0, 40);
    const names = { ...(shared("pixel-hq.names") ?? {}) };
    const mine = { ...(names[e.pane] ?? {}) };
    if (v) mine[e.field] = v; else delete mine[e.field];
    if (Object.keys(mine).length) names[e.pane] = mine; else delete names[e.pane];
    setShared("pixel-hq.names", names);
    const text = JSON.stringify(names, null, 2);
    cx.spawn(async () => { const raw = await readTextFile(this.file).catch(() => null); await writeTextFile(this.file, text, raw).catch(() => {}); });
    this.editing = null;
    cx.notify();
  }

  me() { return panes().find((p) => p.pane === props()?.pane); }

  button(t, id, icon, command, args) {
    return div().id(id).relative().p(4).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`mods/company-pane/${icon}.svg`).size(14).text_color(t.dim));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const st = p.status;
    const pane = p.pane;
    const species = agentOf(p.program?.key)?.species ?? null;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const H = 30;
    const avatar = species
      ? div().flex_none().w(duckWidth(H)).h(H).child(duckMood(mood(st ?? "idle"), H, { species }))
      : div().flex_none().size(24).relative().flex().items_center().justify_center()
          .children(box(t.raised, t.chrome, t.surface))
          .font_family(MONO).font_bold().text_size(11).text_color(t.muted).child(">_");
    const custom = (shared("pixel-hq.names") ?? {})[pane] ?? {};
    const title = custom.name ?? ((((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name) || "shell");
    const chip = (text, color, iconEl) => h_flex().flex_none().gap(5).px(7).h(20).items_center().relative()
      .children(notch(color + "22", [0, 0, 0, 0]))
      .child(div().absolute().left(1).right(1).top(0).h(1).bg(color + "66"))
      .child(div().absolute().left(1).right(1).bottom(0).h(1).bg(color + "66"))
      .child(div().absolute().left(0).top(1).bottom(1).w(1).bg(color + "66"))
      .child(div().absolute().right(0).top(1).bottom(1).w(1).bg(color + "66"))
      .font_family(MONO).font_bold().text_size(9.5).text_color(color)
      .when(Boolean(iconEl), el => el.child(iconEl))
      .child(text.toUpperCase());
    const status = st === "working" ? chip("typing", "#89b4fa", spinner("#89b4fa", this.frame))
      : st === "blocked" ? chip("needs you", t.blocked ?? "#e8744f", bang(t.blocked ?? "#e8744f"))
      : st === "done" ? chip("shipped", t.done ?? "#8ec07c", tick(t.done ?? "#8ec07c"))
      : species ? chip("on break", t.dim ?? "#9a8f86") : null;
    const edit = (field, el, width) => this.editing?.pane === pane && this.editing.field === field
      ? div().id(`pe-${pane}-${field}`).flex_none().w(width).h(22).px(6).flex().items_center().relative()
          .children(notch(t.chrome, [0, 0, 0, 0]))
          .child(div().absolute().left(0).right(0).top(0).bottom(0).border_1().border_color(t.accent))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().font_family(MONO).text_size(11.5).text_color(t.foreground))
      : el.cursor_text().hover((s) => s.bg(t.hover)).tooltip("Click to rename")
          .on_click((_e, cx) => { cx.stop_propagation(); this.start(field, pane, field === "role" ? (custom.role ?? ROLE(p)) : title, cx); });
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(9)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(avatar)
      .child(h_flex().flex_none().gap(7).items_center()
        .child(edit("name", div().id(`pn-${pane}`).truncate().max_w(220).px(3).font_family(MONO).font_bold().text_size(12).text_color(t.foreground).child(title), 170))
        .child(edit("role", div().id(`pr-${pane}`).flex_none().px(6).h(18).flex().items_center().relative()
          .children(notch("#89b4fa22", [0, 0, 0, 0]))
          .child(div().absolute().left(1).right(1).top(0).h(1).bg("#89b4fa66"))
          .child(div().absolute().left(1).right(1).bottom(0).h(1).bg("#89b4fa66"))
          .child(div().absolute().left(0).top(1).bottom(1).w(1).bg("#89b4fa66"))
          .child(div().absolute().right(0).top(1).bottom(1).w(1).bg("#89b4fa66"))
          .font_family(MONO).font_bold().text_size(9.5).text_color("#b4befe")
          .child((custom.role ?? ROLE(p)).toUpperCase()), 120)))
      .child(div().flex_1().truncate().font_family(MONO).text_size(11).text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(status), el => el.child(status))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
