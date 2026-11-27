import { appHome, readTextFile, writeTextFile, shared, setShared, notify } from "herdr";

const REPO_API = "https://api.github.com/repos/bnhan2710/pixel-hq";
const REPO_RAW = "https://raw.githubusercontent.com/bnhan2710/pixel-hq";
const VERSION_FILE = "mods/company-agents/version.json";
const UPDATE_TIMEOUT = 120000;
const PIXEL_HQ_FILES = [
  "layouts/pixel-hq.json",
  "layouts/pixel-hq.svg",
  "mods/company-agents/agy-quota.py",
  "mods/company-agents/animate.js",
  "mods/company-agents/chevron-down.svg",
  "mods/company-agents/chevron-right.svg",
  "mods/company-agents/claude-activity.py",
  "mods/company-agents/claude-statusline.sh",
  "mods/company-agents/clock.svg",
  "mods/company-agents/codex-vitals.py",
  "mods/company-agents/crew.js",
  "mods/company-agents/duck-icon.svg",
  "mods/company-agents/duck.js",
  "mods/company-agents/editor.js",
  "mods/company-agents/figures.js",
  "mods/company-agents/hermes-announce.sh",
  "mods/company-agents/hermes-setup.sh",
  "mods/company-agents/hermes-status/__init__.py",
  "mods/company-agents/hermes-status/plugin.yaml",
  "mods/company-agents/layers.svg",
  "mods/company-agents/main.js",
  "mods/company-agents/mod.json",
  "mods/company-agents/opencode-hp/server.ts",
  "mods/company-agents/opencode-hp/tui.tsx",
  "mods/company-agents/opencode-status.js",
  "mods/company-agents/pin-off.svg",
  "mods/company-agents/pin.svg",
  "mods/company-agents/pixel-spinner.svg",
  "mods/company-agents/scene.js",
  "mods/company-agents/sparkles.svg",
  "mods/company-agents/updater.js",
  "mods/company-agents/x.svg",
  "mods/company-brand/keyboard.svg",
  "mods/company-brand/main.js",
  "mods/company-brand/mod.json",
  "mods/company-brand/plus.svg",
  "mods/company-brand/search.svg",
  "mods/company-brand/settings.svg",
  "mods/company-brand/sidebar.svg",
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
  "mods/company-spaces/chevron-down.svg",
  "mods/company-spaces/chevron-right.svg",
  "mods/company-spaces/main.js",
  "mods/company-spaces/mod.json",
  "mods/company-spaces/monitor.svg",
  "mods/company-spaces/plus.svg",
  "mods/company-spaces/server.svg",
  "mods/company-status/boombox.svg",
  "mods/company-status/branch.svg",
  "mods/company-status/main.js",
  "mods/company-status/mod.json",
  "mods/company-status/monitor.svg",
  "mods/company-status/server.svg",
  "mods/company-switcher/main.js",
  "mods/company-switcher/mod.json",
  "mods/company-tabs/main.js",
  "mods/company-tabs/mod.json",
  "mods/company-tabs/win-close.svg",
  "mods/company-tabs/win-max.svg",
  "mods/company-tabs/win-min.svg",
  "mods/company-tabs/win-restore.svg",
  "mods/company-toast/main.js",
  "mods/company-toast/mod.json",
  "themes/pixel-hq.json",
  VERSION_FILE,
];

async function github(ref) {
  const res = await fetch(`${REPO_API}/${ref}`, {
    headers: { "User-Agent": "Pixel-HQ-Updater" },
  });
  return res.ok ? res.json() : null;
}

async function fetchReleaseFile(ref, path) {
  return fetch(`${REPO_RAW}/${ref}/${path}${ref === "main" ? `?t=${Date.now()}` : ""}`);
}

export function releaseNotes(release) {
  if (!release?.version) return [];
  return [
    { version: String(release.version), notes: String(release.notes ?? "") },
    ...(Array.isArray(release.history) ? release.history : []),
  ];
}

export async function readInstalledRelease() {
  try {
    return JSON.parse(await readTextFile(`${appHome()}/${VERSION_FILE}`));
  } catch {
    return { version: "1.0.0" };
  }
}

async function latestCommit() {
  return (await github("commits/main").catch(() => null))?.sha || "main";
}

export function isUrgentUpdate(type) {
  const t = String(type ?? "").toLowerCase().trim();
  return t === "critical" || t === "urgent" || t === "important" || t === "hotfix" || t === "1" || t === "major";
}

