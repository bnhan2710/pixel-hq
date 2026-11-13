// pixel-hq-plugin v3
// OpenCode plugin for the Herdr app: makes OpenCode show up as a team member in Pixel HQ.
//
// Herdr only counts a terminal as an agent when its program reports a status (an OSC 7501 escape sequence).
// Claude Code does that by itself, and so does OpenCode from 2.0.29 on. OpenCode 1.x does not, so its pane has a pet in the
// header but no desk in the office. On 1.x this plugin sends the sequence on OpenCode's session events: working, idle,
// blocked (permission or question), and labels the terminal with how full the context is (agent.context, 0-100) for the pile of
// papers on the desk. On 2.x it loads and does nothing: OpenCode reports for itself, and the 2.x plugin API
// has no session events to report from.
//
// Install: copy this file to ~/.config/opencode/plugins/ and restart OpenCode. Delete it to remove.
import fs from "node:fs";
import { execFile } from "node:child_process";

const APP = "opencode";
const ID = "pixel-hq-status";
let tty;
// The terminal itself, not stdout (OpenCode owns that): /dev/tty on macOS and Linux, the console output buffer on Windows.
// Opened only when the 1.x server part starts, so OpenCode 2.x never touches the terminal through this plugin.
const openTty = () => {
  if (tty !== undefined) return;
  try { tty = fs.openSync(process.platform === "win32" ? "\\\\.\\CONOUT$" : "/dev/tty", "w"); } catch { tty = null; }
};
let last;
const report = (state) => {
  if (tty == null || state === last) return;
  last = state;
  try { fs.writeSync(tty, `\x1b]7501;state=${state}:app=${APP}\x1b\\`); } catch {}
};

const children = new Set(); // sub-agent sessions must not overwrite the main session's state
const kindOf = (status) => {
  const k = String(typeof status === "string" ? status : status?.type ?? "").toLowerCase();
  if (k === "idle") return "idle";
  return ["active", "busy", "pending", "running", "streaming", "working", "retry"].includes(k) ? "working" : undefined;
};

// How full the context is: the last answer's tokens against the model's context window, labelled onto the Herdr terminal with `hc`
// (at most every 3 s, only when the number moves). Needs the 1.x event stream, so on 2.x there is no pile for OpenCode.
const limits = new Map();
let lastPct, lastAt = 0;
const labelContext = (pct, model) => {
  const id = process.env.HC_TERMINAL_ID, now = Date.now();
  if (!id || pct === lastPct || now - lastAt < 3000) return;
  lastPct = pct; lastAt = now;
  try { execFile("hc", ["label", id, `agent.context=${pct}`, `agent.model=${model}`], () => {}); } catch {}
};
async function loadLimits(client) {
  try {
    const res = await client.config.providers();
    for (const p of res?.data?.providers ?? res?.providers ?? []) for (const [mid, m] of Object.entries(p.models ?? {})) if (m?.limit?.context) limits.set(`${p.id}/${mid}`, m.limit.context);
  } catch {}
}

export const PixelHqStatus = async ({ client } = {}) => {
  openTty();
  report("idle");
  if (client) loadLimits(client);
  return {
    "chat.message": async ({ sessionID }) => { if (!children.has(sessionID)) report("working"); },
    event: async ({ event }) => {
      const type = event?.type, p = event?.properties ?? {};
      if (p.info?.id && p.info.parentID) children.add(p.info.id);
      if (type === "message.updated" && p.info?.role === "assistant" && !children.has(p.info.sessionID) && p.info.tokens) {
        const t = p.info.tokens, used = (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
        const limit = limits.get(`${p.info.providerID}/${p.info.modelID}`);
        if (limit && used > 0) labelContext(Math.max(0, Math.min(100, Math.round((used * 100) / limit))), p.info.modelID);
      }
      const child = typeof p.sessionID === "string" && children.has(p.sessionID);
      if (child) {
        if (type === "permission.asked" || type === "question.asked") report("blocked");
        else if (["permission.replied", "question.replied", "question.rejected"].includes(type)) report("working");
        return;
      }
      switch (type) {
        case "session.status": { const s = kindOf(p.status); if (s) report(s); break; }
        case "tool.execute.before": case "tool.execute.after": case "session.compacted":
        case "permission.replied": case "question.replied": case "question.rejected":
          report("working"); break;
        case "permission.asked": case "question.asked": case "session.error": report("blocked"); break;
        case "session.idle": report("idle"); break;
      }
    },
  };
};

// One file for every OpenCode loader:
// - 2.x wants a default object with `id` and `setup` (it rejects a function) and ignores other keys.
// - 1.3.13 to 1.19 see a default object with `id` and run its `server`.
// - 1.0 to 1.3.1 call every export as a function: `PixelHqStatus` runs, then calling this object logs one load error,
//   after the hooks are already in place.
export default { id: ID, server: PixelHqStatus, setup: () => {} };
