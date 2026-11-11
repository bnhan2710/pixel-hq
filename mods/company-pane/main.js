// A desk nameplate as the pane header: the agent's pixel pet, its job title, status and folder.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout } from "herdr";
import { duckMood, duckWidth, mood } from "./duck.js";

const SPECIES = (key) => {
  const k = String(key ?? "").toLowerCase();
  return k.includes("claude") ? "crab" : k.includes("codex") ? "bot" : k.includes("opencode") ? "penguin" : k.includes("gemini") ? "sheep" : null;
};
const ROLE = (p) => {
  const k = String(p.program?.key ?? "").toLowerCase();
  return k.includes("claude") ? "Staff Engineer" : k.includes("codex") ? "Code Reviewer" : k.includes("opencode") ? "Platform Engineer" : k.includes("gemini") ? "Data Scientist"
    : p.program?.shell ? "Terminal" : (p.program?.name ?? "Contractor");
};

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
  init() { this.hovered = false; }
  me() { return panes().find((p) => p.pane === props()?.pane); }

  button(t, id, icon, command, args) {
    return div().id(id).p(3).rounded(5).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`mods/company-pane/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const st = p.status;
    const pane = p.pane;
    const species = SPECIES(p.program?.key);
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const H = 30;
    const avatar = species
      ? div().flex_none().w(duckWidth(H)).h(H).child(duckMood(mood(st ?? "idle"), H, { species }))
      : div().flex_none().size(24).rounded(6).bg(t.raised).flex().items_center().justify_center().text_size(12).text_color(t.muted).child(">_");
    const title = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const chip = (text, color, spin) => h_flex().flex_none().gap(5).px(8).h(20).items_center().rounded(10).bg(color + "26").text_size(10.5).font_semibold().text_color(color)
      .when(Boolean(spin), el => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(color).spin(900)))
      .child(text);
    const status = st === "working" ? chip("typing", "#89b4fa", true)
      : st === "blocked" ? chip("needs you", t.blocked ?? "#e8744f")
      : st === "done" ? chip("shipped", t.done ?? "#8ec07c")
      : species ? chip("on break", t.dim ?? "#9a8f86") : null;
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
        .child(div().truncate().max_w(220).font_semibold().text_color(t.foreground).child(title))
        .child(div().flex_none().px(7).h(19).flex().items_center().rounded(5).bg("#89b4fa1f").text_size(10.5).text_color("#b4befe").child(ROLE(p))))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(status), el => el.child(status))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
