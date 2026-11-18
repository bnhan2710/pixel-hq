import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, run, shared, setShared, closeOverlay, checking, appHome, exec, window, props } from "herdr";

const MONO = "JetBrains Mono, Menlo, monospace";

const PRESETS = [
  { id: "somafm-chill", title: "SomaFM Groove Salad", desc: "Ambient & Downtempo", url: "https://ice2.somafm.com/groovesalad-128-mp3", tag: "Direct MP3" },
  { id: "nightwave", title: "Nightwave Plaza", desc: "Vaporwave & City Pop", url: "https://stream.plaza.one/mp3", tag: "Direct MP3" },
  { id: "defcon", title: "SomaFM DEF CON", desc: "Hacker Chiptune & Beats", url: "https://ice1.somafm.com/defcon-128-mp3", tag: "Direct MP3" },
  { id: "dronezone", title: "SomaFM Drone Zone", desc: "Ambient Space & Focus", url: "https://ice6.somafm.com/dronezone-128-mp3", tag: "Direct MP3" },
];

export default class CompanyMusic extends View {
  init(_props, cx) {
    this.error = null;
    this.busy = false;
    this.depStatus = null;
    this.showGuide = false;
    this.guideTab = window()?.platform === "windows" ? "windows" : window()?.platform === "macos" ? "macos" : "linux";
    this.installing = false;
    this.installMsg = null;

    this.urlInput = InputState.new({ placeholder: "Paste YouTube, SoundCloud, or direct audio stream URL..." });
    this.urlInput.on("submit", (_e, cx) => this.play(this.urlInput.value(), null, cx));

    this.handle = cx.focus_handle();
    this.handle.focus();
    this.urlInput.focus();

    const setup = shared("pixel-hq.music-setup");
    if (setup?.installing && (!setup.startedAt || Date.now() - setup.startedAt > 180000)) {
      setShared("pixel-hq.music-setup", { installing: false, msg: null });
    }

    if (checking()) return;

    cx.timer.after(150, () => this.urlInput.focus());
    this.checkDeps(cx);

    cx.timer.every(1500, async (cx) => {
      const music = shared("pixel-hq.music");
      if (music?.status !== "buffering") return;
      const script = `${appHome()}/mods/company-music/player.py`;
      const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
      for (const bin of candidates) {
        const r = await exec(bin, [script, "status"], { timeout: 2500 }).catch(() => null);
        if (!r?.stdout) continue;
        try {
          const res = JSON.parse(r.stdout.trim().split("\n").pop());
          if (res.status === "playing" || res.status === "error") {
            this.busy = false;
            setShared("pixel-hq.music", res);
            cx.notify();
          }
          break;
        } catch {}
      }
    });
  }

