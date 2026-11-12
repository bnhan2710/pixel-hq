# Updating Pixel HQ

Herdr installs a shared layout as a plain copy of its files, so it never updates by itself.
Updating means copying the new files from this repo over your install.

What lives in your install (`~/.config/herdr-app/`):

| Path | What it is |
| --- | --- |
| `layouts/pixel-hq.json` | the layout |
| `themes/pixel-hq.json` | the terminal theme |
| `mods/company-agents/`, `company-brand/`, `company-pane/`, `company-spaces/`, `company-status/` | the five mods |

## 1. One command

```sh
git clone --depth 1 https://github.com/bnhan2710/pixel-hq /tmp/pixel-hq-update \
  && cp -R /tmp/pixel-hq-update/layouts /tmp/pixel-hq-update/mods /tmp/pixel-hq-update/themes ~/.config/herdr-app/ \
  && rm -rf /tmp/pixel-hq-update
```

Files with the same name are replaced; your other layouts, mods and themes are left alone.

## 2. Ask your agent

An agent never overwrites existing files unless you say so, so say "update":

> Read ~/.config/herdr-app/AGENTS.md, then update my Pixel HQ from herdr.dev/layouts/bnhan2710/pixel-hq: replace `layouts/pixel-hq.json`, `themes/pixel-hq.json` and the `company-*` mods with the new files (overwriting is intended here), keep my other layouts, then run `herdr-app check` on each mod.

## 3. After updating

1. Run `herdr-app check ~/.config/herdr-app/mods/company-agents` (and the other four mods). Each should print `check passed`.
2. If the window does not refresh, quit and reopen Herdr once.
3. If the layout is not active yet, pick **pixel-hq** in Settings > Look (`ctrl-shift-l` switches layouts).

## What an update overwrites

- **Your edits to these files are lost**, including the height of the Spaces block in `layouts/pixel-hq.json`. Copy them somewhere first, or clone the layout
  (`herdr-app do layout.clone '{"name":"pixel-hq","as":"my-hq"}'`) and keep your layout tweaks in the clone. Edits inside the mods are still overwritten.
- **Kept:** pet positions you dragged (Herdr stores them, not these files), and every file that is not part of this repo.

## What changed?

Read the [commit list](https://github.com/bnhan2710/pixel-hq/commits/main) before you update. The pets and the room are drawn in
`mods/company-agents/duck.js` and `scene.js`; `RECIPE.md` describes the current look in full.

## Going back

An update is a file copy, so to go back clone an older commit and copy that instead:

```sh
git clone https://github.com/bnhan2710/pixel-hq /tmp/pixel-hq-old && git -C /tmp/pixel-hq-old checkout <commit> \
  && cp -R /tmp/pixel-hq-old/layouts /tmp/pixel-hq-old/mods /tmp/pixel-hq-old/themes ~/.config/herdr-app/ && rm -rf /tmp/pixel-hq-old
```
