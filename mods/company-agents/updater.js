import { appHome, readTextFile, writeTextFile, shared, setShared, notify } from "herdr";

const REPO_API = "https://api.github.com/repos/bnhan2710/pixel-hq";
const REPO_RAW = "https://raw.githubusercontent.com/bnhan2710/pixel-hq";
const LEGACY_VERSION_FILE = "mods/company-agents/version.json";
const LAST_LEGACY_VERSION = "1.8.6";
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
];

async function github(ref) {
  const res = await fetch(`${REPO_API}/${ref}`, {
    headers: { "User-Agent": "Pixel-HQ-Updater" },
  });
  return res.ok ? res.json() : null;
}

function fetchReleaseFile(commit, path) {
  return fetch(`${REPO_RAW}/${commit}/${path}`);
}

function parseRelease(release) {
  const tag = release?.tag_name;
  if (release?.draft || release?.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) return null;
  const body = String(release.body ?? "").trim();
  const marker = body.match(/^\[(\w+)\](?:\s|$)/);
  const urgent = isUrgentUpdate(marker?.[1]);
  return { tag, version: tag.slice(1), notes: urgent ? body.slice(marker[0].length).trim() : body, isUrgent: urgent };
}

async function publishedReleases() {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await github(`releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Could not read Pixel HQ releases from GitHub.");
    releases.push(...batch.map(parseRelease).filter(Boolean));
    if (batch.length < 100) return releases.sort((a, b) => compareVersions(b.version, a.version));
  }
}

function notesForUpgrade(releases, from, to) {
  return releases.filter(({ version }) => compareVersions(version, to) <= 0 && compareVersions(version, from) > 0)
    .map(({ version, notes }) => ({ version, notes }));
}

function compareVersions(left, right) {
  const num = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [num(left), num(right)];
  return [0, 1, 2].map((i) => (a[i] ?? 0) - (b[i] ?? 0)).find((diff) => diff !== 0) ?? 0;
}

function formatTransition(from, to) {
  return from && compareVersions(from, to) < 0 ? `v${from} → v${to}` : `v${to}`;
}

export function getPixelHqChangelog(installed, pending, updated) {
  const target = pending ?? installed;
  if (!target?.version) return null;
  const from = pending ? pending.currentVersion : updated?.version === installed?.version ? updated.previousVersion : null;
  const to = String(target.version);
  const entries = notesForUpgrade(target.releases ?? [{ version: to, notes: target.notes }], from || "0.0.0", to)
    .filter(({ version }) => from || version === to)
    .sort((a, b) => compareVersions(b.version, a.version));
  return { label: formatTransition(from, to), entries };
}

export async function readInstalledRelease() {
  const installed = shared("pixel-hq.updated");
  if (installed?.tag) return installed;
  try {
    const legacy = JSON.parse(await readTextFile(`${appHome()}/${LEGACY_VERSION_FILE}`));
    if (legacy?.migrationTag) {
      const pending = shared("pixel-hq.new-version");
      const version = pending?.currentVersion && compareVersions(pending.currentVersion, legacy.version) < 0
        ? pending.currentVersion : legacy.previousVersion || LAST_LEGACY_VERSION;
      return { version, migrationTag: legacy.migrationTag };
    }
    if (legacy?.version) return legacy;
  } catch {}
  return { version: LAST_LEGACY_VERSION };
}

function hasLegacyInstallInProgress(installed) {
  return Boolean(installed.migrationTag && (shared("pixel-hq.updating") === true ||
    shared("pixel-hq.updated")?.version === installed.migrationTag.slice(1)));
}

export function isUrgentUpdate(type) {
  const t = String(type ?? "").toLowerCase().trim();
  return t === "critical" || t === "urgent" || t === "important" || t === "hotfix" || t === "1" || t === "major";
}

export async function checkPixelHqUpdate(notifyUser = true) {
  try {
    const releases = await publishedReleases();
    if (shared("pixel-hq.updating")?.expiresAt > Date.now()) return null;
    const mine = await readInstalledRelease();
    const latest = releases[0];
    if (!latest || compareVersions(latest.version, LAST_LEGACY_VERSION) <= 0 || compareVersions(latest.version, mine.version) <= 0) {
      setShared("pixel-hq.new-version", null);
      return null;
    }

    const versionLabel = formatTransition(mine.version, latest.version);
    const upd = {
      ...latest,
      currentVersion: mine.version,
      versionLabel,
      releases: notesForUpgrade(releases, mine.version, latest.version),
    };
    setShared("pixel-hq.new-version", upd);

    if (notifyUser && hasLegacyInstallInProgress(mine)) {
      await executePixelHqUpdate();
      return upd;
    }
    const dismissed = shared("pixel-hq.dismissed-version");
    if (notifyUser && (mine.migrationTag || dismissed !== upd.version)) {
      if (upd.isUrgent) {
        notify({
          title: `⚠️ Urgent Pixel HQ update: ${versionLabel}`,
          body: `Critical update ${versionLabel} is out · Click to update now`,
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
  const tree = await github(`git/trees/${ref}?recursive=1`).catch(() => null);
  const files = !tree?.truncated && Array.isArray(tree?.tree) ? tree.tree
    .filter((file) => file.type === "blob" && /^(layouts|mods|themes)\//.test(file.path) &&
      file.path !== LEGACY_VERSION_FILE && !file.path.endsWith("README.md") && !file.path.endsWith(".png"))
    .map((file) => file.path) : [];
  const listed = files.includes("mods/company-agents/main.js");
  const paths = listed ? files : PIXEL_HQ_FILES;
  const changed = [];

  for (let index = 0; index < paths.length; index += 8) {
    if (!active()) throw new Error("The update expired. Try again.");
    const batch = paths.slice(index, index + 8);
    const results = await Promise.all(batch.map(async (path) => {
      const res = await fetchReleaseFile(ref, path);
      if (res.status === 404 && !listed && path !== "mods/company-agents/main.js") return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${path}`);
      const content = await res.text();
      const target = `${appHome()}/${path}`;
      const current = await readTextFile(target).catch(() => null);
      return current === content ? null : { path, target, content, current };
    }));
    changed.push(...results.filter(Boolean));
  }

  const order = ({ path }) => {
    if (path === "mods/company-agents/main.js") return 3;
    if (path.startsWith("mods/company-agents/")) return 2;
    if (path === "layouts/pixel-hq.json") return 1;
    return 0;
  };
  changed.sort((a, b) => order(a) - order(b));
  return changed;
}

