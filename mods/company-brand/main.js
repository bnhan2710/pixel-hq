import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, nextCommand } from "herdr";
import { checkPixelHqUpdate, executePixelHqUpdate, openUpdateModal, Updater } from "./updater.js";

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

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    if (props()?.updateModal) {
      this.updater = new Updater(cx);
      return;
    }
    checkPixelHqUpdate(true).then(() => cx.notify()).catch(() => {});
    cx.timer.every(6 * 3600 * 1000, (cx) => {
      checkPixelHqUpdate(true).then(() => cx.notify()).catch(() => {});
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "update") {
          await executePixelHqUpdate();
          cx.notify();
        }
      }
    });
  }

  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }

  render(cx) {
    if (this.updater) return this.updater.render(cx);
    const t = theme();
    const collapsed = narrow();
    const upd = shared("pixel-hq.new-version");
    const updatingState = shared("pixel-hq.updating");
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/company-brand/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })))
        .when(Boolean(updatingState), el => el.child(
          row("update-hq", "sparkles", `⏳ Updating [${updatingState.step}/${updatingState.total}] (${updatingState.pct}%)`, false, () => {
            openUpdateModal();
          }).text_color(t.accent).child(ready)
        ))
        .when(Boolean(!updatingState && upd), el => {
          const urgent = Boolean(upd?.isUrgent);
          const verText = upd?.versionLabel ?? `v${upd.version}`;
          const label = urgent ? `⚠️ Urgent Update (${verText})` : `Update Pixel HQ (${verText})`;
          const color = urgent ? (t.blocked ?? "#f38ba8") : t.accent;
          return el.child(
            row("update-hq", "sparkles", label, false, async () => {
              await executePixelHqUpdate();
              cx.notify();
            }).text_color(color).child(ready)
          );
        });
    }
    // The company sign: a pixel asterisk in an orange tile, the company name and the floor.
    const logo = image("mods/company-brand/logo.png").size(34).flex_none();
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(9).items_center().child(logo)
        .child(v_flex().gap(0).child(div().font_semibold().text_size(14).text_color(t.foreground).child("Pixel HQ"))
          .child(div().text_size(10).text_color(t.dim).child("engineering floor")))))
      .when(Boolean((updatingState || upd) && !collapsed), el => {
        if (updatingState) {
          return el.child(
            this.button("update-btn", svg("mods/company-brand/sparkles.svg").size(15), () => {
              openUpdateModal();
            }).tooltip(`Updating [${updatingState.step}/${updatingState.total}]: ${updatingState.file}`).text_color(t.accent)
          );
        }
        const urgent = Boolean(upd?.isUrgent);
        const verText = upd?.versionLabel ?? `v${upd.version}`;
        const color = urgent ? (t.blocked ?? "#f38ba8") : t.accent;
        const tip = urgent ? `⚠️ Urgent update: Pixel HQ ${verText}` : `Update Pixel HQ to ${verText}`;
        return el.child(
          this.button("update-btn", svg("mods/company-brand/sparkles.svg").size(15), async () => {
            await executePixelHqUpdate();
            cx.notify();
          }).tooltip(tip).text_color(color)
        );
      })
      .when(!collapsed, el => el.child(this.button("search", svg("mods/company-brand/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/company-brand/sidebar.svg").size(15), toggleSidebar)));
  }
}
