import * as os from "node:os";
import { readBaseline, writeBaseline } from "./baseline.ts";
import { recordBaseline } from "./checks/drift.ts";
import { defaultManagedDirs, type ScanMode } from "./discover.ts";
import { join, nodeFs, resolveAbs, toPosix } from "./fsys.ts";
import { BASELINE_DIR, BASELINE_FILE, TOOL_NAME, TOOL_VERSION } from "./name.ts";
import { exitCodeFor, type FailOn, formatInventory, formatJson, formatRules, formatSarif, formatText } from "./output.ts";
import { scan } from "./scan.ts";

const HELP = `${TOOL_NAME} ${TOOL_VERSION}: checks Claude Code, Codex and Cursor config for risky settings.
Reads files only. Makes no network calls and sends no telemetry.

Usage:
  ${TOOL_NAME} [scan] [path]        Check the project at [path] (default: current folder) and your user config
  ${TOOL_NAME} baseline [path]      Record your MCP server definitions so later scans can spot changes
  ${TOOL_NAME} inventory [path]     List the config files found, with tool and scope
  ${TOOL_NAME} rules                List every rule

Options:
  --project-only          Check only the project folder
  --user-only             Check only your user config
  --format <f>            text (default), json or sarif
  --fail-on <level>       Exit 1 if any finding is at or above: high (default), medium, info, never
  --baseline <file>       Baseline file (default ~/${BASELINE_DIR}/${BASELINE_FILE})
  --reset-baseline        With "baseline": replace an existing baseline
  --verbose               Show info notes in text output
  --no-color              No colour (NO_COLOR is also respected)
  --version, --help

Exit codes: 0 no findings at or above --fail-on, 1 findings, 2 the tool couldn't run.
This is a configuration check, not a security assessment.
`;

interface Args {
  command: "scan" | "baseline" | "inventory" | "rules" | "help" | "version";
  path?: string;
  mode: ScanMode;
  format: "text" | "json" | "sarif";
  failOn: FailOn;
  baseline?: string;
  reset: boolean;
  verbose: boolean;
  color: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], env: Record<string, string | undefined>): Args {
  const a: Args = { command: "scan", mode: "all", format: "text", failOn: "high", reset: false, verbose: false, color: !env.NO_COLOR };
  let commandSet = false;
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] ?? "";
    const [flag, inline] = t.startsWith("--") && t.includes("=") ? [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1)] : [t, undefined];
    const take = (): string => inline ?? value(i++, flag);
    switch (flag) {
      case "--help":
      case "-h":
        a.command = "help";
        break;
      case "--version":
      case "-v":
        a.command = "version";
        break;
      case "--project-only":
        a.mode = "project";
        break;
      case "--user-only":
        a.mode = "user";
        break;
      case "--format": {
        const f = take();
        if (f !== "text" && f !== "json" && f !== "sarif") throw new UsageError(`unknown format "${f}"`);
        a.format = f;
        break;
      }
      case "--fail-on": {
        const f = take();
        if (!["high", "medium", "info", "never"].includes(f)) throw new UsageError(`unknown --fail-on level "${f}"`);
        a.failOn = f as FailOn;
        break;
      }
      case "--baseline":
        a.baseline = take();
        break;
      case "--reset-baseline":
        a.reset = true;
        break;
      case "--verbose":
        a.verbose = true;
        break;
      case "--no-color":
        a.color = false;
        break;
      default:
        if (t.startsWith("-")) throw new UsageError(`unknown option ${t}`);
        if (!commandSet && !a.path && ["scan", "baseline", "inventory", "rules"].includes(t)) {
          if (a.command !== "help" && a.command !== "version") a.command = t as Args["command"];
          commandSet = true;
        } else if (!a.path) a.path = t;
        else throw new UsageError(`unexpected argument ${t}`);
    }
  }
  if (argv.includes("--user-only") && argv.includes("--project-only")) throw new UsageError("--project-only and --user-only can't be combined");
  return a;
}

export interface Io {
  out(s: string): void;
  err(s: string): void;
  cwd: string;
  home: string;
  platform: string;
  env: Record<string, string | undefined>;
  isTty: boolean;
}

export function run(argv: string[], io: Io): number {
  let args: Args;
  try {
    args = parseArgs(argv, io.env);
  } catch (e) {
    io.err(`${TOOL_NAME}: ${(e as Error).message}\nRun ${TOOL_NAME} --help for usage.\n`);
    return 2;
  }
  if (args.command === "help") return (io.out(HELP), 0);
  if (args.command === "version") return (io.out(`${TOOL_VERSION}\n`), 0);
  if (args.command === "rules") return (io.out(formatRules()), 0);
  try {
    const home = toPosix(io.home);
    const project = resolveAbs(args.path ? (args.path.startsWith("/") || /^[A-Za-z]:/.test(args.path) ? args.path : join(io.cwd, args.path)) : io.cwd);
    const baselineFile = args.baseline ? resolveAbs(args.baseline) : join(home, BASELINE_DIR, BASELINE_FILE);
    if (nodeFs.list(project) === undefined) {
      io.err(`${TOOL_NAME}: can't read folder ${project}\n`);
      return 2;
    }
    const base = { fs: nodeFs, home, project, mode: args.mode, managedDirs: defaultManagedDirs(io.platform) };
    if (args.command === "baseline") {
      const r = scan(base);
      const b = recordBaseline(r.model, new Date().toISOString());
      if (!writeBaseline(baselineFile, b, args.reset)) {
        io.err(`${TOOL_NAME}: a baseline already exists at ${baselineFile}. Pass --reset-baseline to replace it.\n`);
        return 2;
      }
      io.out(`Recorded ${Object.keys(b.servers).length} MCP server definition(s) from ${b.files.length} file(s) to ${baselineFile}\n`);
      return 0;
    }
    const baseline = readBaseline(baselineFile);
    const r = scan({ ...base, baseline });
    if (args.command === "inventory") return (io.out(formatInventory(r)), 0);
    if (args.format === "json") io.out(formatJson(r));
    else if (args.format === "sarif") io.out(formatSarif(r));
    else io.out(formatText(r, { color: args.color && io.isTty, verbose: args.verbose }));
    return exitCodeFor(r.findings, args.failOn);
  } catch (e) {
    io.err(`${TOOL_NAME}: ${(e as Error).message}\n`);
    return 2;
  }
}

const isMain = (): boolean => {
  const entry = process.argv[1] ?? "";
  return /(?:cli\.(?:m?js|ts)|whatsallowed)$/.test(entry.replaceAll("\\", "/"));
};

if (isMain()) {
  const code = run(process.argv.slice(2), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    cwd: process.cwd(),
    home: os.homedir(),
    platform: process.platform,
    env: process.env,
    isTty: !!process.stdout.isTTY,
  });
  process.exitCode = code;
}
