# Show HN draft

**Title:** Show HN: A local checker for Claude Code/Codex/MCP setups that publishes its own accuracy

**URL:** https://github.com/ignore-previous/whatsallowed

**Text:**

What's Allowed is a CLI I built with Claude Code. It reads your Claude Code, Codex and Cursor config and flags settings that let a repository or a package do more than you'd expect. Some examples: a hook that pipes curl into sh, an MCP server launched with `npx pkg` and no version, a repo's `.claude/settings.json` that sets `ANTHROPIC_BASE_URL`, or a `.env` the agent can read without a deny rule. Each finding gives the file, the line and a rule ID.

`npx whatsallowed` in a project folder. No signup, no network calls (a test enforces that), no telemetry.

There are a few tools like this already. What I wanted was to know how often a check is right, so each one has published precision and recall against a labelled set: 170 test cases kept apart from the ones I tuned on, with Wilson intervals, a list of the known misses and a record of what changed after the first run. On that first run every check had 100% precision, and recall was 100% for eight checks, 90% (60%–98%) for DENY and 80% (49%–94%) for SKILL. I fixed those misses afterwards, so the main table now shows 100% for every check, but those cases are no longer unseen; the first-run table is the fairer guide. Models wrote and labelled all of those cases, and every label came from a model, not a person. So the figures measure how well each check follows its rule, not how much it catches in real projects.

I also ran it on the config files of 110 public repos. It raised 92 alerts, in 31 of those repos. Two other models (Claude Sonnet 5.5 and GPT-6) labelled every alert blind and agreed on all of them; no person labelled any. Precision was 100% (93%–100%) for MCP (52 alerts), 95% (76%–99%) for ALLOW (20 alerts) and 50% (9%–91%) for ENDPOINT (2 alerts, too few to say much). DENY, SKILL and DRIFT can't fire on config files alone, and HOOK and HTTPHOOK raised nothing in this sample. The full table, with the two wrong alerts, is on the same page. The set and the labelling rule are in the repo under CC BY 4.0, so you can rerun it or argue with a label.

Limits, so nobody is surprised: it reads config only. It doesn't run MCP servers, read prose for prompt injection or follow a hook into the script it calls. It is a config check, not a security assessment.

I'd like to hear about false alarms and missed patterns. A minimal config that shows one is the most useful issue.
