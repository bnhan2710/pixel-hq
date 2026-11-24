// Runs the real shell script that setupClaude / setupAntigravity build in
// mods/company-agents/main.js, against a throwaway HOME, and checks that it
// really writes the statusLine entry. A syntax error in the embedded Python
// makes the script fail silently (stderr is discarded), so it has to be run.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mainJs = fs.readFileSync(path.join(__dirname, "..", "mods", "company-agents", "main.js"), "utf8");

// Returns the value of the `const sh = ...;` string built inside the given method.
function extractSh(method) {
  const start = mainJs.indexOf(`async ${method}(cx) {`);
  assert.ok(start >= 0, `${method} not found`);
  const from = mainJs.indexOf("const sh = ", start) + "const sh = ".length;
  const end = mainJs.indexOf(";\n    const ps = ", from);
  assert.ok(from > "const sh = ".length && end > from, `${method}: could not locate the sh string`);
  return new Function(`return (${mainJs.slice(from, end)});`)();
}

function run(method, relDir, extra) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pixelhq-home-"));
  const dir = path.join(home, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(home, "claude-statusline.sh");
  fs.writeFileSync(src, "#!/bin/sh\nexit 0\n");
  const settings = path.join(dir, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ theme: "café", ...extra }, null, 2) + "\n");

  const r = spawnSync("sh", ["-c", extractSh(method), "sh", src], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `${method}: script exited with ${r.status} ${r.stderr}`);

  const raw = fs.readFileSync(settings, "utf8");
  const data = JSON.parse(raw);
  assert.strictEqual(data.statusLine.type, "command", `${method}: statusLine not written`);
  assert.ok(data.statusLine.command.endsWith("pixel-hq-statusline.sh"), `${method}: wrong command`);
  assert.strictEqual(data.theme, "café", `${method}: existing keys must be kept`);
  assert.ok(raw.includes("café"), `${method}: non-ASCII must not be escaped`);
  assert.ok(raw.endsWith("\n"), `${method}: file must end with a newline`);
  assert.ok(fs.existsSync(path.join(dir, "pixel-hq-statusline.sh")), `${method}: statusline script not copied`);
  fs.rmSync(home, { recursive: true, force: true });
}

console.log("=== Testing setupClaude / setupAntigravity settings update (real script) ===");
run("setupClaude", ".claude", {});
console.log("PASS: setupClaude writes statusLine");
run("setupAntigravity", path.join(".gemini", "antigravity-cli"), {});
console.log("PASS: setupAntigravity writes statusLine");
