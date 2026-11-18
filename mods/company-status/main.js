import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, agents, theme, run, window, keys, setBadge, openOverlay, shared, setShared, appHome, exec, checking } from "herdr";

const MONO = "JetBrains Mono, Menlo, monospace";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${remM.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    if (checking()) return;
    this.polling = false;
    cx.timer.every(1000, (cx) => {
      const music = shared("pixel-hq.music");
      if (music?.playing) cx.notify();
    });
    cx.timer.every(3000, async (cx) => {
      if (this.polling) return;
      const music = shared("pixel-hq.music");
      this.polling = true;
      try {
        const script = `${appHome()}/mods/company-music/player.py`;
        const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
        for (const bin of candidates) {
          const r = await exec(bin, [script, "status"], { timeout: 15000 }).catch(() => null);
          if (!r?.stdout) continue;
          try {
            const res = JSON.parse(r.stdout.trim().split("\n").pop());
            if (res.playing !== music.playing || res.status !== music.status || (res.title && res.title !== music.title) || (res.url && res.url !== music.url)) {
              setShared("pixel-hq.music", res);
              cx.notify();
            }
            break;
          } catch {}
        }
      } finally {
        this.polling = false;
      }
    });
  }

  async musicAction(action, cx) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    if (action === "next" || action === "prev") {
      const cur = shared("pixel-hq.music");
      setShared("pixel-hq.music", {
        ...(cur || {}),
        playing: false,
        status: "buffering",
        title: "Switching station..."
      });
      if (cx) cx.notify();
    }
    try {
      const script = `${appHome()}/mods/company-music/player.py`;
      const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
      for (const bin of candidates) {
        const r = await exec(bin, [script, action], { timeout: 35000 }).catch(() => null);
        if (!r?.stdout) continue;
        try {
          const res = JSON.parse(r.stdout.trim().split("\n").pop());
          setShared("pixel-hq.music", res);
          if (cx) cx.notify();
          break;
        } catch {}
      }
    } finally {
      this.actionBusy = false;
    }
  }

  switcherHint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const all = keys().filter((k) => k.section === "global" && (k.action === "mod.open:company-switcher" || k.action === "mod.open:company-keymap"));
    const b = all.find((k) => k.keys === "ctrl-p" || k.keys === "cmd-p") ?? all[0];
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts ? parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("") : (mac ? "⌘P" : "Ctrl+P");
    return `${key} Switcher`;
  }

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
    const activeTab = (space?.tabs ?? []).find(t => t.active) ?? space?.tabs?.[0];
    const leadPane = panes().find(p => p.tab === activeTab?.id && p.terminal) ?? focused();
    const currentBranch = space?.branch || leadPane?.branch;
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
      .when(Boolean(currentBranch), el => el.child(label("branch", currentBranch)))
      .child(div().text_color(t.dim).child(`${list.length} on the team`))
      .when(Boolean(shared("pixel-hq.updating")), (el) => el.child(
        h_flex().id("update-status-pill").gap(6).items_center().px(7).py(2).rounded(6)
          .bg("#89b4fa").text_color(t.chrome)
          .tooltip("Downloading Pixel HQ update...")
          .child(div().font_bold().text_size(11).child("⏳ Updating Pixel HQ..."))
      ))
      .when(Boolean(!shared("pixel-hq.updating") && shared("pixel-hq.new-version")), (el) => {
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
            .on_click(() => run("company-agents.update"))
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
      .child(
        (() => {
          const m = shared("pixel-hq.music");
          const setup = shared("pixel-hq.music-setup");
          if (setup?.installing) {
            return h_flex()
              .id("btn-music")
              .gap(5)
              .items_center()
              .px(6)
              .py(2)
              .rounded(4)
              .max_w(170)
              .cursor_pointer()
              .bg("#313244")
              .text_color("#f9e2af")
              .tooltip(setup.msg || "Installing audio engine... · Click to view")
              .on_click(() => run("mod.open", { name: "company-music" }))
              .child(div().text_size(10).child("⏳"))
              .child(div().truncate().text_size(11).font_semibold().child("Installing..."));
          }
          const isPlaying = Boolean(m?.playing);
          const isPaused = m?.status === "paused";
          const isBuffering = m?.status === "buffering";
          const title = m?.title || "MusicBox";

          const nowSec = Math.floor(Date.now() / 1000);
          const baseElapsed = Number(m?.elapsed || m?.currentElapsed || 0);
          const liveElapsed = isPlaying && m?.startTime ? baseElapsed + Math.max(0, nowSec - m.startTime) : (m?.currentElapsed || baseElapsed);
          const dur = Number(m?.duration || 0);
          const timeText = dur > 0 ? `${formatTime(liveElapsed)}/${formatTime(dur)}` : formatTime(liveElapsed);
          if (isPlaying || isPaused || isBuffering) {
            const playPauseIcon = isPlaying ? "⏸" : "▶";
            const playPauseTooltip = isPlaying ? "Tạm dừng (Pause)" : "Tiếp tục phát (Resume)";
            return h_flex()
              .id("btn-music-bar")
              .gap(3)
              .items_center()
              .px(5)
              .py(2)
              .rounded(6)
              .bg("#181825")
              .border_1()
              .border_color("#313244")
              .child(
                div()
                  .cursor_pointer()
                  .w(22)
                  .h(20)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .text_size(13.5)
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("Bài trước / Đài trước (Previous)")
                  .on_click((_e, cx) => this.musicAction("prev", cx))
                  .child("⏮")
              )
              .child(
                div()
                  .cursor_pointer()
                  .w(22)
                  .h(20)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .text_size(14)
                  .text_color(isPlaying ? "#a6e3a1" : "#89b4fa")
                  .hover((s) => s.bg(t.hover))
                  .tooltip(playPauseTooltip)
                  .on_click((_e, cx) => this.musicAction(isPlaying ? "pause" : "resume", cx))
                  .child(isBuffering ? "⏳" : playPauseIcon)
              )
              .child(
                div()
                  .cursor_pointer()
                  .w(22)
                  .h(20)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .text_size(13.5)
                  .text_color("#f38ba8")
                  .hover((s) => s.bg(t.hover))
                  .tooltip("Dừng phát (Stop)")
                  .on_click((_e, cx) => this.musicAction("stop", cx))
                  .child("⏹")
              )
              .child(
                div()
                  .cursor_pointer()
                  .w(22)
                  .h(20)
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .text_size(13.5)
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .tooltip("Bài kế tiếp / Đài kế tiếp (Next)")
                  .on_click((_e, cx) => this.musicAction("next", cx))
                  .child("⏭")
              )
              .child(
                h_flex()
                  .cursor_pointer()
                  .items_center()
                  .gap(5)
                  .px(6)
                  .py(2)
                  .rounded(4)
                  .max_w(250)
                  .hover((s) => s.bg(t.hover))
                  .tooltip(`Pixel MusicBox: ${title} (${timeText}) · Mở bảng điều khiển`)
                  .on_click(() => run("mod.open", { name: "company-music" }))
                  .child(div().text_size(12).child("📻"))
                  .child(div().truncate().text_size(11.5).font_semibold().text_color(t.foreground).child(title))
                  .child(
                    div()
                      .text_size(10)
                      .font_family(MONO)
                      .text_color(isPlaying ? "#89b4fa" : t.dim)
                      .child(timeText)
                  )
              );
          }
          return h_flex()
            .id("btn-music")
            .gap(5)
            .items_center()
            .px(6)
            .py(2)
            .rounded(4)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("Open Pixel MusicBox")
            .on_click(() => run("mod.open", { name: "company-music" }))
            .child("📻 MusicBox");
        })()
      )
      .child(
        h_flex()
          .id("btn-switcher")
          .cursor_pointer()
          .px(6)
          .py(2)
          .rounded(4)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Open Floor Switcher")
          .on_click(() => run("mod.open", { name: "company-switcher" }))
          .child(this.switcherHint())
      )
      .child(
        h_flex()
          .id("btn-hotkeys")
          .cursor_pointer()
          .px(6)
          .py(2)
          .rounded(4)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Configure Hotkeys")
          .on_click(() => run("mod.open", { name: "company-hotkeys" }))
          .child("Hotkeys")
      )
      .child(div().id("palette").cursor_pointer().px(6).py(2).rounded(4).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
