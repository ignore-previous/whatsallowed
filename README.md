# What's Allowed

`whatsallowed` reads your Claude Code, Codex and Cursor config and flags risky settings, each with the file, the line and a rule ID. Examples: a hook that pipes `curl` into `sh`, an MCP server run with `npx` and no version, a repository that sets `ANTHROPIC_BASE_URL`, or a `.env` file the agent can read without asking.

It runs on your machine and only reads files. It makes no network calls and sends no telemetry, and a test checks the first of those on every build ([test/no-network.test.ts](test/no-network.test.ts)).

Every check publishes its precision and recall against a labelled set you can rerun: see [docs/ACCURACY.md](docs/ACCURACY.md). AI models wrote and labelled that set, and every label in it came from a model, not a person, so the figures show how well each check follows its written rule. How often it catches risky settings in real projects isn't known.

This is a configuration check, not a security assessment. A clean result doesn't mean a setup is safe.

## First run

You need Node.js 20 or later. In the folder of a project you work on with an agent:

```sh
npx whatsallowed
```

It checks that project and your own user config (`~/.claude`, `~/.claude.json`, `~/.codex`, `~/.cursor`). It only reads files, so it changes nothing. It prints a one-line verdict first, then any findings, most important first. Each finding says what it means in plain words and what you could do about it. You make any change yourself.

```
whatsallowed 0.1.0. This is a read-only check: it changes nothing and sends nothing anywhere.

2 things to look at in the 2 settings files checked. 1 needs attention first.

Look at these first (1)  High: could let something run or leak without you noticing.

  A hook downloads code and runs it
    (Hook: a command that Claude Code or Codex runs by itself when something happens, such as after a file edit.)
    What this means: This hook in a repository file downloads a script and pipes it into a shell. ...
    What you could do: Download and review the script, commit it to the repository or your home folder, and run the local copy.
    Where: ./.claude/settings.json, line 3  Found: curl -s https://get.example.dev/bootstrap | sh  Rule: HOOK-001

Worth checking (1)  Medium: risky in some set-ups, harmless in others.

  MCP server "a" runs an unpinned package
    ...
```

The file, line and rule ID are on each finding's last line, for when you want to look it up. Lower-priority notes are hidden unless you add `--verbose`. For scripts and other tools, `--format json` gives the same findings in a stable, machine-readable form (and `--format sarif` for GitHub code scanning).

Exit code 0 means nothing at or above the `--fail-on` level (default `high`). 1 means there were findings, and 2 means the tool couldn't run.

## Commands

| Command | What it does |
|---|---|
| `whatsallowed [path]` | Check the project at `path` (default: current folder) and your user config |
| `whatsallowed baseline [path]` | Record your MCP server definitions in `~/.whatsallowed/baseline.json`, so later scans flag changes (`DRIFT`) |
| `whatsallowed inventory [path]` | List every config file found, with tool and scope |
| `whatsallowed rules` | List every rule ID |

| Option | |
|---|---|
| `--project-only` / `--user-only` | Check one side only |
| `--format text\|json\|sarif` | SARIF 2.1.0 works with GitHub code scanning |
| `--fail-on high\|medium\|info\|never` | Exit 1 when a finding is at or above this level |
| `--baseline <file>` | Use another baseline file |
| `--reset-baseline` | With `baseline`: replace an existing baseline |
| `--verbose` | Also show lower-priority notes in the text report |
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

Ten checks, 35 rules: [docs/checks.md](docs/checks.md). The vendor docs each check relies on: [docs/config-surface.md](docs/config-surface.md).

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

[docs/ACCURACY.md](docs/ACCURACY.md) gives per-check precision and recall with 95% intervals, measured on a separate test set that was run once after tuning (later changes are listed), and lists the known misses and false alarms. Its Label agreement section says who labelled what. Rerun it with `npm run eval`. How cases are labelled: [eval/LABELLING.md](eval/LABELLING.md).

## What it doesn't do

- It doesn't run, connect to or install anything, so it can't see what an MCP server does at run time or what tools it offers.
- It doesn't read prose in skills or instruction files for hidden instructions (prompt injection).
- It doesn't change your config.
- It doesn't follow a hook to a local script it runs, except scripts in skill, plugin and hooks folders.

More in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Licence

Code: MIT ([LICENSE](LICENSE)). Labelled cases in `eval/cases`: CC BY 4.0 ([LICENSE-DATA](LICENSE-DATA)).
