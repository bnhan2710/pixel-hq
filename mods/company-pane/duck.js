// The Claude crab at work, in the same pixel rectangles and API the Pond duck used.
// Herdr draws SVG still, so every motion here is a native .loop():
// no timers, no re-renders, and it only runs while the crab is on screen.
//
// Units are the canvas's, with the origin at the crab's body group. The canvas always
// leaves room on the left for the desk props, so swapping moods never moves the body.
//
//   working  ("stab")    – typing on a laptop, code scrolling by
//   blocked  ("angry")   – waving a claw, a "!" blinking: needs you
//   waiting  ("scowl")   – same, urgent: "!!" blinking faster, claw waving harder
//   done     ("happy")   – claws up, hopping, sparkles
//   idle     ("content") – coffee break, eyes closed, steam rising
// Everyone wears a company badge.

import { div } from "gpui-kit";

const BODY = "#D97757";   // Claude orange
const SHADE = "#B5593B";  // claws and legs
const EYE = "#2A1A14";
const SCREEN = "#2B2B33";
const BASE = "#9A9CA6";
const CODE = "#F0A58A";
const AMBER = "#F2C94C";
const MUG = "#F4E9DC";
const STEAM = "#FFFFFF";
const BADGE = "#F4E9DC";
const BADGE_TOP = "#8C4A33";

// One species per agent program: Claude is the orange crab, Codex a blue terminal robot, OpenCode a penguin, Antigravity the rainbow arch, the rest sheep.
const SPECIES = {
  crab: { body: "#D97757", shade: "#B5593B", eye: "#2A1A14", badge: "#F4E9DC" },
  bot: { body: "#5B6CF0", shade: "#4553C9", eye: "#DDE4FF", badge: "#F4E9DC", bot: true, screen: "#1B2140", glyph: "#DDE4FF", legs: [88, 152], legW: 30 },
  penguin: { body: "#35425E", shade: "#2E3A52", eye: "#1B2130", badge: "#F2A33A", round: true },
  arch: { body: "#3186FF", shade: "#E8743B", eye: "#14131f", badge: "#F4E9DC", arch: true, legs: [70, 126], legW: 54 },
  sheep: { body: "#F1E7D3", shade: "#4A3B33", eye: "#FFFFFF", badge: "#E8744F", face: "#4A3B33" },
};

const AGENTS = [
  { match: (k) => k.includes("claude"), species: "crab", role: "Staff Engineer" },
  { match: (k) => k.includes("codex"), species: "bot", role: "Code Reviewer" },
  { match: (k) => k.includes("opencode"), species: "penguin", role: "Platform Engineer" },
  { match: (k) => k.includes("antigravity") || k === "agy", species: "arch", role: "Systems Architect" },
];
export function agentOf(key) {
  const k = String(key ?? "").toLowerCase();
  return AGENTS.find((a) => a.match(k)) ?? null;
}
export const speciesOf = (key) => agentOf(key)?.species ?? "sheep";

