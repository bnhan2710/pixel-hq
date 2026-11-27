<p align="center">
  <b>English</b> · <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <img src="preview.png?v=8" alt="Pixel HQ: a tiny office for your coding agents. A pixel-art Herdr layout." width="100%">
</p>

<p align="center">
  A <a href="https://herdr.dev">Herdr</a> layout where your coding agents are a small engineering company.<br>
  Pixel pets at desks, chairs and MacBooks, in a dark Catppuccin night office.
</p>

<p align="center">
  <img src="stats.svg" alt="Pixel HQ repo traffic: total clones, page views, stars and forks, a growth chart of total views and clones, the star history, and where visitors come from" width="100%">
</p>

## A real screenshot

<p align="center">
  <img src="screenshot.png?v=8" alt="Pixel HQ at work: the metro line of floors, the office with six agents (Claude Code, Codex, OpenCode, Antigravity) working in a grid of panes, desk nameplates on every pane and a team status bar" width="900"><br>
  <sub>The whole office at work: two Claude Code, two Codex (one waiting for you), an OpenCode and an Antigravity, one git worktree each, with papers piling up on the desks (demo data only).</sub>
</p>

<p align="center">
  <img src="demo.gif?v=5" alt="The sidebar in motion: floors with live status, pets typing at their desks and stepping out beside them on a break" width="320"><br>
  <sub>The sidebar, live: floors with a status dot, pets typing at their desks and stepping out for a while on a break.</sub>
</p>

## What you get

