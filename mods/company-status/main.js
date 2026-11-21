import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, agents, theme, run, window, keys, setBadge, openOverlay, shared, setShared, appHome, exec, checking, settings, readTextFile, writeTextFile } from "herdr";

const MONO = "JetBrains Mono, Menlo, monospace";

async function ensureMusicHotkey(cx) {
  try {
    if (cx && typeof cx.bind_keys === "function") {
      cx.bind_keys([{ keystroke: "ctrl-shift-m", action: "mod.open:company-music" }]);
    }
  } catch {}
  try {
    const home = appHome();
    if (!home) return;
    const path = `${home}/keys.json`;
    const raw = await readTextFile(path).catch(() => null);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    let changed = false;
    if (parsed.global && parsed.global["ctrl-shift-m"] !== "mod.open:company-music") {
      parsed.global["ctrl-shift-m"] = "mod.open:company-music";
      changed = true;
    }
    if (parsed.terminal && parsed.terminal["ctrl-shift-m"] !== "mod.open:company-music") {
      parsed.terminal["ctrl-shift-m"] = "mod.open:company-music";
      changed = true;
    }
    if (changed) {
      await writeTextFile(path, JSON.stringify(parsed, null, 2), raw);
    }
  } catch {}
}

function hideMusicBox(cx) {
  try { localStorage.setItem("pixel-hq.musicbox.hidden", "true"); } catch {}
  setShared("pixel-hq.musicbox.hidden", true);
  cx.notify();
}

function isMusicBoxDisabled() {
  const sh = shared("pixel-hq.musicbox.hidden");
  if (sh !== undefined && sh !== null) return Boolean(sh);
  try {
    if (localStorage.getItem("pixel-hq.musicbox.hidden") === "true") return true;
  } catch {}
  try {
    const cfg = settings();
    if (cfg?.musicbox === false || cfg?.music?.enabled === false || cfg?.["company-music"]?.enabled === false) return true;
  } catch {}
  return false;
}

let detectedPythonBin = null;

async function getPythonBin() {
  if (detectedPythonBin) return detectedPythonBin;
  const script = `${appHome()}/mods/company-music/player.py`;
  const isWin = window()?.platform === "windows" || appHome().includes(":") || appHome().includes("\\");
  const candidates = isWin ? ["python", "py", "python3"] : ["python3", "python"];
  for (const bin of candidates) {
    const r = await exec(bin, [script, "check"], { timeout: 4000 }).catch(() => null);
    if (r?.stdout && r.stdout.includes('"status"')) {
      detectedPythonBin = bin;
      return bin;
    }
  }
  detectedPythonBin = candidates[0];
  return detectedPythonBin;
}

async function runPlayer(args, timeout = 15000) {
  const bin = await getPythonBin();
  const script = `${appHome()}/mods/company-music/player.py`;
  const r = await exec(bin, [script, ...args], { timeout }).catch(() => null);
  if (!r?.stdout) return null;
  try {
    return JSON.parse(r.stdout.trim().split("\n").pop());
  } catch {
    return null;
  }
}

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

