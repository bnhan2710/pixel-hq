const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

async function runTests() {
  console.log("=== Running Codex Vitals Tests ===");

  const scriptPath = path.resolve(__dirname, "../mods/company-agents/codex-vitals.py");
  assert.ok(fs.existsSync(scriptPath), "codex-vitals.py must exist");

  // Create temporary mock CODEX_HOME
  const tmpDir = path.resolve(__dirname, "tmp_mock_codex");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const sessionsDir = path.join(tmpDir, "sessions", "2026", "11", "17");
  fs.mkdirSync(sessionsDir, { recursive: true });

  // 1. Mock config.toml
  fs.writeFileSync(path.join(tmpDir, "config.toml"), 'model = "gpt-5.6-terra"\n');

  // 2. Mock rollout file with token_count and model
  const mockRollout = path.join(sessionsDir, "rollout-2026-11-17T14-00-00-mock.jsonl");
  const rolloutLines = [
    JSON.stringify({
      timestamp: "2026-11-17T07:00:00Z",
      type: "session_meta",
      payload: { cwd: "/mock/workspace" },
    }),
    JSON.stringify({
      timestamp: "2026-11-17T07:00:01Z",
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    }),
    JSON.stringify({
      timestamp: "2026-11-17T07:00:02Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: 25840 },
          model_context_window: 258400,
        },
        rate_limits: {
          primary: { used_percent: 20.0 },
        },
      },
    }),
  ];
  fs.writeFileSync(mockRollout, rolloutLines.join("\n") + "\n");

  // Test Case 1: Active session extraction
  const out = execFileSync("python3", [scriptPath, "", "/mock/workspace"], {
    env: { ...process.env, CODEX_HOME: tmpDir },
    encoding: "utf8",
  });

  const parsed = JSON.parse(out.trim());
  assert.strictEqual(parsed.pct, 10, "Expected context fill pct to be 10%");
  assert.strictEqual(parsed.model, "gpt-5.6-sol", "Expected model to be gpt-5.6-sol");
  assert.strictEqual(parsed.quota, 80, "Expected quota left to be 80%");
  console.log("PASS: Successfully extracted pct, model, and quota from rollout JSONL");

  // Test Case 2: Fallback when session has no token_count yet
  const emptyRollout = path.join(sessionsDir, "rollout-2026-11-17T14-05-00-empty.jsonl");
  fs.writeFileSync(
    emptyRollout,
    JSON.stringify({ payload: { cwd: "/mock/workspace_new" } }) + "\n"
  );
  // Ensure newer timestamp
  const now = new Date();
  fs.utimesSync(emptyRollout, now, now);

  const out2 = execFileSync("python3", [scriptPath, "", "/mock/workspace_new"], {
    env: { ...process.env, CODEX_HOME: tmpDir },
    encoding: "utf8",
  });

  const parsed2 = JSON.parse(out2.trim());
  assert.strictEqual(parsed2.pct, null, "Expected pct to be null when no tokens");
  assert.strictEqual(parsed2.model, "gpt-5.6-terra", "Expected model to fallback to config.toml");
  assert.strictEqual(parsed2.quota, null, "Expected quota to be null");
  console.log("PASS: Successfully fell back to config.toml model when session is empty");

  // Test Case 3: Species mapping in duck.js
  const duckPath = path.resolve(__dirname, "../mods/company-agents/duck.js");
  const duckSrc = fs.readFileSync(duckPath, "utf8");
  const strippedSrc = duckSrc.replace(/import\s+.*?\s+from\s+["']gpui-kit["'];?/g, "const div = () => ({});");
  const duckMod = await import("data:text/javascript;base64," + Buffer.from(strippedSrc).toString("base64"));
  assert.strictEqual(duckMod.speciesOf("codex"), "bot", "Expected codex species to be bot");
  assert.strictEqual(duckMod.agentOf("codex")?.role, "Code Reviewer", "Expected codex role to be Code Reviewer");
  console.log("PASS: Codex correctly mapped to bot (Code Reviewer)");

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("All Codex Vitals tests passed!");
}

runTests().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
