# Updating Pixel HQ

Herdr installs a shared layout as a plain copy of its files, so it never updates by itself.
Updating means copying the new files from this repo over your install.

What lives in your install (`~/.config/herdr-app/`):

| Path | What it is |
| --- | --- |
| `layouts/pixel-hq.json` | the layout |
| `layouts/pixel-hq.svg` | the layout's picture in Settings > Look |
| `themes/pixel-hq.json` | the terminal theme |
| `mods/company-agents/`, `company-brand/`, `company-pane/`, `company-spaces/`, `company-status/`, `company-switcher/`, `company-hotkeys/`, `company-music/` | the mods |

## 1. Press Update now

Click the update pill in the status bar when a new version is available. Pixel HQ downloads the tagged release from GitHub in the background and writes only the files that changed. The status bar shows when the update is running, and a notification reports the result. If the update fails, click the update pill again to retry.

## Or ask your agent

The first tagged release also appears in older updaters. Use the existing update button or toast to switch to tagged updates. You can also ask an agent to install the update with this prompt:

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

Click **Changelog** in the status bar to see what changes between your installed version and the available update. If you skip versions, the changelog includes the published changes from each version in between. After installing, you can still review that update offline.

## Going back

Ask your agent: "Read ~/.config/herdr-app/AGENTS.md, then put my Pixel HQ back to commit `<commit>` of github.com/bnhan2710/pixel-hq. Overwriting my installed pixel-hq files is intended."

## For the maintainer: announcing a release

Tag the commit you want to ship and push that tag.

```sh
git fetch origin main
git tag v1.8.7 origin/main
git push origin v1.8.7
```

On GitHub, create a release for that tag. Enter your own description or use **Generate release notes**, then publish the release. Put `[urgent]` on the first line of the description for an urgent update notice.

For reader-friendly notes, give your agent the previous release commit and the new tag. Ask it to inspect the merged pull requests and their diffs, group related changes by what users can do or notice, and credit contributors with pull request links. Paste the draft into the release description. Use the previous installed release commit if that version predates release tags.

Pixel HQ takes the version from the published release tag, downloads that commit, and shows the release description in **Changelog**. The first eligible stable release on `main` also updates the legacy announcement file once so older updaters can find the migration.
