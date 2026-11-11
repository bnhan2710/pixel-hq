<h1 align="center">Pixel HQ</h1>

<p align="center">
  A <a href="https://herdr.dev">Herdr</a> layout where your coding agents are a small engineering company.<br>
  Pixel pets at desks, chairs and MacBooks, in a dark Catppuccin office.
</p>

<p align="center">
  <img src="preview.png" alt="Pixel HQ layout for Herdr: an office of pixel pets in the sidebar, desk nameplates on every pane, a team status bar" width="900">
</p>

<p align="center">
  <img src="demo.gif" alt="The engineering floor in motion: pets type at their desks and step out beside them on a break" width="320"><br>
  <sub>The floor, live: pets type, step away from the desk on a break and come right back.</sub>
</p>

<p align="center">
  <img src="screenshot.png" alt="A real screenshot of the layout" width="900"><br>
  <sub>A real screenshot (demo data only).</sub>
</p>

## What you get

- **Every space is a floor.** The Spaces list becomes floor cards: a small pixel room tinted with the space's color (a window that lights up while someone is typing, one desk per agent), the name, `branch · N staff`, and a status dot: blue when someone is typing, pink when an agent needs you. The block is only as tall as its floors, so the office below gets the rest of the sidebar.
- **An office in your sidebar.** Every agent is a pixel pet sitting on an office chair at its own desk, with a MacBook.
  Drag a pet to move its desk anywhere; click to jump to that agent.
- **Pets that live their day.** When an agent goes idle its pet mostly stays at the desk; every so often one steps out beside it for a few seconds and comes right back. When work arrives it types. When an agent ships, pixel confetti rains over its desk until you look.
- **Desk nameplates on every pane.** The pane header shows the pet, its job title and a live status chip:
  `typing`, `needs you`, `shipped` or `on break`.
- **Find staff.** A search bar above the office: type a name, a job title (`reviewer`, `engineer`), a status (`typing`, `break`) or a space, and everyone who does not match fades out while matches get a yellow nameplate. Enter jumps to the first match.
- **A team status bar.** "Pixel HQ", how many agents are on the team, and how many are typing, blocked, shipped or on break.
- **A company sign.** The Herdr logo with "Pixel HQ / engineering floor" at the top of the sidebar.
- **A Catppuccin Mocha palette** with a soft blue accent, in a matching terminal theme.

## The team

One species per agent program, so you can tell who is who at a glance:

| Program | Pet | Job title |
| --- | --- | --- |
| Claude Code | orange crab | Staff Engineer |
| Codex | blue terminal robot | Code Reviewer |
| OpenCode | penguin | Platform Engineer |
| anything else | sheep | the program's name |

| Status | What the pet does |
| --- | --- |
| working | sits behind a MacBook with a glowing apple logo and types |
| needs you | waves a claw, a yellow `!` blinks beside it |
| shipped | claws up, hops, sparkles |
| idle | eyes closed, a mug of coffee steaming at the desk |

All of it is drawn from rectangles and animated with Herdr's native `.loop()`: no timers, no images.

## Install

Ask your agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/bnhan2710/pixel-hq

Or by hand: copy `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/`, quit and reopen Herdr once,
then pick **pixel-hq** in Settings > Look and the **pixel-hq** theme.

Mods are trusted code and Herdr does not sandbox them. This repo is about 2,000 lines of JavaScript. It makes no network requests; the only programs it runs are local helpers
(`mkdir`, `cp`, `open`, and Chrome/ImageMagick when you convert an animated picture in the figures editor). Read it before you install it.

## Make it yours

- Right-click a pet to change its figures, or right-click empty floor to put every desk back.
- `RECIPE.md` is the brief this layout was built from. Hand it to your agent to rebuild or remix it.
- Drawings live in `mods/company-agents/duck.js` (the pets) and `scene.js` (the room).

## Credits and license

MIT, see [LICENSE](LICENSE). Built on the **Pond Agents** mod by SimonBystromTableCheck (MIT) and Herdr's shipped mods and layouts (Apache-2.0).
Details in [NOTICE.md](NOTICE.md).
