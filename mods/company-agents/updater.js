import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, appHome, readTextFile, writeTextFile, closeOverlay, props, spaces, agents, focused, knownAgents, shared, setShared } from "herdr";
import { agentTaskArgv } from "./crew.js";

const UPDATE_PROMPT = "Read ~/.config/herdr-app/AGENTS.md, then update my Pixel HQ layout to the latest version from github.com/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended; keep my other layouts and mods.";

const PIXEL_HQ_FILES = [
  "layouts/pixel-hq.json",
  "themes/pixel-hq.json",
  "mods/company-brand/main.js",
  "mods/company-brand/mod.json",
  "mods/company-brand/search.svg",
  "mods/company-brand/sidebar.svg",
  "mods/company-pane/close.svg",
  "mods/company-pane/duck.js",
  "mods/company-pane/main.js",
  "mods/company-pane/mod.json",
  "mods/company-pane/split-down.svg",
  "mods/company-pane/split-right.svg",
  "mods/company-pane/unzoom.svg",
  "mods/company-pane/zoom.svg",
  "mods/company-spaces/main.js",
  "mods/company-spaces/mod.json",
  "mods/company-status/main.js",
  "mods/company-status/mod.json",
  "mods/company-agents/animate.js",
  "mods/company-agents/claude-statusline.sh",
  "mods/company-agents/crew.js",
  "mods/company-agents/duck-icon.svg",
  "mods/company-agents/duck.js",
  "mods/company-agents/editor.js",
  "mods/company-agents/figures.js",
  "mods/company-agents/opencode-status.js",
  "mods/company-agents/scene.js",
  "mods/company-agents/sparkles.svg",
  "mods/company-agents/updater.js",
  "mods/company-agents/mod.json",
  "mods/company-agents/version.json",
  "mods/company-agents/main.js",
];

export class Updater {
  constructor(cx) {
    const p = props() ?? {};
    this.version = String(p.version ?? "latest");
    this.notes = String(p.notes ?? "");
    this.overlay = p.overlay;
    this.status = "updating";
    this.step = 0;
    this.total = 0;
    this.message = "Contacting GitHub for release files...";
    this.error = "";
    this.busy = true;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const finished = shared("pixel-hq.updated");
    if (finished && Date.now() - Number(finished.at ?? 0) < 60000) {
      this.version = String(finished.version ?? this.version);
      this.status = "done";
      this.message = `Successfully updated to v${this.version}!`;
      this.busy = false;
      return;
    }
    cx.spawn(async (cx) => this.doAutoUpdate(cx));
  }

