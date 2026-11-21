import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, keys, appHome, readTextFile } from "herdr";

const MONO = "JetBrains Mono, Menlo, monospace";

const HOTKEY_CATEGORIES = [
  {
    category: "Workspace Floors",
    items: [
      { action: "mod.open:company-switcher", name: "Floor Switcher", desc: "Open floor switcher (hold Ctrl and press P repeatedly to cycle)" },
      { action: "space.next", name: "Next Floor", desc: "Switch to next workspace floor" },
      { action: "space.prev", name: "Previous Floor", desc: "Switch to previous workspace floor" },
      { action: "space.new", name: "New Floor", desc: "Create a new workspace floor" },
      { action: "space.select:1", name: "Jump to Floor 1–9", desc: "Jump directly to floor 1–9", customKeys: ["alt-1 … alt-9"] },
      { action: "space.rename", name: "Rename Floor", desc: "Rename current workspace floor" },
    ],
  },
  {
    category: "Split Panes",
    items: [
      { action: "pane.split:right", name: "Split Right", desc: "Split active pane vertically to the right" },
      { action: "pane.split:down", name: "Split Down", desc: "Split active pane horizontally downward" },
      { action: "pane.close", name: "Close Pane", desc: "Close active workspace pane" },
      { action: "pane.zoom", name: "Toggle Zoom", desc: "Toggle maximize / restore active pane" },
      { action: "layout.switch", name: "Switch Layout", desc: "Switch active display layout" },
      { action: "pane.go:left", name: "Focus Navigation", desc: "Navigate focus between adjacent panes", customKeys: ["alt-h / j / k / l", "alt-left / right"] },
    ],
  },
  {
    category: "Tabs & Terminals",
    items: [
      { action: "tab.new", name: "New Tab", desc: "Open a new terminal tab in active pane" },
      { action: "tab.close", name: "Close Tab", desc: "Close current terminal tab" },
      { action: "tab.next", name: "Next Tab", desc: "Switch to next tab" },
      { action: "tab.prev", name: "Previous Tab", desc: "Switch to previous tab" },
      { action: "tab.select:1", name: "Jump to Tab 1–9", desc: "Jump directly to tab 1–9", customKeys: ["ctrl-1 … ctrl-9"] },
      { action: "tab.rename", name: "Rename Tab", desc: "Rename current terminal tab" },
      { action: "terminal.copy", name: "Copy Selection", desc: "Copy selection from terminal" },
      { action: "terminal.paste", name: "Paste", desc: "Paste clipboard text into terminal" },
      { action: "terminal.search", name: "Search Terminal", desc: "Search scrollback buffer in terminal" },
    ],
  },
  {
    category: "System & Palette",
    items: [
      { action: "app.palette", name: "Command Palette", desc: "Open global command palette" },
      { action: "mod.open:company-music", name: "Pixel MusicBox", desc: "Toggle Pixel MusicBox player", customKeys: ["ctrl-shift-m"] },
      { action: "app.settings", name: "Settings", desc: "Open application settings" },
      { action: "app.help", name: "Help", desc: "Open help and documentation" },
      { action: "layout.toggle:sidebar", name: "Toggle Sidebar", desc: "Toggle left sidebar" },
      { action: "app.zoom_in", name: "Zoom In / Out / Reset", desc: "Adjust UI zoom scale", customKeys: ["ctrl-+", "ctrl--", "ctrl-0"] },
    ],
  },
];

function formatChord(chord) {
  if (!chord) return "";
  return chord
    .split("-")
    .map((p) => {
      p = p.trim().toLowerCase();
      if (p === "ctrl") return "Ctrl";
      if (p === "alt") return "Alt";
      if (p === "shift") return "Shift";
      if (p === "pagedown") return "PgDn";
      if (p === "pageup") return "PgUp";
      if (p === "escape") return "Esc";
      if (p === "enter") return "Enter";
      return p.toUpperCase();
    })
    .join(" + ");
}

export default class CompanyHotkeys extends View {
  init(_props, cx) {
    this.rawKeys = null;
    this.handle = cx.focus_handle();
    this.handle.focus();

    cx.spawn(async (cx) => {
      try {
        const home = appHome();
        const raw = await readTextFile(`${home}/keys.json`).catch(() => null);
        if (raw) {
          this.rawKeys = JSON.parse(raw);
          cx.notify();
        }
      } catch {}
    });
  }

  closeModal() {
    const ov = props()?.overlay;
    if (ov) {
      closeOverlay(ov);
    } else {
      run("overlay.close");
    }
  }

