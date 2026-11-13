import { spawnSync } from "node:child_process";

const terminal = process.env.HC_TERMINAL_ID;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  if (!terminal) return;
  let status;
  try { status = JSON.parse(input); } catch { return; }
  const pct = status?.context_window?.used_percentage;
  if (!Number.isFinite(pct)) return;
  const labels = [`claude.context=${Math.round(pct)}`];
  const model = status?.model?.display_name;
  if (model) labels.push(`claude.model=${model}`);
  spawnSync("hc", ["label", terminal, ...labels], { stdio: "ignore" });
});
