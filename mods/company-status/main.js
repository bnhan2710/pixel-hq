import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys } from "herdr";

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const n = (k) => list.filter(a => a.status === k).length;
    const pill = (color, text) => h_flex().gap(6).items_center().child(div().size(7).rounded(4).bg(color)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(div().font_semibold().text_color("#b4befe").child("Pixel HQ"))
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(div().text_color(t.dim).child(`${list.length} on the team`))
      .when(n("working") > 0, el => el.child(pill("#89b4fa", `${n("working")} typing`)))
      .when(n("blocked") > 0, el => el.child(pill(t.blocked ?? "#e8744f", `${n("blocked")} need you`)))
      .when(n("done") > 0, el => el.child(pill(t.done ?? "#8ec07c", `${n("done")} shipped`)))
      .when(list.length - n("working") - n("blocked") - n("done") > 0, el => el.child(pill(t.dim ?? "#9a8f86", `${list.length - n("working") - n("blocked") - n("done")} on break`)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
