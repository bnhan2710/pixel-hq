# Agent Co.

Your coding agents as a small engineering company. Each agent is a pixel pet sitting on a chair
at its own desk with a MacBook, in a warm-dark office. Its pane header is a desk nameplate with
its job title. Typing, on a break, shipped, needs you: all drawn.

![Agent Co.](preview.png)

This file is the brief: enough to build Agent Co. from an empty folder. The files next to it are
one build of it. If they don't work on your Herdr, or you want it different, build it again from here.

## What you see

The Herdr window in a warm dark palette: charcoal-brown panels, cream text, Claude orange `#D97757`
as the one accent. Panels are rounded (14px) with a faint white 1px border. A sidebar on the left,
tabs and terminals on the right, a status bar at the bottom.

- **Brand block** (top of the sidebar, 46px): a 30px orange tile with a cream pixel asterisk, "Agent Co."
  in semibold 14px and under it "engineering floor" in dim 10px. Search and sidebar-toggle buttons on the right.
- **Spaces list**: the shipped `spaces` mod, unchanged.
- **The Engineering Floor** (the agents block, bottom of the sidebar): a pixel-art office, all on a 4px grid.
  - Back wall: two windows onto a night city (lit windows twinkle), a wall clock, a small orange
    asterisk sign between them, a plant on the left, a water cooler on the right.
  - Floor: dark tiles and a carpet with a lighter border.
  - Each agent sits at a wooden desk (a drawer-less top with two legs) on a tall teal office chair with
    an orange headrest strip, a pole, a star base and wheels. A small nameplate under the desk shows the
    agent's tab name and how long it has been in this state; the focused agent's plate is yellow,
    one that needs you is rust-red.
  - Desks stand in two staggered columns, 6 slots, then wrap with a small offset.
  - Drag a pet to move its desk anywhere in the room; positions are remembered. Click (no drag)
    focuses that agent. Right-click a pet to change its figures; right-click empty floor to reset positions.
- **Pane headers** (40px): the agent's pet (30px tall), its name, a job-title chip, the folder, and a
  status chip on the right. Hovering shows split, zoom and close buttons.
- **Status bar** (28px): "Agent Co. HQ" in orange, machine, git branch, "N on the team", then colored dots:
  "typing", "need you", "shipped", "on break".

## The pets

One species per agent program, picked from `program.key`:

| Program | Pet | Job title |
| --- | --- | --- |
| Claude Code | orange crab (`#D97757`, claws and legs `#B5593B`) | Staff Engineer |
| Codex | blue terminal robot: cloud-shaped head, dark screen face with `>` and a blinking `_`, chest panel | Code Reviewer |
| OpenCode | penguin: dark blue body, white face and belly, amber beak | Platform Engineer |
| anything else | sheep: cream wool, brown face | the program's name |

All are blocky, front-facing, built from rectangles. The body is 200x200 units, claws 25x40 at the sides,
legs underneath; a property room on the left holds desk props. Claude's crab wears a company badge on
a lanyard; the robot has its own chest screen and wears none.

| Status | What the pet does | Pane chip |
| --- | --- | --- |
| working | sits behind a silver MacBook: the lid faces us with a glowing white apple, the screen's light tints its face, claws take turns typing, body bobs | "typing" orange, spinner |
| blocked | waves its right claw, an amber `!` blinks beside it (`!!`, faster, after a minute) | "needs you" |
| done | claws up, hops, amber sparkles twinkle | "shipped" green |
| idle | eyes closed, a mug with steam beside it | "on break" dim |

## Built from

- **The layout** (`layouts/company.json`): a root `row` with `padding: 8`, `gap: 8`, `background: #100e0d`,
  `titlebar: "none"`, `traffic_lights: [12, 16]` and these `colors`: accent `#D97757`, chrome `#171412`,
  canvas `#100e0d`, background `#1f1c1a`, surface `#2a2420`, raised `#332b26`, border `#ffffff14`.
  Children: a `sidebar` column (brand block 46px, spaces block, agents block, footer block) and a `work`
  column (tabs block 42px, the terminals block `{ tab: "active", pane: { … } }`, a files/changes panel, status block 28px).
  The pane frame: radius 14, gap 8, background `#1f1c1a`, 1px border, focus border `#D97757`,
  header `{ mod: "company-pane", height: 40 }`.
- **Theme** (`themes/company.json`): background `#1f1c1a`, foreground `#f2e8dc`, cursor `#D97757`, a warm 16-color ANSI set.
- **`mods/company-brand/`**: the shipped `workspace-chrome` header with the logo tile and two-line name.
- **`mods/company-pane/`**: a pane header. Reads `panes()` for its terminal; draws the pet with `duckMood`
  from its own `duck.js`; chip colors come from the status.
- **`mods/company-status/`**: counts from `agents()` by status.
- **`mods/company-agents/`**: the agents block: `agents()` for the team, `setAgentOrder` on render, `run("pane.focus")`
  on click. The room is `scene.js` (rectangles plus a few `.loop()` twinkles), the pets are `duck.js`.
  Drag uses `on_mouse_down` on a pet and `on_mouse_move` / `on_mouse_up` on the room, positions stored in
  `localStorage` as fractions of the panel.
- **Motion:** only native `.loop()` and `.spin()`, no timers.
- **Font:** the terminal and UI use whatever Settings says; the build was made with JetBrains Mono NL Medium at 14.

## Install

Copy `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/`, then pick **company** in Settings > Look
and the **company** theme. Quit and reopen Herdr once so it loads the new mods.

Credits and licenses: see `NOTICE.md`.
