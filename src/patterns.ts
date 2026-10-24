/**
 * Shared detectors for commands that run code from somewhere the user can't see:
 * remote content executed directly, encoded payloads, and reverse shells.
 * Used by the HOOK, SKILL and MCP checks. Written for this project; no rules copied.
 */

export type ExecKind = "remote" | "encoded" | "revshell";

export interface ExecMatch {
  kind: ExecKind;
  /** The matched text, trimmed to a readable length. */
  match: string;
  /** Which form matched, for the explanation. */
  form: string;
}

const DL = String.raw`(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|fetch|http|aria2c)`;
const SHELL = String.raw`(?:sudo\s+(?:-\S+\s+)*)?(?:\S*/)?(?:ba|z|da|k|fi|c|tc|a)?sh(?:\.exe)?`;
const INTERP = String.raw`(?:sudo\s+)?(?:\S*/)?(?:python[\d.]*|py|node|deno|bun|perl|ruby|php|lua|osascript)`;
const PS = String.raw`(?:pwsh|powershell)(?:\.exe)?`;

interface Rule {
  kind: ExecKind;
  form: string;
  re: RegExp;
}

const RULES: Rule[] = [
  // --- remote content executed directly ---
  {
    kind: "remote",
    form: "downloads a script and pipes it into a shell",
    re: new RegExp(String.raw`\b${DL}\b[^\n|]*(?:\|[^\n|]*)*?\|\s*${SHELL}(?=$|[\s;&|)'"\x60])`, "i"),
  },
  {
    kind: "remote",
    form: "downloads a script and pipes it into an interpreter",
    // An interpreter reading stdin as code: no arguments, or a lone "-".
    re: new RegExp(String.raw`\b${DL}\b[^\n|]*(?:\|[^\n|]*)*?\|\s*${INTERP}(?:\s+-)?\s*(?=$|[;&|)'"\x60])`, "i"),
  },
  {
    kind: "remote",
    form: "downloads a script and pipes it into PowerShell",
    re: new RegExp(String.raw`\b${DL}\b[^\n]*\|\s*(?:iex|Invoke-Expression|${PS}\b[^\n|]*(?:-c(?:ommand)?\s+)?-(?=\s|$))`, "i"),
  },
  {
    kind: "remote",
    form: "runs downloaded content through Invoke-Expression",
    re: /\b(?:iex|Invoke-Expression)\b[^\n]{0,200}?\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadData|Net\.WebClient|curl|wget|https?:\/\/)/i,
  },
  {
    kind: "remote",
    form: "runs downloaded content through process substitution",
    re: new RegExp(String.raw`(?:\b${SHELL}|\bsource|(?:^|[\s;&])\.)\s+<\(\s*${DL}\b`, "i"),
  },
  {
    kind: "remote",
    form: "runs downloaded content through command substitution",
    re: new RegExp(String.raw`(?:\beval|\b${SHELL}\s+-c|\b${INTERP}\s+-[ce])\s+["']?(?:\$\(|\x60)\s*${DL}\b`, "i"),
  },
  {
    kind: "remote",
    form: "evaluates code fetched over the network",
    re: /\b(?:exec|eval|Function)\s*\([^\n]{0,200}?\b(?:urlopen|urllib\.request|requests\.get|httpx\.get|fetch\s*\(|https?\.get|axios\.get)/i,
  },
  {
    kind: "remote",
    form: "runs a remote script through a Windows helper",
    re: /\b(?:mshta(?:\.exe)?\s+["']?(?:https?|vbscript|javascript):|regsvr32(?:\.exe)?\b[^\n]*\/i:\s*["']?https?:|rundll32(?:\.exe)?\b[^\n]*javascript:)/i,
  },
  // --- encoded payloads ---
  {
    kind: "encoded",
    form: "decodes base64 and pipes it into a shell or interpreter",
    re: new RegExp(String.raw`\b(?:base64\s+(?:-d|--decode|-D)|openssl\s+(?:base64|enc)\b[^\n|]*-d|xxd\s+-r)[^\n|]*\|\s*(?:${SHELL}|${INTERP})(?=$|[\s;&|)'"\x60])`, "i"),
  },
  {
    kind: "encoded",
    form: "runs base64 decoded at the shell",
    re: new RegExp(String.raw`(?:\beval|\b${SHELL}\s+-c)\s+["']?(?:\$\(|\x60)[^\n]*\bbase64\s+(?:-d|--decode|-D)`, "i"),
  },
  {
    kind: "encoded",
    form: "runs an encoded PowerShell command",
    re: new RegExp(String.raw`\b${PS}\b[^\n]*\s[-/](?:e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*)\s+["']?[A-Za-z0-9+/]{20,}={0,2}`, "i"),
  },
  {
    kind: "encoded",
    form: "decodes base64 and executes it in PowerShell",
    re: /FromBase64String[^\n]*\b(?:iex|Invoke-Expression|ScriptBlock|Invoke-Command)\b|\b(?:iex|Invoke-Expression|ScriptBlock\]::Create)\b[^\n]*FromBase64String/i,
  },
  {
    kind: "encoded",
    form: "decodes base64 and executes it in code",
    re: /\b(?:exec|eval|Function)\s*\(\s*(?:[\w.]*\()?\s*(?:base64\.b64decode|b64decode|codecs\.decode|atob|Buffer\.from\([^)]*['"]base64['"]|zlib\.decompress)/i,
  },
  // --- reverse shells ---
  {
    kind: "revshell",
    form: "opens a shell over /dev/tcp",
    re: /\/dev\/(?:tcp|udp)\/[^\s/]+\/\d+/i,
  },
  {
    kind: "revshell",
    form: "hands a shell to netcat",
    re: /\b(?:nc|ncat|netcat)(?:\.exe)?\b[^\n|;]*\s-[a-z]*[ec]\s+["']?\S*(?:sh|bash|cmd(?:\.exe)?|powershell(?:\.exe)?)\b/i,
  },
  {
    kind: "revshell",
    form: "wires a shell to netcat through a pipe",
    re: /\bmkfifo\b[^\n]*\b(?:nc|ncat|netcat)\b|\b(?:ba|z)?sh\s+-i\b[^\n]*\|\s*(?:nc|ncat|netcat)\b/i,
  },
  {
    kind: "revshell",
    form: "hands a shell to socat",
    re: /\bsocat\b[^\n]*\b(?:exec|system):[^\n]*(?:sh|bash|cmd|powershell)/i,
  },
  {
    kind: "revshell",
    form: "connects a socket to a shell in code",
    re: /\bsocket\b[^\n]*\bconnect\b[^\n]*(?:pty\.spawn|os\.dup2|subprocess\.(?:call|Popen|run)\s*\(\s*\[?\s*["'](?:\/bin\/)?(?:ba)?sh)|\bfsockopen\s*\([^\n]*(?:exec|system|proc_open|shell_exec)|-rsocket\b[^\n]*TCPSocket/i,
  },
  {
    kind: "revshell",
    form: "opens a TCP client wired to a PowerShell loop",
    re: /Net\.Sockets\.TCPClient\s*\([^\n]*(?:GetStream|iex|Invoke-Expression)/i,
  },
];

// Longest flags first, so "-o" doesn't match the start of "-OutFile".
const OUTPUT_FLAG = /(?:^|\s)(?:(?:-OutFile|--output-document|--output|-o|-O)(?:\s+|=)|>\s*)["']?([^\s"';&|]+)/i;
const RUNNER = new RegExp(
  String.raw`^\s*(?:sudo\s+)?(?:(?:\S*/)?(?:ba|z|da|k)?sh|python[\d.]*|py|node|perl|ruby|php|source|\.|&|Start-Process|${PS}(?:\s+-(?:File|ExecutionPolicy\s+\S+))*|cmd(?:\.exe)?\s+/c|chmod\s+\+?[0-7x]*x[0-7x]*)(?=\s|$)`,
  "i",
);

const baseName = (p: string): string => {
  const clean = p.replace(/["']/g, "").replace(/[?#].*$/, "");
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
};

/** Download to a file, then run that file later in the same command. */
function downloadThenRun(line: string): ExecMatch | undefined {
  const segments = line.split(/\s*(?:&&|\|\||;|\r?\n)\s*/);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    if (!new RegExp(String.raw`\b${DL}\b|\bcertutil\b[^\n]*-urlcache|\bbitsadmin\b[^\n]*/transfer`, "i").test(seg)) continue;
    const names = new Set<string>();
    const out = OUTPUT_FLAG.exec(seg);
    if (out?.[1] && out[1] !== "-" && out[1] !== "/dev/null") names.add(baseName(out[1]));
    for (const url of seg.match(/https?:\/\/[^\s"']+/gi) ?? []) {
      const b = baseName(url);
      if (b) names.add(b);
    }
    // certutil and bitsadmin take the output path as the last argument
    if (/\b(?:certutil|bitsadmin)\b/i.test(seg)) {
      const last = seg.trim().split(/\s+/).pop();
      if (last) names.add(baseName(last));
    }
    const hasOutput = !!out || /\b(?:certutil|bitsadmin)\b/i.test(seg) || /\bwget\b/i.test(seg);
    if (!hasOutput) continue;
    for (const name of names) {
      if (!name || name.length < 2 || !/[.\w]/.test(name)) continue;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const later of segments.slice(i + 1)) {
        const runsByRunner = RUNNER.test(later) && new RegExp(String.raw`(?:^|[\s/\\"'])${esc}(?:$|[\s"'])`, "i").test(later);
        // Run by path (any folder, including %TEMP%\ or $env:TEMP\), or through cmd's start or call.
        const runsDirectly = new RegExp(String.raw`^\s*(?:start\s+(?:"[^"]*"\s+)?(?:/\w+\s+)*|call\s+)?["']?(?:[^\s"']*[/\\])?${esc}(?:$|[\s"'])`, "i").test(later);
        if (runsByRunner || runsDirectly) {
          return { kind: "remote", form: "downloads a file and then runs it", match: trimMatch(`${seg} … ${later}`) };
        }
      }
    }
  }
  return undefined;
}

export function trimMatch(s: string, max = 120): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

/** Join shell line continuations so a command split over lines is matched whole. */
export function joinContinuations(text: string): string {
  return text.replace(/(?:\\|`|\^)[ \t]*\r?\n/g, " ");
}

/** Check one command string (a hook command, a helper, or one logical script line). */
export function findExec(command: string): ExecMatch | undefined {
  const text = joinContinuations(command);
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) return { kind: r.kind, form: r.form, match: trimMatch(m[0]) };
  }
  return downloadThenRun(text);
}

const COMMENT = /^\s*(?:#(?!!)|\/\/|::|rem\s|REM\s|<#|\*\s|\/\*)/;

/** Check a script file line by line, skipping comments. Returns the 1-based line of each hit. */
export function findExecInScript(text: string): Array<ExecMatch & { line: number }> {
  const lines = text.split(/\r?\n/);
  const hits: Array<ExecMatch & { line: number }> = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let logical = lines[i] ?? "";
    const start = i;
    // Continuations: "\" in shell, a backtick in PowerShell, "^" in cmd.
    while (/(?:\\|`|\^)\s*$/.test(logical) && i + 1 < lines.length) {
      logical = logical.replace(/(?:\\|`|\^)\s*$/, " ") + (lines[++i] ?? "");
    }
    if (inBlockComment) {
      if (/#>|\*\//.test(logical)) inBlockComment = false;
      continue;
    }
    if (/^\s*(?:<#|\/\*)/.test(logical) && !/#>|\*\//.test(logical)) {
      inBlockComment = true;
      continue;
    }
    if (COMMENT.test(logical)) continue;
    const hit = findExec(logical);
    if (hit) hits.push({ ...hit, match: trimMatch(logical), line: start + 1 });
  }
  // A script may fetch code into a variable on one line and run it on a later one.
  if (hits.length === 0) {
    const flow = fetchedThenRun(lines);
    if (flow) hits.push(flow);
  }
  // A script may also download on one line and run on the next.
  if (hits.length === 0) {
    const code = joinContinuations(lines.filter((l) => !COMMENT.test(l)).join("\n"));
    const dtr = downloadThenRun(code);
    if (dtr) {
      const first = dtr.match.split(" … ")[0] ?? "";
      const idx = lines.findIndex((l) => first && l.replace(/\s+/g, " ").trim().startsWith(first.slice(0, 30)));
      hits.push({ ...dtr, line: idx >= 0 ? idx + 1 : 1 });
    }
  }
  return hits;
}

/** A call that returns content from the network. */
const FETCH_CALL =
  /\b(?:urlopen|urllib\.request|requests\.(?:get|post|request)|httpx\.(?:get|post|request)|aiohttp|https?\.get|Invoke-RestMethod|Invoke-WebRequest|irm|iwr|DownloadString|DownloadData)\b|\b(?:fetch|axios(?:\.get)?|got)\s*\(|\$\(\s*(?:curl|wget)\b|\b(?:check_output|getoutput)\s*\(\s*\[?\s*["'](?:curl|wget)\b/i;
/** Assignments in Python, JavaScript, PowerShell and shell. Group 1 is the variable, group 2 the value. */
const ASSIGN = [
  /^\s*(?:(?:const|let|var)\s+)?([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)\s*(.+)$/,
  /^\s*\$(?:script:|global:|local:)?([A-Za-z_]\w*)\s*=\s*(.+)$/i,
  /^\s*(?:local\s+|export\s+|readonly\s+)?([A-Za-z_]\w*)=(.+)$/,
];
/** A call that runs code passed to it. Group 1 is the argument text. An empty call such as `eval()` is prose, not a call. */
const RUN_CODE = [
  /\b(?:exec|eval|compile|Function|runInThisContext|runInNewContext|execScript)\s*\(\s*([^\s)].*)$/,
  /\b(?:iex|Invoke-Expression)\b(.*)$/i,
  /\[scriptblock\]::Create\s*\((.*)$/i,
  /\beval\s+([^\s(].*)$/,
  /\b(?:ba|z|da)?sh\s+-c\s+(.*)$/,
];

/** A run-code call with nothing after its opening bracket. */
const OPEN_CALL = /\b(?:exec|eval|compile|Function|runInThisContext|runInNewContext|execScript)\s*\(\s*$/;

/** Code fetched into a variable on one line and run on a later line. */
function fetchedThenRun(lines: string[]): (ExecMatch & { line: number }) | undefined {
  const tainted = new Set<string>();
  const mentions = (text: string): boolean => [...tainted].some((v) => new RegExp(String.raw`(?:^|[^\w$])\$?\{?${v}\b`).test(text));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (COMMENT.test(line)) continue;
    // A call left open at the end of a line, such as `exec(`, takes its argument from the next non-blank line.
    let call = line;
    if (OPEN_CALL.test(line)) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (next) call = `${line}${next.trim()}`;
    }
    for (const re of RUN_CODE) {
      const m = re.exec(call);
      if (m && tainted.size && mentions(m[1] ?? "")) {
        return { kind: "remote", form: "fetches code into a variable and then runs it", match: trimMatch(line), line: i + 1 };
      }
    }
    for (const re of ASSIGN) {
      const m = re.exec(line);
      if (!m?.[1]) continue;
      const value = m[2] ?? "";
      if (FETCH_CALL.test(value) || mentions(value)) tainted.add(m[1]);
      break;
    }
  }
  return undefined;
}

/** True for hosts that mean "this machine". */
export function isLoopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Parse a URL without throwing. */
export function parseUrl(s: string): URL | undefined {
  try {
    return new URL(s);
  } catch {
    return undefined;
  }
}