export async function checkPixelHqUpdate(notifyUser = true) {
  try {
    const ref = await latestCommit();
    let res = await fetchReleaseFile(ref, VERSION_FILE).catch(() => null);
    if (!res?.ok && ref !== "main") res = await fetchReleaseFile("main", VERSION_FILE);
    if (!res?.ok) return null;
    const latest = await res.json();
    if (!latest?.version || shared("pixel-hq.updating")?.expiresAt > Date.now()) return null;
    const mine = await readInstalledRelease();

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
      releases: releaseNotes(latest),
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

async function prepareUpdate(ref, active) {
  const tree = ref === "main" ? null : await github(`git/trees/${ref}?recursive=1`).catch(() => null);
  const files = !tree?.truncated && Array.isArray(tree?.tree) ? tree.tree
    .filter((file) => file.type === "blob" && /^(layouts|mods|themes)\//.test(file.path) &&
      !file.path.endsWith("README.md") && !file.path.endsWith(".png"))
    .map((file) => file.path) : [];
  const listed = files.includes(VERSION_FILE);
  const paths = listed ? files : PIXEL_HQ_FILES;
  const changed = [];
  let release;

  for (let index = 0; index < paths.length; index += 8) {
    if (!active()) throw new Error("The update expired. Try again.");
    const batch = paths.slice(index, index + 8);
    const results = await Promise.all(batch.map(async (path) => {
      const res = await fetchReleaseFile(ref, path);
      if (res.status === 404 && !listed && path !== VERSION_FILE) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${path}`);
      const content = await res.text();
      if (path === VERSION_FILE) release = JSON.parse(content);
      const target = `${appHome()}/${path}`;
      const current = await readTextFile(target).catch(() => null);
      return current === content ? null : { path, target, content, current };
    }));
    changed.push(...results.filter(Boolean));
  }

  if (!release?.version) throw new Error("The release has no version.");
  const order = ({ path }) => {
    if (path === VERSION_FILE) return 4;
    if (path === "mods/company-agents/main.js") return 3;
    if (path.startsWith("mods/company-agents/")) return 2;
    if (path === "layouts/pixel-hq.json") return 1;
    return 0;
  };
  changed.sort((a, b) => order(a) - order(b));
  return { release, changed };
}

function completeUpdate(version, changed) {
  setShared("pixel-hq.updated", { version, at: Date.now() });
  setShared("pixel-hq.new-version", null);
  setShared("pixel-hq.dismissed-version", version);
  setShared("pixel-hq.updating", null);
  notify({
    title: "Pixel HQ updated!",
    body: changed ? `Successfully updated to v${version}!` : `Pixel HQ is already up to date (v${version}).`,
    level: "success",
    timeout: 8000,
    action: { name: "company-agents.changelog" },
  });
}

let runningUpdate;

export async function restorePixelHqUpdate(cx) {
  const update = shared("pixel-hq.updating");
  if (update === true || (update?.expiresAt && update.expiresAt <= Date.now())) {
    setShared("pixel-hq.updating", null);
    return;
  }
  if (!update?.installing || runningUpdate === update.id) return;
  const installed = await readInstalledRelease();
  if (shared("pixel-hq.updating")?.id !== update.id) return;
  if (update.version && installed.version === update.version) {
    completeUpdate(update.version, true);
  } else {
    await executePixelHqUpdate(cx, update);
  }
}

export async function executePixelHqUpdate(cx, interrupted) {
  const pending = shared("pixel-hq.updating");
  if (pending?.expiresAt > Date.now() && pending.id !== interrupted?.id) return;
  const update = { id: `${Date.now()}-${Math.random()}`, expiresAt: interrupted?.expiresAt ?? Date.now() + UPDATE_TIMEOUT };
  runningUpdate = update.id;
  let timer;

  try {
    setShared("pixel-hq.updating", interrupted ? { ...update, ref: interrupted.ref, installing: true } : update);
    if (!interrupted) notify({
      title: "Updating Pixel HQ...",
      body: "Downloading release files from GitHub...",
      level: "info",
      timeout: 5000,
    });

    const deadline = new Promise((_, reject) => {
      timer = cx.timer.after(Math.max(0, update.expiresAt - Date.now()), () => reject(new Error("The update timed out. Try again.")));
    });
    const active = () => shared("pixel-hq.updating")?.id === update.id && Date.now() < update.expiresAt;
    const ref = interrupted?.ref ?? await Promise.race([latestCommit(), deadline]);
    const { release, changed } = await Promise.race([prepareUpdate(ref, active), deadline]);
    const installing = { ...update, ref, installing: true };
    if (changed.length && active()) setShared("pixel-hq.updating", installing);
    for (const file of changed) {
      if (!active()) return;
      if (file.path === VERSION_FILE) setShared("pixel-hq.updating", { ...installing, version: release.version });
      await Promise.race([writeTextFile(file.target, file.content, file.current), deadline]);
    }
    if (active()) completeUpdate(release.version, changed.length > 0);
  } catch (err) {
    if (shared("pixel-hq.updating")?.id === update.id) {
      notify({
        title: "Update failed",
        body: String(err?.message ?? err),
        level: "error",
        timeout: 8000,
      });
    }
  } finally {
    timer?.cancel();
    if (runningUpdate === update.id) runningUpdate = undefined;
    if (shared("pixel-hq.updating")?.id === update.id) setShared("pixel-hq.updating", null);
  }
}
