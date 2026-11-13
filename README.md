<p align="center">
  <b>English</b> · <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <img src="preview.png?v=4" alt="Pixel HQ: a tiny office for your coding agents. A pixel-art Herdr layout." width="100%">
</p>

<p align="center">
  A <a href="https://herdr.dev">Herdr</a> layout where your coding agents are a small engineering company.<br>
  Pixel pets at desks, chairs and MacBooks, in a dark Catppuccin night office.
</p>

<p align="center">
  <img src="demo.gif?v=4" alt="The sidebar in motion: floors with live status, pets typing at their desks and stepping out beside them on a break" width="320"><br>
  <sub>The sidebar, live: floors with a status dot, pets typing at their desks and stepping out for a while on a break.</sub>
</p>

## What you get

- **Every space is a floor.** The Spaces list becomes floor cards: a small cut-away of the night office (a city window that lights up while someone is typing, an LED screen, one desk and one tiny pet per agent, a band in the space's color), the name, `branch · N staff`, and a status dot: blue when someone is typing, pink when an agent needs you. The block is only as tall as its floors, so the office below gets the rest of the sidebar.
- **An office in your sidebar.** A night office with windows, a clock, a water cooler and LED screens with a hologram of the world. Every agent is a pixel pet on an office chair at its own desk, with a MacBook.
  Drag a pet to move its desk anywhere; click to jump to that agent. Add more agents and the desks shrink to fit, so everyone stays visible and readable.
- **Pets that live their day.** When an agent goes idle its pet mostly stays at the desk; every so often one steps out beside it, stands there for a while, and comes back. When work arrives it types. When an agent ships, pixel confetti rains over its desk until you look.
- **Desk nameplates on every pane.** The pane header shows the pet, its job title and a live status chip:
  `typing`, `needs you`, `shipped` or `on break`.
- **Find staff.** A search bar above the office: type a name, a job title (`reviewer`, `engineer`), a status (`typing`, `break`) or a space, and everyone who does not match fades out while matches get a yellow nameplate. Enter jumps to the first match.
- **A team status bar.** "Pixel HQ", how many agents are on the team, and how many are typing, blocked, shipped or on break.
- **A company sign.** The Pixel HQ corgi logo with "Pixel HQ / engineering floor" at the top of the sidebar.
- **A Catppuccin Mocha palette** with a soft blue accent, in a matching terminal theme.

## The team

One species per agent program, so you can tell who is who at a glance:

<table align="center">
  <tr>
    <td align="center"><img src="pets/crab.svg" width="120" alt="orange crab"><br><b>Claude Code</b><br><sub>Staff Engineer</sub></td>
    <td align="center"><img src="pets/bot.svg" width="120" alt="blue terminal robot"><br><b>Codex</b><br><sub>Code Reviewer</sub></td>
    <td align="center"><img src="pets/penguin.svg" width="120" alt="penguin"><br><b>OpenCode</b><br><sub>Platform Engineer</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="pets/arch.svg" width="120" alt="astronaut with a gradient cube head"><br><b>Antigravity (<code>agy</code>)</b><br><sub>Systems Architect</sub></td>
    <td align="center"><img src="pets/sheep.svg" width="120" alt="sheep"><br><b>anything else</b><br><sub>the program's name</sub></td>
  </tr>
</table>

| Program | Pet | Job title |
| --- | --- | --- |
| Claude Code | orange crab | Staff Engineer |
| Codex | blue terminal robot | Code Reviewer |
| OpenCode | penguin | Platform Engineer |
| Antigravity (`agy`) | little astronaut with a gradient cube head, orange arms and boots, its arch logo on the chest and on the laptop lid | Systems Architect |
| anything else | sheep | the program's name |

<p align="center">
  <img src="team.png?v=4" alt="The team at work: two Claude crabs, an OpenCode penguin and a Codex robot at their desks" width="320"><br>
  <sub>Four staff at their desks: two Claude crabs, an OpenCode penguin and a Codex robot (the robot is waiting for you).</sub>
</p>

<p align="center">
  <img src="agy.png?v=4" alt="Antigravity's pet up close: a gradient cube head typing at a laptop whose lid shows the arch logo" width="300"><br>
  <sub>Antigravity (<code>agy</code>) gets its own pet: a gradient cube head from red crown to teal, with its arch logo on the laptop lid and on the chest.</sub>
</p>

| Status | What the pet does |
| --- | --- |
| working | sits behind a MacBook with a glowing apple logo and types |
| needs you | waves a claw, a yellow `!` blinks beside it |
| shipped | claws up, hops, sparkles |
| idle | eyes closed, a mug of coffee steaming at the desk |

The pets, desks and room are drawn from rectangles and animated with Herdr's native `.loop()`. The only picture is the logo, and the only timer is a one-second tick that decides when a pet steps out.

## A real screenshot

<p align="center">
  <img src="screenshot.png?v=4" alt="A real screenshot of Pixel HQ: floors in the Spaces list, an office of pixel pets below it, desk nameplates on every pane and a team status bar" width="900"><br>
  <sub>The layout as it runs (demo data only).</sub>
</p>

## Install

Ask your agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/bnhan2710/pixel-hq

Or by hand: copy `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/`, quit and reopen Herdr once,
then pick **pixel-hq** in Settings > Look and the **pixel-hq** theme.

Mods are trusted code and Herdr does not sandbox them. This repo is about 2,000 lines of JavaScript. It makes no network requests; the only programs it runs are local helpers
(`mkdir`, `cp`, `open`, and Chrome/ImageMagick when you convert an animated picture in the figures editor). The one thing it writes outside its own folders is the OpenCode status plugin described below (only if OpenCode is installed, once, never overwriting). Read it before you install it.

## Update

Herdr installs a shared layout as a plain copy, so it does not update by itself. Just ask your agent:

> Read ~/.config/herdr-app/AGENTS.md, then update my Pixel HQ layout to the latest version from herdr.dev/layouts/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended; keep my other layouts and mods.

(Say "update": an agent never overwrites existing files unless you tell it to.) Then quit and reopen Herdr once if the window does not refresh.

What an update overwrites, and how to go back, is in [UPDATE.md](UPDATE.md).

## OpenCode in the office

Herdr only counts a program as an agent when it reports a status. Claude Code does, OpenCode does not by itself, so on its own an OpenCode pane would get its pet in the header but no desk in the office. The first time the layout runs, if OpenCode is installed, it adds one small plugin ([`opencode-status.js`](mods/company-agents/opencode-status.js)) to OpenCode's plugins folder (`~/.config/opencode/plugins/`) that reports the status. It shows a note in the office, you restart OpenCode once, and OpenCode gets its desk. It never overwrites an existing file, and it does this once only: delete the plugin file to remove it for good. This works on macOS and Linux; Windows is supported through PowerShell but has not been tested on a real Windows machine yet, so please open an issue if OpenCode does not show up there.

## Make it yours

- Right-click a pet to change its figures, or right-click empty floor to put every desk back.
- `RECIPE.md` is the brief this layout was built from. Hand it to your agent to rebuild or remix it.
- Drawings live in `mods/company-agents/duck.js` (the pets) and `scene.js` (the room).

## Credits and license

MIT, see [LICENSE](LICENSE). Built on the **Pond Agents** mod by SimonBystromTableCheck (MIT) and Herdr's shipped mods and layouts (Apache-2.0).
Details in [NOTICE.md](NOTICE.md).
