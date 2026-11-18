# Updating Pixel HQ

Herdr installs a shared layout as a plain copy of its files, so it never updates by itself.
Updating means copying the new files from this repo over your install.

What lives in your install (`~/.config/herdr-app/`):

| Path | What it is |
| --- | --- |
| `layouts/pixel-hq.json` | the layout |
| `themes/pixel-hq.json` | the terminal theme |
| `mods/company-agents/`, `company-brand/`, `company-pane/`, `company-spaces/`, `company-status/`, `company-switcher/`, `company-hotkeys/`, `company-music/` | the mods |

## 1. Press Update now

When a newer version is out, the office shows an **Update now** button. It opens a small window that lists the files on this repo's `main` branch (GitHub API, with a built-in list as fallback), downloads them from `raw.githubusercontent.com`, and overwrites only the installed files that changed: `layouts/pixel-hq.json`, `themes/pixel-hq.json` and the `company-*` mods. It always installs the newest version, never one release at a time. When it says **Successfully updated**, press **Reload Layout** (or **Done**).

Writing the new `company-agents` files makes Herdr reload that mod, the update window included; the window notices the finished update and stays on the success message instead of starting over. Updates made by 1.4.5 and older ran a second, harmless pass instead.

## Or ask your agent

If the download fails, the window offers **Retry Auto-Update** or **Use Agent Tab**, which opens an agent on this prompt. You can also paste it into any agent yourself. An agent never overwrites existing files unless you say so, which is why the prompt says so:

> Read ~/.config/herdr-app/AGENTS.md, then update my Pixel HQ layout to the latest version from herdr.dev/layouts/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended; keep my other layouts and mods.

The agent follows the rules in `~/.config/herdr-app/AGENTS.md`: it reads the new files, replaces `layouts/pixel-hq.json`, `themes/pixel-hq.json` and the `company-*` mods, runs `herdr-app check` on each mod and leaves everything else alone.

## 2. After updating

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

Ask your agent: "Read ~/.config/herdr-app/AGENTS.md, then put my Pixel HQ back to commit `<commit>` of github.com/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended."

## For the maintainer: announcing a release

Installed copies check `mods/company-agents/version.json` on `main` for a newer `version` (and show `notes` as the "what's new" line). To tell everyone, raise `version` there (for example `1.1.0` to `1.2.0`), edit `notes`, and push. Nothing else is needed.