// Antigravity's arch: a smooth bell, warm at the crown (red and orange), cooling through yellow and green to blue feet.
// Built once from thin rows (10 units tall), each blended left to right, so it reads as a soft gradient.
const hexRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mixRgb = (a, b, t) => "#" + hexRgb(a).map((v, i) => Math.round(v + (hexRgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
const ramp = (stops, t) => {
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mixRgb(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops.at(-1)[1];
};
// Antigravity: a gradient cube head, a blue-green torso with the Antigravity badge on the chest,
// orange arms and boots. Built from thin rects blended from red/orange at the crown through green to blue.
const HEAD_L = [[0, "#F4723A"], [0.38, "#F6B03A"], [0.7, "#8FCB4F"], [1, "#52C08C"]];
const HEAD_R = [[0, "#F7803A"], [0.35, "#D6C24A"], [0.62, "#7BD07A"], [0.85, "#45B8A8"], [1, "#3186FF"]];
const TORSO = [[0, "#3186FF"], [0.55, "#35A3C4"], [1, "#52C08C"]];
const ARCH = (() => {
  const out = [];
  // Top face of the cube: rows that widen toward the front edge.
  for (let y = 8; y < 44; y += 3) {
    const t = (y - 8) / 36, x0 = 62 - t * 22, x1 = 182 + t * 14;
    for (let k = 0; k < 4; k++) out.push([x0 + ((x1 - x0) / 4) * k, y, (x1 - x0) / 4 + 0.6, 3.6, mixRgb(mixRgb("#FF5A3C", "#FF9A4A", k / 3), "#FFB36A", t * 0.5)]);
  }
  // Front-left face (the arch side) and the wide right face (the face), in 6-unit rows.
  for (let y = 44; y < 134; y += 6) {
    const t = (y - 44) / 90;
    out.push([40, y, 64, 6.6, ramp(HEAD_L, t)]);
    for (let k = 0; k < 4; k++) out.push([104 + k * 23, y, 23.6, 6.6, mixRgb(ramp(HEAD_R, t), ramp(HEAD_L, t), 0.35 - k * 0.1)]);
  }
  out.push([104, 44, 3, 90, "#ffffff55"]);
  // Neck ring and a round torso.
  out.push([64, 132, 122, 10, "#3186FF"], [64, 132, 122, 3, "#6FB2FF"]);
  for (let y = 142; y < 208; y += 6) out.push([68, y, 114, 6.6, ramp(TORSO, (y - 142) / 66)]);
  // The Antigravity logo sits straight on the suit (no plate), to the right and a little higher, with a thin pale halo.
  const logo = [[134, 156, 8, 3, "#FC413D"], [131, 159, 14, 3, "#F5A83A"], [128, 162, 20, 3, "#9BCB4E"], [126, 165, 8, 12, "#3186FF"], [142, 165, 8, 12, "#3186FF"], [130, 165, 16, 3, "#3186FF"]];
  for (const [x, y, w, h] of logo) out.push([x - 2, y - 2, w + 4, h + 4, "#eaf6ffcc"]);
  for (const l of logo) out.push(l);
  return out;
})();

const runs = (inside, x0, x1, y0, y1, g, color) => {
  const out = [];
  for (let y = y0; y < y1; y += g) {
    let start = null;
    for (let x = x0; x <= x1 + g; x += g) {
      const on = x <= x1 && inside(x + g / 2, y + g / 2);
      if (on && start === null) start = x;
      if (!on && start !== null) { out.push([start, y, x - start, g + 0.4, typeof color === "function" ? color(y) : color]); start = null; }
    }
  }
  return out;
};
const inPenguin = (x, y) => (x - 125) ** 2 + (y - 112) ** 2 <= 92 ** 2;
const inPenguinFace = (x, y) => (x - 98) ** 2 + (y - 90) ** 2 <= 40 ** 2 || (x - 152) ** 2 + (y - 90) ** 2 <= 40 ** 2 || ((x - 125) / 64) ** 2 + ((y - 152) / 50) ** 2 <= 1;
const PENGUIN_COAT = [[0, "#4A5B80"], [0.5, "#35425E"], [1, "#262F44"]];
const PENGUIN = [
  ...runs(inPenguin, 30, 220, 18, 206, 5, (y) => ramp(PENGUIN_COAT, (y - 20) / 184)),
  ...runs((x, y) => inPenguin(x, y) && (x - 131) ** 2 + (y - 118) ** 2 > 92 ** 2, 30, 220, 18, 206, 5, "#6479A3"),
  ...runs((x, y) => inPenguin(x, y) && inPenguinFace(x, y), 30, 220, 40, 206, 5, (y) => (y > 178 ? "#E4DFD3" : "#F7F4EC")),
  [117, 10, 10, 12, "#4A5B80"], [127, 4, 8, 12, "#4A5B80"],
];
const PENGUIN_FEET = [[66, 206, 48, 12, "#F5A623"], [136, 206, 48, 12, "#F5A623"]];

const ROOM = 118; // desk props reach left of the body group
const WIDTH = ROOM + 250;
const HEIGHT = 240;
const BOB = { period: 1200, easing: "ease-out" };

export const BLOCKED_SCOWL = 60 * 1000;

export function mood(status, waited = 0) {
  if (status === "working") return "stab";
  if (status === "blocked") return waited < BLOCKED_SCOWL ? "angry" : "scowl";
  if (status === "done") return "happy";
  return "content";
}

export const duckWidth = (height) => Math.round((height * WIDTH) / HEIGHT);
// Where the body's middle sits across the canvas (0..1): other figures centre here.
export const DUCK_CENTER = (ROOM + 125) / WIDTH;

// The moods a figure set can pick, in the order the editor shows them.
export const MOODS = [
  { id: "stab", label: "Typing" },
  { id: "angry", label: "Waving" },
  { id: "scowl", label: "Waving, urgent" },
  { id: "happy", label: "Celebrating" },
  { id: "content", label: "Coffee break" },
];

export function duck(status, height, waited = 0) {
  return duckMood(mood(status, waited), height);
}

// One mood; `still` draws it without any motion.
export function duckMood(m, height, { still = false, species = "crab" } = {}) {
  const sp = SPECIES[species] ?? SPECIES.crab;
  const BODY = sp.body, SHADE = sp.shade, EYE = sp.eye, BADGE = sp.badge;
  const s = height / HEIGHT;
  const motion = (el, prop, policy) => (still ? el : el.loop(prop, policy));
  const px = (v) => v * s;
  const rect = (x, y, w, h, color) => div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).bg(color);

  const typing = m === "stab";
  const waving = m === "angry" || m === "scowl";
  const urgent = m === "scowl";
  const cheer = m === "happy";
  const rest = m === "content";

  // Eyes: open slots; arches when cheering; closed lines on a break.
  const arch = (x, y) => [rect(x, y + 5, 10, 15, EYE), rect(x + 25, y + 5, 10, 15, EYE), rect(x + 5, y, 25, 10, EYE)];
  const eyes = cheer
    ? [...arch(48, 52), ...arch(157, 52)]
    : rest
      ? [rect(52, 66, 36, 8, EYE), rect(152, 66, 36, 8, EYE)]
      : sp.bot
        ? [rect(64, 48, 12, 12, EYE), rect(76, 60, 12, 12, EYE), rect(88, 72, 12, 12, EYE), rect(76, 84, 12, 12, EYE), rect(64, 96, 12, 12, EYE), motion(rect(120, 90, 38, 10, EYE), "opacity", { from: 0.15, to: 1, period: 600, easing: "linear" })]
        : [rect(55, 42, 20, 30, EYE), rect(164, 42, 20, 30, EYE)];

  // Antigravity: big glossy eyes with blush on the wide face, .
  const WH = "#ffffff";
  const archFace = cheer
    ? [rect(122, 80, 24, 7, EYE), rect(127, 73, 14, 7, EYE), rect(164, 80, 24, 7, EYE), rect(169, 73, 14, 7, EYE)]
    : rest
      ? [rect(122, 84, 26, 7, EYE), rect(162, 84, 26, 7, EYE)]
      : [rect(122, 66, 24, 32, EYE), rect(162, 66, 24, 32, EYE), rect(127, 91, 14, 7, "#2a6fdc"), rect(167, 91, 14, 7, "#2a6fdc"), rect(128, 70, 9, 9, WH), rect(168, 70, 9, 9, WH)];
  const roundFace = [
    ...(cheer
      ? [rect(84, 80, 6, 10, EYE), rect(102, 80, 6, 10, EYE), rect(88, 74, 16, 6, EYE), rect(144, 80, 6, 10, EYE), rect(162, 80, 6, 10, EYE), rect(148, 74, 16, 6, EYE)]
      : rest
        ? [rect(84, 84, 24, 5, EYE), rect(144, 84, 24, 5, EYE)]
        : [rect(86, 68, 20, 28, EYE), rect(146, 68, 20, 28, EYE), rect(89, 71, 8, 8, WH), rect(149, 71, 8, 8, WH), rect(99, 87, 4, 4, "#ffffffaa"), rect(159, 87, 4, 4, "#ffffffaa")]),
    rect(114, 100, 22, 7, "#F5A623"), rect(118, 107, 14, 6, "#E0861C"), rect(62, 102, 18, 8, "#F49AA8"), rect(170, 102, 18, 8, "#F49AA8"),
  ];
  const eyes2 = sp.arch
    ? [...archFace, rect(116, 104, 22, 8, "#ef6a7e"), rect(170, 104, 22, 8, "#ef6a7e")]
    : sp.round
      ? roundFace
      : eyes;

  // Claws. Typing: they alternate. Waving: the right one waves up. Cheering: both flap high.
  const [LX, RX, CW] = sp.arch ? [26, 194, 30] : sp.round ? [16, 208, 26] : [0, 225, 25];
  let leftClaw = rect(LX, 122, CW, 40, SHADE);
  let rightClaw = rect(RX, 122, CW, 40, SHADE);
  if (typing) {
    leftClaw = motion(rect(LX, 122, CW, 40, SHADE), "top", { from: px(122), to: px(110), period: 240, easing: "ease-in-out" });
    rightClaw = motion(rect(RX, 122, CW, 40, SHADE), "top", { from: px(110), to: px(122), period: 240, easing: "ease-in-out" });
  } else if (waving) {
    rightClaw = motion(rect(RX, 55, CW, 85, SHADE), "top", { from: px(48), to: px(66), period: urgent ? 260 : 480, easing: "ease-in-out" });
  } else if (cheer) {
    leftClaw = motion(rect(LX, 60, CW, 80, SHADE), "top", { from: px(50), to: px(70), period: 300, easing: "ease-in-out" });
    rightClaw = motion(rect(RX, 60, CW, 80, SHADE), "top", { from: px(70), to: px(50), period: 300, easing: "ease-in-out" });
  }

  // Desk props in the room on the left.
  let props = null;
  if (typing) {
    // Sitting behind a MacBook: we see the silver lid with its glowing apple, the screen's light on the face.
    const SILVER = "#c9ced6", EDGE = "#a7adb8", DECK = "#aeb4c0";
    const glow = motion(rect(40, 56, 170, 44, "#8fd0ff"), "opacity", { from: 0.06, to: 0.2, period: 900, easing: "ease-in-out" });
    // The lid shows the maker's logo: the white apple, or for Antigravity its rainbow arch.
    const lid = sp.arch
      ? div().absolute().left(0).top(0).w(1).h(1)
        .child(rect(120, 130, 12, 4, "#FC413D")).child(rect(116, 134, 20, 4, "#F5A83A")).child(rect(112, 138, 28, 4, "#9BCB4E"))
        .child(rect(110, 142, 10, 12, "#3186FF")).child(rect(132, 142, 10, 12, "#3186FF")).child(rect(114, 142, 24, 4, "#3186FF"))
      : div().absolute().left(0).top(0).w(1).h(1)
        .child(rect(126, 128, 6, 4, "#ffffff")).child(rect(114, 134, 24, 4, "#ffffff")).child(rect(110, 138, 32, 12, "#ffffff"))
        .child(rect(114, 150, 24, 6, "#ffffff")).child(rect(138, 138, 6, 6, SILVER));
    const apple = motion(lid, "opacity", { from: 0.55, to: 1, period: 1400, easing: "ease-in-out" });
    props = div().absolute().left(0).top(0).w(px(1)).h(px(1))
      .child(glow)
      .child(rect(36, 100, 178, 88, SILVER)).child(rect(36, 100, 178, 4, "#e6e9ee")).child(rect(36, 184, 178, 4, EDGE))
      .child(rect(36, 104, 4, 80, "#d9dde3")).child(rect(210, 104, 4, 80, EDGE))
      .child(apple)
      .child(rect(22, 188, 206, 10, DECK)).child(rect(22, 198, 206, 4, "#8d93a0"));
  } else if (waving) {
    const bar = (x) => [rect(x, 6, 16, 52, AMBER), rect(x, 66, 16, 16, AMBER)];
    const mark = div().absolute().left(0).top(0).w(px(1)).h(px(1)).children(urgent ? [...bar(-84), ...bar(-58)] : bar(-70));
    props = motion(mark, "opacity", { from: 0.25, to: 1, period: urgent ? 280 : 560, easing: "linear" });
  } else if (cheer) {
    const star = (x, y) => [rect(x, y + 12, 36, 12, AMBER), rect(x + 12, y, 12, 36, AMBER)];
    const sparks = div().absolute().left(0).top(0).w(px(1)).h(px(1)).children([...star(-80, 20), ...star(-46, 78)]);
    props = motion(sparks, "opacity", { from: 0.2, to: 1, period: 420, easing: "ease-in-out" });
  } else if (rest) {
    const steam = motion(div().absolute().left(0).top(0).w(px(1)).h(px(1))
      .child(rect(-76, 96, 8, 28, STEAM)).child(rect(-56, 84, 8, 36, STEAM)), "opacity", { from: 0.1, to: 0.8, period: 1500, easing: "ease-in-out" });
    props = div().absolute().left(0).top(0).w(px(1)).h(px(1))
      .child(steam)
      .child(rect(-86, 132, 56, 54, MUG))
      .child(rect(-30, 142, 16, 28, MUG))
      .child(rect(-76, 142, 36, 8, "#6B3F2A"));
  }

  // The body group: everything but the legs. It bobs, or hops when cheering.
  let group = div().absolute().left(px(ROOM)).top(0).w(px(250)).h(px(207))
    .child(leftClaw)
    .child(rightClaw)
    .when(!sp.bot && !sp.arch && !sp.round, (el) => el.child(rect(25, 0, 200, 200, BODY)))
    .when(Boolean(sp.arch), (el) => el.children(ARCH.map(([x, y, w, h, c]) => rect(x, y, w, h, c))))
    .when(Boolean(sp.round), (el) => el.children(PENGUIN.map(([x, y, w, h, c]) => rect(x, y, w, h, c))))
    .when(Boolean(sp.bot), (el) => el
      .child(rect(25, 24, 200, 104, BODY)).child(rect(55, 2, 56, 30, BODY)).child(rect(122, 0, 64, 34, BODY)).child(rect(176, 12, 40, 24, BODY))
      .child(rect(25, 128, 200, 72, BODY)).child(rect(40, 30, 34, 10, "#8E9CFF"))
      .child(rect(46, 36, 158, 78, sp.screen))
      .child(rect(96, 142, 58, 40, sp.screen))
      .child(rect(104, 150, 8, 8, sp.glyph)).child(rect(112, 158, 8, 8, sp.glyph)).child(rect(104, 166, 8, 8, sp.glyph)).child(rect(126, 164, 20, 6, sp.glyph)))
    .when(Boolean(sp.ears), (el) => el.child(rect(25, 0, 42, 38, SHADE)).child(rect(183, 0, 42, 38, SHADE)))
    .when(Boolean(sp.patch), (el) => el.child(rect(40, 32, 56, 60, sp.patch)).child(rect(146, 32, 56, 60, sp.patch)))
    .when(Boolean(sp.face), (el) => el.child(rect(64, 22, 112, 88, sp.face)).child(rect(14, 40, 26, 18, sp.face)).child(rect(200, 40, 26, 18, sp.face)))
    .children(eyes2)
    // company badge on a lanyard, hanging at the right side of the chest
    .when(!sp.bot && !sp.arch && !sp.round, (el) => el.child(rect(181, 82, 6, 38, BADGE_TOP)).child(rect(163, 120, 42, 56, BADGE)).child(rect(163, 120, 42, 12, BADGE_TOP)).child(rect(174, 140, 20, 16, SHADE)).child(rect(170, 162, 28, 6, SHADE)))
    .when(Boolean(props), (el) => el.child(props));
  group = cheer
    ? motion(group, "top", { from: 0, to: px(-18), period: 300, easing: "ease-in-out" })
    : motion(group, "top", { from: 0, to: px(typing ? 3 : 7), ...(typing ? { period: 480, easing: "ease-in-out" } : BOB) });

  // Four little legs.
  let legs = sp.round
    ? PENGUIN_FEET.map(([x, y, w, h, c], i) => (cheer ? motion(rect(ROOM + x, y, w, h, c), "top", { from: px(i % 2 ? y - 8 : y), to: px(i % 2 ? y : y - 8), period: 600, easing: "ease-in-out" }) : rect(ROOM + x, y, w, h, c)))
    : (sp.legs ?? [45, 90, 145, 190]).map((x) => rect(ROOM + x, 200, sp.legW ?? 22, 40, SHADE));
  if (cheer && !sp.round) legs = legs.map((l, i) => motion(l, "top", { from: px(i % 2 ? 194 : 200), to: px(i % 2 ? 200 : 194), period: 600, easing: "ease-in-out" }));
  const whole = div().absolute().left(0).top(0).w(px(WIDTH)).h(px(HEIGHT)).children(legs).child(group);

  return div().relative().flex_none().w(px(WIDTH)).h(px(HEIGHT)).child(whole);
}