const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];
const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];
// A pixel button: a framed, hard-shadowed chip with mono text.
const chip = (el, t) => el.relative().h(24).pl(9).pr(11).pt(4).pb(6).items_center().cursor_pointer()
  .children(box(t.raised, t.chrome, t.surface)).font_family(MONO).font_bold().text_size(10).text_color(t.muted)
  .hover(s => s.text_color(t.foreground));

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    if (checking()) return;
    this.polling = false;
    cx.spawn(async (cx) => {
      await ensureMusicHotkey(cx);
    });
    let prevDisabled = isMusicBoxDisabled();
    cx.timer.every(500, (cx) => {
      const curDisabled = isMusicBoxDisabled();
      if (curDisabled !== prevDisabled) {
        prevDisabled = curDisabled;
        cx.notify();
        return;
      }
      if (curDisabled) return;
      const music = shared("pixel-hq.music");
      if (music?.playing) cx.notify();
    });
    cx.timer.every(3000, async (cx) => {
      if (this.polling || isMusicBoxDisabled()) return;
      const music = shared("pixel-hq.music");
      this.polling = true;
      try {
        const res = await runPlayer(["status"], 15000);
        if (res) {
          if (
            res.playing !== music?.playing ||
            res.status !== music?.status ||
            (res.title && res.title !== music?.title) ||
            (res.url && res.url !== music?.url) ||
            res.startTime !== music?.startTime ||
            res.pid !== music?.pid
          ) {
            setShared("pixel-hq.music", res);
            cx.notify();
          }
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
      const res = await runPlayer([action], 35000);
      if (res) {
        setShared("pixel-hq.music", res);
        if (cx) cx.notify();
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
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/company-status/${icon}.svg`).size(13)).child(text.toUpperCase());
    const pill = (color, text) => h_flex().gap(6).items_center().child(div().size(6).bg(color)).child(text.toUpperCase());
    return h_flex().size_full().px(14).gap(14).items_center().bg(t.chrome).border_t(1).border_color(t.surface).font_family(MONO).text_size(11).text_color(t.muted)
      .child(div().font_bold().text_size(11).text_color("#b4befe").child("PIXEL HQ"))
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(currentBranch), el => el.child(label("branch", currentBranch)))
      .child(div().text_color(t.dim).child(`${list.length} ON THE TEAM`))
      .when(Boolean(shared("pixel-hq.updating")), (el) => el.child(
        h_flex().id("update-status-pill").gap(6).items_center().px(7).py(2)
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
          h_flex().id("update-status-pill").gap(6).items_center().px(7).py(2)
            .bg(pillBg).text_color(t.chrome).cursor_pointer().hover(s => s.opacity(0.85))
            .tooltip(tooltip)
            .on_click(() => run("company-agents.update"))
            .child(div().font_bold().text_size(11).child(pillText))
        );
      })
      .when(n("working") > 0, el => el.child(pill("#89b4fa", `${n("working")} typing`)))
      .when(n("blocked") > 0, el => el.child(div().id("needs-you-pill").cursor_pointer().px(4).hover(s => s.bg(t.hover))
        .tooltip("Open the needs-you list")
        .on_click(() => openOverlay({ mod: "company-agents", kind: "popup", frame: "none", width: 340, height: Math.min(440, Math.max(150, 52 + n("blocked") * 56)), props: { needsYou: true } }))
        .child(pill(t.blocked ?? "#e8744f", `${n("blocked")} ${n("blocked") === 1 ? "needs" : "need"} you`))))
      .when(n("done") > 0, el => el.child(pill(t.done ?? "#8ec07c", `${n("done")} shipped`)))
      .when(list.length - n("working") - n("blocked") - n("done") > 0, el => el.child(pill(t.dim ?? "#9a8f86", `${list.length - n("working") - n("blocked") - n("done")} on break`)))
      .child(div().flex_1())
      .when(!isMusicBoxDisabled(), (el) =>
        el.child(
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
                
                .max_w(170)
                .cursor_pointer()
                .bg("#313244")
                .text_color("#f9e2af")
                .tooltip(setup.msg || "Installing audio engine... · Click to view")
                .on_click(() => run("mod.open", { name: "company-music" }))
                .on_mouse_down("right", (_e, cx) => {
                  cx.stop_propagation();
                  hideMusicBox(cx);
                })
                .child(div().text_size(10).child("⏳"))
                .child(div().truncate().text_size(11).font_semibold().child("Installing..."));
            }
            const isPlaying = Boolean(m?.playing);
            const isPaused = m?.status === "paused";
            const isBuffering = m?.status === "buffering";
            const title = m?.title || "MusicBox";

            const nowSec = Math.floor(Date.now() / 1000);
            const pauseElapsed = Number(m?.elapsed || 0);
            const liveElapsed = isPlaying && m?.startTime
              ? pauseElapsed + Math.max(0, nowSec - m.startTime)
              : Number(m?.currentElapsed || pauseElapsed);
            const dur = Number(m?.duration || 0);
            const timeText = dur > 0 ? `${formatTime(liveElapsed)}/${formatTime(dur)}` : formatTime(liveElapsed);
            if (isPlaying || isPaused || isBuffering) {
              const playPauseIcon = isPlaying ? "⏸" : "▶";
              const playPauseTooltip = isPlaying ? "Pause" : "Resume";
              return h_flex()
                .id("btn-music-bar")
                .gap(3)
                .items_center()
                .px(5)
                .py(2)
                
                .bg("#181825")
                .border_1()
                .border_color("#313244")
                .on_mouse_down("right", (_e, cx) => {
                  cx.stop_propagation();
                  hideMusicBox(cx);
                })
                .child(
                  div()
                    .cursor_pointer()
                    .w(22)
                    .h(20)
                    .flex()
                    .items_center()
                    .justify_center()
                    
                    .text_size(13.5)
                    .text_color(t.dim)
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .tooltip("Previous track / station")
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
                    
                    .text_size(13.5)
                    .text_color("#f38ba8")
                    .hover((s) => s.bg(t.hover))
                    .tooltip("Stop playback")
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
                    
                    .text_size(13.5)
                    .text_color(t.dim)
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .tooltip("Next track / station")
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
                    
                    .max_w(250)
                    .hover((s) => s.bg(t.hover))
                    .tooltip(`Pixel MusicBox: ${title} (${timeText}) · Open controls · Right-click to hide from status bar`)
                    .on_click(() => run("mod.open", { name: "company-music" }))
                    .child(svg("mods/company-status/boombox.svg").size(14).flex_none())
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
            return chip(h_flex(), t)
              .id("btn-music")
              .tooltip("Open Pixel MusicBox · Right-click to hide from status bar")
              .on_click(() => run("mod.open", { name: "company-music" }))
              .on_mouse_down("right", (_e, cx) => {
                cx.stop_propagation();
                hideMusicBox(cx);
              })
              .child("MUSICBOX");
          })()
        )
      )
      .child(
        chip(h_flex(), t)
          .id("btn-switcher")
          .tooltip("Open Floor Switcher")
          .on_click(() => run("mod.open", { name: "company-switcher" }))
          .child(this.switcherHint().toUpperCase())
      )
      .child(
        chip(h_flex(), t)
          .id("btn-hotkeys")
          .tooltip("Configure Hotkeys")
          .on_click(() => run("mod.open", { name: "company-hotkeys" }))
          .child("HOTKEYS")
      )
      .child(
        chip(h_flex().id("palette"), t)
          .on_click(() => run("app.palette"))
          .child(this.hint(t).replace("  commands", " COMMANDS").replace(/^commands$/, "COMMANDS"))
      );
  }
}
