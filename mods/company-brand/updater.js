import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, readTextFile, writeTextFile, shared, setShared, notify, openOverlay, closeOverlay, props, run } from "herdr";

const PIXEL_HQ_FILES = [
  "layouts/pixel-hq.json",
  "themes/pixel-hq.json",
  "mods/company-brand/main.js",
  "mods/company-brand/mod.json",
  "mods/company-brand/search.svg",
  "mods/company-brand/sidebar.svg",
  "mods/company-brand/sparkles.svg",
  "mods/company-brand/updater.js",
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
  "mods/company-agents/agy-quota.py",
  "mods/company-agents/codex-vitals.py",
  "mods/company-agents/opencode-hp/server.ts",
  "mods/company-agents/opencode-hp/tui.tsx",
  "mods/company-agents/updater.js",
  "mods/company-agents/mod.json",
  "mods/company-agents/version.json",
  "mods/company-agents/main.js",
];

export function isUrgentUpdate(type) {
  const t = String(type ?? "").toLowerCase().trim();
  return t === "critical" || t === "urgent" || t === "important" || t === "hotfix" || t === "1" || t === "major";
}

export async function checkPixelHqUpdate(notifyUser = true) {
  try {
    let mine = null;
    try {
      mine = JSON.parse(await readTextFile(`${appHome()}/mods/company-agents/version.json`));
    } catch {
      mine = { version: "1.0.0" };
    }
    let latest = null;
    try {
      const commitRes = await fetch("https://api.github.com/repos/bnhan2710/pixel-hq/commits/main").catch(() => null);
      if (commitRes && commitRes.ok) {
        const commitData = await commitRes.json().catch(() => null);
        const sha = commitData?.sha;
        if (sha) {
          const rawShaRes = await fetch(`https://raw.githubusercontent.com/bnhan2710/pixel-hq/${sha}/mods/company-agents/version.json`);
          if (rawShaRes.ok) latest = await rawShaRes.json().catch(() => null);
        }
      }
    } catch {}

    if (!latest?.version) {
      const res = await fetch(`https://raw.githubusercontent.com/bnhan2710/pixel-hq/main/mods/company-agents/version.json?t=${Date.now()}`);
      if (!res.ok) return null;
      latest = await res.json().catch(() => null);
    }
    if (!latest?.version) return null;

    const num = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
    const [a, b] = [num(latest.version), num(mine?.version)];
    const newer = [0, 1, 2].map((i) => (a[i] ?? 0) - (b[i] ?? 0)).find((d) => d !== 0) > 0;
    if (!newer) {
      setShared("pixel-hq.new-version", null);
      return null;
    }

    const curVer = mine?.version ? String(mine.version) : "";
    const newVer = String(latest.version);
    const versionLabel = curVer && curVer !== newVer ? `v${curVer} → v${newVer}` : `v${newVer}`;
    const urgent = isUrgentUpdate(latest.type);
    const upd = {
      version: newVer,
      currentVersion: curVer,
      versionLabel,
      type: latest.type ? String(latest.type) : (urgent ? "urgent" : "normal"),
      isUrgent: urgent,
      notes: latest.notes ? String(latest.notes) : "",
    };
    setShared("pixel-hq.new-version", upd);

    const dismissed = shared("pixel-hq.dismissed-version");
    if (notifyUser && dismissed !== upd.version) {
      if (urgent) {
        notify({
          title: `⚠️ Urgent Pixel HQ update: ${versionLabel}`,
          body: upd.notes ? `${upd.notes} · Click to update now` : `Critical update ${versionLabel} is out · Click to update now`,
          level: "warning",
          timeout: 30000,
          action: { name: "company-brand.update" },
        });
      } else {
        notify({
          title: "Pixel HQ update available",
          body: `Version ${versionLabel} is out · Click to update`,
          level: "info",
          timeout: 10000,
          action: { name: "company-brand.update" },
        });
      }
    }
    return upd;
  } catch {
    return null;
  }
}

export async function openUpdateModal() {
  const upd = shared("pixel-hq.new-version");
  let mine = null;
  try {
    mine = JSON.parse(await readTextFile(`${appHome()}/mods/company-agents/version.json`));
  } catch {}
  openOverlay({
    mod: "company-brand",
    kind: "popup",
    width: 460,
    height: 270,
    props: {
      updateModal: true,
      version: upd?.version ?? "latest",
      currentVersion: mine?.version ?? "",
      versionLabel: upd?.versionLabel ?? "",
      notes: upd?.notes ?? "",
      isUrgent: upd?.isUrgent ?? false,
    },
  });
}

