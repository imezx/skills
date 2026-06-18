import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import {
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_MAX_OUTPUT_BYTES,
} from "./constants";

export type Platform = "windows" | "macos" | "linux";

export interface ShellInfo {
  path: string;
  args: string[];
  platform: Platform;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  shell: string;
  platform: Platform;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  shellPath?: string;
  windowsShell?: "powershell" | "cmd";
  env?: Record<string, string>;
}

export function detectPlatform(): Platform {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

export function resolveShell(
  override?: string,
  windowsShell?: "powershell" | "cmd",
): ShellInfo {
  const platform = detectPlatform();

  if (override && override.trim()) {
    const p = override.trim();
    const lower = p.toLowerCase();
    const isPowerShell =
      lower.endsWith("powershell.exe") ||
      lower.endsWith("pwsh.exe") ||
      lower.endsWith("pwsh");
    return {
      path: p,
      args: isPowerShell ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-c"],
      platform,
    };
  }

  if (platform === "windows") {
    const pref = windowsShell ?? "cmd";

    if (pref === "cmd") {
      return { path: "cmd.exe", args: ["/c"], platform };
    }

    const pwshCandidates = [
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ];

    for (const p of pwshCandidates) {
      if (fs.existsSync(p)) {
        return { path: p, args: ["-NoProfile", "-NonInteractive", "-Command"], platform };
      }
    }

    return { path: "cmd.exe", args: ["/c"], platform };
  }

  if (process.env.SHELL) {
    try {
      if (fs.existsSync(process.env.SHELL)) {
        return { path: process.env.SHELL, args: ["-c"], platform };
      }
    } catch { }
  }

  for (const sh of ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh", "/usr/local/bin/bash", "/usr/local/bin/zsh", "/bin/zsh"]) {
    try {
      if (fs.existsSync(sh)) return { path: sh, args: ["-c"], platform };
    } catch { }
  }

  return { path: "/bin/sh", args: ["-c"], platform };
}

export function resolveCwd(cwd?: string): string {
  if (!cwd) return os.homedir();
  const expanded = cwd.replace(/^~(?=[/\\]|$)/, os.homedir());
  try {
    if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory())
      return expanded;
  } catch { }
  return os.homedir();
}

function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;
  return (
    buf.slice(0, maxBytes).toString("utf-8") +
    `\n[truncated - output exceeded ${maxBytes} bytes]`
  );
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function expandWindowsPath(current: string): string {
  const query = (hive: string) => {
    try {
      const out = child_process.execSync(
        `reg query "${hive}" /v PATH`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 },
      );
      const m = out.match(/PATH\s+REG(?:_EXPAND)?_SZ\s+(.+)/i);
      return m ? m[1].trim() : "";
    } catch {
      return "";
    }
  };

  const machine = query("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment");
  const user = query("HKCU\\Environment");

  const parts = [machine, user, current].filter(Boolean);
  return [...new Set(parts.join(";").split(";").map(p => p.trim()).filter(Boolean))].join(";");
}

export function execCommand(
  command: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const shellInfo = resolveShell(options.shellPath, options.windowsShell);
    const cwd = resolveCwd(options.cwd);
    const timeoutMs = Math.min(
      options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS,
      EXEC_MAX_TIMEOUT_MS,
    );

    const baseEnv: NodeJS.ProcessEnv = { ...process.env };

    if (shellInfo.platform === "windows" && baseEnv.PATH) {
      baseEnv.PATH = expandWindowsPath(baseEnv.PATH);
    }

    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      ...(options.env ?? {}),
    };

    const isPowerShell =
      shellInfo.path.toLowerCase().endsWith("powershell.exe") ||
      shellInfo.path.toLowerCase().endsWith("pwsh.exe");

    let finalCommand: string;

    if (isPowerShell) {
      finalCommand =
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`;
    } else {
      finalCommand = command;
    }

    let proc: child_process.ChildProcess;
    try {
      proc = child_process.spawn(
        shellInfo.path,
        [...shellInfo.args, finalCommand],
        { cwd, env, windowsHide: true },
      );
    } catch (spawnErr) {
      resolve({
        stdout: "",
        stderr: spawnErr instanceof Error ? spawnErr.message : String(spawnErr),
        exitCode: 1,
        timedOut: false,
        shell: shellInfo.path,
        platform: shellInfo.platform,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGKILL"); } catch { }
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: truncate(normalizeLineEndings(stdout), EXEC_MAX_OUTPUT_BYTES),
        stderr: truncate(normalizeLineEndings(stderr), EXEC_MAX_OUTPUT_BYTES),
        exitCode: code ?? 1,
        timedOut,
        shell: shellInfo.path,
        platform: shellInfo.platform,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        timedOut: false,
        shell: shellInfo.path,
        platform: shellInfo.platform,
      });
    });
  });
}
