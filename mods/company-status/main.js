import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, setBadge, openOverlay, shared } from "herdr";

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
    const n = (k) => list.filter(a => a.status === k).length;
    const wants = n("blocked") > 0 ? String(n("blocked")) : null;
    if (window()?.platform === "macos" && this.badge !== wants) {
      this.badge = wants;
      try { setBadge(wants); } catch { this.badge = undefined; }
    }
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const pill = (color, text) => h_flex().gap(6).items_center().child(div().size(7).rounded(4).bg(color)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(div().font_semibold().text_color("#b4befe").child("Pixel HQ"))
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(div().text_color(t.dim).child(`${list.length} on the team`))
      .when(Boolean(shared("pixel-hq.updating") || shared("pixel-hq.new-version")), (el) => {
        const updating = shared("pixel-hq.updating");
        if (updating) {
          return el.child(
            h_flex().id("update-status-pill").gap(6).items_center().px(7).py(2).rounded(6)
              .bg("#89b4fa").text_color(t.chrome).cursor_pointer()
              .tooltip(`[${updating.step}/${updating.total}] Updating ${updating.file}... · Click to view modal`)
              .on_click(() => run("company-brand.update"))
              .child(div().font_bold().text_size(11).child(`⏳ Updating [${updating.step}/${updating.total}] · ${updating.pct}%`))
          );
        }
        const upd = shared("pixel-hq.new-version");
        const urgent = Boolean(upd?.isUrgent);
        const pillBg = urgent ? (t.blocked ?? "#f38ba8") : t.accent;
        const verText = upd?.versionLabel ?? `v${upd.version}`;
        const pillText = urgent ? `⚠️ Urgent update: ${verText}` : `✨ New update: ${verText}`;
        const tooltip = urgent
          ? `[Urgent Update] Pixel HQ ${verText} is out${upd.notes ? ` · ${upd.notes}` : ""} · Click to update now`
          : `Pixel HQ ${verText} is out${upd.notes ? ` · ${upd.notes}` : ""} · Click to update`;
        return el.child(
          h_flex().id("update-status-pill").gap(6).items_center().px(7).py(2).rounded(6)
            .bg(pillBg).text_color(t.chrome).cursor_pointer().hover(s => s.opacity(0.85))
            .tooltip(tooltip)
            .on_click(() => run("company-brand.update"))
            .child(div().font_bold().text_size(11).child(pillText))
        );
      })
      .when(n("working") > 0, el => el.child(pill("#89b4fa", `${n("working")} typing`)))
      .when(n("blocked") > 0, el => el.child(div().id("needs-you-pill").cursor_pointer().rounded(6).px(4).hover(s => s.bg(t.hover))
        .tooltip("Open the needs-you list")
        .on_click(() => openOverlay({ mod: "company-agents", kind: "popup", width: 340, height: Math.min(440, Math.max(150, 52 + n("blocked") * 56)), props: { needsYou: true } }))
        .child(pill(t.blocked ?? "#e8744f", `${n("blocked")} ${n("blocked") === 1 ? "needs" : "need"} you`))))
      .when(n("done") > 0, el => el.child(pill(t.done ?? "#8ec07c", `${n("done")} shipped`)))
      .when(list.length - n("working") - n("blocked") - n("done") > 0, el => el.child(pill(t.dim ?? "#9a8f86", `${list.length - n("working") - n("blocked") - n("done")} on break`)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
