# Changelog

## 0.2.1

Fixes. Nothing here changes what the ten checks look for, and the accuracy figures are the same.

- A config file over 1 MiB used to be skipped without a word, so a padded settings file could come back clean. It is now reported as `FILE-001` (high in a repository, local or plugin file; medium in your own), named in the output, and it counts toward `--fail-on`. The run no longer says "Nothing was checked" when the only config file was too large.
- Deeply nested JSON no longer stops the run with "Maximum call stack size exceeded". That file gets a note and the other files are still checked.
- Files we can't read now get a note that names them: binary files, a file whose top level is a list instead of an object, values of the wrong type (text where a list belongs), and truncated JSON. For truncated JSON we still check the part we could read, and the note says so.
- UTF-16 files, with or without a byte order mark, are read as text. A UTF-16 `settings.json` now gives the same findings as a UTF-8 one.
- Passwords inside addresses and commands are hidden in a finding's match and fix text, not only in the summary. This covers text, JSON and SARIF output, and findings such as `ENDPOINT-001`, `HTTPHOOK-001` and `MCP-001`.
- The masking step also hides the password after `docker login -p`, `sshpass -p` and an attached `mysql -ppassword`, and keys in well-known formats. It no longer hides `NAME=value` unless the name looks like a credential, so `make CC=gcc` stays readable.
- `MCP-001` names the package when an option with a value comes first. `npx --token X pkg` now reports `pkg`, not the token.
- A server removed since the baseline is named once in the text output, with a path relative to your folder, instead of twice.
- Added this changelog.

## 0.2.0

- The verdict line says "files" instead of "settings files".
- The second line of a clean result changed from "That is good news, but it does not promise your setup is safe." to "The summary at the end shows what was checked."
- JSON output has a new `summary` key with the per-check counts the text summary shows.
- JSON `notes` no longer carries "No baseline recorded, so MCP drift wasn't checked…". The DRIFT row in `summary` says it instead.
