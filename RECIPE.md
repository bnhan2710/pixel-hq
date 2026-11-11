# Pixel HQ

Your coding agents as a small engineering company. Each agent is a pixel pet sitting on a chair
at its own desk with a MacBook, in a dark office. Its pane header is a desk nameplate with
its job title. Typing, on a break, shipped, needs you: all drawn.

![Pixel HQ](preview.png)

This file is the brief: enough to build Pixel HQ from an empty folder. The files next to it are
one build of it. If they don't work on your Herdr, or you want it different, build it again from here.

## What you see

The Herdr window in a Catppuccin Mocha palette: dark blue-gray panels, light text, a soft blue `#89b4fa`
as the one accent. Panels are rounded (14px) with a faint white 1px border. A sidebar on the left,
tabs and terminals on the right, a status bar at the bottom.

- **Brand block** (top of the sidebar, 46px): the Pixel HQ logo (`mods/company-brand/logo.png`, a pixel-art corgi at a laptop in a rounded purple frame, 34px, transparent corners), "Pixel HQ"
  in semibold 14px and under it "engineering floor" in dim 10px. Search and sidebar-toggle buttons on the right.
- **Floors** (the spaces block, header "Spaces" with a + button): each top-level space is one floor, a 52px card (rounded 8, no outline).
  - Tile (54x40, rounded 6, 1px dark outline): a cut-away of one floor of the night office. Slate wall (a touch lighter while the floor has staff, `#2a2f52`) with a 3px band in the space's color (the one Herdr stores in `space.colors`) along the top, a window with a city skyline, a moon and a few lit panes (brighter while an agent in the space is typing), a small LED screen of colored code lines (some blink while someone types), and a tiled floor with one desk per agent, up to three: a chair, a 8x7 pet in its own colors (crab orange, robot blue, penguin dark with a white belly, Antigravity orange over blue, other agents cream) and a laptop that glows white. A blocked agent's laptop glows pink with a blinking amber `!`; a done agent gets green and yellow sparkles. Empty desks show a dark laptop.
  - Line 1: the space name, semibold. Line 2, dim 11px: the git branch (or the folder name without git), a dot, and "N staff" or "empty",
    then green up and red down arrows for ahead and behind.
  - Right edge: one 8px dot. Blue while someone is typing, pink and softly pulsing when an agent needs you, nothing otherwise.
  - The active floor gets the shipped selected background. Worktree spaces keep the shipped compact tree rows; drag to reorder, the right-click menu
    and the collapsed rail work as in the shipped mod.
  - The mod resizes its own block (`layout.resize`) to `31 + floors x 54 + 20` px, between 100 and 380, plus 56 per remote machine, so the
    office gets the rest; more floors than fit scroll. The layout file starts it at 104px.
- **Pixel header and search** (above the office): a 30px plaque with a notched 2px frame (`#45475a`, corners cut) on a `#181825` fill and a hard 2px `#11111b` shadow below. It holds the corgi logo (24px, the same `logo.png`), "THE ENGINEERING FLOOR" in JetBrains Mono bold 10px caps in `#89b4fa`, then the figures and sort buttons.
- **Find staff** (32px, 10px side margins, same notched frame on `#11111b`, frame turns `#89b4fa` while typing): a hand-drawn pixel magnifier (11 rectangles of 1.5px), the placeholder "Find staff" in mono, and while there is text "matches/total" and an x button. A pet matches when every word of the query appears in its tab or title text, space name, program name, job title (staff engineer, code reviewer, platform engineer) or a status word (typing/working, idle/break, shipped/done, needs you/blocked). Pets that do not match drop to 14% opacity and matches get a yellow nameplate; Enter focuses the first match.
- **Status bar** (28px): "Pixel HQ" in lavender, machine, git branch, "N on the team", then colored dots:
  "typing", "need you", "shipped", "on break".

## The pets

One species per agent program, picked from `program.key`:

| Program | Pet | Job title |
| --- | --- | --- |
| Claude Code | orange crab (`#D97757`, claws and legs `#B5593B`) | Staff Engineer |
| Codex | blue terminal robot: cloud-shaped head, dark screen face with `>` and a blinking `_`, chest panel | Code Reviewer |
| OpenCode | penguin: dark blue body, white face and belly, amber beak | Platform Engineer |
| Antigravity (`agy`, program key `antigravity`) | a small astronaut with a cube head: top face red to orange, a narrow left face and a wide right face blending orange, yellow and green into teal and blue. Big glossy eyes with a white highlight and pink cheeks on the wide face; the narrow face carries a soft vertical edge. A short pale-blue neck ring, a round blue-to-green torso with the Antigravity arch logo on the chest (right of center, no plate, thin pale halo), orange arms and boots. The laptop lid shows the tiny rainbow arch instead of the white apple | Systems Architect |
| anything else | sheep: cream wool, brown face | the program's name |

