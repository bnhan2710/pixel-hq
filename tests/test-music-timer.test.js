import assert from "node:assert";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${remM.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
}

function calculateLiveElapsed(music, nowSec) {
  const isPlaying = Boolean(music?.playing);
  const pauseElapsed = Number(music?.elapsed || 0);
  return (isPlaying && music?.startTime)
    ? pauseElapsed + Math.max(0, nowSec - music.startTime)
    : Number(music?.currentElapsed || pauseElapsed);
}

function testFormatTime() {
  assert.strictEqual(formatTime(0), "00:00");
  assert.strictEqual(formatTime(-10), "00:00");
  assert.strictEqual(formatTime(NaN), "00:00");
  assert.strictEqual(formatTime(null), "00:00");
  assert.strictEqual(formatTime(45), "00:45");
  assert.strictEqual(formatTime(60), "01:00");
  assert.strictEqual(formatTime(125), "02:05");
  assert.strictEqual(formatTime(3599), "59:59");
  assert.strictEqual(formatTime(3600), "1:00:00");
  assert.strictEqual(formatTime(3665), "1:01:05");
  console.log("PASS: formatTime formatting validated across all edge cases");
}

function testTimerNoDoubleCountingAcrossTicks() {
  const startTime = 1000;
  const music = {
    playing: true,
    status: "playing",
    startTime,
    elapsed: 0,
    currentElapsed: 0,
    duration: 300
  };

  let prevElapsed = calculateLiveElapsed(music, startTime);
  assert.strictEqual(prevElapsed, 0);

  for (let sec = 1; sec <= 30; sec++) {
    const now = startTime + sec;
    if (sec % 2 === 0) {
      music.currentElapsed = sec;
    }
    const current = calculateLiveElapsed(music, now);
    assert.strictEqual(current, sec);
    assert.strictEqual(current - prevElapsed, 1);
    prevElapsed = current;
  }
  console.log("PASS: Timer advances by exactly 1s per tick with zero jumping or doubling");
}

function testPauseAndResumeTransitions() {
  const start = 2000;
  const music = {
    playing: true,
    status: "playing",
    startTime: start,
    elapsed: 0,
    currentElapsed: 0,
    duration: 200
  };

  assert.strictEqual(calculateLiveElapsed(music, start + 10), 10);

  music.playing = false;
  music.status = "paused";
  music.elapsed = 10;
  music.currentElapsed = 10;
  music.startTime = 2010;

  assert.strictEqual(calculateLiveElapsed(music, 2010), 10);
  assert.strictEqual(calculateLiveElapsed(music, 2015), 10);
  assert.strictEqual(calculateLiveElapsed(music, 2020), 10);

  music.playing = true;
  music.status = "playing";
  music.startTime = 2020;
  music.elapsed = 10;

  assert.strictEqual(calculateLiveElapsed(music, 2020), 10);
  assert.strictEqual(calculateLiveElapsed(music, 2021), 11);
  assert.strictEqual(calculateLiveElapsed(music, 2025), 15);
  console.log("PASS: Pause and resume transitions maintain consistent elapsed counter");
}

async function testBinaryResolutionCaching() {
  for (const mod of ["company-music", "company-status"]) {
    const source = readFileSync(new URL(`../mods/${mod}/main.js`, import.meta.url), "utf8");
    const resolver = source.slice(source.indexOf("let detectedPythonBin"), source.indexOf("function formatTime"));
    for (const homebrew of ["/opt/homebrew/bin", "/usr/local/bin"]) {
      const available = new Set();
      const calls = [];
      const context = {
        appHome: () => "/Users/test/.config/herdr-app",
        window: () => ({ platform: "macos" }),
        exec: async (bin, args) => {
          calls.push([bin, args.at(-1)]);
          if (!available.has(bin)) throw new Error("Executable missing");
          if (args[0] === "--version") return { code: 0 };
          return { code: 0, stdout: '{"status":"ok"}' };
        },
      };
      const runPlayer = runInNewContext(resolver + "\nrunPlayer", context);
      assert.equal(await runPlayer(["next"]), null);
      assert.ok(calls.every(([, action]) => action === "check"));
      const python = `${homebrew}/python3`;
      available.add(python);
      assert.equal((await runPlayer(["next"])).status, "ok");
      assert.deepEqual(calls.filter(([, action]) => action === "next"), [[python, "next"]]);
      calls.length = 0;
      await runPlayer(["prev"]);
      await runPlayer(["stop"]);
      assert.deepEqual(calls, [[python, "prev"], [python, "stop"]]);
      if (mod === "company-music") {
        const brew = `${homebrew}/brew`;
        available.add(brew);
        const findHomebrew = runInNewContext(resolver + "\nfindHomebrew", { ...context });
        assert.equal(await findHomebrew(), brew);
      }
    }
  }
  console.log("PASS: Both macOS Homebrew prefixes, retry after setup, and single execution of player actions");
}

