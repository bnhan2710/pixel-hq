import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, run, shared, setShared, closeOverlay, checking, appHome, exec, window, props, readTextFile, writeTextFile, settings } from "herdr";

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

async function syncSettingsVisibility(disabled) {
  try {
    const home = appHome();
    if (!home) return;
    const path = `${home}/settings.json`;
    const raw = await readTextFile(path).catch(() => null);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    let changed = false;
    if (disabled) {
      if (parsed.musicbox !== false) {
        parsed.musicbox = false;
        changed = true;
      }
    } else {
      if ("musicbox" in parsed) {
        delete parsed.musicbox;
        changed = true;
      }
    }
    if (changed) {
      await writeTextFile(path, JSON.stringify(parsed, null, 2), raw);
    }
  } catch {}
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

function isMusicBoxHidden() {
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

const PRESETS = [
  { id: "somafm-chill", title: "SomaFM Groove Salad", desc: "Ambient & Downtempo", url: "https://ice2.somafm.com/groovesalad-128-mp3", tag: "Direct MP3" },
  { id: "nightwave", title: "Nightwave Plaza", desc: "Vaporwave & City Pop", url: "https://radio.plaza.one/mp3", tag: "Direct MP3" },
  { id: "defcon", title: "SomaFM DEF CON", desc: "Hacker Chiptune & Beats", url: "https://ice1.somafm.com/defcon-128-mp3", tag: "Direct MP3" },
  { id: "dronezone", title: "SomaFM Drone Zone", desc: "Ambient Space & Focus", url: "https://ice6.somafm.com/dronezone-128-mp3", tag: "Direct MP3" },
];

export default class CompanyMusic extends View {
  init(_props, cx) {
    this.error = null;
    this.busy = false;
    this.depStatus = null;
    cx.spawn(async (cx) => {
      await ensureMusicHotkey(cx);
    });
    this.showGuide = false;
    this.guideTab = window()?.platform === "windows" ? "windows" : window()?.platform === "macos" ? "macos" : "linux";
    this.installing = false;
    this.installMsg = null;
    this.installSuccess = null;
    this.history = shared("pixel-hq.music")?.history || [];
    const curMusic = shared("pixel-hq.music");
    if (curMusic?.error && curMusic.status !== "error") {
      setShared("pixel-hq.music", { ...curMusic, error: null });
    }

    this.urlInput = InputState.new({ placeholder: "Paste YouTube, SoundCloud, or direct audio stream URL..." });
    this.urlInput.on("submit", (_e, cx) => this.play(this.urlInput.value(), null, cx));

    this.handle = cx.focus_handle();
    this.handle.focus();
    this.urlInput.focus();

    const setup = shared("pixel-hq.music-setup");
    if (setup?.installing) {
      if (!setup.startedAt || Date.now() - setup.startedAt > 180000) {
        setShared("pixel-hq.music-setup", { installing: false, msg: null });
      } else {
        this.installing = true;
        this.installMsg = setup.msg;
      }
    }

    if (checking()) return;

    cx.timer.after(150, () => this.urlInput.focus());
    this.checkDeps(cx);
    this.loadHistory(cx);
    this.syncStatus(cx);

    cx.timer.every(1000, (cx) => {
      const music = shared("pixel-hq.music");
      if (music?.playing) cx.notify();
    });

    cx.timer.every(2000, (cx) => {
      const music = shared("pixel-hq.music");
      if (music?.status !== "buffering" && !music?.playing) return;
      this.syncStatus(cx);
    });
  }

  async syncStatus(cx) {
    const res = await runPlayer(["status"], 15000);
    if (!res) return;
    if (Array.isArray(res.history)) {
      this.history = res.history;
    }
    if (res.status === "playing" || res.status === "error" || res.status === "idle") {
      this.busy = false;
    }
    setShared("pixel-hq.music", res);
    if (cx) cx.notify();
  }

  async checkDeps(cx) {
    const res = await runPlayer(["check"], 4000);
    if (!res) return;
    this.depStatus = res;
    this.showGuide = !res.has_player;
    if (res.has_player) {
      this.installing = false;
      this.installMsg = null;
      setShared("pixel-hq.music-setup", { installing: false, msg: null });
    }
    if (cx) cx.notify();
  }

  async loadHistory(cx) {
    const res = await runPlayer(["history"], 4000);
    if (Array.isArray(res?.history)) {
      this.history = res.history;
      if (cx) cx.notify();
    }
  }

  async clearHistory(cx) {
    this.history = [];
    const cur = shared("pixel-hq.music") || {};
    setShared("pixel-hq.music", { ...cur, history: [] });
    if (cx) cx.notify();
    await runPlayer(["clear-history"], 4000);
  }

  async openTerminal(targetOs, cx) {
    const detectedPlatform = window()?.platform || (this.depStatus?.platform === "win32" ? "windows" : this.depStatus?.platform === "darwin" ? "macos" : "linux");
    if (targetOs !== detectedPlatform) {
      this.installMsg = `Cannot open ${targetOs} terminal on ${detectedPlatform}. Switch to ${detectedPlatform} tab.`;
      if (cx) cx.notify();
      return;
    }

    this.installMsg = "Opened terminal window. Run the command and click Re-check!";
    if (cx) cx.notify();

    if (targetOs === "windows") {
      await exec("powershell", ["-NoProfile", "-Command", "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'winget install Gyan.FFmpeg yt-dlp.yt-dlp'"]).catch(() => {
        exec("cmd.exe", ["/c", "start", "powershell", "-NoExit", "-Command", "winget install Gyan.FFmpeg yt-dlp.yt-dlp"]).catch(() => null);
      });
    } else if (targetOs === "macos") {
      await exec("osascript", ["-e", 'tell application "Terminal" to do script "brew install ffmpeg yt-dlp"']).catch(() => null);
    } else if (targetOs === "linux") {
      await exec("sh", ["-c", 'x-terminal-emulator -e "sudo apt-get install -y ffmpeg yt-dlp" || gnome-terminal -- bash -c "sudo apt-get install -y ffmpeg yt-dlp; exec bash" || xterm -e "sudo apt-get install -y ffmpeg yt-dlp"']).catch(() => null);
    }
  }

  async installYtDlpOnly(cx) {
    if (this.installing) return;
    this.installing = true;
    this.installMsg = "Installing yt-dlp via pip (~3s)...";
    this.installSuccess = null;
    setShared("pixel-hq.music-setup", {
      installing: true,
      msg: this.installMsg,
      startedAt: Date.now()
    });
    if (cx) cx.notify();

    const isWin = window()?.platform === "windows" || this.depStatus?.platform === "win32";
    const isMac = window()?.platform === "macos" || this.depStatus?.platform === "darwin";

    let ok = false;
    const pyCandidates = isWin ? ["python", "python3", "py"] : ["python3", "python"];
    for (const py of pyCandidates) {
      this.installMsg = `Running ${py} -m pip install yt-dlp...`;
      if (cx) cx.notify();
      const r = await exec(py, ["-m", "pip", "install", "--upgrade", "yt-dlp"], { timeout: 45000 }).catch(() => null);
      if (r?.code === 0) {
        ok = true;
        break;
      }
    }

    if (!ok) {
      const pipCandidates = isWin ? ["pip", "pip3"] : ["pip3", "pip"];
      for (const pip of pipCandidates) {
        this.installMsg = `Running ${pip} install yt-dlp...`;
        if (cx) cx.notify();
        const r = await exec(pip, ["install", "--upgrade", "yt-dlp"], { timeout: 45000 }).catch(() => null);
        if (r?.code === 0) {
          ok = true;
          break;
        }
      }
    }

    if (!ok && isMac) {
      this.installMsg = "Running brew install yt-dlp...";
      if (cx) cx.notify();
      const r = await exec("brew", ["install", "yt-dlp"], { timeout: 90000 }).catch(() => null);
      if (r?.code === 0) ok = true;
    } else if (!ok && isWin) {
      this.installMsg = "Running winget install yt-dlp...";
      if (cx) cx.notify();
      const r = await exec("winget", ["install", "yt-dlp.yt-dlp", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { timeout: 90000 }).catch(() => null);
      if (r?.code === 0) ok = true;
    }

    this.installMsg = "Verifying yt-dlp installation...";
    if (cx) cx.notify();
    await this.checkDeps(cx);

    this.installing = false;
    setShared("pixel-hq.music-setup", { installing: false, msg: null });

    if (this.depStatus?.has_ytdlp) {
      this.error = null;
      this.installSuccess = "yt-dlp installed successfully! Starting playback...";
      if (cx) cx.notify();
      const val = this.urlInput.value()?.trim();
      if (val) {
        cx.timer.after(600, () => this.play(val, null, cx));
      }
      cx.timer.after(4000, () => {
        this.installSuccess = null;
        if (cx) cx.notify();
      });
    } else {
      this.error = "Could not install yt-dlp automatically. Click Open Terminal below to install manually.";
      if (cx) cx.notify();
    }
  }

  async runAutoInstall(targetOs, cx) {
    if (this.installing) return;

    const detectedPlatform = window()?.platform || (this.depStatus?.platform === "win32" ? "windows" : this.depStatus?.platform === "darwin" ? "macos" : "linux");
    if (targetOs !== detectedPlatform) {
      this.installMsg = `Cannot run ${targetOs} package manager on ${detectedPlatform}. Switch to ${detectedPlatform} tab.`;
      if (cx) cx.notify();
      return;
    }

    this.installing = true;
    this.installMsg = "Installing dependencies... Please wait";
    setShared("pixel-hq.music-setup", {
      installing: true,
      msg: this.installMsg,
      targetOs,
      startedAt: Date.now()
    });
    if (cx) cx.notify();

    if (targetOs === "windows") {
      try {
        if (!this.depStatus?.has_player) {
          this.installMsg = "Installing FFmpeg (audio engine)... Please wait";
          if (cx) cx.notify();
          await exec("winget", ["install", "Gyan.FFmpeg", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { timeout: 180000 }).catch(() => null);
        }
        if (!this.depStatus?.has_ytdlp) {
          this.installMsg = "Installing yt-dlp via pip...";
          if (cx) cx.notify();
          let ytdlpOk = false;
          const pyCandidates = ["python", "python3", "py"];
          for (const py of pyCandidates) {
            const r = await exec(py, ["-m", "pip", "install", "--upgrade", "yt-dlp"], { timeout: 45000 }).catch(() => null);
            if (r?.code === 0) { ytdlpOk = true; break; }
          }
          if (!ytdlpOk) {
            await exec("winget", ["install", "yt-dlp.yt-dlp", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { timeout: 90000 }).catch(() => null);
          }
        }
        this.installMsg = "Installation completed! Verifying dependencies...";
        await this.checkDeps(cx);
      } catch {
        this.installMsg = "Installation failed. Please use Open Terminal.";
      }
    } else if (targetOs === "macos") {
      try {
        if (!this.depStatus?.has_player) {
          this.installMsg = "Installing ffmpeg via Homebrew...";
          if (cx) cx.notify();
          await exec("brew", ["install", "ffmpeg"], { timeout: 180000 }).catch(() => null);
        }
        if (!this.depStatus?.has_ytdlp) {
          this.installMsg = "Installing yt-dlp via pip...";
          if (cx) cx.notify();
          const r = await exec("python3", ["-m", "pip", "install", "--upgrade", "yt-dlp"], { timeout: 45000 }).catch(() => null);
          if (r?.code !== 0) {
            await exec("brew", ["install", "yt-dlp"], { timeout: 90000 }).catch(() => null);
          }
        }
        this.installMsg = "Installation completed! Verifying dependencies...";
        await this.checkDeps(cx);
      } catch {
        this.installMsg = "Brew failed. Please use Open Terminal.";
      }
    } else if (targetOs === "linux") {
      try {
        if (!this.depStatus?.has_player) {
          this.installMsg = "Installing ffmpeg...";
          if (cx) cx.notify();
          await exec("sh", ["-c", "which apt-get && sudo apt-get update && sudo apt-get install -y ffmpeg || sudo dnf install -y ffmpeg || sudo pacman -S --noconfirm ffmpeg"], { timeout: 180000 }).catch(() => null);
        }
        if (!this.depStatus?.has_ytdlp) {
          this.installMsg = "Installing yt-dlp via pip...";
          if (cx) cx.notify();
          const r = await exec("python3", ["-m", "pip", "install", "--upgrade", "yt-dlp"], { timeout: 45000 }).catch(() => null);
          if (r?.code !== 0) {
            await exec("sh", ["-c", "sudo apt-get install -y yt-dlp || sudo dnf install -y yt-dlp || sudo pacman -S --noconfirm yt-dlp"], { timeout: 90000 }).catch(() => null);
          }
        }
        this.installMsg = "Installation completed! Verifying dependencies...";
        await this.checkDeps(cx);
      } catch {
        this.installMsg = "Install failed. Run in Terminal (sudo required).";
      }
    }

    this.installing = false;
    setShared("pixel-hq.music-setup", {
      installing: false,
      msg: this.installMsg
    });
    if (cx) cx.notify();
  }

  async play(url, presetTitle, cx) {
    if (!url || !url.trim() || this.busy) return;
    const cleanUrl = url.trim();
    this.busy = true;
    this.error = null;

    const curMusic = shared("pixel-hq.music") || {};
    const safeTitle = presetTitle ? presetTitle.replace(/["\r\n\\|]/g, " ").trim() : null;
    const isExt = cleanUrl.includes("youtu") || cleanUrl.includes("soundcloud") || cleanUrl.includes("list=");
    const finalTitle = isExt ? null : safeTitle;

    setShared("pixel-hq.music", {
      ...curMusic,
      playing: false,
      status: "buffering",
      title: safeTitle || "Buffering stream...",
      url: cleanUrl,
      error: null,
      history: this.history && this.history.length > 0 ? this.history : (curMusic.history || [])
    });
    cx.notify();

    const args = finalTitle ? ["play", cleanUrl, finalTitle] : ["play", cleanUrl];

    let res = null;
    try {
      res = await runPlayer(args, 35000);

      if (res?.status === "error") {
        this.error = res.error;
        setShared("pixel-hq.music", {
          ...curMusic,
          playing: false,
          status: "error",
          title: "",
          url: cleanUrl,
          error: res.error,
          source: "direct",
          history: this.history && this.history.length > 0 ? this.history : (curMusic.history || [])
        });
        if (res.error.includes("Neither ffplay nor mpv found")) {
          this.showGuide = true;
        }
      } else if (res) {
        this.error = null;
        if (Array.isArray(res.history)) {
          this.history = res.history;
        } else {
          this.loadHistory(cx);
        }
        setShared("pixel-hq.music", {
          ...res,
          history: Array.isArray(res.history) ? res.history : (this.history || curMusic.history || [])
        });
      } else {
        this.error = "Could not start audio player. Verify Python, ffplay or mpv is installed.";
        setShared("pixel-hq.music", {
          ...curMusic,
          playing: false,
          status: "error",
          title: "",
          url: cleanUrl,
          error: this.error,
          source: "direct",
          history: this.history && this.history.length > 0 ? this.history : (curMusic.history || [])
        });
      }
    } finally {
      this.busy = false;
      if (cx) cx.notify();
    }
  }

  async pause(cx) {
    const res = await runPlayer(["pause"], 4000);
    if (res) setShared("pixel-hq.music", res);
    cx.notify();
  }

  async resume(cx) {
    const res = await runPlayer(["resume"], 4000);
    if (res) setShared("pixel-hq.music", res);
    cx.notify();
  }

  async stop(cx) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    try {
      const res = await runPlayer(["stop"], 4000);
      if (res) setShared("pixel-hq.music", res);
      this.error = null;
      if (cx) cx.notify();
    } finally {
      this.actionBusy = false;
    }
  }

  async next(cx) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    try {
      const res = await runPlayer(["next"], 20000);
      if (res) setShared("pixel-hq.music", res);
      if (cx) cx.notify();
    } finally {
      this.actionBusy = false;
    }
  }

  async prev(cx) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    try {
      const res = await runPlayer(["prev"], 20000);
      if (res) setShared("pixel-hq.music", res);
      if (cx) cx.notify();
    } finally {
      this.actionBusy = false;
    }
  }

  renderSetupGuide(t) {
    const isWindows = this.guideTab === "windows";
    const isMac = this.guideTab === "macos";
    const isLinux = this.guideTab === "linux";

    const detectedPlatform = window()?.platform || (this.depStatus?.platform === "win32" ? "windows" : this.depStatus?.platform === "darwin" ? "macos" : "linux");
    const isCurrentOsTab = this.guideTab === detectedPlatform;

    const primaryCmd = isWindows
      ? "winget install Gyan.FFmpeg"
      : isMac
      ? "brew install ffmpeg"
      : "sudo apt install ffmpeg";

    const pmLabel = isWindows ? "winget" : isMac ? "brew" : "apt";

    const setup = shared("pixel-hq.music-setup");
    const isInstalling = Boolean(this.installing || setup?.installing);
    const installMsg = this.installMsg || setup?.msg;

    const copyBtn = (cmd, label) => {
      const isCopied = this.copiedCmd === cmd;
      return h_flex()
        .relative()
        .h(22)
        .px(8)
        .items_center()
        .children(box(isCopied ? "#a6e3a1" : "#45475a", isCopied ? "#a6e3a122" : "#313244", "#11111b"))
        .cursor_pointer()
        .hover((s) => s.text_color("#ffffff"))
        .on_click((_e, cx) => {
          cx.write_to_clipboard(cmd);
          this.copiedCmd = cmd;
          cx.notify();
          cx.timer.after(2000, () => {
            if (this.copiedCmd === cmd) {
              this.copiedCmd = null;
              cx.notify();
            }
          });
        })
        .child(
          div()
            .font_family(MONO)
            .font_bold()
            .text_size(9)
            .text_color(isCopied ? "#a6e3a1" : "#cdd6f4")
            .child(isCopied ? "COPIED" : label || "COPY"),
        );
    };

    const cmdBox = (cmd) =>
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .p(6)
        .bg("#181825")
        .border_1()
        .border_color("#45475a")
        .child(div().font_family(MONO).text_size(11).text_color("#a6e3a1").child(cmd))
        .child(copyBtn(cmd));

    return v_flex()
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          closeOverlay(props()?.overlay);
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
          .p(12)
          .gap(10)
          .font_family(MONO)
          .text_color(t.foreground)
          .child(
            h_flex()
              .w_full()
              .pb(6)
              .border_b(1)
              .border_color("#313244")
              .items_center()
              .justify_between()
              .child(
                h_flex()
                  .gap(8)
                  .items_center()
                  .child(svg("mods/company-status/boombox.svg").size(15))
                  .child(
                    v_flex()
                      .gap(1)
                      .child(div().font_family(MONO).font_bold().text_size(12).text_color("#cdd6f4").child("AUDIO ENGINE SETUP"))
                      .child(div().text_size(9.5).text_color(t.dim).child("FFplay or MPV required for native audio streaming"))
                  )
              )
              .child(
                h_flex()
                  .relative()
                  .h(22)
                  .px(8)
                  .items_center()
                  .cursor_pointer()
                  .children(box("#45475a", "#313244", "#11111b"))
                  .hover((s) => s.text_color("#ffffff"))
                  .on_click(() => closeOverlay(props()?.overlay))
                  .child(
                    div()
                      .text_size(9.5)
                      .font_bold()
                      .font_family(MONO)
                      .text_color("#a6adc8")
                      .child("ESC"),
                  ),
              ),
          )
      .child(
        h_flex()
          .w_full()
          .p(3)
          .bg("#11111b")
          .border_1()
          .border_color("#313244")
          .gap(4)
          .child(
            h_flex()
              .flex_1()
              .h(28)
              .items_center()
              .justify_center()
              .when(isMac, (el) => el.bg("#313244").border_1().border_color("#cba6f7"))
              .cursor_pointer()
              .text_size(11)
              .font_semibold()
              .text_color(isMac ? "#cba6f7" : t.dim)
              .on_click((_e, cx) => {
                this.guideTab = "macos";
                cx.notify();
              })
              .child("macOS (brew)")
          )
          .child(
            h_flex()
              .flex_1()
              .h(28)
              .items_center()
              .justify_center()
              .when(isWindows, (el) => el.bg("#313244").border_1().border_color("#89b4fa"))
              .cursor_pointer()
              .text_size(11)
              .font_semibold()
              .text_color(isWindows ? "#89b4fa" : t.dim)
              .on_click((_e, cx) => {
                this.guideTab = "windows";
                cx.notify();
              })
              .child("Windows (winget)")
          )
          .child(
            h_flex()
              .flex_1()
              .h(28)
              .items_center()
              .justify_center()
              .when(isLinux, (el) => el.bg("#313244").border_1().border_color("#a6e3a1"))
              .cursor_pointer()
              .text_size(11)
              .font_semibold()
              .text_color(isLinux ? "#a6e3a1" : t.dim)
              .on_click((_e, cx) => {
                this.guideTab = "linux";
                cx.notify();
              })
              .child("Linux (apt / dnf)")
          )
      )
      .child(
        v_flex()
          .w_full()
          .flex_1()
          .p(12)
          .bg("#11111b")
          .border_1()
          .border_color("#313244")
          .gap(10)
          .when(isWindows, (el) =>
            el
              .child(
                v_flex()
                  .gap(4)
                  .child(div().font_bold().text_size(11.5).text_color("#89b4fa").child("1. Required: Audio Engine (Direct Streams & Radio)"))
                  .child(div().text_size(10.5).text_color(t.muted).child("Install FFmpeg (includes ffplay) via Windows Package Manager:"))
                  .child(cmdBox("winget install Gyan.FFmpeg"))
                  .child(div().text_size(9.5).text_color(t.dim).child("Or with Chocolatey: choco install ffmpeg · Or Scoop: scoop install ffmpeg"))
              )
              .child(
                v_flex()
                  .gap(4)
                  .child(div().font_bold().text_size(11.5).text_color("#cba6f7").child("2. Optional: Extractor (YouTube & SoundCloud)"))
                  .child(div().text_size(10.5).text_color(t.muted).child("yt-dlp is required only for extracting YouTube and SoundCloud streams:"))
                  .child(cmdBox("winget install yt-dlp"))
              )
          )
          .when(isMac, (el) =>
            el
              .child(
                v_flex()
                  .gap(4)
                  .child(div().font_bold().text_size(11.5).text_color("#cba6f7").child("1. Required: Audio Engine (Direct Streams & Radio)"))
                  .child(div().text_size(10.5).text_color(t.muted).child("Install FFmpeg via Homebrew package manager:"))
                  .child(cmdBox("brew install ffmpeg"))
              )
              .child(
                v_flex()
                  .gap(4)
                  .child(div().font_bold().text_size(11.5).text_color("#89b4fa").child("2. Optional: Extractor (YouTube & SoundCloud)"))
                  .child(div().text_size(10.5).text_color(t.muted).child("Install yt-dlp via Homebrew:"))
                  .child(cmdBox("brew install yt-dlp"))
              )
          )
          .when(isLinux, (el) =>
            el
              .child(
                v_flex()
                  .gap(4)
                  .child(div().font_bold().text_size(11.5).text_color("#a6e3a1").child("1. Required: Audio Engine (Direct Streams & Radio)"))
                  .child(div().text_size(10.5).text_color(t.muted).child("Install FFmpeg via your system package manager:"))
                  .child(cmdBox("sudo apt install ffmpeg"))
                  .child(div().text_size(9.5).text_color(t.dim).child("Fedora: sudo dnf install ffmpeg · Arch: sudo pacman -S ffmpeg"))
              )
              .child(
                v_flex()
                  .gap(4)
                  .child(div().font_bold().text_size(11.5).text_color("#89b4fa").child("2. Optional: Extractor (YouTube & SoundCloud)"))
                  .child(div().text_size(10.5).text_color(t.muted).child("Install yt-dlp via pip or package manager:"))
                  .child(cmdBox("pip install yt-dlp"))
              )
          )
      )
      .child(
        v_flex()
          .w_full()
          .gap(8)
          .when(Boolean(installMsg), (el) =>
            el.child(
              h_flex()
                .w_full()
                .px(10)
                .py(6)
                .bg("#f9e2af22")
                .border_1()
                .border_color("#f9e2af44")
                .gap(6)
                .items_center()
                .child(div().text_size(12).child("⏳"))
                .child(div().text_size(10.5).font_medium().text_color("#f9e2af").truncate().child(installMsg))
            )
          )
          .child(
            h_flex()
              .w_full()
              .items_center()
              .justify_between()
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(
                    div()
                      .h(28)
                      .px(10)
                      .when(isCurrentOsTab, (el) =>
                        el
                          .bg(isInstalling ? "#45475a" : "#89b4fa")
                          .text_color(isInstalling ? "#cdd6f4" : "#11111b")
                          .cursor_pointer()
                          .hover((s) => s.opacity(0.88))
                          .on_click((_e, cx) => this.runAutoInstall(this.guideTab, cx))
                      )
                      .when(!isCurrentOsTab, (el) =>
                        el
                          .bg("#313244")
                          .border_1()
                          .border_color("#45475a")
                          .text_color(t.dim)
                          .tooltip(`Auto-install is only available on ${this.guideTab}`)
                      )
                      .flex()
                      .items_center()
                      .font_bold()
                      .text_size(11)
                      .child(isInstalling ? `⏳ Installing (${pmLabel})...` : `⚡ Auto-Install (${pmLabel})`)
                  )
                  .child(
                    div()
                      .h(28)
                      .px(9)
                      .when(isCurrentOsTab, (el) =>
                        el
                          .bg("#313244")
                          .border_1()
                          .border_color("#45475a")
                          .text_color("#cdd6f4")
                          .cursor_pointer()
                          .hover((s) => s.bg("#45475a"))
                          .on_click((_e, cx) => this.openTerminal(this.guideTab, cx))
                      )
                      .when(!isCurrentOsTab, (el) =>
                        el
                          .bg("#24273a")
                          .border_1()
                          .border_color("#313244")
                          .text_color(t.dim)
                      )
                      .flex()
                      .items_center()
                      .text_size(11)
                      .font_semibold()
                      .child("🖥️ Open Terminal")
                  )
                  .child(
                    div()
                      .h(28)
                      .px(9)
                      .bg("#313244")
                      .border_1()
                      .border_color("#45475a")
                      .cursor_pointer()
                      .flex()
                      .items_center()
                      .text_size(11)
                      .font_semibold()
                      .text_color("#cdd6f4")
                      .hover((s) => s.bg("#45475a"))
                      .on_click((_e, cx) => this.checkDeps(cx))
                      .child("🔄 Re-check")
                  )
              )
              .child(
                div()
                  .cursor_pointer()
                  .px(6)
                  .py(4)
                  .border_1()
                  .border_color("#313244")
                  .text_size(10.5)
                  .font_family(MONO)
                  .text_color(t.dim)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => {
                    this.showGuide = false;
                    cx.notify();
                  })
                  .child("Skip →")
              )
          )
      )
  );
  }

  render() {
    const t = theme();
    if (this.showGuide && (!this.depStatus || !this.depStatus.has_player)) {
      return this.renderSetupGuide(t);
    }

    const music = shared("pixel-hq.music") ?? { playing: false, status: "idle", title: "", url: "" };
    const isPlaying = Boolean(music.playing);
    const isBuffering = music.status === "buffering" || this.busy;
    const isPaused = music.status === "paused";
    const currentTitle = music.title || (isPlaying ? "Audio Stream" : "No stream playing");

    const nowSec = Math.floor(Date.now() / 1000);
    const pauseElapsed = Number(music.elapsed || 0);
    const liveElapsed = isPlaying && music.startTime
      ? pauseElapsed + Math.max(0, nowSec - music.startTime)
      : Number(music.currentElapsed || pauseElapsed);
    const dur = Number(music.duration || 0);
    const percent = dur > 0 ? Math.min(100, Math.max(0, Math.round((liveElapsed / dur) * 100))) : 0;

    const missingPlayer = Boolean(this.depStatus && !this.depStatus.has_player);
    const missingYtDlp = Boolean(this.depStatus && !this.depStatus.has_ytdlp);
    const rawError = this.error || music.error;
    const isStalePlayerError = Boolean(this.depStatus?.has_player && rawError && rawError.includes("Neither ffplay nor mpv"));
    const isStaleYtDlpError = Boolean(this.depStatus?.has_ytdlp && rawError && rawError.includes("yt-dlp"));
    const activeError = (isStalePlayerError || isStaleYtDlpError) ? null : rawError;
    const isMusicHidden = isMusicBoxHidden();

    return v_flex()
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          closeOverlay(props()?.overlay);
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
          .p(12)
          .gap(8)
          .font_family(MONO)
          .text_color(t.foreground)
          .child(
            h_flex()
              .w_full()
              .pb(6)
              .border_b(1)
              .border_color("#313244")
              .items_center()
              .justify_between()
              .child(
                h_flex()
                  .gap(8)
                  .items_center()
                  .child(svg("mods/company-status/boombox.svg").size(15))
                  .child(div().font_family(MONO).font_bold().text_size(12).text_color("#89b4fa").child("PIXEL MUSICBOX"))
                  .child(
                    div()
                      .px(5)
                      .py(1)
                      .bg("#313244")
                      .border_1()
                      .border_color("#45475a")
                      .text_size(9)
                      .font_family(MONO)
                      .text_color("#a6adc8")
                      .child("AUDIO ONLY")
                  )
                  .when(missingPlayer, (el) =>
                    el.child(
                      div()
                        .px(5)
                        .py(1)
                        .bg("#f38ba833")
                        .border_1()
                        .border_color("#f38ba866")
                        .text_size(9)
                        .font_family(MONO)
                        .text_color("#f38ba8")
                        .cursor_pointer()
                        .hover((s) => s.bg("#f38ba855"))
                        .on_click((_e, cx) => {
                          this.showGuide = true;
                          cx.notify();
                        })
                        .child("⚠️ SETUP GUIDE")
                    )
                  )
              )
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(
                    div()
                      .id("btn-toggle-status-bar")
                      .cursor_pointer()
                      .px(6)
                      .py(2)
                      .border_1()
                      .border_color("#45475a")
                      .text_size(9.5)
                      .font_family(MONO)
                      .font_bold()
                      .bg(isMusicHidden ? "#45475a" : "#313244")
                      .text_color(isMusicHidden ? "#f9e2af" : t.dim)
                      .hover((s) => s.bg(t.hover).text_color(t.foreground))
                      .tooltip(isMusicHidden ? "Show on status bar" : "Hide MusicBox from status bar")
                      .on_click((_e, cx) => {
                        const nextVal = !isMusicBoxHidden();
                        try {
                          if (nextVal) {
                            localStorage.setItem("pixel-hq.musicbox.hidden", "true");
                          } else {
                            localStorage.removeItem("pixel-hq.musicbox.hidden");
                          }
                        } catch {}
                        setShared("pixel-hq.musicbox.hidden", nextVal);
                        cx.spawn(async () => {
                          await syncSettingsVisibility(nextVal);
                        });
                        cx.notify();
                      })
                      .child(isMusicHidden ? "STATUS: HIDDEN" : "STATUS: SHOWN")
                  )
                  .child(
                    h_flex()
                      .relative()
                      .h(22)
                      .px(8)
                      .pt(2)
                      .pb(4)
                      .items_center()
                      .cursor_pointer()
                      .children(box("#45475a", "#313244", "#11111b"))
                      .hover((s) => s.text_color("#ffffff"))
                      .on_click(() => closeOverlay(props()?.overlay))
                      .child(
                        div()
                          .text_size(9.5)
                          .font_family(MONO)
                          .font_bold()
                          .text_color("#a6adc8")
                          .child("ESC"),
                      ),
                  )
              )
          )
      .when(isMusicHidden, (el) =>
        el.child(
          h_flex()
            .w_full()
            .px(8)
            .py(3)
            .bg("#f9e2af15")
            .border_1()
            .border_color("#f9e2af33")
            .items_center()
            .gap(6)
            .child(div().text_size(10).child("💡"))
            .child(div().text_size(9.5).text_color("#f9e2af").child("MusicBox hidden from status bar. Reopen with Ctrl + Shift + M"))
        )
      )
      .child(
        v_flex()
          .gap(5)
          .w_full()
          .child(
            h_flex()
              .w_full()
              .gap(6)
              .items_center()
              .child(
                div()
                  .flex_1()
                  .h(28)
                  .px(7)
                  .flex()
                  .items_center()
                  .bg("#11111b")
                  .border_1()
                  .border_color("#313244")
                  .child(Input.new(this.urlInput).font_family(MONO).text_size(11).size_full().text_color(t.foreground))
              )
              .child(
                h_flex()
                  .id("btn-play-custom")
                  .relative()
                  .h(28)
                  .px(10)
                  .items_center()
                  .cursor_pointer()
                  .children(box(this.busy ? "#45475a" : "#89b4fa", this.busy ? "#313244" : "#89b4fa", "#11111b"))
                  .hover((s) => s.opacity(0.88))
                  .on_click((_e, cx) => this.play(this.urlInput.value(), null, cx))
                  .child(
                    div()
                      .font_bold()
                      .font_family(MONO)
                      .text_size(10)
                      .text_color(this.busy ? "#cdd6f4" : "#11111b")
                      .child(this.busy ? "STARTING..." : "▶ PLAY"),
                  ),
              )
          )
      )
      .when(Boolean(this.installSuccess), (el) =>
        el.child(
          h_flex()
            .w_full()
            .px(8)
            .py(5)
            .bg("#a6e3a122")
            .border_1()
            .border_color("#a6e3a155")
            .gap(6)
            .items_center()
            .child(div().text_size(10).child("✓"))
            .child(div().font_bold().text_size(10).text_color("#a6e3a1").child(this.installSuccess))
        )
      )
      .when(Boolean(activeError || this.installing), (el) =>
        el.child(
          v_flex()
            .w_full()
            .px(8)
            .py(6)
            .bg(this.installing ? "#f9e2af1a" : "#f38ba822")
            .border_1()
            .border_color(this.installing ? "#f9e2af44" : "#f38ba855")
            .gap(4)
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(div().text_size(10).child(this.installing ? "⏳" : "⚠️"))
                .child(div().font_bold().text_size(10.5).text_color(this.installing ? "#f9e2af" : "#f38ba8").child(this.installing ? "INSTALLING AUDIO EXTRACTOR..." : "AUDIO PLAYER ERROR"))
                .child(div().flex_1())
                .when(Boolean((activeError && activeError.includes("yt-dlp")) || this.installing), (headEl) =>
                  headEl.child(
                    div()
                      .when(this.installing, (b) =>
                        b
                          .px(6)
                          .py(1)
                          .bg("#313244")
                          .border_1()
                          .border_color("#45475a")
                          .text_size(9.5)
                          .font_bold()
                          .text_color("#f9e2af")
                          .child("INSTALLING...")
                      )
                      .when(!this.installing, (b) =>
                        b
                          .cursor_pointer()
                          .px(6)
                          .py(1)
                          .bg("#89b4fa22")
                          .border_1()
                          .border_color("#89b4fa55")
                          .text_size(9.5)
                          .font_bold()
                          .text_color("#89b4fa")
                          .hover((s) => s.bg("#89b4fa44"))
                          .on_click((_e, cx) => this.installYtDlpOnly(cx))
                          .child("⚡ INSTALL YT-DLP")
                      )
                  )
                )
                .when(missingPlayer && !this.installing, (headEl) =>
                  headEl.child(
                    div()
                      .cursor_pointer()
                      .px(6)
                      .py(1)
                      .bg("#f38ba833")
                      .border_1()
                      .border_color("#f38ba866")
                      .text_size(9.5)
                      .font_bold()
                      .text_color("#f38ba8")
                      .hover((s) => s.bg("#f38ba855"))
                      .on_click((_e, cx) => {
                        this.showGuide = true;
                        cx.notify();
                      })
                      .child("SETUP GUIDE →")
                  )
                )
            )
            .when(this.installing, (bodyEl) =>
              bodyEl.child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(div().text_size(10).text_color("#f9e2af").child(this.installMsg || "Installing yt-dlp via pip (~3s)... Please wait"))
              )
            )
            .when(!this.installing, (bodyEl) =>
              bodyEl.child(div().text_size(10).text_color("#eba0ac").child(activeError || ""))
            )
        )
      )
      .child(
        v_flex()
          .w_full()
          .p(8)
          .bg("#0a0e14")
          .border_1()
          .border_color("#24273a")
          .gap(6)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .justify_between()
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(
                    div()
                      .font_family(MONO)
                      .text_size(10)
                      .font_bold()
                      .text_color("#585b70")
                      .child("(◎) ══════════ (◎)")
                  )
              )
              .child(
                div()
                  .px(6)
                  .py(1)
                  .border_1()
                  .border_color(
                    isPlaying
                      ? "#a6e3a1"
                      : isBuffering
                      ? "#f9e2af"
                      : isPaused
                      ? "#cba6f7"
                      : "#313244"
                  )
                  .text_size(8.5)
                  .font_family(MONO)
                  .font_bold()
                  .bg(
                    isPlaying
                      ? "#a6e3a122"
                      : isBuffering
                      ? "#f9e2af22"
                      : isPaused
                      ? "#cba6f722"
                      : "#181825"
                  )
                  .text_color(
                    isPlaying
                      ? "#a6e3a1"
                      : isBuffering
                      ? "#f9e2af"
                      : isPaused
                      ? "#cba6f7"
                      : "#6c7086"
                  )
                  .child(
                    isPlaying
                      ? "● PLAYING [STEREO]"
                      : isBuffering
                      ? "⏳ BUFFERING..."
                      : isPaused
                      ? "⏸ PAUSED"
                      : "■ STANDBY"
                  )
              )
          )
          .child(
            v_flex()
              .w_full()
              .gap(1)
              .child(div().text_size(8.5).font_bold().font_family(MONO).text_color(isPlaying ? "#a6e3a1" : t.dim).child("AUDIO OUTPUT // DECK A"))
              .child(div().font_bold().font_family(MONO).text_size(11.5).text_color(isPlaying ? "#a6e3a1" : "#cdd6f4").truncate().child(currentTitle))
          )
          .child(
            v_flex()
              .w_full()
              .gap(4)
              .child(
                div()
                  .w_full()
                  .h(6)
                  .bg("#11111b")
                  .border_1()
                  .border_color("#313244")
                  .overflow_hidden()
                  .child(
                    div()
                      .h_full()
                      .bg(isPlaying ? "#a6e3a1" : "#585b70")
                      .w(`${Math.max(2, percent)}%`)
                  )
              )
              .child(
                h_flex()
                  .w_full()
                  .items_center()
                  .justify_between()
                  .child(
                    h_flex()
                      .gap(6)
                      .items_center()
                      .child(
                        div()
                          .text_size(9)
                          .font_family(MONO)
                          .font_bold()
                          .text_color(isPlaying ? "#a6e3a1" : t.dim)
                          .child(
                            dur > 0
                              ? `TAPE TIME: ${formatTime(liveElapsed)} / ${formatTime(dur)}`
                              : `LIVE STREAM: ${formatTime(liveElapsed)}`
                          )
                      )
                  )
                  .child(
                    h_flex()
                      .gap(2)
                      .items_center()
                      .children(
                        [3, 5, 8, 12, 10, 6, 9, 11, 7, 4].map((h, idx) =>
                          div()
                            .w(2)
                            .h(isPlaying ? h : 2)
                            .bg(isPlaying ? (idx > 7 ? "#f38ba8" : idx > 5 ? "#f9e2af" : "#a6e3a1") : "#313244")
                        )
                      )
                  )
              )
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .pt(2)
              .when(isPlaying || isPaused, (el) =>
                el.child(
                  h_flex()
                    .relative()
                    .h(24)
                    .px(8)
                    .items_center()
                    .cursor_pointer()
                    .children(box("#45475a", "#313244", "#11111b"))
                    .hover((s) => s.text_color("#ffffff"))
                    .tooltip("Previous track / station")
                    .on_click((_e, cx) => this.prev(cx))
                    .child(
                      div()
                        .text_size(9.5)
                        .font_family(MONO)
                        .font_bold()
                        .text_color("#cdd6f4")
                        .child("⏮ PREV"),
                    ),
                ),
              )
              .when(isPlaying, (el) =>
                el.child(
                  h_flex()
                    .relative()
                    .h(24)
                    .px(9)
                    .items_center()
                    .cursor_pointer()
                    .children(box("#45475a", "#313244", "#11111b"))
                    .hover((s) => s.text_color("#ffffff"))
                    .on_click((_e, cx) => this.pause(cx))
                    .child(
                      div()
                        .text_size(9.5)
                        .font_family(MONO)
                        .font_bold()
                        .text_color("#cdd6f4")
                        .child("⏸ PAUSE"),
                    ),
                ),
              )
              .when(isPaused, (el) =>
                el.child(
                  h_flex()
                    .relative()
                    .h(24)
                    .px(9)
                    .items_center()
                    .cursor_pointer()
                    .children(box("#a6e3a1", "#a6e3a122", "#11111b"))
                    .hover((s) => s.text_color("#ffffff"))
                    .on_click((_e, cx) => this.resume(cx))
                    .child(
                      div()
                        .text_size(9.5)
                        .font_family(MONO)
                        .font_bold()
                        .text_color("#a6e3a1")
                        .child("▶ RESUME"),
                    ),
                ),
              )
              .when(isPlaying || isPaused || isBuffering, (el) =>
                el.child(
                  h_flex()
                    .relative()
                    .h(24)
                    .px(9)
                    .items_center()
                    .cursor_pointer()
                    .children(box("#f38ba8", "#f38ba822", "#11111b"))
                    .hover((s) => s.text_color("#ffffff"))
                    .on_click((_e, cx) => this.stop(cx))
                    .child(
                      div()
                        .text_size(9.5)
                        .font_family(MONO)
                        .font_bold()
                        .text_color("#f38ba8")
                        .child("⏹ STOP"),
                    ),
                ),
              )
              .when(isPlaying || isPaused, (el) =>
                el.child(
                  h_flex()
                    .relative()
                    .h(24)
                    .px(8)
                    .items_center()
                    .cursor_pointer()
                    .children(box("#45475a", "#313244", "#11111b"))
                    .hover((s) => s.text_color("#ffffff"))
                    .tooltip("Next track / station")
                    .on_click((_e, cx) => this.next(cx))
                    .child(
                      div()
                        .text_size(9.5)
                        .font_family(MONO)
                        .font_bold()
                        .text_color("#cdd6f4")
                        .child("⏭ NEXT"),
                    ),
                ),
              )
          )
      )
      .when(Boolean(this.history && this.history.length > 0), (el) =>
        el.child(
          v_flex()
            .gap(4)
            .w_full()
            .child(
              h_flex()
                .w_full()
                .items_center()
                .justify_between()
                .child(
                  div()
                    .font_family(MONO)
                    .text_size(9.5)
                    .font_bold()
                    .text_color(t.dim)
                    .child(`RECENTLY PLAYED (${this.history.length})`)
                )
                .child(
                  div()
                    .cursor_pointer()
                    .px(5)
                    .py(1)
                    .bg("#313244")
                    .border_1()
                    .border_color("#45475a")
                    .text_size(9)
                    .font_family(MONO)
                    .font_bold()
                    .text_color("#a6adc8")
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => this.clearHistory(cx))
                    .child("× CLEAR")
                )
            )
            .child(
              v_flex()
                .w_full()
                .gap(3)
                .max_h(120)
                .overflow_y_scrollbar()
                .children(
                  this.history.map((h) => {
                    const active = music.url === h.url;
                    const isMedia = h.url.includes("youtube.com") || h.url.includes("youtu.be") || h.url.includes("soundcloud.com");
                    const icon = isMedia ? "🎬" : "📻";
                    const badgeText = h.url.includes("soundcloud") ? "SOUNDCLOUD" : isMedia ? "YOUTUBE" : "DIRECT";
                    const badgeColor = isMedia ? "#f38ba8" : "#89b4fa";

                    return h_flex()
                      .id(h.url)
                      .w_full()
                      .h(32)
                      .px(8)
                      .gap(7)
                      .items_center()
                      .justify_between()
                      .bg(active ? "#313244" : "#11111b")
                      .border_1()
                      .border_color(active ? "#89b4fa" : "#313244")
                      .cursor_pointer()
                      .hover((s) => s.border_color("#89b4fa"))
                      .on_click((_e, cx) => {
                        this.urlInput.set_value(h.url);
                        this.play(h.url, isMedia ? null : h.title, cx);
                      })
                      .child(
                        h_flex()
                          .gap(6)
                          .items_center()
                          .min_w(0)
                          .flex_1()
                          .child(
                            div()
                              .px(4)
                              .py(0.5)
                              .bg(`${badgeColor}22`)
                              .border_1()
                              .border_color(`${badgeColor}55`)
                              .text_size(8)
                              .font_family(MONO)
                              .font_bold()
                              .text_color(badgeColor)
                              .child(`${icon} ${badgeText}`)
                          )
                          .child(
                            v_flex()
                              .gap(1)
                              .min_w(0)
                              .flex_1()
                              .child(
                                div()
                                  .font_bold()
                                  .text_size(10.5)
                                  .text_color(active ? "#89b4fa" : t.foreground)
                                  .truncate()
                                  .child(h.title || h.url)
                              )
                              .child(
                                div()
                                  .text_size(8.5)
                                  .font_family(MONO)
                                  .text_color(t.dim)
                                  .truncate()
                                  .child(h.url)
                              )
                          )
                      )
                      .child(
                        div()
                          .px(5)
                          .py(1)
                          .bg(active && isPlaying ? "#a6e3a122" : "#181825")
                          .border_1()
                          .border_color(active && isPlaying ? "#a6e3a1" : "#313244")
                          .text_size(8.5)
                          .font_family(MONO)
                          .font_bold()
                          .text_color(active && isPlaying ? "#a6e3a1" : "#cdd6f4")
                          .child(active && isPlaying ? "● PLAYING" : "▶ PLAY")
                      );
                  })
                )
            )
        )
      )
      .child(
        v_flex()
          .gap(5)
          .w_full()
          .child(
            h_flex()
              .w_full()
              .items_center()
              .justify_between()
              .child(
                div()
                  .font_family(MONO)
                  .text_size(9.5)
                  .font_bold()
                  .text_color("#89b4fa")
                  .child("■ SYNTHESIZER SOUND BANKS // DIRECT STREAM ■")
              )
          )
          .children(
            PRESETS.map((p, idx) => {
              const active = music.url === p.url;
              return h_flex()
                .id(p.id)
                .w_full()
                .h(32)
                .px(8)
                .gap(8)
                .items_center()
                .justify_between()
                .bg(active ? "#313244" : "#11111b")
                .border_1()
                .border_color(active ? "#89b4fa" : "#313244")
                .cursor_pointer()
                .hover((s) => s.border_color(active ? "#89b4fa" : "#585b70"))
                .on_click((_e, cx) => this.play(p.url, p.title, cx))
                .child(
                  h_flex()
                    .gap(8)
                    .items_center()
                    .min_w(0)
                    .child(
                      div()
                        .px(4)
                        .py(1)
                        .bg(active ? "#89b4fa33" : "#181825")
                        .border_1()
                        .border_color(active ? "#89b4fa" : "#45475a")
                        .font_family(MONO)
                        .font_bold()
                        .text_size(8.5)
                        .text_color(active ? "#89b4fa" : "#a6adc8")
                        .child(`0${idx + 1}`)
                    )
                    .when(active, (el) => el.child(div().font_family(MONO).font_bold().text_size(10).text_color("#89b4fa").child("▶")))
                    .child(div().font_bold().font_family(MONO).text_size(10.5).text_color(active ? "#89b4fa" : t.foreground).truncate().child(p.title))
                    .child(div().text_size(9).font_family(MONO).text_color(t.dim).child(`· ${p.desc}`))
                )
                .child(
                  div()
                    .px(6)
                    .py(1.5)
                    .bg(active ? "#89b4fa22" : "#181825")
                    .border_1()
                    .border_color(active ? "#89b4fa" : "#313244")
                    .text_size(8.5)
                    .font_family(MONO)
                    .font_bold()
                    .text_color(active ? "#89b4fa" : "#6c7086")
                    .child(active && isPlaying ? "● ON AIR" : p.tag)
                );
            })
          )
      )
  );
  }
}
