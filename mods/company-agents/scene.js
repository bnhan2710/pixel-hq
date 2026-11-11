// A pixel-art office at night, seen from the front: a slate wall with two city windows and a server rack in the corner, a filing cabinet and a water cooler,
// a tiled floor lit by the windows. Everything snaps to a 4px grid and is built from rectangles; lights twinkle with native .loop().
import { div } from "gpui-kit";

const U = 4;
const snap = (v) => Math.round(v / U) * U;
const r = (x, y, w, h, c) => div().absolute().left(x).top(y).w(w).h(h).bg(c);
const rnd = (i) => { const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };

function ellipse(cx, cy, rx, ry, c) {
  const out = [];
  for (let dy = -ry; dy < ry; dy += U) {
    const half = snap(rx * Math.sqrt(Math.max(0, 1 - ((dy + U / 2) / ry) ** 2)));
    if (half > 0) out.push(r(cx - half, cy + dy, half * 2, U, c));
  }
  return out;
}

// A server corner on the wall: two racks full of blinking status lights, and a holographic world map floating above a projector.
const LIGHTS = ["#f4723a", "#f9d23c", "#8fcb4f", "#37c5d6", "#c678dd", "#f38ba8"];
const WORLD = [
  "....XXXX.....XXXXXX..",
  "...XXXXXXX..XXXXXXXXX",
  "....XXXXXX...XXXXXXX.",
  ".....XXXX.....XXXXX..",
  ".......XX......XXX...",
  ".......XXX.....XX....",
  "........XX....X......",
];
function ledWall(x, w, base) {
  // Two LED code screens on the right wall, set at an angle: 4px strips that step down a little further each time.
  const o = [], top = 12, n = Math.floor(w / U), nA = Math.max(2, Math.round(n * 0.45));
  const ph = base - top - Math.round(n * 0.7) - 4;
  for (let i = 0; i < n; i++) {
    const inA = i < nA, j = inA ? i : i - nA, dy = inA ? Math.round(j * 0.25) : Math.round(j * 0.75) - 2;
    const cx0 = x + i * U + (inA ? 0 : 2);
    if (j === 0) o.push(r(cx0 - 3, top + dy - 3, 3, ph + 6, "#0a0c1a"));
    o.push(r(cx0, top + dy - 3, U, ph + 6, "#0a0c1a"), r(cx0, top + dy, U, ph, "#10132a"), r(cx0, top + dy, U, 3, "#2a2f55"));
    for (let row = 0; row < Math.floor((ph - 8) / 6); row++) {
      const seg = i + row * 3 + (inA ? 0 : 7);
      if (seg % 3 === 2 || rnd(row * 13 + Math.floor(seg / 3) * 5 + (inA ? 0 : 99)) < 0.22) continue;
      const bar = r(cx0, top + dy + 6 + row * 6, U, 3, LIGHTS[Math.floor(rnd(row * 3 + Math.floor(seg / 3) * 7) * LIGHTS.length)]);
      o.push((row + i) % 7 === 0 ? bar.loop("opacity", { from: 0.35, to: 1, period: 900 + ((row * 130 + i * 90) % 900), easing: "ease-in-out" }) : bar);
    }
  }
  // The projector pad stands in front of the screens, a green hologram of the world above it.
  const hx = x + Math.floor((w - 40) / 2), hy = base - 14;
  const beam = [];
  for (let i = 0; i < 4; i++) beam.push(r(hx + 6 - i * 3, hy - 4 - i * 5, 28 + i * 6, 5, "#6fe0f01c"));
  const map = [];
  WORLD.forEach((line, yy) => [...line].forEach((ch, xx) => { if (ch === "X") map.push(r(hx - 6 + xx * 2, hy - 30 + yy * 3, 2, 3, "#7be495")); }));
  o.push(
    div().absolute().left(0).top(0).w(1).h(1).children(beam).loop("opacity", { from: 0.5, to: 1, period: 2400, easing: "ease-in-out" }),
    r(hx, hy, 40, 14, "#aab4d6"), r(hx, hy, 40, 3, "#d3d8ea"), r(hx + 4, hy - 3, 32, 5, "#6fe0f0"), r(hx + 4, hy + 8, 6, 3, "#e8d44a"), r(hx + 28, hy + 8, 8, 3, "#37c5d6"),
    div().absolute().left(0).top(0).w(1).h(1).children(map).loop("opacity", { from: 0.55, to: 1, period: 2200, easing: "ease-in-out" }),
  );
  return o;
}

export const yHorizon = (H) => snap(snap(H) * 0.3); // where the wall ends and the floor begins

