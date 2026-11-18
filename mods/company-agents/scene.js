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

// The tech corner on the wall: a server rack (drive bays, vents and fans, a glowing light on every unit) and a modern little desk with a monitor, keyboard and a mug.
const LIGHTS = ["#f4723a", "#f9d23c", "#8fcb4f", "#37c5d6", "#c678dd", "#f38ba8"];
const CODE = ["#cba6f7", "#89b4fa", "#a6e3a1", "#f9e2af", "#f5c2e7", "#94e2d5"]; // keyword, function, string, class, tag, type
function ledWall(x, w, base, isMusicPlaying = false) {
  const o = [], top = 8, rw = w >= 64 ? snap(Math.min(28, w * 0.34)) : snap(w), rh = snap(Math.min(base - top, 80)), rt = base - rh;
  // Server rack: a cabinet with a lit top cap, a darker side, a plinth with feet, and units of three kinds.
  o.push(r(x - 2, rt - 2, rw + 4, rh + 2, "#0a0c1a"), r(x, rt, rw, rh, "#1a1f3d"), r(x + rw - 3, rt, 3, rh, "#12152c"), r(x, rt, 1, rh, "#2c3366"),
    r(x, rt, rw, 3, "#2c3366"), r(x + 3, rt + 4, rw - 8, 5, "#0a0d26"), r(x + 3, rt + 4, rw - 8, 1, "#3a4180"), r(x, base - 5, rw, 5, "#10132a"), r(x + 1, base - 1, 4, 1, "#3a3f66"), r(x + rw - 5, base - 1, 4, 1, "#3a3f66"));
  for (let c = 0; c < Math.floor((rw - 12) / 2); c++) { const h = 1 + Math.floor(rnd(c * 3 + 1) * 3); o.push(r(x + 5 + c * 2, rt + 8 - h, 1, h, c % 4 === 3 ? "#f9e2af" : "#a6e3a1")); }
  o.push(r(x - 6, rt - 4, rw + 12, rh + 4, "#a78bfa0b"));
  const units = Math.max(3, Math.floor((rh - 22) / 11));
  for (let k = 0; k < units; k++) {
    const uy = rt + 11 + k * 11, ux = x + 3, uw = rw - 8, kind = k % 4, ledC = LIGHTS[[2, 2, 0, 3, 2, 1][k % 6]];
    o.push(r(ux, uy, uw, 9, "#252b52"), r(ux, uy, uw, 1, "#3a4180"), r(ux, uy + 8, uw, 1, "#0f1226"));
    if (kind === 0) for (let b = 0; b < Math.min(3, Math.floor((uw - 10) / 5)); b++) o.push(r(ux + 8 + b * 5, uy + 2, 4, 5, "#323a70"), r(ux + 8 + b * 5, uy + 2, 4, 1, "#4a529a"));
    else if (kind === 1) for (let v = 0; v < Math.floor((uw - 10) / 3); v++) o.push(r(ux + 8 + v * 3, uy + 2, 1, 5, "#10132a"));
    else if (kind === 3) for (let q = 0; q < Math.floor((uw - 10) / 3); q++) {
      const pc = rnd(k * 9 + q) > 0.5 ? "#8fcb4f" : "#f4a23a", port = r(ux + 8 + q * 3, uy + 3, 2, 3, pc);
      o.push(r(ux + 8 + q * 3, uy + 6, 2, 1, "#10132a"), (q + k) % 3 === 0 ? port.loop("opacity", { from: 0.2, to: 1, period: 350 + ((q * 170 + k * 90) % 500), easing: "linear" }) : port);
    }
    else for (let f = 0; f < (uw >= 28 ? 2 : 1); f++) o.push(r(ux + 8 + f * 8, uy + 2, 5, 5, "#10132a"), r(ux + 9 + f * 8, uy + 3, 3, 3, "#323a70"));
    o.push(r(ux + 1, uy + 2, 5, 5, ledC + "33"));
    const led = r(ux + 2, uy + 3, 3, 3, ledC);
    o.push(k % 3 === 1 ? led.loop("opacity", { from: 0.25, to: 1, period: 700 + k * 230, easing: "ease-in-out" }) : led);
  }
  if (w >= 64) {
    const rx = x + 3, ry = rt - 11;
    o.push(
      r(rx, ry + 2, 18, 9, "#313244"),
      r(rx + 4, ry, 10, 2, "#45475a"),
      r(rx + 2, ry + 4, 4, 5, "#181825"),
      r(rx + 3, ry + 5, 2, 3, isMusicPlaying ? "#89b4fa" : "#45475a"),
      r(rx + 12, ry + 4, 4, 5, "#181825"),
      r(rx + 13, ry + 5, 2, 3, isMusicPlaying ? "#89b4fa" : "#45475a"),
      r(rx + 7, ry + 4, 4, 4, "#11111b"),
      r(rx + 15, ry - 3, 1, 3, "#89b4fa"),
      r(rx + 8, ry + 2, 2, 1, isMusicPlaying ? "#a6e3a1" : "#585b70")
    );
    if (isMusicPlaying) {
      o.push(
        r(rx + 4, ry - 6, 2, 2, "#cba6f7").loop("opacity", { from: 0.1, to: 1, period: 1400, easing: "ease-in-out" }),
        r(rx + 5, ry - 9, 1, 4, "#cba6f7").loop("opacity", { from: 0.1, to: 1, period: 1400, easing: "ease-in-out" }),
        r(rx + 11, ry - 9, 2, 2, "#89b4fa").loop("opacity", { from: 0.8, to: 0.1, period: 1700, easing: "ease-in-out" }),
        r(rx + 12, ry - 12, 1, 4, "#89b4fa").loop("opacity", { from: 0.8, to: 0.1, period: 1700, easing: "ease-in-out" }),
        r(rx + 17, ry - 5, 2, 2, "#f5c2e7").loop("opacity", { from: 0.2, to: 0.9, period: 1200, easing: "ease-in-out" })
      );
    }
  }
  if (w < 64) return o;
  // A little desk on the baseboard: a slim modern desk, and on it a monitor (code editor with a gutter, minimap and status bar), a keyboard, a mouse and a mug.
  const flick = (el, from, period) => el.loop("opacity", { from, to: 1, period, easing: "linear" });
  const mx = x + rw + 6, mw = snap(w - rw - 6), deskY = base - 17;
  const mh = Math.max(24, Math.min(deskY - top - 20, Math.round(mw * 0.8)));
  const my = deskY - 11 - mh, sy = my + mh + 3;
  o.push(r(mx - 4, my - 6, mw + 8, mh + 12, "#89b4fa0c"), // the screen's glow on the wall
    r(mx - 6, base, mw + 12, 2, "#0a0c1a66"),
    // a modern desk: a slim light top, thin dark legs with feet, a cable tray, a hanging white drawer and a glowing LED strip underneath
    r(mx - 5, deskY, mw + 10, 3, "#dfe3f2"), r(mx - 5, deskY, mw + 10, 1, "#f4f6fc"), r(mx - 5, deskY + 3, mw + 10, 1, "#9aa1c2"),
    r(mx - 5, base - 3, mw + 10, 3, "#6fe0f01a"), r(mx - 2, deskY + 4, 2, base - deskY - 4, "#2a2e4a"), r(mx + mw, deskY + 4, 2, base - deskY - 4, "#2a2e4a"),
    r(mx - 4, base - 1, 6, 1, "#2a2e4a"), r(mx + mw - 2, base - 1, 6, 1, "#2a2e4a"), r(mx + 1, deskY + 5, mw - 2, 2, "#1c2038"),
    r(mx + mw - 16, deskY + 7, 14, 8, "#c9cee4"), r(mx + mw - 16, deskY + 7, 14, 1, "#e6e9f5"), r(mx + mw - 13, deskY + 10, 8, 1, "#7e86ad"), r(mx + mw - 13, deskY + 13, 8, 1, "#7e86ad"),
    r(mx - 2, deskY + 4, mw + 4, 1, "#6fe0f0").loop("opacity", { from: 0.3, to: 1, period: 2600, easing: "ease-in-out" }), r(mx - 2, deskY + 4, mw + 4, 1, "#c4a0ff").loop("opacity", { from: 1, to: 0.3, period: 2600, easing: "ease-in-out" }),
    // the monitor: bezel with a light top edge, a neck and a foot
    r(mx - 3, my - 6, mw + 6, 2, "#f5c2e7").loop("opacity", { from: 0.2, to: 1, period: 2600, easing: "ease-in-out" }), r(mx - 3, my - 6, mw + 6, 2, "#89dceb").loop("opacity", { from: 1, to: 0.2, period: 2600, easing: "ease-in-out" }),
    r(mx - 3, my - 3, mw + 6, mh + 6, "#0a0c1a"), r(mx + Math.floor(mw / 2) - 1, my - 2, 2, 1, "#4a5090"), r(mx - 3, my - 3, mw + 6, 1, "#3a3f66"), r(mx, my, mw, mh, "#10143a"), r(mx, my + Math.floor(mh / 2), mw, Math.ceil(mh / 2), "#0e1233"),
    r(mx + Math.floor(mw / 2) - 2, sy, 4, deskY - sy, "#0a0c1a"), r(mx + Math.floor(mw / 2) - 9, deskY - 3, 18, 3, "#0a0c1a"), r(mx + Math.floor(mw / 2) - 9, deskY - 3, 18, 1, "#3a3f66"),
    // title bar with three dots and a tab
    r(mx, my, mw, 5, "#232a5c"), r(mx + 2, my + 1, 3, 3, "#f38ba8"), r(mx + 7, my + 1, 3, 3, "#f9e2af"), r(mx + 12, my + 1, 3, 3, "#a6e3a1"), r(mx + 18, my + 1, Math.min(14, mw - 40), 4, "#10143a"), flick(r(mx + mw - 12, my + 1, 9, 3, "#a6e3a1"), 0.35, 1000),
    // status bar
    r(mx, my + mh - 4, mw, 4, "#1d2250"), r(mx + 2, my + mh - 3, 8, 2, "#89b4fa"), flick(r(mx + 12, my + mh - 3, 6, 2, "#a6e3a1"), 0.3, 800), r(mx + mw - 9, my + mh - 3, 6, 2, "#f9e2af"),
    // keyboard, mouse, mug with steam
    r(mx + 3, deskY - 3, Math.min(mw - 16, 26), 3, "#2a2f4f"), r(mx + 3, deskY - 3, Math.min(mw - 16, 26), 1, "#f5c2e7").loop("opacity", { from: 0.3, to: 1, period: 2600, easing: "ease-in-out" }), r(mx + 3, deskY - 3, Math.min(mw - 16, 26), 1, "#89dceb").loop("opacity", { from: 1, to: 0.3, period: 2600, easing: "ease-in-out" }), r(mx + mw - 12, deskY - 2, 4, 2, "#aab4d6"),
    r(mx + mw - 6, deskY - 5, 5, 5, "#e8e2d0"), r(mx + mw - 1, deskY - 4, 2, 3, "#e8e2d0"), r(mx + mw - 5, deskY - 5, 3, 1, "#6b4430"),
    r(mx + mw - 5, deskY - 9, 1, 3, "#cdd6f4").loop("opacity", { from: 0, to: 0.7, period: 1600, easing: "ease-in-out" }), r(mx + mw - 3, deskY - 11, 1, 3, "#cdd6f4").loop("opacity", { from: 0.6, to: 0, period: 1900, easing: "ease-in-out" }));
  // The monitor shows a worker processing data: code on top with the lines being run shimmering, and under it a live log (finished batches in green,
  // the current one blinking amber, the text flickering as it streams), a progress bar with a blinking frontier and a throughput meter.
  const edH = Math.floor((mh - 15) * 0.42), tY = my + 8 + edH + 2, tH = my + mh - 5 - tY;
  if (tH >= 12) {
    o.push(r(mx, tY, mw, tH, "#080b22"), r(mx, tY, mw, 1, "#2a3270"));
    const logRows = Math.min(5, Math.floor((tH - 9) / 4));
    for (let l = 0; l < logRows; l++) {
      const y = tY + 3 + l * 4, cur = l === logRows - 1, wMax = Math.max(6, mw - 28), mwid = 5 + Math.floor(rnd(l * 5 + 2) * (wMax - 5));
      o.push(cur ? flick(r(mx + 2, y, 2, 2, "#f9e2af"), 0.1, 520) : r(mx + 2, y, 2, 2, "#a6e3a1"), r(mx + 6, y, 5, 2, "#4a529a"),
        flick(r(mx + 13, y, mwid, 2, cur ? "#e6e9f5" : "#7a84bd"), cur ? 0.25 : 0.55, cur ? 330 : 1100 + l * 370),
        r(mx + mw - 8, y, 5, 2, cur ? "#f9e2af" : "#94e2d5"));
    }
    const py = tY + tH - 5, segs = Math.floor((mw - 6 - 14) / 3), lit = Math.max(1, segs - 2);
    for (let q = 0; q < segs; q++) { const seg = r(mx + 3 + q * 3, py, 2, 2, q < lit ? "#a6e3a1" : "#1d2250"); o.push(q === lit - 1 ? flick(seg, 0.2, 600) : seg); }
    for (let t = 0; t < 4; t++) { const h = 2 + Math.floor(rnd(t * 3 + 5) * 3); o.push(flick(r(mx + mw - 14 + t * 3, py + 2 - h, 2, h, "#89b4fa"), 0.25, 380 + t * 170)); }
  }
  const rows = Math.floor(edH / 4), indents = [0, 1, 1, 2, 2, 1, 2, 0, 1, 2, 1, 0], right = mx + mw - 9;
  for (let row = 0; row < rows; row++) {
    const ry = my + 8 + row * 4;
    o.push(r(mx + 2, ry, 2, 2, "#3a3f66"));
    if (row === 2) o.push(r(mx + 5, ry - 1, mw - 10, 4, "#ffffff0b"));
    if (row % 5 === 4) continue;
    let cx = mx + 7 + indents[row % indents.length] * 4;
    for (let part = 0; part < 3; part++) {
      const pw = 4 + Math.floor(rnd(row * 7 + part * 3) * 11);
      if (cx + pw > right) break;
      o.push(r(cx, ry, pw, 2, CODE[Math.floor(rnd(row * 11 + part * 5 + 2) * CODE.length)]));
      cx += pw + 2;
    }
  }
  for (const [rr, per] of [[1, 1100], [3, 1500]]) if (rr < rows) o.push(flick(r(mx + 5, my + 7 + rr * 4, mw - 10, 4, "#a6e3a122"), 0.15, per));
  for (let m = 0; m < Math.floor(edH / 3); m++) o.push(r(mx + mw - 6, my + 8 + m * 3, 2 + Math.floor(rnd(m * 4 + 1) * 3), 1, "#4a529a"));
  o.push(r(mx + 7 + 4, my + 8 + Math.min(rows - 1, 3) * 4, 2, 2, "#cdd6f4").loop("opacity", { from: 0, to: 1, period: 900, easing: "ease-in-out" }));
  return o;
}

