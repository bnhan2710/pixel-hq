const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");

async function runTests() {
  console.log("=== Running OpenCode Multi-Tab Status Tests ===");
  const tuiPath = path.resolve(__dirname, "../mods/company-agents/opencode-hp/tui.tsx");
  const code = fs.readFileSync(tuiPath, "utf8");

  // Test 1: Version check
  const versionLine = code.split("\n")[0].trim();
  assert.strictEqual(
    versionLine,
    "// pixel-hq-opencode-hp v3",
    `Expected v3 marker on line 1, got: "${versionLine}"`
  );
  console.log("PASS: Version is pixel-hq-opencode-hp v3");

  // Load plugin
  process.env.HC_TERMINAL_ID = "t_test_oc";
  const mod = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const { setup } = mod.default;

  assert.strictEqual(typeof setup, "function", "setup should be exported as a function");

  // Setup mock OpenCode context
  const sentStatuses = [];
  const renderer = {
    setProgramStatus(status) {
      sentStatuses.push({ ...status });
      return true;
    },
  };

  let currentRoute = { type: "session", sessionID: "ses_tab1" };
  const sessions = {
    ses_tab1: { id: "ses_tab1", title: "Tab 1 (Active Idle)" },
    ses_tab2: { id: "ses_tab2", title: "Tab 2 (Background Busy)" },
  };

  let tab1Status = { busy: false, attention: false };
  let tab2Status = { busy: true, attention: false };

  const tabsList = () => [
    {
      sessionID: "ses_tab1",
      title: sessions.ses_tab1.title,
      active: currentRoute.sessionID === "ses_tab1",
      ...tab1Status,
    },
    {
      sessionID: "ses_tab2",
      title: sessions.ses_tab2.title,
      active: currentRoute.sessionID === "ses_tab2",
      ...tab2Status,
    },
  ];

  const eventListeners = new Map();
  const ctx = {
    renderer,
    location: "test-loc",
    ui: {
      router: {
        current: () => currentRoute,
      },
      tabs: {
        enabled: () => true,
        list: tabsList,
      },
    },
    data: {
      session: {
        get: (id) => sessions[id],
        status: (id) => (id === "ses_tab1" ? (tab1Status.busy ? "running" : "idle") : (tab2Status.busy ? "running" : "idle")),
        message: { list: () => [] },
        permission: { list: () => (tab1Status.attention === "permission" ? [{ id: "perm_1" }] : []) },
        form: { list: () => (tab1Status.attention === "question" ? [{ id: "form_1" }] : []) },
      },
      on: (ev, fn) => {
        if (!eventListeners.has(ev)) eventListeners.set(ev, []);
        eventListeners.get(ev).push(fn);
        return () => {
          const arr = eventListeners.get(ev) || [];
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
    },
  };

  const originalSetProgramStatus = renderer.setProgramStatus;
  const cleanup = await setup(ctx);

  // Test 2: Verify renderer.setProgramStatus was wrapped
  assert.notStrictEqual(
    ctx.renderer.setProgramStatus,
    originalSetProgramStatus,
    "ctx.renderer.setProgramStatus should be intercepted/wrapped by setup()"
  );
  console.log("PASS: ctx.renderer.setProgramStatus is wrapped");

  // Test 3: Multiple sessions running, but active tab (Tab 1) is idle.
  // In OpenCode v2 default behavior, createProgramStatus would send:
  // 1) Child record: { state: "working", id: "ses_tab2", app: "opencode", title: "Tab 2 (Background Busy)" }
  // 2) Root record:  { state: "working", app: "opencode", title: "Tab 2 (Background Busy)" }
  sentStatuses.length = 0;

  // Simulate OpenCode sending child record for tab 2
  ctx.renderer.setProgramStatus({
    state: "working",
    id: "ses_tab2",
    app: "opencode",
    title: "Tab 2 (Background Busy)",
  });

  assert.strictEqual(sentStatuses.length, 1);
  assert.strictEqual(sentStatuses[0].id, "ses_tab2");
  assert.strictEqual(sentStatuses[0].state, "working");
  console.log("PASS: Child record for background tab passed through unchanged");

  // Simulate OpenCode sending root record (which originally would be working)
  sentStatuses.length = 0;
  ctx.renderer.setProgramStatus({
    state: "working",
    app: "opencode",
    title: "Tab 2 (Background Busy)",
  });

  // MUST BE OVERRIDDEN TO IDLE because active tab (Tab 1) is idle!
  assert.strictEqual(sentStatuses.length, 1);
  assert.strictEqual(sentStatuses[0].id, undefined, "Root record should have no id");
  assert.strictEqual(
    sentStatuses[0].state,
    "idle",
    `Expected root state to be "idle" for active Tab 1, got "${sentStatuses[0].state}"`
  );
  console.log("PASS: Root status intercepted and forced to idle matching active Tab 1");

  // Test 4: Switch tab to Tab 2 (Background Busy)
  sentStatuses.length = 0;
  currentRoute = { type: "session", sessionID: "ses_tab2" };

  // Trigger status update via OpenCode event or setProgramStatus
  ctx.renderer.setProgramStatus({
    state: "working",
    app: "opencode",
    title: "Tab 2 (Background Busy)",
  });

  assert.strictEqual(sentStatuses.length, 1);
  assert.strictEqual(
    sentStatuses[0].state,
    "working",
    `Expected root state to be "working" when active tab is Tab 2, got "${sentStatuses[0].state}"`
  );
  console.log("PASS: Root status correctly switches to working when active tab is busy");

  // Test 5: Switch back to Tab 1, and Tab 1 gets blocked (needs permission)
  sentStatuses.length = 0;
  currentRoute = { type: "session", sessionID: "ses_tab1" };
  tab1Status = { busy: false, attention: "permission" };

  ctx.renderer.setProgramStatus({
    state: "working",
    app: "opencode",
  });

  assert.strictEqual(sentStatuses.length, 1);
  assert.strictEqual(
    sentStatuses[0].state,
    "blocked",
    `Expected root state to be "blocked" when active tab needs permission, got "${sentStatuses[0].state}"`
  );
  console.log("PASS: Root status reflects blocked state when active tab needs input");

  if (typeof cleanup === "function") cleanup();
  console.log("All OpenCode tab status tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