All are blocky, front-facing, built from rectangles. The body is 200x200 units, claws 25x40 at the sides,
legs underneath; a property room on the left holds desk props. Claude's crab wears a company badge on
a lanyard; the robot has its own chest screen and wears none.

| Status | What the pet does | Pane chip |
| --- | --- | --- |
| working | sits behind a silver MacBook: the lid faces us with a glowing white apple, the screen's light tints its face, claws take turns typing, body bobs | "typing" blue, spinner |
| blocked | waves its right claw, an amber `!` blinks beside it (`!!`, faster, after a minute) | "needs you" |
| done | claws up, hops, amber sparkles twinkle, and seven pixel confetti pieces (yellow, pink, green, blue, violet, orange, teal) fall over the desk until someone looks | "shipped" green |
| idle | stays at its desk, eyes closed, a mug with steam beside it. Every 14 to 32 s one idle pet (picked at random, never two at once) glides out beside its desk (about half a gap sideways and a small step toward the viewer, 0.8 s), stays out for about 8 s and glides back. A one-second timer only decides when; it redraws only when a pet leaves or returns. A pet being dragged stays put | "on break" dim |

## The office

The back wall is a slate night office, left to right: a potted plant, a window with a moon, a round clock, a second window, a water cooler, and two angled LED screens full of colored code lines (some blink) with a glowing projector pad in front that floats a green hologram of the world. Below it is a dark tiled floor with window light. Every pet sits on a grey office chair with a headrest and armrests, behind a steel-grey desk with cubicle panels on both sides.

Desks adapt to the team. Up to four agents get full-size desks in two staggered columns; more agents shrink every desk (never below 0.42x) and add columns and rows until all fit, with each name label as wide as its column (full text in the tooltip). Nobody is ever hidden unless the panel is too small even at the smallest size, then a badge counts the rest.

## Built from

- **The layout** (`layouts/pixel-hq.json`): a root `row` with `padding: 8`, `gap: 8`, `background: #11111b`,
  `titlebar: "none"`, `traffic_lights: [12, 16]` and these `colors`: accent `#89b4fa`, chrome `#181825`,
  canvas `#11111b`, background `#1e1e2e`, surface `#262637`, raised `#313244`, border `#ffffff14`.
  Children: a `sidebar` column (brand block 46px, spaces block, agents block, footer block) and a `work`
  column (tabs block 42px, the terminals block `{ tab: "active", pane: { … } }`, a files/changes panel, status block 28px).
  The pane frame: radius 14, gap 8, background `#1e1e2e`, 1px border, focus border `#89b4fa`,
  header `{ mod: "company-pane", height: 40 }`.
- **Theme** (`themes/pixel-hq.json`): background `#1e1e2e`, foreground `#cdd6f4`, cursor `#89b4fa`, the Catppuccin Mocha 16-color ANSI set.
- **`mods/company-brand/`**: the shipped `workspace-chrome` header with the logo tile and two-line name.
- **`mods/company-pane/`**: a pane header. Reads `panes()` for its terminal; draws the pet with `duckMood`
  from its own `duck.js`; chip colors come from the status.
- **`mods/company-status/`**: counts from `agents()` by status.
- **`mods/company-spaces/`**: the shipped `spaces` mod with a floor card instead of the one-line row. It reads `agents()` and groups by `agent.space`.
- **`mods/company-agents/`**: the agents block: `agents()` for the team, `setAgentOrder` on render, `run("pane.focus")`
  on click. The room is `scene.js` (rectangles plus a few `.loop()` twinkles), the pets are `duck.js`.
  Drag uses `on_mouse_down` on a pet and `on_mouse_move` / `on_mouse_up` on the room, positions stored in
  `localStorage` as fractions of the panel.
- **Motion:** only native `.loop()` and `.spin()`, no timers.
- **Font:** the terminal and UI use whatever Settings says; the build was made with JetBrains Mono NL Medium at 14.

## Install

Copy `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/`, then pick **pixel-hq** in Settings > Look
and the **pixel-hq** theme. Quit and reopen Herdr once so it loads the new mods.

Credits and licenses: see `NOTICE.md`.
