# Reddit post (draft, one only)

Pick one subreddit (r/ClaudeAI is the closest fit). Read its sidebar rules on self-promotion first. Disclose that you built it. At most one post a month afterwards.

**Title:** I built a free local checker for Claude Code / Codex config, and published how often each check is right

**Body:**

Disclosure: I made this. It's free and MIT-licensed.

What's Allowed reads your agent config (`~/.claude`, `.claude/settings.json`, `.mcp.json`, `~/.codex/config.toml`, Cursor's `mcp.json`, skills and plugins) and points out things like:

- hooks or MCP launch commands that download and run code
- `npx` MCP servers with no pinned version
- a repo's settings redirecting `ANTHROPIC_BASE_URL` or adding an http hook to someone else's server
- `.env` files with no Read deny rule
- API keys pasted into CLAUDE.md

Run `npx whatsallowed` in a project. It makes no network calls and has no telemetry.

Each check has precision and recall measured on a labelled test set kept apart from tuning, with the misses and what I changed after the first run listed: https://github.com/ignore-previous/whatsallowed/blob/main/docs/ACCURACY.md. Every label came from an AI model, not a person. The figures show how well each check follows its written rule, not how much it catches in real projects. It's a config check, not a security assessment, so a clean result doesn't mean you're safe.

Reports of false alarms are very welcome.
