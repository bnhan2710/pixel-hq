// Pixel HQ Toast Notification
// Restyled notifications with 3D notched pixel frame, monospace typography, square indicators, and pixel buttons.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme } from "herdr";

const MONO = "JetBrains Mono, Menlo, monospace";

const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];
const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];

const LEVEL_CONFIG = {
  error: { badge: "ERR", color: "#f38ba8", bg: "#f38ba822", border: "#f38ba866" },
  warning: { badge: "WARN", color: "#f9e2af", bg: "#f9e2af22", border: "#f9e2af66" },
  success: { badge: "OK", color: "#a6e3a1", bg: "#a6e3a122", border: "#a6e3a166" },
  info: { badge: "INFO", color: "#89b4fa", bg: "#89b4fa22", border: "#89b4fa66" },
};

export default class Toast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const lvl = LEVEL_CONFIG[p.level] ?? LEVEL_CONFIG.info;
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;

    return h_flex()
      .id("company-toast")
      .size_full()
      .relative()
      .children(box("#45475a", "#181825", "#11111b"))
      .cursor_pointer()
      .hover((s) => s.opacity(0.96))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(
        h_flex()
          .relative()
          .size_full()
          .px(12)
          .py(8)
          .gap(10)
          .items_center()
          .child(
            p.icon
              ? image(p.icon).w(18).h(18).flex_none()
              : h_flex()
                  .gap(5)
                  .items_center()
                  .flex_none()
                  .child(div().size(6).bg(lvl.color))
                  .child(
                    div()
                      .px(4)
                      .py(1)
                      .bg(lvl.bg)
                      .border_1()
                      .border_color(lvl.border)
                      .font_family(MONO)
                      .font_bold()
                      .text_size(8.5)
                      .text_color(lvl.color)
                      .child(lvl.badge),
                  ),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .overflow_hidden()
              .gap(1)
              .child(
                div()
                  .truncate()
                  .font_bold()
                  .font_family(MONO)
                  .text_size(11.5)
                  .text_color(lvl.color)
                  .child(login ? `${login[1]} NEEDS LOGIN` : p.title ?? ""),
              )
              .when(!login && Boolean(p.body), (el) =>
                el.child(
                  div()
                    .truncate()
                    .font_family(MONO)
                    .text_size(10)
                    .text_color("#a6adc8")
                    .child(p.body ?? ""),
                ),
              )
              .when(Boolean(login), (el) =>
                el.child(
                  h_flex()
                    .gap(8)
                    .items_center()
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .tooltip(command)
                        .font_family(MONO)
                        .text_size(10)
                        .text_color("#a6adc8")
                        .child(command),
                    )
                    .child(
                      h_flex()
                        .id("toast-login-copy")
                        .relative()
                        .h(22)
                        .px(6)
                        .items_center()
                        .children(box("#45475a", "#313244", "#11111b"))
                        .cursor_pointer()
                        .hover((s) => s.text_color("#ffffff"))
                        .on_click((_e, cx) => {
                          cx.stop_propagation();
                          cx.write_to_clipboard(command);
                          this.copied = true;
                          cx.notify();
                        })
                        .child(
                          div()
                            .font_family(MONO)
                            .font_bold()
                            .text_size(9)
                            .text_color(this.copied ? "#a6e3a1" : "#89b4fa")
                            .child(this.copied ? "COPIED" : "COPY"),
                        ),
                    ),
                ),
              ),
          ),
      );
  }
}
