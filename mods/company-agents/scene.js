// A pixel-art office at night: wall with city windows, a clock and the Claude sign, a carpeted floor.
// Everything snaps to a 4px grid and is built from rectangles; lights twinkle with native .loop().
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

export const yHorizon = (H) => snap(snap(H) * 0.3); // where the wall ends and the floor begins

export function scene(W, H) {
  W = snap(W); H = snap(H);
  const yH = yHorizon(H);
  const L = [];

  // Wall, wainscot and baseboard.
  L.push(r(0, 0, W, yH, "#2c2421"), r(0, yH - 28, W, 28, "#322a26"), r(0, yH - 28, W, 4, "#3d332d"), r(0, yH - 4, W, 4, "#120f0d"));

  // Two windows onto a night city.
  const win = (x, seed, withMoon) => {
    const w = snap(W * 0.3), h = snap(yH * 0.58), y = snap(yH * 0.1);
    const o = [r(x - 4, y - 4, w + 8, h + 8, "#4a3d35"), r(x, y, w, h, "#0e1226")];
    for (let i = 0; i < 6; i++) o.push(r(x + 6 + (i % 4) * snap(w / 4), y + 6 + snap(rnd(i + seed) * h * 0.3), U, U, "#f5e9b0").loop("opacity", { from: 0.2, to: 0.9, period: 1500 + i * 400, easing: "ease-in-out" }));
    if (withMoon) o.push(...ellipse(x + w - 16, y + 16, 8, 8, "#d9cf9a"));
    const bw = snap(w / 6);
    for (let i = 0; i < 6; i++) {
      const bh = snap(14 + rnd(i + seed * 7) * h * 0.5), bx = x + i * bw;
      o.push(r(bx, y + h - bh, bw - 2, bh, "#161b36"));
      for (let k = 0; k < 3; k++) if (rnd(i * 5 + k + seed) > 0.35) o.push(r(bx + 4 + (k % 2) * 8, y + h - bh + 6 + Math.floor(k / 2) * 10, U, U, "#e0b94a").loop("opacity", { from: 0.5, to: 1, period: 2000 + k * 700, easing: "ease-in-out" }));
    }
    o.push(r(x + w / 2 - 2, y, 4, h, "#4a3d35"), r(x, y + h / 2 - 2, w, 4, "#4a3d35"), r(x - 8, y + h + 4, w + 16, 4, "#3b3029"));
    return o;
  };
  L.push(...win(snap(W * 0.06), 1, true), ...win(snap(W * 0.64), 4, false));

  // Clock and the orange sign between them.
  const cx = snap(W * 0.5);
  L.push(...ellipse(cx, 26, 14, 14, "#8e94b2"), ...ellipse(cx, 26, 10, 10, "#d8dcee"), r(cx - 2, 18, 4, 10, "#222"), r(cx, 24, 8, 4, "#222"));
  L.push(r(cx - 16, 48, 32, 32, "#33291f"), r(cx - 12, 62, 24, 4, "#d97757"), r(cx - 2, 52, 4, 24, "#d97757"),
    r(cx - 8, 54, 4, 4, "#d97757"), r(cx + 4, 54, 4, 4, "#d97757"), r(cx - 8, 70, 4, 4, "#d97757"), r(cx + 4, 70, 4, 4, "#d97757"));

  // Plant and water cooler against the wall.
  L.push(
    r(6, yH - 40, 8, 24, "#2f6e3b"), r(14, yH - 50, 8, 34, "#3a8247"), r(22, yH - 38, 8, 22, "#2f6e3b"), r(10, yH - 18, 16, 16, "#8a5a3c"), r(10, yH - 18, 16, 4, "#a06c48"),
    r(W - 34, yH - 56, 16, 24, "#4c8cc0"), r(W - 36, yH - 32, 20, 32, "#aab4c8"), r(W - 34, yH - 24, 4, 4, "#e8744f"),
  );

  // Floor with soft tiles, and a carpet in the middle.
  L.push(r(0, yH, W, H - yH, "#1f1b19"));
  for (let y = yH, i = 0; y < H; y += 40, i++) for (let x = (i % 2) * 40; x < W; x += 80) L.push(r(x, y, 40, 40, "#241f1c"));
  L.push(r(snap(W * 0.04), yH + 24, snap(W * 0.92), H - yH - 40, "#2f2622"), r(snap(W * 0.04), yH + 24, snap(W * 0.92), 4, "#4d3e34"), r(snap(W * 0.04), H - 20, snap(W * 0.92), 4, "#4d3e34"));

  return div().absolute().left(0).top(0).w(W).h(H).overflow_hidden().children(L);
}

// Where each desk stands: x as a fraction of the width, y of the floor. Two staggered columns.
export const SLOTS = [
  [0.27, 0.0], [0.74, 0.15], [0.27, 0.5], [0.74, 0.65], [0.27, 1.0], [0.74, 1.0],
];