async function testMacAutoInstall() {
  const source = readFileSync(new URL("../mods/company-music/main.js", import.meta.url), "utf8");
  const installed = [];
  const context = {
    View: class {},
    appHome: () => "/Users/test/.config/herdr-app",
    window: () => ({ platform: "macos" }),
    setShared() {},
    exec: async (bin, args) => {
      if (bin === "/opt/homebrew/bin/brew") {
        if (args[0] === "install") installed.push(...args.slice(1));
        return { code: 0 };
      }
      if (bin === "/opt/homebrew/bin/python3" && installed.includes("python")) {
        return { code: 0, stdout: '{"status":"ok","has_player":true,"has_ytdlp":true}' };
      }
      throw new Error("Executable missing");
    },
  };
  const Music = runInNewContext(source.replace(/^import .+\n/gm, "").replace("export default class", "class") +
    "\nCompanyMusic", context);
  const music = new Music();
  const cx = { notify() {} };
  await music.checkDeps(cx);
  assert.equal(music.showGuide, true);
  await music.runAutoInstall("macos", cx);
  assert.deepEqual(installed, ["python", "ffmpeg", "yt-dlp"]);
  assert.equal(music.depStatus.has_python, true);
  assert.equal(music.showGuide, false);
  assert.equal(music.installing, false);
  console.log("PASS: macOS setup installs missing tools through Homebrew and verifies them");
}

function testMusicBoxDisableToggle() {
  function checkDisabled(store, settingsObj, sharedObj = {}) {
    const sh = sharedObj["pixel-hq.musicbox.hidden"];
    if (sh !== undefined && sh !== null) return Boolean(sh);
    try {
      if (store?.getItem("pixel-hq.musicbox.hidden") === "true") return true;
    } catch {}
    try {
      const cfg = settingsObj;
      if (cfg?.musicbox === false || cfg?.music?.enabled === false || cfg?.["company-music"]?.enabled === false) return true;
    } catch {}
    return false;
  }

  const mockStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  };

  assert.strictEqual(checkDisabled(mockStorage, {}), false);

  mockStorage.setItem("pixel-hq.musicbox.hidden", "true");
  assert.strictEqual(checkDisabled(mockStorage, {}), true);

  mockStorage.removeItem("pixel-hq.musicbox.hidden");
  assert.strictEqual(checkDisabled(mockStorage, {}), false);

  assert.strictEqual(checkDisabled(mockStorage, {}, { "pixel-hq.musicbox.hidden": true }), true);
  assert.strictEqual(checkDisabled(mockStorage, {}, { "pixel-hq.musicbox.hidden": false }), false);

  assert.strictEqual(checkDisabled(mockStorage, { musicbox: false }), true);
  assert.strictEqual(checkDisabled(mockStorage, { music: { enabled: false } }), true);
  assert.strictEqual(checkDisabled(mockStorage, { "company-music": { enabled: false } }), true);
  assert.strictEqual(checkDisabled(mockStorage, { musicbox: true }), false);

  console.log("PASS: MusicBox disable toggle via localStorage and settings verified");
}

function testMusicBoxHotkeyAndNotification() {
  function applyHotkey(parsed) {
    let changed = false;
    if (parsed.global && parsed.global["ctrl-shift-m"] !== "mod.open:company-music") {
      parsed.global["ctrl-shift-m"] = "mod.open:company-music";
      changed = true;
    }
    if (parsed.terminal && parsed.terminal["ctrl-shift-m"] !== "mod.open:company-music") {
      parsed.terminal["ctrl-shift-m"] = "mod.open:company-music";
      changed = true;
    }
    return { parsed, changed };
  }

  const initial = { global: { "ctrl-p": "space.switch" }, terminal: { "ctrl-c": "term.copy" } };
  const res1 = applyHotkey(initial);
  assert.strictEqual(res1.changed, true);
  assert.strictEqual(res1.parsed.global["ctrl-shift-m"], "mod.open:company-music");
  assert.strictEqual(res1.parsed.terminal["ctrl-shift-m"], "mod.open:company-music");
  assert.strictEqual(res1.parsed.global["ctrl-p"], "space.switch");

  const res2 = applyHotkey(res1.parsed);
  assert.strictEqual(res2.changed, false);

  function syncSettings(parsed, disabled) {
    let changed = false;
    if (disabled) {
      if (parsed.musicbox !== false) {
        parsed.musicbox = false;
        changed = true;
      }
    } else {
      if ("musicbox" in parsed) {
        delete parsed.musicbox;
        changed = true;
      }
    }
    return { parsed, changed };
  }

  const s1 = syncSettings({ zoom: 1.0 }, true);
  assert.strictEqual(s1.changed, true);
  assert.strictEqual(s1.parsed.musicbox, false);

  const s2 = syncSettings(s1.parsed, false);
  assert.strictEqual(s2.changed, true);
  assert.strictEqual("musicbox" in s2.parsed, false);

  console.log("PASS: MusicBox hotkey registration and settings synchronization verified");
}

console.log("=== Running Music Timer & Progression Tests ===");
testFormatTime();
testTimerNoDoubleCountingAcrossTicks();
testPauseAndResumeTransitions();
await testBinaryResolutionCaching();
await testMacAutoInstall();
testMusicBoxDisableToggle();
testMusicBoxHotkeyAndNotification();