export function scene(W, H) {
  W = snap(W); H = snap(H);
  const yH = yHorizon(H);
  const base = yH - 8; // the top of the baseboard: things stand on it
  const L = [];

  // Back wall: slate, a lighter band, a dark skirting and a dark line under the ceiling.
  L.push(r(0, 0, W, yH, "#262a42"), r(0, 0, W, 4, "#161827"), r(0, yH - 32, W, 24, "#2c3150"), r(0, yH - 32, W, 4, "#363c5f"), r(0, base, W, 8, "#171a2c"));

  // Two windows onto a night city, in dark frames with a pale sill and a few glints on the glass.
  const win = (x, seed, withMoon, ww = W * 0.25) => {
    const w = snap(ww), h = snap(yH * 0.58), y = snap(yH * 0.1);
    const o = [r(x - 4, y - 4, w + 8, h + 8, "#0c0e1c"), r(x, y, w, h, "#0e1226")];
    for (let i = 0; i < 6; i++) o.push(r(x + 6 + (i % 4) * snap(w / 4), y + 6 + snap(rnd(i + seed) * h * 0.3), U, U, "#f5e9b0").loop("opacity", { from: 0.2, to: 0.9, period: 1500 + i * 400, easing: "ease-in-out" }));
    if (withMoon) o.push(...ellipse(x + w - 16, y + 16, 8, 8, "#d9cf9a"));
    const bw = snap(w / 6);
    for (let i = 0; i < 6; i++) {
      const bh = snap(14 + rnd(i + seed * 7) * h * 0.5), bx = x + i * bw;
      o.push(r(bx, y + h - bh, bw - 2, bh, "#161b36"));
      for (let k = 0; k < 3; k++) if (rnd(i * 5 + k + seed) > 0.35) o.push(r(bx + 4 + (k % 2) * 8, y + h - bh + 6 + Math.floor(k / 2) * 10, U, U, "#e0b94a").loop("opacity", { from: 0.5, to: 1, period: 2000 + k * 700, easing: "ease-in-out" }));
    }
    for (const f of [0.16, 0.5, 0.84]) for (let s = 0; s < h / 4; s++) { const gx = x + f * w - s * 3; if (gx > x + 2 && gx + 8 < x + w - 2) o.push(r(gx, y + s * 4, 8, 4, "#ffffff0d")); }
    o.push(r(x + w / 2 - 2, y, 4, h, "#0c0e1c"), r(x, y + h / 2 - 2, w, 4, "#0c0e1c"), r(x - 8, y + h + 4, w + 16, 5, "#7e86ad"));
    return o;
  };
  // Left to right: a plant, two windows with the clock between them, the water cooler, then the LED screens and hologram.
  const rackW = Math.max(48, Math.min(96, snap(W * 0.2))), rackX = W - rackW - 10;
  const cw = rackX - 30, x0 = 38, usable = cw - 10 - x0;
  const two = usable >= 100;
  const gap = two ? Math.max(32, snap(usable * 0.26)) : 0;
  const wA = two ? snap((usable - gap) / 2) : usable, wB = usable - wA - gap;
  const wx1 = x0, wx2 = x0 + wA + gap;
  L.push(...win(wx1, 1, true, wA));
  if (two) L.push(...win(wx2, 4, false, wB));

  // Clock between the windows and, when there is room, the blue sign under it.
  const cx = two ? wx1 + wA + Math.floor(gap / 2) : snap(W * 0.5), cr = Math.min(14, Math.floor(gap / 2) - 2) || 14;
  const rr = Math.max(8, cr);
  L.push(...ellipse(cx, 26, rr, rr, "#8e94b2"), ...ellipse(cx, 26, rr - 4, rr - 4, "#d8dcee"), r(cx - 1, 26 - rr + 4, 2, rr - 3, "#2a2d44"), r(cx, 25, rr - 5, 2, "#2a2d44"), r(cx - 2, 24, 4, 4, "#c0424e"));
  if (gap >= 44 && base - 48 >= 88) L.push(r(cx - 16, 48, 32, 32, "#2a2f4a"), r(cx - 12, 62, 24, 4, "#89b4fa"), r(cx - 2, 52, 4, 24, "#89b4fa"),
    r(cx - 8, 54, 4, 4, "#89b4fa"), r(cx + 4, 54, 4, 4, "#89b4fa"), r(cx - 8, 70, 4, 4, "#89b4fa"), r(cx + 4, 70, 4, 4, "#89b4fa"));

  // The water cooler stands on the baseboard, left of the screens.
  L.push(r(cw + 2, base - 54, 16, 22, "#6fa8d6"), r(cw + 4, base - 52, 4, 10, "#a9d0ee"), r(cw, base - 32, 20, 32, "#b7bfd6"), r(cw, base - 32, 20, 4, "#d3d8ea"), r(cw + 8, base - 24, 4, 4, "#e8744f"));

  // A potted plant in the left corner and the LED wall in the right one.
  const plant = (x) => [
    r(x, base - 44, 10, 26, "#2f6e3b"), r(x + 8, base - 54, 10, 36, "#3a8247"), r(x + 18, base - 42, 10, 24, "#2f6e3b"), r(x + 4, base - 34, 6, 6, "#52a35f"),
    r(x + 2, base - 18, 24, 18, "#8a5a3c"), r(x, base - 18, 28, 4, "#a06c48"),
  ];
  L.push(...plant(6), ...ledWall(rackX, rackW, base));

  // Tiled floor: a dark base with a grid of 24px tiles, and a pool of window light under each window.
  L.push(r(0, yH, W, H - yH, "#242843"));
  for (let x = 0; x < W; x += 24) L.push(r(x, yH, 2, H - yH, "#1c1f36"));
  for (let y = yH + 4; y < H; y += 24) L.push(r(0, y, W, 2, "#1c1f36"));
  for (const [wx, wl] of two ? [[wx1, wA], [wx2, wB]] : [[wx1, wA]]) for (let i = 0; i < 9; i++) L.push(r(wx + i * 6, yH + 8 + i * 8, Math.round(wl * 0.85), 8, "#ffffff07"));
  L.push(r(0, yH, 4, H - yH, "#0d0f1a"), r(W - 4, yH, 4, H - yH, "#0d0f1a"), r(0, H - 4, W, 4, "#0d0f1a"));

  return div().absolute().left(0).top(0).w(W).h(H).overflow_hidden().children(L);
}

// Where each desk stands: x as a fraction of the width, y of the floor. Two staggered columns.
export const SLOTS = [
  [0.27, 0.0], [0.74, 0.1], [0.27, 0.62], [0.74, 0.72], [0.27, 1.0], [0.74, 1.0],
];