  getBindingsMap() {
    const map = new Map();

    if (this.rawKeys?.global) {
      for (const [chord, act] of Object.entries(this.rawKeys.global)) {
        if (!map.has(act)) map.set(act, []);
        map.get(act).push(chord);
      }
    }

    const allKeys = keys() ?? [];
    for (const k of allKeys) {
      if (k.section === "global") {
        if (!map.has(k.action)) map.set(k.action, []);
        if (!map.get(k.action).includes(k.keys)) {
          map.get(k.action).push(k.keys);
        }
      }
    }

    return map;
  }

  render(cx) {
    const bindingsMap = this.getBindingsMap();

    return v_flex()
      .id("company-hotkeys")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          this.closeModal();
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
                  .child(div().text_size(11).font_bold().text_color("#89b4fa").child("⌨")),
              )
              .child(
                v_flex()
                  .gap(1)
                  .child(
                    h_flex()
                      .gap(8)
                      .items_center()
                      .child(
                        div()
                          .text_size(12)
                          .font_bold()
                          .text_color("#cdd6f4")
                          .child("HOTKEYS REFERENCE"),
                      )
                      .child(
                        h_flex()
                          .px(5)
                          .py(1)
                          .bg("#89b4fa18")
                          .border_1()
                          .border_color("#89b4fa44")
                          .child(
                            div()
                              .text_size(9)
                              .font_bold()
                              .text_color("#89b4fa")
                              .child("READ-ONLY"),
                          ),
                      ),
                  )
                  .child(
                    div()
                      .text_size(10)
                      .text_color("#6c7086")
                      .child("Active system keybindings cheat sheet"),
                  ),
              ),
          )
          .child(
            h_flex()
              .id("btn-esc-hotkeys")
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
              .on_click((_e, _cx) => this.closeModal())
              .child("ESC CLOSE"),
          ),
      )
      .child(
        v_flex()
          .id("hotkeys-scroll-area")
          .flex_1()
          .min_h(0)
          .gap(10)
          .overflow_y_scrollbar()
          .children(
            HOTKEY_CATEGORIES.map((cat, catIdx) =>
              v_flex()
                .id(`hotkey-cat-${catIdx}`)
                .p(8)
                .gap(6)
                .bg("#1e1e2e")
                .border_1()
                .border_color("#313244")
                .child(
                  div()
                    .font_bold()
                    .text_size(11)
                    .text_color("#89b4fa")
                    .child(cat.category.toUpperCase()),
                )
                .child(
                  v_flex()
                    .gap(3)
                    .children(
                      cat.items.map((item, itemIdx) => {
                        const boundChords = item.customKeys ?? bindingsMap.get(item.action) ?? [];

                        return h_flex()
                          .id(`hotkey-row-${catIdx}-${itemIdx}`)
                          .px(6)
                          .py(4)
                          .bg("#181825")
                          .items_center()
                          .justify_between()
                          .hover((s) => s.bg("#1e1e30"))
                          .child(
                            v_flex()
                              .flex_1()
                              .min_w(0)
                              .gap(1)
                              .child(
                                div()
                                  .text_size(11)
                                  .font_bold()
                                  .text_color("#cdd6f4")
                                  .child(item.name),
                              )
                              .child(
                                div()
                                  .text_size(9.5)
                                  .text_color("#6c7086")
                                  .child(item.desc),
                              ),
                          )
                          .child(
                            h_flex()
                              .gap(4)
                              .items_center()
                              .flex_wrap()
                              .children(
                                boundChords.length > 0
                                  ? boundChords.map((chord) =>
                                      h_flex()
                                        .h(20)
                                        .px(6)
                                        .bg("#11111b")
                                        .border_1()
                                        .border_color("#89b4fa44")
                                        .items_center()
                                        .child(
                                          div()
                                            .text_size(10)
                                            .font_bold()
                                            .font_family(MONO)
                                            .text_color("#89b4fa")
                                            .child(formatChord(chord)),
                                        ),
                                    )
                                  : [
                                      div()
                                        .text_size(11)
                                        .text_color("#585b70")
                                        .child("—"),
                                    ],
                              ),
                          );
                      }),
                    ),
                ),
            ),
          ),
      )
      .child(
        h_flex()
          .justify_between()
          .text_size(10)
          .text_color("#6c7086")
          .child("HOLD CTRL + TAP P TO CYCLE FLOORS · ALT+[ / ALT+] SWITCH FLOORS")
          .child("ESC CLOSE"),
      );
  }
}
