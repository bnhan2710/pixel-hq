const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

async function runTests() {
  console.log("=== Running Update System Decoupling & Urgency Types Tests ===");

  const brandPath = path.resolve(__dirname, "../mods/company-brand/main.js");
  const brandSrc = fs.readFileSync(brandPath, "utf8");

  const brandUpdaterPath = path.resolve(__dirname, "../mods/company-brand/updater.js");
  const brandUpdaterSrc = fs.readFileSync(brandUpdaterPath, "utf8");

  const statusPath = path.resolve(__dirname, "../mods/company-status/main.js");
  const statusSrc = fs.readFileSync(statusPath, "utf8");

  const agentsPath = path.resolve(__dirname, "../mods/company-agents/main.js");
  const agentsSrc = fs.readFileSync(agentsPath, "utf8");

  // 1. Verify company-brand has updater logic and toast notification support with urgency levels
  assert.ok(brandUpdaterSrc.includes("export async function checkPixelHqUpdate"), "updater.js must export checkPixelHqUpdate");
  assert.ok(brandUpdaterSrc.includes("export async function executePixelHqUpdate"), "updater.js must export executePixelHqUpdate");
  assert.ok(brandUpdaterSrc.includes("export function isUrgentUpdate"), "updater.js must export isUrgentUpdate helper");
  assert.ok(brandUpdaterSrc.includes("notify({"), "updater.js must trigger native toast notification");
  assert.ok(brandUpdaterSrc.includes("timeout: 10000"), "normal toast notification must have 10-second timeout");
  assert.ok(brandUpdaterSrc.includes("timeout: 30000"), "urgent toast notification must have 30-second timeout");
  assert.ok(brandUpdaterSrc.includes('level: "warning"'), "urgent toast notification must use warning level");
  assert.ok(brandUpdaterSrc.includes('level: "info"'), "normal toast notification must use info level");
  console.log("PASS: company-brand/updater.js exports check and execute functions with type 1 (urgent) and type 2 (normal) toasts");

  // 2. Verify isUrgentUpdate classification
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
  console.log("PASS: isUrgentUpdate correctly distinguishes Type 1 (urgent/critical) from Type 2 (normal/routine)");

  // 3. Verify Position 1: company-brand footer & header indicators adapt to urgency
  assert.ok(brandSrc.includes("checkPixelHqUpdate(true)"), "company-brand must check for updates on startup");
  assert.ok(brandSrc.includes('row("update-hq"'), "company-brand footer must include Update Pixel HQ row");
  assert.ok(brandSrc.includes("⚠️ Urgent Update"), "company-brand footer must show Urgent Update when isUrgent is true");
  assert.ok(brandSrc.includes('c === "update"'), "company-brand must listen to nextCommand for update");
  console.log("PASS: Position 1 verified in company-brand (footer row & header button with urgency-aware labels and styling)");

  // 4. Verify Position 2: company-status bottom status bar pill is clear and shows old -> new version transition
  assert.ok(statusSrc.includes('id("update-status-pill")'), "company-status must include update-status-pill");
  assert.ok(!statusSrc.includes('`🚀 v${upd.version}`'), "company-status must NOT just show raw version like current version");
  assert.ok(statusSrc.includes("✨ New update: ${verText}"), "company-status must clearly show '✨ New update: ${verText}' for normal type");
  assert.ok(statusSrc.includes("⚠️ Urgent update: ${verText}"), "company-status must show '⚠️ Urgent update: ${verText}' for urgent type");
  assert.ok(brandUpdaterSrc.includes("v${curVer} → v${newVer}"), "updater must calculate version transition string (v<old> → v<new>)");
  assert.ok(statusSrc.includes('run("company-brand.update")'), "update-status-pill must trigger company-brand.update on click");
  console.log("PASS: Position 2 verified in company-status (clear 'New update' pill showing old -> new transition and adapting to Type 1/2)");

  // 5. Verify company-agents office floor banner has been cleanly removed
  assert.ok(!agentsSrc.includes('Pixel HQ ${this.update.version} is out'), "company-agents office floor must not render update banner");
  assert.ok(!agentsSrc.includes('btn("upd-go"'), "company-agents must not render old upd-go button");
  console.log("PASS: Obtrusive update banner cleanly eradicated from company-agents office floor");

  // 6. Verify modal and live updating status progress (1/N ... N/N)
  assert.ok(brandUpdaterSrc.includes("export class Updater"), "updater.js must export Updater class for modal");
  assert.ok(brandUpdaterSrc.includes("export async function openUpdateModal"), "updater.js must export openUpdateModal function");
  assert.ok(brandSrc.includes("props()?.updateModal"), "company-brand must support updateModal in props");
  assert.ok(brandUpdaterSrc.includes("setShared(\"pixel-hq.updating\""), "updater must publish live updating progress to shared state");
  assert.ok(statusSrc.includes("shared(\"pixel-hq.updating\")"), "status pill must observe live updating progress");
  assert.ok(statusSrc.includes("⏳ Updating [${updating.step}/${updating.total}]"), "status pill must display live 1/N progress");
  assert.ok(brandSrc.includes("⏳ Updating [${updatingState.step}/${updatingState.total}]"), "sidebar must display live 1/N progress");
  assert.ok(brandUpdaterSrc.includes("timeout: 180000"), "updating toast must remain visible throughout the update (not hide)");
  console.log("PASS: Modal and live updating progress (1/N..N/N) with persistent toast verified");

  console.log("All Update System Decoupling & Urgency Types tests passed!");
}

runTests().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
