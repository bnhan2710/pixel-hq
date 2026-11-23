import { appHome, readTextFile, writeTextFile, shared, setShared, notify } from "herdr";

const PIXEL_HQ_FILES = [
  "layouts/pixel-hq.json",
  "themes/pixel-hq.json",
  "mods/company-brand/main.js",
  "mods/company-brand/mod.json",
  "mods/company-brand/search.svg",
  "mods/company-brand/sidebar.svg",
  "mods/company-brand/keyboard.svg",
  "mods/company-switcher/main.js",
  "mods/company-switcher/mod.json",
  "mods/company-hotkeys/main.js",
  "mods/company-hotkeys/mod.json",
  "mods/company-music/main.js",
  "mods/company-music/mod.json",
  "mods/company-music/player.py",
  "mods/company-pane/close.svg",
  "mods/company-pane/duck.js",
  "mods/company-pane/main.js",
  "mods/company-pane/mod.json",
  "mods/company-pane/split-down.svg",
  "mods/company-pane/split-right.svg",
  "mods/company-pane/unzoom.svg",
  "mods/company-pane/zoom.svg",
  "mods/company-tabs/main.js",
  "mods/company-tabs/mod.json",
  "mods/company-toast/main.js",
  "mods/company-toast/mod.json",
  "mods/company-spaces/main.js",
  "mods/company-spaces/mod.json",
  "mods/company-status/main.js",
  "mods/company-status/mod.json",
  "mods/company-agents/animate.js",
  "mods/company-agents/claude-statusline.sh",
  "mods/company-agents/claude-activity.py",
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
  "mods/company-agents/hermes-status/__init__.py",
  "mods/company-agents/hermes-status/plugin.yaml",
  "mods/company-agents/hermes-setup.sh",
  "mods/company-agents/hermes-announce.sh",
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
      const commitRes = await fetch("https://api.github.com/repos/bnhan2710/pixel-hq/commits/main", {
        headers: { "User-Agent": "Pixel-HQ-Updater" },
      }).catch(() => null);
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
          action: { name: "company-agents.update" },
        });
      } else {
        notify({
          title: "Pixel HQ update available",
          body: `Version ${versionLabel} is out · Click to update`,
          level: "info",
          timeout: 10000,
          action: { name: "company-agents.update" },
        });
      }
    }
    return upd;
  } catch {
    return null;
  }
}

let updating = false;

export async function executePixelHqUpdate() {
  if (updating) return;
  updating = true;
  setShared("pixel-hq.updating", true);
  notify({
    title: "Updating Pixel HQ...",
    body: "Downloading release files from GitHub...",
    level: "info",
    timeout: 5000,
  });

  try {
    let targetSha = "main";
    const treeRes = await fetch("https://api.github.com/repos/bnhan2710/pixel-hq/git/trees/main?recursive=1", {
      headers: { "User-Agent": "Pixel-HQ-Updater" },
    }).catch(() => null);
    let fileList = [];
    if (treeRes && treeRes.ok) {
      const treeData = await treeRes.json().catch(() => null);
      if (treeData?.sha) targetSha = treeData.sha;
      if (Array.isArray(treeData?.tree)) {
        fileList = treeData.tree
          .filter((f) => f.type === "blob" && (f.path.startsWith("layouts/") || f.path.startsWith("mods/") || f.path.startsWith("themes/")) && !f.path.endsWith("README.md") && !f.path.endsWith(".png") && !f.path.includes("company-brand/updater.js") && !f.path.includes("company-brand/sparkles.svg"))
          .map((f) => f.path);
      }
    }
    if (!fileList.length) {
      fileList = PIXEL_HQ_FILES.filter((f) => !f.endsWith(".png") && !f.includes("company-brand/updater.js") && !f.includes("company-brand/sparkles.svg"));
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

    const changed = [];
    let newVersion = "latest";

    for (const p of fileList) {
      const url = `https://raw.githubusercontent.com/bnhan2710/pixel-hq/${targetSha}/${p}?t=${Date.now()}`;
      const res = await fetch(url);
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${p}`);
      const content = await res.text();
      if (p === "mods/company-agents/version.json") {
        try { newVersion = JSON.parse(content).version; } catch {}
      }
      const targetPath = `${appHome()}/${p}`;
      const current = await readTextFile(targetPath).catch(() => null);
      if (current !== content) changed.push({ targetPath, content, current });
    }

    for (const f of changed) await writeTextFile(f.targetPath, f.content, f.current);

    setShared("pixel-hq.updated", { version: newVersion, at: Date.now() });
    setShared("pixel-hq.new-version", null);
    setShared("pixel-hq.dismissed-version", String(newVersion));
    setShared("pixel-hq.updating", null);

    notify({
      title: "Pixel HQ updated!",
      body: changed.length > 0 ? `Successfully updated to v${newVersion}!` : `Pixel HQ is already up to date (v${newVersion}).`,
      level: "success",
      timeout: 8000,
    });
  } catch (err) {
    setShared("pixel-hq.updating", null);
    notify({
      title: "Update failed",
      body: String(err?.message ?? err),
      level: "error",
      timeout: 8000,
    });
  } finally {
    updating = false;
  }
}