export const yHorizon = (H) => snap(snap(H) * 0.3); // where the wall ends and the floor begins

export function scene(W, H, isMusicPlaying = false) {
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
  // Left to right: a plant, two windows with the clock between them, the water cooler, then the server rack and wall monitor.
  const rackW = Math.max(64, Math.min(110, snap(W * 0.27))), rackX = W - rackW - 10;
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

  // The water cooler stands on the baseboard, left of the server rack.
  L.push(r(cw + 2, base - 54, 16, 22, "#6fa8d6"), r(cw + 4, base - 52, 4, 10, "#a9d0ee"), r(cw, base - 32, 20, 32, "#b7bfd6"), r(cw, base - 32, 20, 4, "#d3d8ea"), r(cw + 8, base - 24, 4, 4, "#e8744f"));

  // A potted plant in the left corner and the tech corner in the right one.
  const plant = (x) => [
    r(x, base - 44, 10, 26, "#2f6e3b"), r(x + 8, base - 54, 10, 36, "#3a8247"), r(x + 18, base - 42, 10, 24, "#2f6e3b"), r(x + 4, base - 34, 6, 6, "#52a35f"),
    r(x + 2, base - 18, 24, 18, "#8a5a3c"), r(x, base - 18, 28, 4, "#a06c48"),
  ];
  L.push(...plant(6), ...ledWall(rackX, rackW, base, isMusicPlaying));

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
