import { toPosix } from "../fsys.ts";
import type { Model, Parsed } from "../model.ts";
import { get, strArr } from "../parse.ts";
import type { Finding } from "../types.ts";
import { isHomeOrRoot } from "./mode.ts";
import { make } from "./util.ts";

const f = (x: Parameters<typeof make>[1]): Finding => make("ALLOW", x);

/** Programs that can run arbitrary code, gain privileges, reach other machines, or delete anything. */
const POWERFUL = new Set(
  [
    "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
    "python", "python2", "python3", "py", "node", "deno", "bun", "ruby", "perl", "php", "lua", "osascript",
    "npx", "bunx", "pnpx", "uvx", "eval", "exec", "env", "xargs", "nohup", "timeout", "watch", "time",
    "sudo", "su", "doas", "runas", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "netcat", "socat", "telnet",
    "curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod", "iex", "invoke-expression", "start-process",
    "rm", "del", "remove-item", "docker", "podman", "kubectl",
  ].map((s) => s.toLowerCase()),
);

/** Multi-word runners: "npm exec", "pnpm dlx", ... */
const POWERFUL_PAIRS = new Set(["npm exec", "pnpm dlx", "pnpm exec", "yarn dlx", "uv run", "pipx run", "bun x", "deno run", "go run", "cargo run"]);

/** Flags that only print a version or help text. */
const INFO_FLAGS = new Set(["--version", "--help"]);

const WILD_TAIL = /^(?:\s+--?[\w-]+)*(?:\s*\*|:\*|\s+\*\*?)$/;

type Verdict = { rule: "ALLOW-001" | "ALLOW-002"; word?: string } | undefined;

export function classifyAllowRule(rule: string): Verdict {
  const r = rule.trim();
  const m = /^(Bash|PowerShell)(?:\((.*)\))?$/is.exec(r);
  if (!m) return undefined;
  const inner = (m[2] ?? "").trim();
  if (m[2] === undefined || inner === "" || /^(?:\*+|:\*|\*:\*|\*\s*\*)$/.test(inner)) return { rule: "ALLOW-001" };
  // Leading wildcard: "* --help" style rules still match any command prefix.
  if (/^\*\s/.test(inner) || inner === "*:*") return { rule: "ALLOW-001" };
  const words = inner.split(/\s+/);
  const first = (words[0] ?? "").replace(/:\*$|\*$/, "");
  const base = first.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const rest = inner.slice((words[0] ?? "").length);
  // "Bash(node --version:*)": the program prints its version or help and exits, so the wildcard can't make it run code.
  // Bash only: in PowerShell these are ordinary arguments, so "PowerShell(rm --version *)" stays flagged.
  const flags = words.slice(1).map((w) => w.replace(/:\*$|\*+$/, "")).filter((w) => w !== "");
  if (m[1]?.toLowerCase() === "bash" && flags.length > 0 && flags.every((w) => INFO_FLAGS.has(w))) return undefined;
  // "cmd *", "cmd:*", "cmd*"
  if (POWERFUL.has(base) && (WILD_TAIL.test(rest) || /(?::\*|\*)$/.test(words[0] ?? "") && words.length === 1)) {
    return { rule: "ALLOW-002", word: base };
  }
  if (words.length >= 2) {
    const pair = `${base} ${(words[1] ?? "").replace(/:\*$|\*$/, "").toLowerCase()}`;
    const restPair = inner.slice(inner.indexOf(words[1] ?? "") + (words[1] ?? "").length);
    if (POWERFUL_PAIRS.has(pair) && (WILD_TAIL.test(restPair) || /(?::\*|\*)$/.test(words[1] ?? ""))) return { rule: "ALLOW-002", word: pair };
  }
  return undefined;
}

function resolveDir(dir: string, project: string, home: string): string {
  let d = dir.trim();
  if (d === "~" || d.startsWith("~/")) d = home + d.slice(1);
  d = toPosix(d);
  const abs = /^(?:\/|[A-Za-z]:\/)/.test(d) ? d : `${toPosix(project)}/${d}`;
  const out: string[] = [];
  const parts = abs.split("/");
  const lead = parts[0] === "" ? "/" : `${parts[0]}/`;
  for (const part of parts.slice(1)) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return toPosix(lead + out.join("/"));
}

function checkFile(p: Parsed, m: Model): Finding[] {
  const out: Finding[] = [];
  const allow = strArr(get(p.doc.value, "permissions", "allow"));
  allow.forEach((rule, i) => {
    const line = p.doc.lineOf(["permissions", "allow", i]);
    const v = classifyAllowRule(rule);
    if (v?.rule === "ALLOW-001") {
      out.push(
        f({
          rule: "ALLOW-001",
          severity: "high",
          title: "An allow rule approves every shell command",
          file: p.file,
          line,
          match: rule,
          why: "Any command the agent decides to run, including deleting files or sending data out, runs without a prompt.",
          fix: 'Replace it with the specific commands you use, such as "Bash(npm run test)" or "Bash(git diff *)".',
        }),
      );
    } else if (v?.rule === "ALLOW-002") {
      out.push(
        f({
          rule: "ALLOW-002",
          severity: "medium",
          title: `An allow rule approves "${v.word}" with any arguments`,
          file: p.file,
          line,
          match: rule,
          why: `"${v.word}" can run arbitrary code, reach the network or delete files, so allowing it with any arguments is close to allowing every command.`,
          // Name the same tool as the rule, so a PowerShell rule isn't answered with a Bash example.
          fix: `Allow the exact invocations you need, for example "${/^\s*powershell/i.test(rule) ? "PowerShell" : "Bash"}(${v.word === "python3" || v.word === "python" ? "python3 -m pytest" : v.word} ...)" with fixed arguments.`,
        }),
      );
    }
    if (/^WebFetch(?:\(\s*(?:domain:\s*\*|\*)?\s*\))?$/i.test(rule.trim())) {
      out.push(
        f({
          rule: "ALLOW-003",
          severity: "medium",
          title: "The agent can fetch any web address without asking",
          file: p.file,
          line,
          match: rule,
          why: "A prompt injected into a page or file can make the agent send data to any site, with no prompt to stop it.",
          fix: 'List the domains you need: "WebFetch(domain:docs.example.com)".',
        }),
      );
    }
  });
  const dirs = strArr(get(p.doc.value, "permissions", "additionalDirectories"));
  dirs.forEach((dir, i) => {
    const resolved = resolveDir(dir, m.ctx.project, m.ctx.home);
    if (isHomeOrRoot(dir, m.ctx.home) || isHomeOrRoot(resolved, m.ctx.home)) {
      out.push(
        f({
          rule: "ALLOW-004",
          severity: "medium",
          title: "The agent's working area includes your whole home folder or a drive",
          file: p.file,
          line: p.doc.lineOf(["permissions", "additionalDirectories", i]),
          match: dir,
          why: "Files across your home folder, such as SSH keys and other projects, become readable and editable like project files.",
          fix: "Add only the specific folders the project needs.",
        }),
      );
    }
  });
  return out;
}

export function checkAllow(m: Model): Finding[] {
  return m.settings.flatMap((p) => checkFile(p, m));
}
