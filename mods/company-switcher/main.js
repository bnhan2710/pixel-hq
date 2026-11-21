// Pixel HQ Floor Switcher
// Instant switching between workspace floors with quick search, arrow navigation, 1-9 shortcuts, and Ctrl+P cycling.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, agents, run, theme, props, closeOverlay, nextCommand } from "herdr";

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

export default class CompanySwitcher extends View {
  init(_props, cx) {
    this.filter = "";
    this.selected = 0;
    this.cycling = false;

    this.input = InputState.new({ placeholder: "Search floor or type 1–9 to jump…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value().toLowerCase().trim();
      this.selected = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.switchCurrent(cx));

    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input.focus();
    cx.timer.after(200, () => this.input.focus());

    // Listen to nextCommand for cycling commands when Ctrl+P is pressed repeatedly
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const list = this.filteredSpaces();
        if (list.length === 0) continue;
        if (c === "cycle") {
          this.selected = (this.selected + 1) % list.length;
          this.cycling = true;
          cx.notify();
        } else if (c === "cycleBack") {
          this.selected = (this.selected - 1 + list.length) % list.length;
          this.cycling = true;
          cx.notify();
        }
      }
    });
  }

  filteredSpaces() {
    const all = spaces() ?? [];
    if (!this.filter) return all;
    return all.filter((s, i) => {
      const name = (s.name ?? "").toLowerCase();
      const folder = (s.folder ?? "").toLowerCase();
      const num = String(i + 1);
      return name.includes(this.filter) || folder.includes(this.filter) || num === this.filter;
    });
  }

  switchCurrent(cx) {
    const list = this.filteredSpaces();
    if (list.length > 0 && list[this.selected]) {
      run("space.select", { id: list[this.selected].id });
      closeOverlay(props()?.overlay);
    } else if (cx) {
      cx.notify();
    }
  }

  render(cx) {
    const t = theme();
    const list = this.filteredSpaces();
    const agList = agents() ?? [];
    const crewMap = new Map();
    for (const a of agList) {
      if (!crewMap.has(a.space)) crewMap.set(a.space, []);
      crewMap.get(a.space).push(a);
    }

    return v_flex()
      .id("company-switcher")
      .track_focus(this.handle)
      .on_modifiers_changed((e, cx) => {
        const ctrlHeld = Boolean(e.modifiers?.control || e.modifiers?.platform);
        if (!ctrlHeld && this.cycling) {
          this.cycling = false;
          this.switchCurrent(cx);
        }
      })
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          this.cycling = false;
          closeOverlay(props()?.overlay);
          cx.stop_propagation();
          return;
        }

        const isCtrlOrCmd = Boolean(e.modifiers?.control || e.modifiers?.platform);
        const isP = e.key === "p" || e.key === "P" || e.keystroke?.endsWith("-p");

        if (isCtrlOrCmd && isP) {
          if (list.length > 0) {
            if (e.modifiers?.shift) {
              this.selected = (this.selected - 1 + list.length) % list.length;
            } else {
              this.selected = (this.selected + 1) % list.length;
            }
            this.cycling = true;
            cx.stop_propagation();
            cx.notify();
            return;
          }
        }

        if (e.key === "down" || e.key === "arrow_down" || (e.key === "tab" && !e.modifiers?.shift)) {
          this.selected = (this.selected + 1) % Math.max(1, list.length);
          cx.stop_propagation();
          cx.notify();
          return;
        }

        if (e.key === "up" || e.key === "arrow_up" || (e.key === "tab" && e.modifiers?.shift)) {
          this.selected = (this.selected - 1 + Math.max(1, list.length)) % Math.max(1, list.length);
          cx.stop_propagation();
          cx.notify();
          return;
        }

        if (e.key === "enter") {
          this.cycling = false;
          this.switchCurrent(cx);
          cx.stop_propagation();
          return;
        }

        if (!this.filter && /^[1-9]$/.test(e.key)) {
          const idx = parseInt(e.key, 10) - 1;
          const all = spaces() ?? [];
          if (all[idx]) {
            this.cycling = false;
            run("space.select", { id: all[idx].id });
            closeOverlay(props()?.overlay);
            cx.stop_propagation();
            return;
          }
        }
      })
      .on_key_up((e, cx) => {
        const k = (e.key ?? "").toLowerCase();
        if ((k === "control" || k === "ctrl" || k === "meta" || k === "command") && this.cycling) {
          this.cycling = false;
          this.switchCurrent(cx);
          cx.stop_propagation();
        }
      })
      .size_full()
      .min_h(0)
      .relative()
      .children(box("#45475a", "#181825", "#11111b"))
      .child(
        v_flex()
          .relative()
          .size_full()
          .p(10)
          .gap(8)
          .font_family(MONO)
          .child(
            h_flex()
              .w_full()
              .pb(6)
              .items_center()
              .justify_between()
              .border_b(1)
              .border_color("#313244")
              .child(
                h_flex()
                  .gap(8)
                  .items_center()
                  .child(svg("mods/company-spaces/monitor.svg").size(15).text_color("#89b4fa"))
                  .child(
                    div()
                      .font_family(MONO)
                      .text_size(12)
                      .font_bold()
                      .text_color("#cdd6f4")
                      .child("FLOOR SWITCHER // DIRECTORY"),
                  )
                  .child(
                    div()
                      .px(4)
                      .py(1)
                      .bg("#89b4fa18")
                      .border_1()
                      .border_color("#89b4fa44")
                      .font_family(MONO)
                      .text_size(8.5)
                      .font_bold()
                      .text_color("#89b4fa")
                      .child("CTRL+P"),
                  ),
              )
              .child(
                h_flex()
                  .id("btn-esc-switcher")
                  .relative()
                  .h(22)
                  .px(8)
                  .items_center()
                  .justify_center()
                  .cursor_pointer()
                  .children(box("#45475a", "#313244", "#11111b"))
                  .hover((s) => s.text_color("#ffffff"))
                  .on_click(() => closeOverlay(props()?.overlay))
                  .child(
                    div()
                      .font_family(MONO)
                      .text_size(9.5)
                      .font_bold()
                      .text_color("#a6adc8")
                      .child("ESC"),
                  ),
              ),
          )
          .child(
            h_flex()
              .relative()
              .h(32)
              .px(8)
              .gap(8)
              .items_center()
              .bg("#0d0e15")
              .border_1()
              .border_color("#313244")
              .child(div().font_family(MONO).font_bold().text_size(13).text_color("#89b4fa").child(">"))
              .child(
                Input.new(this.input)
                  .h_full()
                  .w_full()
                  .font_family(MONO)
                  .text_size(11.5)
                  .text_color("#cdd6f4"),
              ),
          )
          .child(
            v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .py(2)
              .gap(6)
              .children(
                list.map((s, i) => {
                  const on = s.active;
                  const isSel = this.selected === i;
                  const crew = crewMap.get(s.id) ?? [];
                  const working = crew.filter((a) => a.status === "working").length;
                  const blocked = crew.filter((a) => a.status === "blocked").length;
                  const dotColor = blocked > 0 ? "#f38ba8" : working > 0 ? "#89b4fa" : "#a6e3a1";

                  return h_flex()
                    .id(`space-row-${s.id}`)
                    .h(42)
                    .px(10)
                    .items_center()
                    .justify_between()
                    .cursor_pointer()
                    .bg(isSel ? "#2a2b3d" : on ? "#1e1e2e" : "#14141e")
                    .border_1()
                    .border_color(isSel ? "#89b4fa" : on ? "#45475a" : "#262637")
                    .hover((st) => st.bg("#2e3146"))
                    .on_click(() => {
                      run("space.select", { id: s.id });
                      closeOverlay(props()?.overlay);
                    })
                    .child(
                      h_flex()
                        .gap(8)
                        .items_center()
                        .when(isSel, (el) => el.child(div().font_family(MONO).font_bold().text_size(11).text_color("#89b4fa").child("▶")))
                        .when(!isSel, (el) => el.child(div().w(8)))
                        .child(
                          div()
                            .px(5)
                            .py(1.5)
                            .bg("#11111b")
                            .border_1()
                            .border_color(isSel ? "#89b4fa" : "#45475a")
                            .font_family(MONO)
                            .text_size(9.5)
                            .font_bold()
                            .text_color(isSel ? "#89b4fa" : "#a6adc8")
                            .child(`F${i + 1}`)
                        )
                        .child(
                          v_flex()
                            .gap(1)
                            .child(
                              h_flex()
                                .gap(6)
                                .items_center()
                                .child(
                                  div()
                                    .font_family(MONO)
                                    .text_size(12)
                                    .font_bold()
                                    .text_color(isSel ? "#89b4fa" : "#cdd6f4")
                                    .child(s.name ?? "unnamed"),
                                )
                                .when(on, (ch) =>
                                  ch.child(
                                    div()
                                      .px(4)
                                      .py(0.5)
                                      .font_family(MONO)
                                      .text_size(8.5)
                                      .font_bold()
                                      .bg("#89b4fa26")
                                      .border_1()
                                      .border_color("#89b4fa55")
                                      .text_color("#89b4fa")
                                      .child("CURRENT FLOOR"),
                                  ),
                                ),
                            )
                            .child(
                              div()
                                .font_family(MONO)
                                .text_size(9.5)
                                .text_color("#6c7086")
                                .child(s.folder ? s.folder.replace(/\/+$/, "").split("/").pop() : "~"),
                            ),
                        ),
                    )
                    .child(
                      h_flex()
                        .gap(8)
                        .items_center()
                        .when(crew.length > 0, (ch) =>
                          ch.child(
                            h_flex()
                              .gap(5)
                              .items_center()
                              .child(div().size(6).bg(dotColor))
                              .child(
                                div()
                                  .font_family(MONO)
                                  .text_size(9.5)
                                  .text_color("#a6adc8")
                                  .child(`${crew.length} ABOARD`),
                              ),
                          ),
                        )
                        .child(
                          div()
                            .px(5)
                            .py(1.5)
                            .bg("#11111b")
                            .border_1()
                            .border_color("#45475a")
                            .text_size(9)
                            .font_family(MONO)
                            .font_bold()
                            .text_color("#a6adc8")
                            .child(`ALT+${i + 1}`)
                        ),
                    );
                }),
              ),
          )
          .child(
            h_flex()
              .h(24)
              .px(6)
              .items_center()
              .justify_between()
              .border_t(1)
              .border_color("#313244")
              .font_family(MONO)
              .text_size(9)
              .text_color("#6c7086")
              .child("CTRL+P TO CYCLE · 1–9 TO JUMP · ENTER SELECT")
              .child("ESC CLOSE"),
          ),
      );
  }
}