- **Every space is a floor.** The Spaces list becomes floor cards: a small cut-away of the night office (a city window that lights up while someone is typing, an LED screen, one desk and one tiny pet per agent, a band in the space's color), the name, `branch · N aboard`, and a status dot: blue when someone is typing, pink when an agent needs you. The block is only as tall as its floors, so the office below gets the rest of the sidebar.
- **Every machine is a metro line.** Each machine gets its own colored line with a lettered badge (`WSL LINE`, `THIS COMPUTER LINE`) and its station count. Its spaces are stops on the track: the one you are in has a yellow stop, a little train waits above any stop where an agent is typing (its lamp blinks pink when an agent needs you), and the line ends in a `new station` stop that opens a new space on that machine. A machine that is away greys its line out. Drag a line by its header to put it where you want it, for example your WSL or server line on top: a grip shows on hover, the whole target line lights up as a drop zone, and the order is remembered. Right-click a line header to rename that machine in place (Enter saves, Esc cancels).
- **An office in your sidebar.** A night office with windows, a clock, a water cooler, a server rack with blinking lights and a little desk with a code editor on its monitor. Every agent is a pixel pet on an office chair at its own desk, with a MacBook.
  Desks sit on a grid like icons on a desktop: drag a pet and its desk drops into the nearest free cell, while the other desks stay where they are; click to jump to that agent. Add more agents and the desks shrink to fit, so everyone stays visible and readable.
- **Pets that live their day.** When an agent goes idle its pet mostly stays at the desk; every so often one steps out beside it, stands there for a while, and comes back. When left idle for over 2 minutes it snoozes with floating pixel Zzz; after 5 minutes a retro pixel alarm clock rings and urges it back to work. Both clocks count from the last time you looked at that agent, so opening it and leaving without a task sends it back to a plain coffee break. Click an idle pet anytime to nudge it awake. When work arrives it types. When an agent ships, pixel confetti rains over its desk until you look.
- **Desk nameplates on every pane.** The pane header shows the pet, its job title and a live status chip:
  `typing`, `needs you`, `shipped` or `on break`.
  **Click the name or the job title to rename it** (Enter saves, an empty name brings the default back). The new name also shows on that agent's desk in the office, and a new job title is picked up by Find staff. It is saved in `pixel-hq-names.json` in your Herdr config folder, per pane.
- **HP and SP vitals.** Under every desk's nameplate, two thin bars span the nameplate width. **HP** is context used, drawn like Claude's status line: green, yellow from 60%, red from 80%. **SP** is the share of your quota window left: blue while plenty, amber from 30%, red from 10%. Hover a desk for the exact numbers. The model and its effort ride along on the branch line (`main · Opus 5.5 · high`). Codex has no quota source, so its desks get the HP bar and papers only; Antigravity's SP bar rides its usage API (read locally via the agy CLI's own token).
- **Needs you, one list.** The moment any agent on any floor or machine waits on you, a pixel bell appears in the header with the count (the status bar's `N need you` pill does the same, and on macOS the Dock badge carries the number too). Click it: the needs-you popup lists every waiting agent across every space and machine, longest first — the pet, its terminal title, its floor, its program and how long it has been waiting. Click a row and you land on its pane.
- **The wall shows the whole company.** The office follows your clock: the windows go from dawn to day, dusk and night, the sun or the moon crosses them, and the clock shows the time. Each building in the windows is one of your spaces: lit while its agents work, a red beacon on the roof when one needs you, a green one when it shipped, a blue roof line on the floor you are on. Under the clock a sign counts the agents waiting on you (a small red badge on the clock when the office is too narrow for the sign). Under the windows hangs a dot-matrix board: a five-segment fuel gauge for the lowest usage window left across your agents (Claude Code's 5-hour window, Codex, Antigravity; amber under 25%, red and blinking under 10%), and an amber panel cycling through what just happened (`ARES SHIPPED 4M`), tasks shipped today, time at work, any context over 80% and how many helpers are out. While someone needs you it turns red, names them and holds still. Hover it to read every panel at once. The wall rack blinks a light for every sub-agent and shell job in the office, and the plant, a little potted tree, grows a new leafy branch as tasks ship today (at 1, 4, 8, 13, 19 and 26), blossoms from 30, and droops while someone has waited on you for over five minutes.
- **Click the wall.** A building goes to its space; the sign (or the badge) opens the list of agents waiting on you; the clock, the plant or the board shows today (or, while it is red, who is waiting): tasks shipped, time agents worked, the busiest floor; the rack lists every desk with sub-agents or shell jobs, busiest first, and a click shows that agent; the water cooler sends every finished pet on a break (settles them until their next task).
- **Interns and a server rack.** When an agent delegates, its sub-agents sit at the front of its desk as tiny pets in their own species and mood (three at most, then a `+N` tag): Hermes' sub-agents from its plugin, and any agent's sub-agents started with `hc run` (their terminals' `parent`). Shell work lights a slim rack on the right cubicle panel, one blinking LED per running command or background process, and sends a little helper bot per job pacing the floor between the desk and the rack with a parcel (three at most, then `+N`); both turn amber once a job has run over a minute. Hermes reports this through its plugin, Claude Code through a hook (below). The pet types faster with each one, up to twice as fast, and the desk's tooltip counts them.
- **Shipped staff can clock out.** Every shipped desk gets a green `✓` at its top-left corner. Click it and the pet is settled until its next task: the desk leaves the floor and its confetti stops. It comes back on its own the moment it works or waits on you again, and a `✓ N settled` chip on the floor brings everyone back at once.
- **Find staff.** A search bar above the office: type a name, a job title (`reviewer`, `engineer`), a status (`typing`, `break`) or a space, and everyone who does not match fades out while matches get a yellow nameplate. Enter jumps to the first match.
- **Pixel MusicBox & Radio.** A retro boombox sits in the tech corner of the office with floating pixel music notes `♪ ♫` while audio plays. Click the radio or the status bar's `MUSICBOX` button (or press `Ctrl+Shift+M`) to open the MusicBox: paste any YouTube, SoundCloud, or direct audio stream URL (.mp3, .m3u8, Icecast) or pick direct stream presets (SomaFM, Nightwave Plaza, DEF CON Radio). Streams headless audio only via `ffplay` or `mpv` without opening a browser or rendering video.
- **A pixel tab bar.** Tabs, the `+` button and the `FILES` / `CHANGES` toggles are drawn as pixel boxes with a hard shadow. The active tab has a soft frame and a blue underline. A working agent shows a spinning pixel loader on its tab, and a finished or blocked one shows a pixel tick or `!`. Scroll the wheel over the bar to switch tabs, drag a tab to move it.
- **Floor Switcher.** Press `Ctrl+P` (or `Cmd+P`) to jump between floors: type to search, use the arrows or `1`-`9`, or keep `Ctrl` held and press `P` again to cycle.
- **Hotkeys sheet.** The status bar's `HOTKEYS` button opens a read-only cheat sheet of the shortcuts for floors, panes and layouts.
- **A team status bar.** "Pixel HQ", how many agents are on the team, and how many are typing, blocked, shipped or on break. It is drawn in pixel style too, with pixel buttons for the MusicBox, the Floor Switcher, the Hotkeys sheet and the command palette. Right-click the MusicBox button to hide it from the bar.
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
    <td align="center"><img src="pets/herald.svg" width="120" alt="charcoal herald in a gold winged helmet"><br><b>Hermes Agent</b><br><sub>Chief of Staff</sub></td>
    <td align="center"><img src="pets/sheep.svg" width="120" alt="sheep"><br><b>anything else</b><br><sub>the program's name</sub></td>
  </tr>
</table>

| Program | Pet | Job title |
| --- | --- | --- |
| Claude Code | orange crab | Staff Engineer |
| Codex | blue terminal robot | Code Reviewer |
| OpenCode | penguin | Platform Engineer |
| Antigravity (`agy`) | little astronaut with a gradient cube head, orange arms and boots, its arch logo on the chest and on the laptop lid | Systems Architect |
| Hermes Agent (`hermes`) | charcoal herald in a gold helmet with white wings that flap (faster when it types or cheers), gold badge | Chief of Staff |
| anything else | sheep | the program's name |

<p align="center">
  <img src="team.gif?v=2" alt="The whole sidebar in motion: the metro line of floors and the office with six staff in six states: two clashing desks with red tags and a dotted line, a crab typing, a Codex robot waiting for you, an OpenCode penguin on a break, an Antigravity astronaut typing and a crab that has shipped, with branch tags and piles of papers" width="320"><br>
  <sub>(Animated.) The whole sidebar: three floors on the metro line, and the office with six staff in six states: a crab and a robot that changed the same file in two worktrees (red tags, dotted sparks), a crab typing, a penguin on a break, an astronaut typing and a crab that has shipped. Each sits in its own worktree, and the papers pile up as their context grows.</sub>
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
| idle | eyes closed, a mug of coffee steaming at the desk; snoozes with drifting Zzz after 2m; retro alarm clock rings and urges to work after 5m; both reset when you look at the agent (click to nudge awake) |

The pets, desks and room are drawn from rectangles and animated with Herdr's native `.loop()`. The only picture is the logo, and the only timer is a one-second tick that decides when a pet steps out.

## Install

Ask your agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/bnhan2710/pixel-hq

Or by hand: copy `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/`, quit and reopen Herdr once,
then pick **pixel-hq** in Settings > Look. It brings its own **pixel-hq** theme, dark even when your system is in light mode.

Mods are trusted code and Herdr does not sandbox them. This repo is about 4,200 lines of JavaScript. The only programs it runs are local helpers
(`mkdir`, `cp`, `open`, `git` to see what each desk changed and to make worktrees when you hire, and Chrome/ImageMagick when you convert an animated picture in the figures editor). The one thing it writes outside its own folders is the OpenCode status plugin described below (only if OpenCode is installed, once, never overwriting). It only talks to GitHub: the update check reads public release metadata, and pressing **Update now** downloads this repo's files (see "Update"). Nothing about you is sent. Read it before you install it.

## Update

Herdr installs a shared layout as a plain copy. When a new release is published, click the update in the status bar. Pixel HQ downloads the tagged commit from GitHub and overwrites the installed Pixel HQ files that changed. Click **Changelog** to see the release notes for your upgrade. Older updaters receive a one-time migration through the existing update button. You can also ask an agent:

> Read ~/.config/herdr-app/AGENTS.md, then update my Pixel HQ layout to the latest version from herdr.dev/layouts/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended; keep my other layouts and mods.

(Say "update": an agent never overwrites existing files unless you tell it to.) Then quit and reopen Herdr once if the window does not refresh.

What an update overwrites, and how to go back, is in [UPDATE.md](UPDATE.md).

## Papers on the desk

As an agent's context fills up, a pile of paper grows on its desk: one sheet per 10%, and past 80% the top sheets turn pink (past 95% the pile trembles). The same percentage feeds the HP bar (see "HP and SP vitals" above). Hover it for the exact percentage. **Click the pile, then click it again within 6 seconds**, and Pixel HQ sends the agent `/compact`, which already summarizes the conversation and swaps the history for that summary. It only does this when the agent is idle: a working agent answers "busy: wait for it", a blocked one "answer it first". The first click just arms it and says so on the nameplate.

Herdr does not know how full an agent's context is, so each agent has its own way in:

- **Codex:** nothing to set up. Pixel HQ reads the token count Codex writes to its session file (`~/.codex/sessions`, found through the process that has it open, or by folder) every few seconds. macOS and Linux (it needs `sh` and `lsof`).
- **OpenCode:** nothing to set up. Pixel HQ reports the last answer's tokens against the model's context window, on both 1.x and 2.x, from one TUI plugin ([`opencode-hp/`](mods/company-agents/opencode-hp/), a directory package in `~/.config/opencode/plugins/` — auto-discovered by every running TUI, hot-reloaded on save): 1.x loads its `tui` export, 2.x its `setup`; 1.x additionally has a fallback in the status plugin. OpenCode has no plan-quota source surfaced here, so OpenCode desks get the HP bar and papers, no SP bar.
- **Claude Code:** a status line has to tell Herdr. [`claude-statusline.sh`](mods/company-agents/claude-statusline.sh) does that (it labels the terminal with the context percentage, how much of the 5-hour window is left and the effort level); it needs `python3`. Ask your agent:

> Set my Claude Code status line (`statusLine` in `~/.claude/settings.json`) to `sh ~/.config/herdr-app/mods/company-agents/claude-statusline.sh`, keeping the rest of my settings. If I already have a status line, tell me first.

- **Claude Code's shell commands and sub-agents** (runners, rack LEDs and interns): a hook has to tell Herdr. [`claude-activity.py`](mods/company-agents/claude-activity.py) counts Bash commands in flight and running sub-agents and labels the terminal with them (`agent.jobs`, `agent.jobs_started`, `agent.threads`). It is opt-in and needs `python3`. One command adds the hooks to `~/.claude/settings.json`, keeping your own hooks and saving the original as `settings.json.pixel-hq.bak` (run it again any time, it never duplicates):

  ```sh
  python3 ~/.config/herdr-app/mods/company-agents/claude-activity.py install
  python3 ~/.config/herdr-app/mods/company-agents/claude-activity.py uninstall   # removes only its own hooks
  ```

  It does nothing outside Herdr and costs about 40 ms per Bash command. Background commands (`run_in_background`) are not counted, since Claude Code reports no end for them.

- **Antigravity (`agy`):** nothing to set up. Pixel HQ finds the conversation transcript in `~/.gemini/antigravity-cli/brain/` (from the CLI's `history.jsonl` workspace match) and reads token usage (`input_tokens + cache_read_tokens`) against its 1M token context window every few seconds — that feeds HP. SP reads the plan's remaining quota from the same usage API the `agy` CLI talks to (token in `~/.gemini/antigravity-cli/antigravity-oauth-token`, refreshed automatically; `AGY_HOME` honored for non-standard installs) and shows the tightest model bucket ([`agy-quota.py`](mods/company-agents/agy-quota.py)). macOS, Linux and Windows (SP needs `python3` or `python`; the script carries no credentials of its own — it reads the public OAuth pair from the installed `agy` binary and caches it under `~/.cache/pixel-hq/`).

- **Hermes Agent (`hermes`):** nothing to set up. Hermes does not report a status to Herdr by itself, so Pixel HQ installs a small Hermes plugin ([`hermes-status/`](mods/company-agents/hermes-status/)) into `~/.hermes/plugins/pixel-hq-status/` and into every profile's `plugins/` folder under `~/.hermes/profiles/`, then turns it on with `hermes plugins enable pixel-hq-status`, once per home. Restart Hermes after that to get a desk. With the classic CLI the plugin sends Herdr's status sequence (OSC 7501) from Hermes' hooks: **working** when a turn starts, **blocked** while a dangerous-command approval or a clarify question waits on you, **idle** when the turn ends or is interrupted, and idle again at launch so the desk shows up before your first message. Turns of delegated sub-agents never mark the main desk idle. After each model call it labels the terminal with the context fill (`agent.context`, `agent.model`), which feeds the HP bar and the paper pile, and every 2 seconds (only on change) with what is running: `agent.threads` (sub-agents), `agent.jobs` (`terminal` / `execute_code` calls in flight plus background processes) and `agent.jobs_long` (those past a minute), for the interns and the server rack. It does nothing outside a Herdr terminal. **`hermes --tui` works too:** there the agent runs in Hermes' shared background host (`hermes gateway`), which has no terminal of its own, so Pixel HQ also adds `HC_TERMINAL_ID` to each home's `terminal.client_env_passthrough` (merged with what is there). Every TUI session then carries the Herdr terminal it was started from, and the plugin writes the status to that terminal's tty, only while its foreground program is Hermes. Pixel HQ puts the desk up at launch itself ([`hermes-announce.sh`](mods/company-agents/hermes-announce.sh)), since the TUI reports nothing before your first message. After the first install, restart the host once (`hermes gateway restart`) so it loads the plugin. Pixel HQ only updates its own copy later and never turns the plugin back on; to remove it, delete the folder (a `.pixel-hq-status-installed` marker keeps it from coming back) or run `hermes plugins disable pixel-hq-status`. macOS and Linux.

## Teamwork without collisions

- **One floor, one office.** Each space is its own office: the desks show only the agents of the space you are looking at (the other floors have their own cards).
- **Branch on every nameplate.** Under each desk's name tag is the branch its agent is on, with a small git-branch glyph.
- **Clash warnings.** Every few seconds Pixel HQ asks git what each desk has changed. If two worktrees of the same repo both changed the same file, both pets get a red lightning bolt and a red `clash: file` tag, and a dotted line of sparks joins their desks. If two agents are working in one and the same folder at the same time, they get an amber `same folder` tag instead.
- **Hire staff in their own worktree.** The **+** in the header opens a small form: a ticket name (say `UC-1234`), the repo folder and which agent to start. Pixel HQ runs `git worktree add -b UC-1234 <repo>/../.worktrees/<repo>-UC-1234` (or reuses the branch if it exists) and opens the agent (Claude Code, Codex, OpenCode, Antigravity or Hermes) there as a new tab of the current space, so two staff never share a working tree. Worktrees are not removed when the staff leaves; clean them with `git worktree remove`. If the folder is a workspace of several repos, the form tells you which ones are inside so you can type one.

<p align="center">
  <img src="clash.png" alt="Two desks that changed the same file: a red lightning bolt, a red clash tag and the branch name" width="200">
  <img src="piles.png" alt="A desk with a tall pile of papers, the top sheets pink because the context is almost full" width="200"><br>
  <sub>Left: a clash warning with the branch on the nameplate. Right: a nearly full context, the pink sheets on top.</sub>
</p>

## OpenCode in the office

Herdr only counts a program as an agent when it reports a status. Claude Code does, and so does OpenCode from 2.0.29 on. OpenCode 1.x does not, so on its own an OpenCode 1.x pane would get its pet in the header but no desk in the office. The first time the layout runs, if OpenCode is installed, it adds one small plugin ([`opencode-status.js`](mods/company-agents/opencode-status.js)) to OpenCode's plugins folder (`~/.config/opencode/plugins/`) that reports the status on 1.x and stays quiet on 2.x. The same run also adds [`opencode-hp/`](mods/company-agents/opencode-hp/) there, a TUI plugin (a directory package) that keeps the desk's HP bar in step with the context window on both 1.x and 2.x; every running TUI picks it up within seconds. The status plugin shows a note in the office; restart OpenCode once and OpenCode gets its desk. Neither plugin ever overwrites someone else's file, and each installs once only: delete the plugin file (or the folder) to remove it for good. The one exception is Pixel HQ's own first plugin, which OpenCode 2.x refuses to load ("1 plugin failed"): if that copy is there, it is replaced once with the current one. This works on macOS and Linux; Windows is supported through PowerShell but has not been tested on a real Windows machine yet, so please open an issue if OpenCode does not show up there.

## Update notices

Pixel HQ checks public GitHub Releases at startup and every six hours. Publishing a new version tag makes the update available. The status bar shows the version range and the changelog uses the release notes for that range.

## Make it yours

- Right-click a pet to change its figures, or right-click empty floor to put every desk back.
- `RECIPE.md` is the brief this layout was built from. Hand it to your agent to rebuild or remix it.
- Drawings live in `mods/company-agents/duck.js` (the pets) and `scene.js` (the room).

## Credits and license

MIT, see [LICENSE](LICENSE). Built on the **Pond Agents** mod by SimonBystromTableCheck (MIT) and Herdr's shipped mods and layouts (Apache-2.0).
Details in [NOTICE.md](NOTICE.md).
