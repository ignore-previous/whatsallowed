import { type McpServer, type Model, stringMap } from "../model.ts";
import { get, str, strArr } from "../parse.ts";
import { findExec, isLoopback, parseUrl } from "../patterns.ts";
import type { Finding } from "../types.ts";
import { make, scopeWord } from "./util.ts";

const f = (x: Parameters<typeof make>[1]): Finding => make("MCP", x);

/** Split a command line into words, honouring simple quotes. */
export function shellWords(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const m of s.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

const base = (w: string): string => (w.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
const META = /;|&&|\|\||\||`|\$\(|>\s*\S|<\(/;

export interface Launch {
  argv: string[];
  /** Set when the server is started through a shell string. */
  shellScript?: string;
}

/** Peel off cmd /c, sh -c, powershell -Command wrappers. */
export function unwrap(argv: string[]): Launch {
  const b = base(argv[0] ?? "");
  if (b === "cmd") {
    const i = argv.findIndex((a) => /^\/[ck]$/i.test(a));
    if (i >= 0) {
      const rest = argv.slice(i + 1);
      const script = rest.join(" ");
      return { argv: rest.length === 1 ? shellWords(rest[0] ?? "") : rest, shellScript: script };
    }
  }
  if (["sh", "bash", "zsh", "dash", "ksh"].includes(b)) {
    const i = argv.findIndex((a) => /^-\w*c\w*$/.test(a));
    if (i >= 0 && argv[i + 1] !== undefined) {
      const script = argv[i + 1] ?? "";
      return { argv: shellWords(script), shellScript: script };
    }
  }
  if (b === "powershell" || b === "pwsh") {
    const i = argv.findIndex((a) => /^-c(ommand)?$/i.test(a));
    if (i >= 0) {
      const script = argv.slice(i + 1).join(" ");
      return { argv: shellWords(script), shellScript: script };
    }
  }
  return { argv };
}

const NPM_EXACT = /^(?:@[^@/\s]+\/)?[^@/\s]+@v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PY_EXACT = /^[A-Za-z0-9_.\-[\],]+(?:==|@)v?\d+(?:\.\d+)*(?:[-+.]?[0-9A-Za-z.]+)?$/;

interface RunnerHit {
  runner: string;
  pkg: string;
  pinned: boolean;
}

/** Find a package runner and the package it runs. */
export function findRunner(argv: string[]): RunnerHit | undefined {
  for (let i = 0; i < argv.length; i++) {
    const w = base(argv[i] ?? "");
    const next = (argv[i + 1] ?? "").toLowerCase();
    let runner: string | undefined;
    let start = i + 1;
    let py = false;
    if (w === "npx" || w === "bunx" || w === "pnpx") runner = w;
    else if ((w === "pnpm" || w === "yarn") && next === "dlx") ((runner = `${w} dlx`), (start = i + 2));
    else if (w === "npm" && (next === "exec" || next === "x")) ((runner = "npm exec"), (start = i + 2));
    else if (w === "bun" && next === "x") ((runner = "bun x"), (start = i + 2));
    else if (w === "uvx") ((runner = "uvx"), (py = true));
    else if (w === "uv" && next === "tool" && (argv[i + 2] ?? "").toLowerCase() === "run") ((runner = "uv tool run"), (start = i + 3), (py = true));
    else if (w === "pipx" && next === "run") ((runner = "pipx run"), (start = i + 2), (py = true));
    if (!runner) continue;
    let pkg: string | undefined;
    for (let j = start; j < argv.length; j++) {
      const a = argv[j] ?? "";
      const pkgFlag = /^(?:-p|--package|--from|--spec)(?:=(.+))?$/.exec(a);
      if (pkgFlag) {
        pkg = pkgFlag[1] ?? argv[j + 1];
        break;
      }
      if (a === "--") continue;
      if (a.startsWith("-")) {
        // flags that take a value
        if (/^(?:--python|-r|--registry|--with|--index-url|--cache|--userconfig)$/.test(a)) j++;
        continue;
      }
      pkg = a;
      break;
    }
    if (!pkg) return undefined;
    if (/^(?:\.{0,2}\/|[A-Za-z]:[\\/]|file:)/.test(pkg)) return undefined; // local path, not a download
    const pinned = py ? PY_EXACT.test(pkg) : NPM_EXACT.test(pkg);
    return { runner, pkg, pinned };
  }
  return undefined;
}

const ANY_HOST = /(?:^|[\s=:"'/])(?:0\.0\.0\.0|::|\[::\])(?=$|[\s:"'/\]])/;

function checkServer(s: McpServer): Finding[] {
  const out: Finding[] = [];
  const d = s.def;
  const where = scopeWord(s.scope);
  const cmdLine = s.doc.lineOf([...s.base, "command"]);
  const command = d.command;
  const args = strArr(d.args);
  const argv0 = Array.isArray(command) ? strArr(command) : typeof command === "string" ? (args.length ? [command] : shellWords(command)) : [];
  const argv = [...argv0, ...args];
  if (argv.length) {
    const joined = argv.join(" ");
    const launch = unwrap(argv);
    const exec = findExec(launch.shellScript ?? joined);
    if (exec) {
      out.push(
        f({
          rule: "MCP-003",
          severity: "high",
          title: `MCP server "${s.name}" downloads code and runs it at launch`,
          file: s.file,
          line: cmdLine,
          match: exec.match,
          why: `The launch command ${exec.form}. Whoever controls that address decides what runs each time the server starts.`,
          fix: "Install a pinned release of the server and launch the local copy.",
        }),
      );
    } else if (launch.shellScript !== undefined && META.test(launch.shellScript)) {
      out.push(
        f({
          rule: "MCP-002",
          severity: "medium",
          title: `MCP server "${s.name}" is launched through a shell script`,
          file: s.file,
          line: cmdLine,
          match: launch.shellScript.slice(0, 100),
          why: "Chaining commands in a shell string hides extra steps in the launch, and the shell runs whatever the string expands to.",
          fix: "Point command at the server's executable and pass its options in args.",
        }),
      );
    }
    const r = findRunner(launch.argv);
    if (r && !r.pinned) {
      out.push(
        f({
          rule: "MCP-001",
          severity: "medium",
          title: `MCP server "${s.name}" runs an unpinned package`,
          file: s.file,
          line: cmdLine,
          match: `${r.runner} ${r.pkg}`,
          why: `Each launch fetches whatever version is newest. If the package or its publisher account is compromised, the next start runs the new code with your agent's access.`,
          fix: `Pin an exact version, for example ${r.runner} ${r.pkg.replace(/@[^@/]*$/, "")}${r.runner === "uvx" || r.runner === "pipx run" || r.runner === "uv tool run" ? "==1.2.3" : "@1.2.3"}.`,
        }),
      );
    }
  }
  // Listening on every interface
  const env = stringMap(d.env);
  const hostIdx = args.findIndex((a) => ANY_HOST.test(` ${a} `));
  const hostEnv = Object.entries(env).find(([k, v]) => /host|bind|listen|addr/i.test(k) && ANY_HOST.test(` ${v} `));
  const url = str(d.url) ?? str(d.serverUrl) ?? str(d.httpUrl);
  const u = url ? parseUrl(url) : undefined;
  const urlAny = u && (u.hostname === "0.0.0.0" || u.hostname === "[::]" || u.hostname === "::");
  if (hostIdx >= 0 || hostEnv || urlAny || (typeof command === "string" && !args.length && ANY_HOST.test(` ${command} `))) {
    out.push(
      f({
        rule: "MCP-004",
        severity: "medium",
        title: `MCP server "${s.name}" listens on every network interface`,
        file: s.file,
        line: hostIdx >= 0 ? s.doc.lineOf([...s.base, "args", hostIdx]) : hostEnv ? s.doc.lineOf([...s.base, "env", hostEnv[0]]) : cmdLine,
        match: hostIdx >= 0 ? (args[hostIdx] ?? "") : hostEnv ? `${hostEnv[0]}=${hostEnv[1]}` : (url ?? String(command)),
        why: "Other machines on the same network, such as café or office Wi-Fi, can reach the server and call its tools.",
        fix: "Bind to 127.0.0.1.",
      }),
    );
  }
  if (u && !urlAny) {
    if (u.protocol === "http:" && !isLoopback(u.hostname)) {
      out.push(
        f({
          rule: "MCP-006",
          severity: "medium",
          title: `MCP server "${s.name}" talks to a remote host over plain http`,
          file: s.file,
          line: s.doc.lineOf([...s.base, "url"]),
          match: url ?? "",
          why: "Tool calls, results and any auth headers cross the network unencrypted.",
          fix: "Use the server's https address.",
        }),
      );
    } else if (u.protocol === "https:" && !isLoopback(u.hostname) && s.scope === "project") {
      out.push(
        f({
          rule: "MCP-007",
          severity: "info",
          title: `The repository connects to a remote MCP server "${s.name}"`,
          file: s.file,
          line: s.doc.lineOf([...s.base, "url"]),
          match: u.host,
          why: `Tool calls go to ${u.host}. Check you trust it before approving the server.`,
          fix: "No change needed if you trust the host.",
        }),
      );
    }
  }
  const secret = get(d, "oauth", "client_secret");
  if (typeof secret === "string" && secret.trim() && !/^\$\{?[A-Za-z_]\w*\}?$/.test(secret.trim())) {
    out.push(
      f({
        rule: "MCP-005",
        severity: "medium",
        title: `MCP server "${s.name}" keeps an OAuth client secret in the config file`,
        file: s.file,
        line: s.doc.lineOf([...s.base, "oauth", "client_secret"]),
        match: "oauth.client_secret = (hidden)",
        why: `The secret sits in plain text in a ${where}, where backups, dotfile repos and other tools can read it.`,
        fix: "Move it to an environment variable or your OS keychain.",
      }),
    );
  }
  return out;
}

export function checkMcp(m: Model): Finding[] {
  return m.servers.flatMap(checkServer);
}
