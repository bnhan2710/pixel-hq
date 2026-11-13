// The crew's git side: which desks are about to step on each other, and hiring a new staff member in its own git worktree.
// Everything takes `exec` as an argument (Herdr's `exec`), so it can be exercised outside Herdr.

const run = (exec, cwd, args, timeout = 8000) =>
  exec("git", args, { cwd, timeout }).then((r) => (r.code === 0 ? r.stdout : null)).catch(() => null);

const parseStatus = (out) => {
  const files = new Set();
  for (const line of String(out ?? "").split("\n")) {
    if (line.length < 4) continue;
    let p = line.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    files.add(p.replace(/^"|"$/g, ""));
  }
  return files;
};

// Where is each desk working? items: [{ address, cwd }] -> Map(address -> { cwd, top, common, files }).
// `top` is the worktree's root (null when the folder is not in a git repo); `common` identifies the repo, shared by all its worktrees.
export async function snapshot(exec, items) {
  const byCwd = new Map();
  for (const it of items) if (it.cwd && !byCwd.has(it.cwd)) byCwd.set(it.cwd, null);
  await Promise.all([...byCwd.keys()].map(async (cwd) => {
    const top = (await run(exec, cwd, ["rev-parse", "--show-toplevel"]))?.trim() || null;
    if (!top) { byCwd.set(cwd, { top: null, common: null, files: new Set() }); return; }
    let common = (await run(exec, cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))?.trim();
    if (!common) common = (await run(exec, cwd, ["rev-parse", "--git-common-dir"]))?.trim();
    const files = parseStatus(await run(exec, top, ["status", "--porcelain=v1"]));
    byCwd.set(cwd, { top, common: common || top, files });
  }));
  return new Map(items.map((it) => [it.address, { cwd: it.cwd, ...(byCwd.get(it.cwd) ?? { top: null, common: null, files: new Set() }) }]));
}

// Two kinds of trouble, as Map(address -> { kind, others: [address], files: [path] }):
//  "file":   two worktrees of the same repo both changed the same file, so one of them will have to merge.
//  "folder": two agents are working in one and the same folder at once, so they will step on each other.
export function clashes(snap, isWorking) {
  const out = new Map();
  const note = (a, b, kind, files) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      const cur = out.get(x) ?? { kind, others: [], files: [] };
      if (kind === "file") cur.kind = "file";
      if (!cur.others.includes(y)) cur.others.push(y);
      for (const f of files) if (!cur.files.includes(f) && cur.files.length < 6) cur.files.push(f);
      out.set(x, cur);
    }
  };
  const addrs = [...snap.keys()];
  for (let i = 0; i < addrs.length; i++) {
    for (let j = i + 1; j < addrs.length; j++) {
      const [a, b] = [addrs[i], addrs[j]], A = snap.get(a), B = snap.get(b);
      if (A.top && B.top) {
        if (A.common !== B.common) continue;
        if (A.top === B.top) { if (isWorking(a) && isWorking(b)) note(a, b, "folder", [...A.files].filter((f) => B.files.has(f))); continue; }
        const hit = [...A.files].filter((f) => B.files.has(f));
        if (hit.length) note(a, b, "file", hit);
      } else if (!A.top && !B.top && A.cwd && A.cwd === B.cwd && isWorking(a) && isWorking(b)) note(a, b, "folder", []);
    }
  }
  return out;
}

// A new staff member gets their own worktree and branch, named after the ticket:
// <repo>/../.worktrees/<repo>-<ticket>, branch <ticket> (created from the repo's current HEAD, or reused if it exists).
export async function hire(exec, { ticket, repo }) {
  const t = String(ticket ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(t) || t.includes("..") || t.endsWith("/") || t.endsWith(".lock")) throw new Error("Ticket: letters, digits and - _ . / only");
  const top = (await run(exec, String(repo ?? "").trim(), ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top) {
    // Not a repo itself: point at the repos inside it, if any (a workspace folder with one repo per child).
    const kids = (await exec("sh", ["-c", 'for d in */; do [ -e "${d}.git" ] && echo "${d%/}"; done | head -6'], { cwd: String(repo ?? "").trim(), timeout: 5000 }).catch(() => null))?.stdout?.trim().split("\n").filter(Boolean) ?? [];
    throw new Error(kids.length ? `Not a git repo. Repos inside it: ${kids.join(", ")}. Type the path of one.` : "That folder is not inside a git repo");
  }
  const cut = top.lastIndexOf("/");
  const path = `${top.slice(0, cut)}/.worktrees/${top.slice(cut + 1)}-${t.replace(/\//g, "-")}`;
  const listed = (await run(exec, top, ["worktree", "list", "--porcelain"])) ?? "";
  if (listed.split("\n").includes(`worktree ${path}`)) return { path, branch: t, reused: true };
  const exists = (await run(exec, top, ["rev-parse", "--verify", "--quiet", `refs/heads/${t}`])) !== null;
  const r = await exec("git", exists ? ["worktree", "add", path, t] : ["worktree", "add", "-b", t, path], { cwd: top, timeout: 60000 });
  if (r.code !== 0) throw new Error((r.stderr || "git worktree add failed").trim().split("\n").pop());
  return { path, branch: t, reused: false };
}
