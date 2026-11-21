// Pixel HQ Floor Switcher
// Instant switching between workspace floors with quick search, arrow navigation, 1-9 shortcuts, and Ctrl+P cycling.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, agents, run, theme, props, closeOverlay, nextCommand } from "herdr";

const MONO = "JetBrains Mono, Menlo, monospace";

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
      .p(14)
      .gap(10)
      .bg("#181825")
      .border_2()
      .border_color("#313244")
      .font_family(MONO)
      .text_size(12)
      .child(
        h_flex()
          .h(30)
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                h_flex()
                  .size(20)
                  .bg("#313244")
                  .items_center()
                  .justify_center()
                  .child(div().text_size(11).font_bold().text_color("#89b4fa").child("⌘")),
              )
              .child(
                div()
                  .text_size(12)
                  .font_bold()
                  .text_color("#cdd6f4")
                  .child("FLOOR SWITCHER"),
              ),
          )
          .child(
            div()
              .id("btn-esc-switcher")
              .px(7)
              .py(2)
              .bg("#313244")
              .border_1()
              .border_color("#45475a")
              .text_size(10)
              .font_bold()
              .text_color("#a6adc8")
              .cursor_pointer()
              .hover((s) => s.bg("#45475a").text_color("#cdd6f4"))
              .on_click(() => closeOverlay(props()?.overlay))
              .child("ESC"),
          ),
      )
      .child(
        Input.new(this.input)
          .h(32)
          .flex_none()
          .px(8)
          .border_1()
          .border_color("#89b4fa")
          .bg("#1e1e2e")
          .font_family(MONO)
          .text_size(12)
          .text_color("#cdd6f4"),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .py(2)
          .gap(4)
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
                .h(38)
                .px(8)
                .items_center()
                .justify_between()
                .cursor_pointer()
                .bg(isSel ? "#313244" : on ? "#1e1e2e" : "#00000000")
                .border_1()
                .border_color(isSel ? "#89b4fa" : on ? "#45475a" : "#00000000")
                .hover((st) => st.bg("#313244"))
                .on_click(() => {
                  run("space.select", { id: s.id });
                  closeOverlay(props()?.overlay);
                })
                .child(
                  h_flex()
                    .gap(8)
                    .items_center()
                    .child(
                      h_flex()
                        .h(20)
                        .px(6)
                        .bg("#11111b")
                        .border_1()
                        .border_color(isSel ? "#89b4fa" : "#313244")
                        .items_center()
                        .justify_center()
                        .child(
                          div()
                            .text_size(10.5)
                            .font_bold()
                            .text_color("#89b4fa")
                            .child(`F${i + 1}`),
                        ),
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
                                .text_size(12)
                                .font_bold()
                                .text_color("#cdd6f4")
                                .child(s.name ?? "unnamed"),
                            )
                            .when(on, (ch) =>
                              ch.child(
                                div()
                                  .px(4)
                                  .py(0.5)
                                  .text_size(9)
                                  .font_bold()
                                  .bg("#89b4fa26")
                                  .text_color("#89b4fa")
                                  .child("CURRENT"),
                              ),
                            ),
                        )
                        .child(
                          div()
                            .text_size(10)
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
                              .text_size(10.5)
                              .text_color("#a6adc8")
                              .child(`${crew.length} ABOARD`),
                          ),
                      ),
                    )
                    .child(
                      h_flex()
                        .h(18)
                        .px(5)
                        .bg("#11111b")
                        .border_1()
                        .border_color("#313244")
                        .items_center()
                        .child(
                          div()
                            .text_size(9.5)
                            .font_family(MONO)
                            .text_color("#a6adc8")
                            .child(`ALT+${i + 1}`),
                        ),
                    ),
                );
            }),
          ),
      )
      .child(
        h_flex()
          .justify_between()
          .text_size(10)
          .text_color("#6c7086")
          .child("CTRL+P TO CYCLE · 1–9 TO JUMP")
          .child("ESC TO CLOSE"),
      );
  }
}
