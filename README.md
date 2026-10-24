# What's Allowed

What's Allowed reads your Claude Code, Codex and Cursor config and flags risky settings, each with the file and line. Add `--details` for explanations and rule IDs.

Examples: a hook that pipes `curl` into `sh`, an MCP server run with `npx` and no version, a repository that sets `ANTHROPIC_BASE_URL`, or a `.env` file the agent can read without asking.

Runs: [on your computer](docs/THREAT_MODEL.md#assumptions) · Sends: [nothing once installed (tested)](test/no-network.test.ts) · Won't: [change your config](test/no-writes.test.ts), or [tell you a setup is safe](docs/THREAT_MODEL.md#what-it-cant-see)

Every check publishes its test results: [docs/ACCURACY.md](docs/ACCURACY.md).

The `baseline` command writes one file of its own, `~/.whatsallowed/baseline.json`, and only when you run it. Once installed, What's Allowed sends no telemetry and makes no network calls; a test checks that on every build.

## First run

You need Node.js 20 or later. In the folder of a project you work on with an agent:

```sh
npx whatsallowed
```

To see an example, run `npx whatsallowed demo`. It scans a made-up project with risky settings and reads none of your files.

It checks the project and your own user config (`~/.claude`, `~/.claude.json`, `~/.codex`, `~/.cursor`). A scan only reads files and changes nothing. The short report starts with counts by level and files checked. Findings show what is wrong, where to look and a first step to fix it. The summary names the areas checked and groups empty areas together.

<!-- demo-output -->
```
5 high, 5 medium, 0 info; 5 files checked.
Read-only demo. Made-up findings. None of your files were read.

Look at these first (5)

  A permission allows every command
    ./.claude/settings.json:4
    What to do: Replace it with the specific commands you use, such as "Bash(npm
                run test)" or "Bash(git diff *)".

  The project approves its own extra tools
    ./.claude/settings.json:7
    What to do: Remove the key and approve servers one by one, or list them in
                enabledMcpjsonServers in your local settings.

  An automatic command downloads code and runs it
    ./.claude/settings.json:15
    What to do: Download and review the script, commit it to the repository or
                your home folder, and run the local copy.

  A key or token is written directly in the tool settings
    ./.mcp.json:16
    What to do: Rotate the key and reference it instead, for example ${API_KEY},
                so the value stays in your environment.

  Codex runs anything, anywhere, without asking
    ~/.codex/config.toml:1
    What to do: Use sandbox_mode = "workspace-write" and keep approval_policy =
                "on-request".

Worth checking (5)

  A secrets file in this project isn't blocked from the AI
    ./.env:1
    What to do: Add "Read(./.env)" to permissions.deny in .claude/settings.json,
                or "Read(**/.env)" to cover every copy.

  Extra tool "browser" runs a package without a fixed version
    ./.mcp.json:4
    What to do: Pin an exact version, for example npx demo-browser-mcp@1.2.3.

  Extra tool "tickets" changed since the saved settings
    ./.mcp.json:10
    What to do: Check the change (git log or diff the file).

  A permission allows "npx" with any arguments
    ~/.claude/settings.json:6
    What to do: Allow the exact invocations you need, for example "Bash(npx
                ...)" with fixed arguments.

  The AI can fetch any web address without asking
    ~/.claude/settings.json:7
    What to do: List the domains you need: "WebFetch(domain:docs.example.com)".

Add --details to see why each one matters and more ways to fix it.

Summary: the made-up shop-app project and demo user settings. None of your files
         were read.
  Permission modes: 2 settings.
  Allowed actions: 5 permission rules.
  Protected files: 0 rules blocking access.
  Automatic commands: 1 automatic command.
  Extra tools: 2 extra tools.
  Changes since baseline: Baseline of 2026-10-01, 2 servers: 1 changed, 0 new, 0
                          removed since then.
  Keys and tokens: 1 file or value checked.
Nothing found for: request addresses, web notifications, add-on scripts.

This is not a security assessment. A clean result does not mean it is safe.
```
<!-- /demo-output -->

Add `--details` for what each finding means, what you could do, the matched text, rule IDs and a glossary. Add `--verbose` to show lower-priority notes and the items behind summary counts. You can use both flags together. You make any changes yourself.

Text wraps to the terminal width, up to 90 columns. Redirected output uses 80 columns. Continuation lines stay under their labels. For scripts and other tools, `--format json` gives the same findings in a stable, machine-readable form. Use `--format sarif` for GitHub code scanning. These formats are unchanged by `--details` and `--verbose`.

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
| `--details` | Show explanations, suggested changes, matched text, rule IDs and glossary |
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
