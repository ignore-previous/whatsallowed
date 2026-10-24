# Publishing plan: fresh single-commit history

Nothing here has been done yet. Each step that leaves this machine (creating the repository, pushing, `npm publish`) waits for the maintainer's go-ahead.

## Why a fresh history

The working repository's history holds things that shouldn't be public: an early commit had a real local user name in three test-case paths (fixed before the test split was first run; see eval/README.md), the progress notes were tracked for a while, and fake keys were stored whole before they were split. Rewriting that history is easy to get wrong. Publishing one commit made from a clean export of the current tree avoids it.

## Steps

1. **Name (done 22 Oct 2026).** The tool is What's Allowed: command and unscoped npm package `whatsallowed`, plugin `whatsallowed`, published from the GitHub org `ignore-previous` (owner account `ruddy-dev`). The old working name `d1check` is gone from the tree (`grep -rn d1check` finds nothing). Run `npm run check`.
2. **Scan the tree.** `npm run prepublish-scan` must pass. It fails on any file that names this machine's user or home folder, any git name or email in any config scope, including files the global config includes (read at run time, never stored), any real-format key string, or a `PROGRESS.md`. The public pseudonym `ruddy-dev` is the one identity allowed. If git holds no name besides the pseudonym, the scan fails rather than report clean: add the real name with `PREPUBLISH_EXTRA_NAMES` (comma-separated). `PREPUBLISH_ALLOW_NO_REAL_NAME=1` scans without it, and the result line then says the real name was not checked.
3. **Export only tracked files.** From the working repository:
   ```sh
   mkdir ../whatsallowed-public
   git archive HEAD | tar -x -C ../whatsallowed-public
   ```
   This leaves out everything git ignores or doesn't track: `PROGRESS.md` (kept outside the repo in `../d1-checker-private/`), `node_modules/`, `eval/out/`, and the private spot-check and real-world working files. `dist/cli.mjs` is tracked on purpose (the Claude Code plugin runs it), so rebuild it with `npm run build` before exporting.
4. **Check the export.** In `../whatsallowed-public`: `npm ci`, `npm run check`, then `node tools/prepublish-scan.mjs .` from inside it. The result line must not say "real name NOT checked". Look over `git archive`'s file list once by eye.
5. **One commit, brand identity.** In the export:
   ```sh
   git init -b main
   git config user.name "ruddy-dev"
   git config user.email "345788022+ruddy-dev@users.noreply.github.com"
   git add -A
   git commit -m "Initial public release"
   ```
   Use the brand account's GitHub noreply address, not a personal one. Check with `git log --format='%an <%ae>%n%cn <%ce>'` that both author and committer are the brand.
6. **Create the repository and push** (go-ahead needed). Create `ignore-previous/whatsallowed` on GitHub as public, add it as `origin`, push `main`. GitHub push protection is a last check for key strings.
7. **Publish to npm** (go-ahead needed). `npm publish --access public`, ideally from CI with provenance once a workflow exists.
8. **Afterwards.** Keep developing in the private working repository and copy releases across the same way, or switch to the public repository as the working copy from then on. Decide which before the second release.

## What stays private

- `../d1-checker-private/`: progress notes, the real-world spot-check list and anonymised labels, and the real-world fetch and label scripts. Not a git repository.
- Third-party config files from the real-world run were deleted after labelling. Only per-check totals are published (`eval/realworld/2026-10-22.json`).
