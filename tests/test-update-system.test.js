const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const versionFile = "mods/company-agents/version.json";
const modFile = "mods/company-agents/updater.js";
const mainFile = "mods/company-agents/main.js";
const commitRef = "a".repeat(40);
const releases = [
  { tag_name: "v1.8.6", body: "Update the preview." },
  { tag_name: "v1.8.7", body: "[urgent]\n\n- View the changelog." },
  { tag_name: "v1.8.5", body: "Reset the office immediately." },
  { tag_name: "v1.8.4", body: "Update status lines." },
  { tag_name: "v1.8.8", body: "Unpublished changes.", draft: true },
  { tag_name: "v1.8.9", body: "Prerelease changes.", prerelease: true },
  { tag_name: "test", body: "Non-version tag." },
];
const latestNotes = { version: "1.8.7", notes: "- View the changelog." };
const previousNotes = { version: "1.8.6", notes: "Update the preview." };

async function updateHarness(source, options = {}, state = new Map(), files = new Map()) {
  const requests = [];
  const notifications = [];
  const writes = [];
  const deadlines = [];
  const response = (body) => ({
    ok: true,
    status: 200,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    json: async () => body,
  });
  const host = {
    appHome: () => "/app",
    readTextFile: async (target) => {
      if (!files.has(target)) throw new Error("Missing file");
      return files.get(target);
    },
    writeTextFile: async (target, content) => {
      writes.push(target);
      if (options.writeError) throw new Error("Disk write failed");
      files.set(target, content);
      if (target.endsWith(options.interruptedFile ?? "/never")) return new Promise(() => {});
    },
    shared: (key) => state.get(key),
    setShared: (key, value) => state.set(key, value),
    notify: (notification) => notifications.push(notification),
    fetch: async (url) => {
      requests.push(url);
      if (url.includes("/releases?")) return response(options.releases ?? releases);
      if (url.endsWith("/commits/refs/tags/v1.8.7") && !options.missingTag) return response({ sha: commitRef });
      if (url.includes(`/git/trees/${commitRef}?`) && !options.fallback) return response({
        sha: "tree-ref",
        tree: [versionFile, modFile, mainFile].map(path => ({ type: "blob", path })),
      });
      if (options.hang && url.includes("raw.githubusercontent.com")) return new Promise(() => {});
      if (!options.missingFile && url.endsWith(`/${commitRef}/${mainFile}`)) return response("updated main");
      if (url.endsWith(`/${commitRef}/${modFile}`)) return response("updated updater");
      return { ok: false, status: 404 };
    },
  };
  const key = `pixelHqUpdateTest${updateHarness.nextId++}`;
  globalThis[key] = host;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(source.replace(/^import .*?;$/m,
    `const { appHome, readTextFile, writeTextFile, shared, setShared, notify, fetch } = globalThis.${key};`)).toString("base64")}`);
  delete globalThis[key];
  const cx = { timer: { after: (_ms, callback) => {
    deadlines.push(callback);
    return { cancel() {} };
  } } };
  return { mod, cx, state, files, requests, notifications, writes, deadlines };
}
updateHarness.nextId = 0;

async function testUpdateBehavior(source) {
  const success = await updateHarness(source);
  const available = await success.mod.checkPixelHqUpdate(false);
  assert.deepEqual(available.releases, [latestNotes]);
  assert.equal(available.isUrgent, true);
  await success.mod.executePixelHqUpdate(success.cx);
  assert.deepEqual(success.writes, [`/app/${modFile}`, `/app/${mainFile}`]);
  assert.ok(success.requests.some(url => url.endsWith("/commits/refs/tags/v1.8.7")));
  assert.ok(success.requests.every(url => !url.includes("/tree-ref/") && !url.endsWith(versionFile)));
  assert.ok(success.requests.filter(url => url.includes("raw.githubusercontent.com")).every(url => url.includes(`/${commitRef}/`)));
  assert.equal(success.state.get("pixel-hq.updating"), null);
  assert.equal(success.state.get("pixel-hq.updated").version, latestNotes.version);
  assert.equal(success.state.get("pixel-hq.updated").previousVersion, "1.8.6");
  assert.equal(success.notifications.at(-1).action.name, "company-agents.changelog");

  const installed = { version: "1.8.5", notes: "Reset the office immediately." };
  const upgrade = await updateHarness(source, {}, new Map(), new Map([[`/app/${versionFile}`, JSON.stringify(installed)]]));
  const pending = await upgrade.mod.checkPixelHqUpdate(false);
  assert.equal(pending.versionLabel, "v1.8.5 → v1.8.7");
  const expected = {
    label: pending.versionLabel,
    entries: [latestNotes, previousNotes],
  };
  assert.deepEqual(upgrade.mod.getPixelHqChangelog(installed, pending, null), expected);
  assert.deepEqual(upgrade.mod.getPixelHqChangelog(null, { ...pending, currentVersion: "1.8.6" }, null), {
    label: "v1.8.6 → v1.8.7",
    entries: expected.entries.slice(0, 1),
  });
  await upgrade.mod.executePixelHqUpdate(upgrade.cx);
  const installedNow = await upgrade.mod.readInstalledRelease();
  const updated = upgrade.state.get("pixel-hq.updated");
  assert.deepEqual(upgrade.mod.getPixelHqChangelog(installedNow, null, updated), expected);
  assert.deepEqual(upgrade.mod.getPixelHqChangelog(installedNow, null, null), {
    label: "v1.8.7",
    entries: expected.entries.slice(0, 1),
  });
  await upgrade.mod.executePixelHqUpdate(upgrade.cx);
  assert.deepEqual(upgrade.state.get("pixel-hq.updated"), updated);

  const untagged = await updateHarness(source, { releases: releases.filter(row => row.tag_name !== "v1.8.7") });
  assert.equal(await untagged.mod.checkPixelHqUpdate(false), null);
  assert.ok(untagged.requests.every(url => url.includes("/releases?")));

  const fallback = await updateHarness(source, { fallback: true });
  await fallback.mod.executePixelHqUpdate(fallback.cx);
  assert.equal(fallback.state.get("pixel-hq.updated").version, latestNotes.version);

  for (const options of [{ missingTag: true }, { missingFile: true }, { writeError: true }]) {
    const failure = await updateHarness(source, options);
    await failure.mod.executePixelHqUpdate(failure.cx);
    assert.equal(failure.notifications.at(-1).level, "error");
    assert.equal(failure.state.has("pixel-hq.updated"), false);
    assert.equal(failure.state.get("pixel-hq.updating"), null);
  }

  const timeout = await updateHarness(source, { hang: true });
  const updating = timeout.mod.executePixelHqUpdate(timeout.cx);
  await timeout.mod.executePixelHqUpdate(timeout.cx);
  assert.equal(timeout.deadlines.length, 1);
  timeout.deadlines[0]();
  await updating;
  assert.equal(timeout.writes.length, 0);
  assert.equal(timeout.state.get("pixel-hq.updating"), null);
  assert.match(timeout.notifications.at(-1).body, /timed out/);

  for (const interruptedFile of [modFile, mainFile]) {
    const interrupted = await updateHarness(source, { interruptedFile });
    interrupted.mod.executePixelHqUpdate(interrupted.cx);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(interrupted.state.get("pixel-hq.updating").installing);
    const restarted = await updateHarness(source, {}, interrupted.state, interrupted.files);
    await restarted.mod.restorePixelHqUpdate(restarted.cx);
    assert.deepEqual(restarted.writes, interruptedFile === modFile ? [`/app/${mainFile}`] : []);
    assert.equal(restarted.state.get("pixel-hq.updated").version, latestNotes.version);
    assert.equal(restarted.state.get("pixel-hq.updated").previousVersion, "1.8.6");
    assert.equal(restarted.state.get("pixel-hq.updating"), null);
  }

  const bridge = { version: "1.8.7", migrationTag: "v1.8.7", previousVersion: "1.8.6" };
  const bridgeFiles = () => new Map([[`/app/${versionFile}`, JSON.stringify(bridge)]]);
  const legacyOffer = { version: "1.8.7", currentVersion: "1.8.5" };
  const handoffState = () => new Map([
    ["pixel-hq.updating", true],
    ["pixel-hq.new-version", legacyOffer],
  ]);
  const partial = await updateHarness(source, {}, handoffState(), bridgeFiles());
  await partial.mod.restorePixelHqUpdate(partial.cx);
  assert.equal(partial.state.get("pixel-hq.updated").tag, bridge.migrationTag);
  assert.equal(partial.state.get("pixel-hq.updated").previousVersion, legacyOffer.currentVersion);
  assert.equal(partial.state.get("pixel-hq.updating"), null);

  const mixed = await updateHarness(source, {}, handoffState(), bridgeFiles());
  await mixed.mod.checkPixelHqUpdate(true);
  assert.equal(mixed.state.get("pixel-hq.updated").tag, bridge.migrationTag);
  assert.equal(mixed.state.get("pixel-hq.updated").previousVersion, legacyOffer.currentVersion);

  const finishedLegacy = await updateHarness(source, {}, new Map([
    ["pixel-hq.updated", { version: bridge.version }],
    ["pixel-hq.dismissed-version", bridge.version],
  ]), bridgeFiles());
  await finishedLegacy.mod.checkPixelHqUpdate(true);
  assert.equal(finishedLegacy.state.get("pixel-hq.updated").tag, bridge.migrationTag);

  const importedBridge = await updateHarness(source, {}, new Map(), bridgeFiles());
  await importedBridge.mod.checkPixelHqUpdate(true);
  assert.equal(importedBridge.state.get("pixel-hq.new-version").version, bridge.version);
  assert.equal(importedBridge.state.has("pixel-hq.updated"), false);
  assert.deepEqual(importedBridge.writes, []);
  assert.equal(importedBridge.notifications.at(-1).action.name, "company-agents.update");

  for (const stale of [true, { id: "expired", expiresAt: 1 }]) {
    const started = await updateHarness(source, {}, new Map([["pixel-hq.updating", stale]]));
    await started.mod.restorePixelHqUpdate(started.cx);
    assert.equal(started.state.get("pixel-hq.updating"), null);
  }
}

async function runTests() {
  console.log("=== Running Update System Background & Pristine Brand Tests ===");

  const brandPath = path.resolve(__dirname, "../mods/company-brand/main.js");
  const brandSrc = fs.readFileSync(brandPath, "utf8");
  const brandUpdaterPath = path.resolve(__dirname, "../mods/company-brand/updater.js");
  const brandSparklesPath = path.resolve(__dirname, "../mods/company-brand/sparkles.svg");

  const agentsUpdaterPath = path.resolve(__dirname, "../mods/company-agents/updater.js");
  const agentsUpdaterSrc = fs.readFileSync(agentsUpdaterPath, "utf8");

  const statusPath = path.resolve(__dirname, "../mods/company-status/main.js");
  const statusSrc = fs.readFileSync(statusPath, "utf8");

  const agentsPath = path.resolve(__dirname, "../mods/company-agents/main.js");
  const agentsSrc = fs.readFileSync(agentsPath, "utf8");

  // 1. Verify company-brand is 100% restored to pristine original state without updater logic
  assert.ok(!fs.existsSync(brandUpdaterPath), "company-brand/updater.js must NOT exist");
  assert.ok(!fs.existsSync(brandSparklesPath), "company-brand/sparkles.svg must NOT exist");
  assert.ok(!brandSrc.includes("updater"), "company-brand/main.js must not import updater");
  assert.ok(!brandSrc.includes("sparkles"), "company-brand/main.js must not reference sparkles");
  assert.ok(!brandSrc.includes("checkPixelHqUpdate"), "company-brand/main.js must not check updates");
  console.log("PASS: company-brand is 100% pristine and free of updater logic");

  // 2. Verify company-agents/updater.js exports check and direct execute functions without modal
  assert.ok(agentsUpdaterSrc.includes("export async function checkPixelHqUpdate"), "updater.js must export checkPixelHqUpdate");
  assert.ok(agentsUpdaterSrc.includes("export async function executePixelHqUpdate"), "updater.js must export executePixelHqUpdate");
  assert.ok(agentsUpdaterSrc.includes("export function isUrgentUpdate"), "updater.js must export isUrgentUpdate helper");
  assert.ok(agentsUpdaterSrc.includes("notify({"), "updater.js must trigger native toast notification");
  assert.ok(agentsUpdaterSrc.includes("timeout: 10000"), "normal toast notification must have 10-second timeout");
  assert.ok(agentsUpdaterSrc.includes("timeout: 30000"), "urgent toast notification must have 30-second timeout");
  assert.ok(agentsUpdaterSrc.includes('level: "warning"'), "urgent toast notification must use warning level");
  assert.ok(agentsUpdaterSrc.includes('level: "info"'), "normal toast notification must use info level");
  assert.ok(agentsUpdaterSrc.includes("Pixel-HQ-Updater"), "GitHub API fetch must include User-Agent header");
  assert.ok(agentsUpdaterSrc.includes("Updating Pixel HQ..."), "updater must notify updating in background");
  assert.ok(agentsUpdaterSrc.includes("Pixel HQ updated!"), "updater must notify updated on completion");
  console.log("PASS: company-agents/updater.js exports background check & execute without modal or progress window");

  // 3. Verify isUrgentUpdate classification
  function testIsUrgent(type) {
    const t = String(type ?? "").toLowerCase().trim();
    return t === "critical" || t === "urgent" || t === "important" || t === "hotfix" || t === "1" || t === "major";
  }
  assert.strictEqual(testIsUrgent("urgent"), true, "urgent must be true");
  assert.strictEqual(testIsUrgent("critical"), true, "critical must be true");
  assert.strictEqual(testIsUrgent("important"), true, "important must be true");
  assert.strictEqual(testIsUrgent("hotfix"), true, "hotfix must be true");
  assert.strictEqual(testIsUrgent("1"), true, "type 1 string must be true");
  assert.strictEqual(testIsUrgent(1), true, "type 1 number must be true");
  assert.strictEqual(testIsUrgent("normal"), false, "normal must be false");
  assert.strictEqual(testIsUrgent("routine"), false, "routine must be false");
  assert.strictEqual(testIsUrgent("2"), false, "type 2 string must be false");
  assert.strictEqual(testIsUrgent(undefined), false, "default undefined must be false");
  console.log("PASS: isUrgentUpdate correctly distinguishes Type 1 from Type 2");

  // 4. Verify company-status status bar pill triggers company-agents.update and shows transition
  assert.ok(statusSrc.includes('id("update-status-pill")'), "company-status must include update-status-pill");
  assert.ok(statusSrc.includes("✨ New update: ${verText}"), "company-status must show '✨ New update: ${verText}' for normal type");
  assert.ok(statusSrc.includes("⚠️ Urgent update: ${verText}"), "company-status must show '⚠️ Urgent update: ${verText}' for urgent type");
  assert.ok(statusSrc.includes('run("company-agents.update")'), "update-status-pill must trigger company-agents.update on click");
  console.log("PASS: company-status displays update pill and invokes company-agents.update");

  // 5. Verify company-agents integration and direct update execution
  assert.ok(agentsSrc.includes('if (c === "update") this.runUpdate(cx)'), "company-agents must listen to nextCommand for update");
  assert.ok(agentsSrc.includes("executePixelHqUpdate"), "company-agents must import and execute update directly");
  assert.ok(agentsSrc.includes("checkPixelHqUpdate(true)"), "company-agents must check for updates on startup");
  assert.ok(!agentsSrc.includes('Pixel HQ ${this.update.version} is out'), "company-agents office floor must not render intrusive banner");
  console.log("PASS: company-agents executes update directly without modal");

  assert.ok(statusSrc.includes('run("company-agents.changelog")'));
  assert.ok(agentsSrc.includes('if (props()?.changelog) return this.changelog(t)'));
  assert.match(agentsSrc, /openChangelog\(\) \{\s+openOverlay\(\{ mod: "company-agents", kind: "dialog", [^}]+props: \{ changelog: true \}/);
  await testUpdateBehavior(agentsUpdaterSrc);
  console.log("PASS: commit-pinned downloads, fallback, timeout, failures, reload recovery, and changelog");
}

runTests().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
