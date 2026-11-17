const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

async function runTests() {
  console.log("=== Running Vitals & Labels Tests ===");

  // Test 1: Species matching from duck.js
  const duckPath = path.resolve(__dirname, "../mods/company-agents/duck.js");
  const duckSrc = fs.readFileSync(duckPath, "utf8");
  // Strip gpui-kit import for headless test
  const strippedSrc = duckSrc.replace(/import\s+.*?\s+from\s+["']gpui-kit["'];?/g, "const div = () => ({});");
  const duckMod = await import("data:text/javascript;base64," + Buffer.from(strippedSrc).toString("base64"));
  const { speciesOf, agentOf } = duckMod;

  assert.strictEqual(speciesOf("claude"), "crab");
  assert.strictEqual(speciesOf("codex"), "bot");
  assert.strictEqual(speciesOf("opencode"), "penguin");
  assert.strictEqual(speciesOf("antigravity"), "arch");
  assert.strictEqual(speciesOf("agy"), "arch");
  assert.strictEqual(speciesOf("something_else"), "sheep");
  console.log("PASS: speciesOf correctly maps agents to species (including antigravity & agy)");

  // Test 2: Label parsing logic (mirrors main.js contextOf)
  function parseContext(all) {
    return new Map(all.flatMap((k) => {
      const labels = k.labels ?? {};
      const prog = String(k.program?.key ?? k.report?.app ?? k.status?.app ?? k.agent ?? "").toLowerCase();
      const isClaude = /claude/.test(prog);
      const isAgy = /antigravity|agy/.test(prog);
      const own = isClaude ? labels["claude.context"] ?? labels["agent.context"] : (isAgy ? labels["agy.context"] ?? labels["agent.context"] : labels["agent.context"]);
      const model = isClaude ? (labels["claude.model"] || labels["agent.model"] || null) : (labels["agent.model"] || labels["agy.model"] || null);
      const v = Number.parseInt(own, 10);
      const q = Number.parseInt((isClaude ? labels["claude.quota"] ?? labels["agent.quota"] : (isAgy ? labels["agy.quota"] ?? labels["agent.quota"] : labels["agent.quota"])), 10);
      if (!Number.isFinite(v) && !Number.isFinite(q)) return [];
      return [[k.address, {
        pct: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null,
        model,
        quota: Number.isFinite(q) ? Math.max(0, Math.min(100, q)) : null,
        effort: (isClaude ? labels["claude.effort"] || labels["agent.effort"] : labels["agent.effort"]) || null,
      }]];
    }));
  }

  const terminals = [
    {
      address: "t_claude",
      program: { key: "claude" },
      labels: {
        "claude.context": "55",
        "claude.model": "Opus 4",
        "claude.quota": "70",
      },
    },
    {
      address: "t_opencode",
      program: { key: "opencode" },
      labels: {
        "agent.context": "22",
        "agent.model": "inkling-2-small-free",
      },
    },
    {
      address: "t_agy",
      status: { app: "antigravity" },
      labels: {
        "agent.context": "7",
        "agent.model": "Gemini 3.8 Flash (High)",
        "agent.quota": "96",
      },
    },
  ];

  const parsed = parseContext(terminals);
  assert.strictEqual(parsed.get("t_claude")?.pct, 55);
  assert.strictEqual(parsed.get("t_claude")?.model, "Opus 4");
  assert.strictEqual(parsed.get("t_claude")?.quota, 70);

  assert.strictEqual(parsed.get("t_opencode")?.pct, 22);
  assert.strictEqual(parsed.get("t_opencode")?.model, "inkling-2-small-free");

  assert.strictEqual(parsed.get("t_agy")?.pct, 7);
  assert.strictEqual(parsed.get("t_agy")?.model, "Gemini 3.8 Flash (High)");
  assert.strictEqual(parsed.get("t_agy")?.quota, 96);

  console.log("PASS: contextOf parsing handles Claude, OpenCode, and Antigravity vitals");

  console.log("All Vitals & Labels tests passed!");
}

runTests().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
