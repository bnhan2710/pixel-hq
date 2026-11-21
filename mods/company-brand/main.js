import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, notify } from "herdr";

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

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).relative().size(26).flex_none().flex().items_center().justify_center().cursor_pointer()
      .hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, iconPath, label, action) => h_flex().id(id).relative().h(26).pl(8).pr(10).gap(7).items_center().cursor_pointer()
        .children(box(t.raised, t.chrome, t.surface))
        .font_family(MONO).font_bold().text_size(10).text_color(t.muted)
        .hover(s => s.text_color(t.foreground))
        .when(collapsed, el => el.w(30).px(0).justify_center().tooltip(label))
        .on_click(action)
        .child(svg(iconPath).size(15).flex_none())
        .when(!collapsed, el => el.child(label.toUpperCase()));
      const ready = div().size(6).bg(t.accent);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.surface).px(collapsed ? 6 : 8).pt(4).pb(4).gap(3)
        .when(collapsed, el => el.items_center())
        .child(row("settings", "mods/company-brand/settings.svg", "Settings", () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(3).right(4) : ready)))
        .child(row("machine", "mods/company-brand/plus.svg", "Add machine", () => run("mod.open", { name: "machine-add" })));
    }
    const logo = image("mods/company-brand/logo.png").size(34).flex_none();
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(9).items_center().cursor_pointer()
        .tooltip("Pixel HQ - Click to test pixel notification")
        .on_click(() => notify({ title: "PIXEL HQ", body: "Pixel art toast notification online!", level: "success" }))
        .child(logo)
        .child(v_flex().gap(0).child(div().font_family(MONO).font_bold().text_size(13).text_color(t.foreground).child("PIXEL HQ"))
          .child(div().font_family(MONO).font_bold().text_size(9.5).text_color(t.dim).child("ENGINEERING FLOOR")))))
      .when(!collapsed, el => el.child(this.button("hotkeys", svg("mods/company-brand/keyboard.svg").size(15).text_color(t.muted), () => run("mod.open", { name: "company-hotkeys" }))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/company-brand/search.svg").size(15).text_color(t.muted), () => run("mod.open", { name: "picker" }))))
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/company-brand/sidebar.svg").size(15).text_color(t.muted), toggleSidebar)));
  }
}