  async checkDeps(cx) {
    const script = `${appHome()}/mods/company-music/player.py`;
    const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
    for (const bin of candidates) {
      const r = await exec(bin, [script, "check"], { timeout: 4000 }).catch(() => null);
      if (!r?.stdout) continue;
      try {
        const res = JSON.parse(r.stdout.trim().split("\n").pop());
        this.depStatus = res;
        this.showGuide = !res.has_player;
        if (res.has_player) {
          this.installing = false;
          this.installMsg = null;
          setShared("pixel-hq.music-setup", { installing: false, msg: null });
        }
        if (cx) cx.notify();
        break;
      } catch {}
    }
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

  async runAutoInstall(targetOs, cx) {
    if (this.installing) return;

    const detectedPlatform = window()?.platform || (this.depStatus?.platform === "win32" ? "windows" : this.depStatus?.platform === "darwin" ? "macos" : "linux");
    if (targetOs !== detectedPlatform) {
      this.installMsg = `Cannot run ${targetOs} package manager on ${detectedPlatform}. Switch to ${detectedPlatform} tab.`;
      cx.notify();
      return;
    }

    this.installing = true;
    this.installMsg = `Installing full dependencies (${targetOs === "windows" ? "FFmpeg + yt-dlp" : "ffmpeg + yt-dlp"})... Please wait`;
    setShared("pixel-hq.music-setup", {
      installing: true,
      msg: this.installMsg,
      targetOs,
      startedAt: Date.now()
    });
    cx.notify();

    if (targetOs === "windows") {
      try {
        if (!this.depStatus?.has_player) {
          this.installMsg = "Installing FFmpeg (audio engine)... Please wait";
          if (cx) cx.notify();
          await exec("winget", ["install", "Gyan.FFmpeg", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { timeout: 180000 }).catch(() => null);
        }
        if (!this.depStatus?.has_ytdlp) {
          this.installMsg = "Installing yt-dlp (YouTube extractor)... Please wait";
          if (cx) cx.notify();
          await exec("winget", ["install", "yt-dlp.yt-dlp", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { timeout: 180000 }).catch(async () => {
            const pyCandidates = ["python", "python3", "py"];
            for (const py of pyCandidates) {
              const r = await exec(py, ["-m", "pip", "install", "yt-dlp"], { timeout: 180000 }).catch(() => null);
              if (r?.code === 0) break;
            }
          });
        }
        this.installMsg = "Installation completed! Verifying dependencies...";
        await this.checkDeps(cx);
      } catch {
        this.installMsg = "Installation failed. Please use Open Terminal.";
      }
    } else if (targetOs === "macos") {
      try {
        this.installMsg = "Installing ffmpeg and yt-dlp via Homebrew...";
        if (cx) cx.notify();
        await exec("brew", ["install", "ffmpeg", "yt-dlp"], { timeout: 180000 }).catch(() => null);
        await this.checkDeps(cx);
      } catch {
        this.installMsg = "Brew failed. Please use Open Terminal.";
      }
    } else if (targetOs === "linux") {
      try {
        this.installMsg = "Installing ffmpeg and yt-dlp...";
        if (cx) cx.notify();
        await exec("sh", ["-c", "which apt-get && sudo apt-get update && sudo apt-get install -y ffmpeg yt-dlp || sudo dnf install -y ffmpeg yt-dlp || sudo pacman -S --noconfirm ffmpeg yt-dlp || python3 -m pip install yt-dlp"], { timeout: 180000 }).catch(() => null);
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
    cx.notify();
  }

  async play(url, presetTitle, cx) {
    if (!url || !url.trim() || this.busy) return;
    const cleanUrl = url.trim();
    this.busy = true;
    this.error = null;

    setShared("pixel-hq.music", {
      playing: false,
      status: "buffering",
      title: presetTitle || "Buffering stream...",
      url: cleanUrl,
      source: "direct"
    });
    cx.notify();

    const script = `${appHome()}/mods/company-music/player.py`;
    const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
    const args = presetTitle ? [script, "play", cleanUrl, presetTitle] : [script, "play", cleanUrl];

    let res = null;
    for (const bin of candidates) {
      const r = await exec(bin, args, { timeout: 35000 }).catch(() => null);
      if (!r?.stdout) continue;
      try {
        res = JSON.parse(r.stdout.trim().split("\n").pop());
        break;
      } catch {}
    }

    this.busy = false;
    if (res?.status === "error") {
      this.error = res.error;
      setShared("pixel-hq.music", {
        playing: false,
        status: "error",
        title: "",
        url: cleanUrl,
        error: res.error,
        source: "direct"
      });
      if (res.error.includes("Neither ffplay nor mpv found")) {
        this.showGuide = true;
      }
    } else if (res) {
      this.error = null;
      setShared("pixel-hq.music", res);
    } else {
      this.error = "Could not start audio player. Verify Python, ffplay or mpv is installed.";
      setShared("pixel-hq.music", {
        playing: false,
        status: "error",
        title: "",
        url: cleanUrl,
        error: this.error,
        source: "direct"
      });
    }
    cx.notify();
  }

  async pause(cx) {
    const script = `${appHome()}/mods/company-music/player.py`;
    const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
    for (const bin of candidates) {
      const r = await exec(bin, [script, "pause"], { timeout: 4000 }).catch(() => null);
      if (!r?.stdout) continue;
      try {
        const res = JSON.parse(r.stdout.trim().split("\n").pop());
        setShared("pixel-hq.music", res);
        break;
      } catch {}
    }
    cx.notify();
  }

  async resume(cx) {
    const script = `${appHome()}/mods/company-music/player.py`;
    const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
    for (const bin of candidates) {
      const r = await exec(bin, [script, "resume"], { timeout: 4000 }).catch(() => null);
      if (!r?.stdout) continue;
      try {
        const res = JSON.parse(r.stdout.trim().split("\n").pop());
        setShared("pixel-hq.music", res);
        break;
      } catch {}
    }
    cx.notify();
  }

  async stop(cx) {
    const script = `${appHome()}/mods/company-music/player.py`;
    const candidates = window()?.platform === "windows" ? ["python", "python3", "py"] : ["python3", "python"];
    for (const bin of candidates) {
      const r = await exec(bin, [script, "stop"], { timeout: 4000 }).catch(() => null);
      if (!r?.stdout) continue;
      try {
        const res = JSON.parse(r.stdout.trim().split("\n").pop());
        setShared("pixel-hq.music", res);
        break;
      } catch {}
    }
    this.error = null;
    cx.notify();
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
      return div()
        .cursor_pointer()
        .px(8)
        .py(3)
        .rounded(4)
        .bg(isCopied ? "#a6e3a133" : "#313244")
        .border_1()
        .border_color(isCopied ? "#a6e3a1" : "#45475a")
        .text_size(10)
        .font_family(MONO)
        .font_semibold()
        .text_color(isCopied ? "#a6e3a1" : "#cdd6f4")
        .hover((s) => s.bg(isCopied ? "#a6e3a144" : "#45475a"))
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
        .child(isCopied ? "✓ Copied" : label || "Copy");
    };

    const cmdBox = (cmd) =>
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .p(6)
        .rounded(6)
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
      .bg("#181825")
      .border_1()
      .border_color("#45475a")
      .rounded(12)
      .p(16)
      .gap(12)
      .text_color(t.foreground)
      .child(
        h_flex()
          .w_full()
          .items_center()
          .justify_between()
          .child(
            v_flex()
              .gap(2)
              .child(div().font_bold().text_size(14).text_color("#cdd6f4").child("How to Install Audio Player"))
              .child(div().text_size(11).text_color(t.dim).child("FFplay or MPV engine is required to stream audio without a browser"))
          )
          .child(
            div()
              .cursor_pointer()
              .px(7)
              .py(2)
              .rounded(4)
              .text_size(11)
              .font_family(MONO)
              .text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => closeOverlay(props()?.overlay))
              .child("✕ Close")
          )
      )
      .child(
        h_flex()
          .w_full()
          .p(3)
          .rounded(8)
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
              .rounded(6)
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
              .rounded(6)
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
              .rounded(6)
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
          .rounded(8)
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
                .rounded(6)
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
                      .rounded(6)
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
                      .rounded(6)
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
                      .rounded(6)
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
                  .rounded(4)
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
    const missingPlayer = Boolean(this.depStatus && !this.depStatus.has_player);
    const missingYtDlp = Boolean(this.depStatus && !this.depStatus.has_ytdlp);
    const rawError = this.error || music.error;
    const isStalePlayerError = Boolean(this.depStatus?.has_player && rawError && rawError.includes("Neither ffplay nor mpv"));
    const isStaleYtDlpError = Boolean(this.depStatus?.has_ytdlp && rawError && rawError.includes("yt-dlp"));
    const activeError = (isStalePlayerError || isStaleYtDlpError) ? null : rawError;

    return v_flex()
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          closeOverlay(props()?.overlay);
          cx.stop_propagation();
        }
      })
      .size_full()
      .bg("#181825")
      .border_1()
      .border_color("#45475a")
      .rounded(12)
      .p(16)
      .gap(12)
      .text_color(t.foreground)
      .child(
        h_flex()
          .w_full()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(div().font_family(MONO).font_bold().text_size(13).text_color("#89b4fa").child("PIXEL MUSICBOX"))
              .child(
                div()
                  .px(6)
                  .py(1)
                  .rounded(4)
                  .bg("#313244")
                  .text_size(9.5)
                  .font_family(MONO)
                  .text_color("#a6adc8")
                  .child("AUDIO ONLY")
              )
              .when(missingPlayer, (el) =>
                el.child(
                  div()
                    .px(6)
                    .py(1)
                    .rounded(4)
                    .bg("#f38ba833")
                    .border_1()
                    .border_color("#f38ba866")
                    .text_size(9.5)
                    .font_family(MONO)
                    .text_color("#f38ba8")
                    .cursor_pointer()
                    .hover((s) => s.bg("#f38ba855"))
                    .on_click((_e, cx) => {
                      this.showGuide = true;
                      cx.notify();
                    })
                    .child("⚠️ Setup Guide")
                )
              )
          )
          .child(
            div()
              .cursor_pointer()
              .px(7)
              .py(2)
              .rounded(4)
              .text_size(11)
              .font_family(MONO)
              .text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => closeOverlay(props()?.overlay))
              .child("✕ Close")
          )
      )
      .child(
        v_flex()
          .gap(6)
          .w_full()
          .child(
            h_flex()
              .w_full()
              .gap(6)
              .items_center()
              .child(
                div()
                  .flex_1()
                  .h(30)
                  .px(8)
                  .flex()
                  .items_center()
                  .rounded(6)
                  .bg("#11111b")
                  .border_1()
                  .border_color("#313244")
                  .child(Input.new(this.urlInput).font_family(MONO).text_size(11.5).size_full().text_color(t.foreground))
              )
              .child(
                div()
                  .id("btn-play-custom")
                  .h(30)
                  .px(12)
                  .rounded(6)
                  .bg(this.busy ? "#45475a" : "#89b4fa")
                  .cursor_pointer()
                  .flex()
                  .items_center()
                  .font_bold()
                  .text_size(11)
                  .text_color(this.busy ? "#cdd6f4" : "#11111b")
                  .hover((s) => s.opacity(0.88))
                  .on_click((_e, cx) => this.play(this.urlInput.value(), null, cx))
                  .child(this.busy ? "⏳ Starting..." : "▶ Play")
              )
          )
      )
      .when(Boolean(activeError), (el) =>
        el.child(
          v_flex()
            .w_full()
            .px(10)
            .py(8)
            .rounded(6)
            .bg("#f38ba822")
            .border_1()
            .border_color("#f38ba855")
            .gap(4)
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(div().text_size(11).child("⚠️"))
                .child(div().font_bold().text_size(11).text_color("#f38ba8").child("Audio Player Error"))
                .child(div().flex_1())
                .when(Boolean(activeError && activeError.includes("yt-dlp")), (headEl) =>
                  headEl.child(
                    div()
                      .cursor_pointer()
                      .px(6)
                      .py(1)
                      .rounded(3)
                      .bg("#89b4fa22")
                      .border_1()
                      .border_color("#89b4fa55")
                      .text_size(10)
                      .font_semibold()
                      .text_color("#89b4fa")
                      .hover((s) => s.bg("#89b4fa44"))
                      .on_click((_e, cx) => this.runAutoInstall(this.guideTab, cx))
                      .child("⚡ Install yt-dlp")
                  )
                )
                .when(missingPlayer, (headEl) =>
                  headEl.child(
                    div()
                      .cursor_pointer()
                      .px(6)
                      .py(1)
                      .rounded(3)
                      .bg("#f38ba833")
                      .text_size(10)
                      .font_semibold()
                      .text_color("#f38ba8")
                      .hover((s) => s.bg("#f38ba855"))
                      .on_click((_e, cx) => {
                        this.showGuide = true;
                        cx.notify();
                      })
                      .child("View Setup Guide →")
                  )
                )
            )
            .child(div().text_size(10.5).text_color("#eba0ac").child(activeError))
        )
      )
      .child(
        v_flex()
          .w_full()
          .p(10)
          .rounded(8)
          .bg("#11111b")
          .border_1()
          .border_color("#313244")
          .gap(8)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .justify_between()
              .child(
                h_flex()
                  .gap(8)
                  .items_center()
                  .child(div().text_size(14).child("📻"))
                  .child(
                    v_flex()
                      .gap(2)
                      .child(div().text_size(9.5).font_family(MONO).text_color(t.dim).child("NOW PLAYING"))
                      .child(div().font_bold().text_size(12).text_color(t.foreground).truncate().child(currentTitle))
                  )
              )
              .child(
                div()
                  .px(7)
                  .py(2)
                  .rounded(4)
                  .text_size(9.5)
                  .font_family(MONO)
                  .font_bold()
                  .bg(
                    isPlaying
                      ? "#a6e3a133"
                      : isBuffering
                      ? "#f9e2af33"
                      : isPaused
                      ? "#cba6f733"
                      : "#313244"
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
                      ? "● PLAYING"
                      : isBuffering
                      ? "⏳ BUFFERING"
                      : isPaused
                      ? "⏸ PAUSED"
                      : "IDLE"
                  )
              )
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .when(isPlaying, (el) =>
                el.child(
                  div()
                    .h(26)
                    .px(10)
                    .rounded(4)
                    .bg("#313244")
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .text_size(11)
                    .font_family(MONO)
                    .font_semibold()
                    .text_color("#cdd6f4")
                    .hover((s) => s.bg("#45475a"))
                    .on_click((_e, cx) => this.pause(cx))
                    .child("⏸ Pause")
                )
              )
              .when(isPaused, (el) =>
                el.child(
                  div()
                    .h(26)
                    .px(10)
                    .rounded(4)
                    .bg("#89b4fa")
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .text_size(11)
                    .font_family(MONO)
                    .font_bold()
                    .text_color("#11111b")
                    .hover((s) => s.opacity(0.88))
                    .on_click((_e, cx) => this.resume(cx))
                    .child("▶ Resume")
                )
              )
              .when(isPlaying || isPaused || isBuffering, (el) =>
                el.child(
                  div()
                    .h(26)
                    .px(10)
                    .rounded(4)
                    .bg("#f38ba833")
                    .border_1()
                    .border_color("#f38ba866")
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .text_size(11)
                    .font_family(MONO)
                    .font_semibold()
                    .text_color("#f38ba8")
                    .hover((s) => s.bg("#f38ba855"))
                    .on_click((_e, cx) => this.stop(cx))
                    .child("⏹ Stop")
                )
              )
          )
      )
      .child(
        v_flex()
          .gap(4)
          .w_full()
          .child(div().font_family(MONO).text_size(10).font_bold().text_color(t.dim).child("DIRECT STREAM PRESETS (NO YT-DLP NEEDED)"))
          .children(
            PRESETS.map((p) => {
              const active = music.url === p.url;
              return h_flex()
                .id(p.id)
                .w_full()
                .h(32)
                .px(8)
                .gap(8)
                .items_center()
                .justify_between()
                .rounded(6)
                .bg(active ? "#313244" : "#11111b")
                .border_1()
                .border_color(active ? "#89b4fa" : "#313244")
                .cursor_pointer()
                .hover((s) => s.border_color("#89b4fa"))
                .on_click((_e, cx) => this.play(p.url, p.title, cx))
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .min_w(0)
                    .child(div().font_semibold().text_size(11).text_color(active ? "#89b4fa" : t.foreground).truncate().child(p.title))
                    .child(div().text_size(10).text_color(t.dim).child(`· ${p.desc}`))
                )
                .child(
                  div()
                    .px(6)
                    .py(1)
                    .rounded(3)
                    .bg("#181825")
                    .text_size(9)
                    .font_family(MONO)
                    .text_color(active ? "#89b4fa" : "#6c7086")
                    .child(p.tag)
                );
            })
          )
      );
  }
}