  async doAutoUpdate(cx) {
    this.busy = true;
    this.status = "updating";
    this.error = "";
    this.message = "Contacting GitHub for release files...";
    cx.notify();

    try {
      const treeRes = await fetch("https://api.github.com/repos/bnhan2710/pixel-hq/git/trees/main?recursive=1").catch(() => null);
      let fileList = [];
      if (treeRes && treeRes.ok) {
        const treeData = await treeRes.json().catch(() => null);
        if (Array.isArray(treeData?.tree)) {
          fileList = treeData.tree
            .filter((f) => f.type === "blob" && (f.path.startsWith("layouts/") || f.path.startsWith("mods/") || f.path.startsWith("themes/")) && !f.path.endsWith("README.md") && !f.path.endsWith(".png"))
            .map((f) => f.path);
        }
      }
      if (!fileList.length) {
        fileList = PIXEL_HQ_FILES.filter((f) => !f.endsWith(".png"));
      }

      fileList.sort((a, b) => {
        const order = (f) => {
          if (f.includes("company-agents/main.js")) return 4;
          if (f.includes("company-agents/updater.js")) return 3;
          if (f.includes("company-agents/version.json")) return 2;
          if (f.includes("layouts/pixel-hq.json")) return 1;
          return 0;
        };
        return order(a) - order(b) || a.localeCompare(b);
      });

      this.total = fileList.length;
      this.step = 0;
      const changed = [];
      cx.notify();

      for (let i = 0; i < fileList.length; i++) {
        const p = fileList[i];
        this.step = i + 1;
        this.message = `[${i + 1}/${fileList.length}] Downloading ${p}...`;
        cx.notify();

        const url = `https://raw.githubusercontent.com/bnhan2710/pixel-hq/main/${p}?t=${Date.now()}`;
        const res = await fetch(url);
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${p}`);
        const content = await res.text();
        if (p === "mods/company-agents/version.json") {
          const latest = (() => { try { return JSON.parse(content).version; } catch { return null; } })();
          if (latest) this.version = String(latest);
        }
        const targetPath = `${appHome()}/${p}`;
        const current = await readTextFile(targetPath).catch(() => null);
        if (current !== content) changed.push({ targetPath, content, current });
      }

      for (const f of changed) await writeTextFile(f.targetPath, f.content, f.current);
      setShared("pixel-hq.updated", { version: this.version, at: Date.now() });

      this.status = "done";
      this.message = changed.length > 0 ? `Successfully updated to v${this.version}!` : `Pixel HQ is already up to date (v${this.version}).`;
      if (this.version) {
        localStorage.setItem("upd-dismissed", String(this.version));
        setShared("pixel-hq.dismissed-version", String(this.version));
      }
    } catch (err) {
      this.status = "error";
      this.error = String(err?.message ?? err);
      this.message = `Update failed: ${this.error}`;
    } finally {
      this.busy = false;
      cx.notify();
    }
  }

  async doAgentUpdate(cx) {
    this.busy = true;
    this.status = "updating";
    this.error = "";
    this.message = "Discovering installed agent runtime...";
    cx.notify();

    try {
      const sp = spaces().find((x) => x.active);
      const installed = (await knownAgents({ on: sp?.machine ?? undefined }).catch(() => [])).filter((a) => a.installed);
      const here = agents().find((a) => a.address === focused()?.agent);
      const deskKey = String(here?.program?.key ?? "").toLowerCase();
      const matched = installed.find((a) => a.key?.toLowerCase() === deskKey || deskKey.includes(a.key?.toLowerCase()));
      const runningKey = agents().find((a) => a.program?.key)?.program?.key?.toLowerCase();
      const runningMatched = installed.find((a) => a.key?.toLowerCase() === runningKey || runningKey?.includes(a.key?.toLowerCase()));
      const pick = matched ?? runningMatched ?? installed[0];
      const baseArgv = pick?.run ?? (deskKey.includes("codex") ? ["codex"] : deskKey.includes("opencode") ? ["opencode"] : (deskKey.includes("antigravity") || deskKey.includes("agy")) ? ["agy"] : ["claude"]);
      const argv = agentTaskArgv(baseArgv, pick?.key ?? deskKey);
      const folder = sp?.machine ? sp.folder || undefined : appHome();

      this.message = `Launching ${pick?.name || deskKey || "agent"} in terminal tab...`;
      cx.notify();

      run("tab.new", { name: "update Pixel HQ", folder, argv, task: UPDATE_PROMPT, space: sp?.id });

      this.status = "done";
      this.message = `Update session started with ${pick?.name || deskKey || "agent"}! Track progress in the new tab.`;
      if (this.version) {
        localStorage.setItem("upd-dismissed", String(this.version));
        setShared("pixel-hq.dismissed-version", String(this.version));
      }
    } catch (err) {
      this.status = "error";
      this.error = String(err?.message ?? err);
      this.message = `Could not launch terminal tab: ${this.error}`;
    } finally {
      this.busy = false;
      cx.notify();
    }
  }

  render(cx) {
    const mono = "JetBrains Mono";
    const bc = this.status === "error" ? "#ff5370" : this.status === "done" ? "#a6e3a1" : "#89b4fa";
    const pct = this.total > 0 ? Math.min(100, Math.round((this.step * 100) / this.total)) : 0;
    const button = (id, label, bg, fg, onClick) =>
      h_flex()
        .id(id)
        .h(28)
        .px(12)
        .items_center()
        .rounded(6)
        .border_1()
        .border_color(bg)
        .bg(bg)
        .text_color(fg)
        .cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click((_e, cx) => onClick(cx))
        .child(label);

    return v_flex()
      .id("pixel-hq-updater")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) closeOverlay(this.overlay);
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(16)
      .gap(10)
      .rounded(10)
      .bg("#11111b")
      .border_1()
      .border_color(bc)
      .text_size(12)
      .text_color("#cdd6f4")
      .child(
        h_flex().items_center().justify_between()
          .child(
            h_flex().gap(8).items_center()
              .child(image("mods/company-brand/logo.png").size(22).flex_none().rounded(4))
              .child(div().font_family(mono).font_bold().text_size(13).text_color(bc).child(`PIXEL HQ UPDATE · v${this.version}`))
          )
          .when(!this.busy, (el) => el.child(
            div().cursor_pointer().p(4).rounded(4).text_size(14).font_family(mono).text_color("#7f849c").hover((s) => s.text_color("#ffffff"))
              .on_click(() => closeOverlay(this.overlay)).child("✕")
          ))
      )
      .when(Boolean(this.notes), (el) => el.child(
        div().px(10).py(6).rounded(6).bg("#181825").border_1().border_color("#313244").text_size(11).text_color("#a6adc8").child(this.notes)
      ))
      .child(
        v_flex().flex_1().justify_center().gap(8)
          .child(
            div().font_family(mono).text_size(11.5)
              .text_color(this.status === "error" ? "#ff5370" : this.status === "done" ? "#a6e3a1" : "#cdd6f4")
              .child(this.message)
          )
          .when(this.status === "updating" && this.total > 0, (el) => el.child(
            h_flex().items_center().gap(10)
              .child(
                div().flex_1().h(5).rounded(3).bg("#313244")
                  .child(div().h_full().rounded(3).bg("#89b4fa").w(Math.max(4, Math.round((280 * pct) / 100))))
              )
              .child(div().flex_none().text_size(11).font_family(mono).text_color("#7f849c").child(`${pct}%`))
          ))
      )
      .child(
        h_flex().justify_end().gap(8).text_size(11).font_family(mono).font_bold()
          .when(this.status === "error", (el) => el
            .child(button("upd-retry", "Retry Auto-Update", "#89b4fa", "#11111b", (cx) => cx.spawn(async (cx) => this.doAutoUpdate(cx))))
            .child(button("upd-agent", "Use Agent Tab", "#313244", "#cdd6f4", (cx) => cx.spawn(async (cx) => this.doAgentUpdate(cx))))
            .child(button("upd-close", "Close", "#181825", "#7f849c", () => closeOverlay(this.overlay))))
          .when(this.status === "done", (el) => el
            .child(button("upd-reload", "Reload Layout", "#a6e3a1", "#11111b", () => {
              if (this.version) {
                localStorage.setItem("upd-dismissed", String(this.version));
                setShared("pixel-hq.dismissed-version", String(this.version));
              }
              closeOverlay(this.overlay);
              run("layout.switch", { name: "pixel-hq" });
            }))
            .child(button("upd-done", "Done", "#313244", "#cdd6f4", () => {
              if (this.version) {
                localStorage.setItem("upd-dismissed", String(this.version));
                setShared("pixel-hq.dismissed-version", String(this.version));
              }
              closeOverlay(this.overlay);
            })))
          .when(this.status === "updating", (el) => el
            .child(div().text_size(10.5).text_color("#7f849c").child("Please wait while updating files...")))
      );
  }
}