export async function executePixelHqUpdate() {
  await openUpdateModal();
}

export class Updater {
  constructor(cx) {
    const p = props() ?? {};
    this.version = String(p.version ?? "latest");
    this.currentVersion = String(p.currentVersion ?? "");
    this.versionLabel = String(p.versionLabel ?? (this.currentVersion ? `v${this.currentVersion} → v${this.version}` : `v${this.version}`));
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

    let toastId = null;
    try {
      toastId = notify({
        title: `Updating Pixel HQ (${this.versionLabel})...`,
        body: "Downloading and updating files...",
        level: "info",
        timeout: 180000,
      });
    } catch {}

    try {
      let targetSha = "main";
      const treeRes = await fetch("https://api.github.com/repos/bnhan2710/pixel-hq/git/trees/main?recursive=1").catch(() => null);
      let fileList = [];
      if (treeRes && treeRes.ok) {
        const treeData = await treeRes.json().catch(() => null);
        if (treeData?.sha) targetSha = treeData.sha;
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
          if (f.includes("company-brand/main.js")) return 5;
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
        const pct = Math.round(((i + 1) / fileList.length) * 100);
        setShared("pixel-hq.updating", {
          step: i + 1,
          total: fileList.length,
          file: p,
          pct,
          message: this.message,
        });
        cx.notify();

        const url = `https://raw.githubusercontent.com/bnhan2710/pixel-hq/${targetSha}/${p}?t=${Date.now()}`;
        const res = await fetch(url);
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${p}`);
        const content = await res.text();
        if (p === "mods/company-agents/version.json") {
          try {
            const latest = JSON.parse(content).version;
            if (latest) this.version = String(latest);
          } catch {}
        }
        const targetPath = `${appHome()}/${p}`;
        const current = await readTextFile(targetPath).catch(() => null);
        if (current !== content) changed.push({ targetPath, content, current });
      }

      this.message = "Writing updated files...";
      cx.notify();
      for (const f of changed) await writeTextFile(f.targetPath, f.content, f.current);

      setShared("pixel-hq.updated", { version: this.version, at: Date.now() });
      setShared("pixel-hq.new-version", null);
      setShared("pixel-hq.updating", null);

      this.status = "done";
      this.message = changed.length > 0 ? `Successfully updated to v${this.version}!` : `Pixel HQ is already up to date (v${this.version}).`;
      if (this.version) {
        setShared("pixel-hq.dismissed-version", String(this.version));
      }

      if (toastId) {
        try { closeOverlay(toastId); } catch {}
      }
      notify({
        title: "Pixel HQ updated!",
        body: changed.length > 0 ? `Successfully updated to v${this.version}!` : `Pixel HQ is already up to date (v${this.version}).`,
        level: "success",
        timeout: 8000,
      });
    } catch (err) {
      setShared("pixel-hq.updating", null);
      this.status = "error";
      this.error = String(err?.message ?? err);
      this.message = `Update failed: ${this.error}`;
      if (toastId) {
        try { closeOverlay(toastId); } catch {}
      }
      notify({
        title: "Update failed",
        body: this.error,
        level: "error",
        timeout: 8000,
      });
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
              .child(div().font_family(mono).font_bold().text_size(13).text_color(bc).child(`PIXEL HQ UPDATE · ${this.versionLabel || `v${this.version}`}`))
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
            .child(button("upd-retry", "Retry Update", "#89b4fa", "#11111b", (cx) => cx.spawn(async (cx) => this.doAutoUpdate(cx))))
            .child(button("upd-close", "Close", "#181825", "#7f849c", () => closeOverlay(this.overlay))))
          .when(this.status === "done", (el) => el
            .child(button("upd-reload", "Reload Layout", "#a6e3a1", "#11111b", () => {
              closeOverlay(this.overlay);
              run("layout.switch", { name: "pixel-hq" });
            }))
            .child(button("upd-done", "Done", "#313244", "#cdd6f4", () => closeOverlay(this.overlay))))
      );
  }
}