function completeUpdate(release, previousVersion, changed) {
  const { version } = release;
  setShared("pixel-hq.updated", { ...release, previousVersion, at: Date.now() });
  setShared("pixel-hq.new-version", null);
  setShared("pixel-hq.dismissed-version", version);
  setShared("pixel-hq.updating", null);
  notify({
    title: "Pixel HQ updated!",
    body: changed ? `Successfully updated to v${version}!` : `Pixel HQ is now registered as v${version}.`,
    level: "success",
    timeout: 8000,
    action: { name: "company-agents.changelog" },
  });
}

let runningUpdate;

export async function restorePixelHqUpdate(cx) {
  const update = shared("pixel-hq.updating");
  if (update === true && hasLegacyInstallInProgress(await readInstalledRelease())) {
    await executePixelHqUpdate(cx);
    return;
  }
  if (update === true || (update?.expiresAt && update.expiresAt <= Date.now())) {
    setShared("pixel-hq.updating", null);
    return;
  }
  if (!update?.installing || runningUpdate === update.id) return;
  await executePixelHqUpdate(cx, update);
}

export async function executePixelHqUpdate(cx, interrupted) {
  const pending = shared("pixel-hq.updating");
  if (pending?.expiresAt > Date.now() && pending.id !== interrupted?.id) return;
  const update = { id: `${Date.now()}-${Math.random()}`, expiresAt: interrupted?.expiresAt ?? Date.now() + UPDATE_TIMEOUT };
  runningUpdate = update.id;
  let timer;

  try {
    setShared("pixel-hq.updating", interrupted ? { ...interrupted, ...update } : update);
    if (!interrupted) notify({
      title: "Updating Pixel HQ...",
      body: "Downloading release files from GitHub...",
      level: "info",
      timeout: 5000,
    });

    const deadline = new Promise((_, reject) => {
      timer = cx?.timer.after(Math.max(0, update.expiresAt - Date.now()), () => reject(new Error("The update timed out. Try again.")));
    });
    const active = () => shared("pixel-hq.updating")?.id === update.id && Date.now() < update.expiresAt;
    const installed = await Promise.race([readInstalledRelease(), deadline]);
    const previousVersion = interrupted?.previousVersion ?? installed.version;
    const releases = interrupted?.release ? null : await Promise.race([publishedReleases(), deadline]);
    const advertised = shared("pixel-hq.new-version")?.tag;
    const target = interrupted?.release ?? (advertised ? releases.find(({ tag }) => tag === advertised) : releases[0]);
    if (!target || compareVersions(target.version, LAST_LEGACY_VERSION) <= 0) throw new Error("No published Pixel HQ release is available.");
    if (compareVersions(target.version, installed.version) <= 0) {
      setShared("pixel-hq.new-version", null);
      return;
    }
    const release = interrupted?.release ?? {
      ...target,
      releases: notesForUpgrade(releases, previousVersion, target.version),
    };
    const ref = interrupted?.ref ?? (await Promise.race([github(`commits/refs/tags/${release.tag}`), deadline]))?.sha;
    if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error(`Could not resolve release tag ${release.tag}.`);
    const changed = await Promise.race([prepareUpdate(ref, active), deadline]);
    const installing = { ...update, ref, release, previousVersion, installing: true };
    if (changed.length && active()) setShared("pixel-hq.updating", installing);
    for (const file of changed) {
      if (!active()) return;
      await Promise.race([writeTextFile(file.target, file.content, file.current), deadline]);
    }
    if (active()) completeUpdate(release, previousVersion, changed.length > 0);
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
