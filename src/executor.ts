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
}

function detectPlatform(): Platform {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function resolveShell(): ShellInfo {
  const platform = detectPlatform();

  if (platform === "windows") {
    const pwshCore = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const pwshBuiltin =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

    if (fs.existsSync(pwshCore)) {
      return {
        path: pwshCore,
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-OutputEncoding",
          "UTF8",
          "-Command",
        ],
        platform,
      };
    }
    if (fs.existsSync(pwshBuiltin)) {
      return {
        path: pwshBuiltin,
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-OutputEncoding",
          "UTF8",
          "-Command",
        ],
        platform,
      };
    }
    return { path: "cmd.exe", args: ["/c"], platform };
  }

  for (const sh of ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"]) {
    if (fs.existsSync(sh)) {
      return { path: sh, args: ["-c"], platform };
    }
  }

  return { path: "/bin/sh", args: ["-c"], platform };
}

function resolveCwd(cwd?: string): string {
  if (!cwd) return os.homedir();
  const expanded = cwd.replace(/^~(?=[/\\]|$)/, os.homedir());
  try {
    if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory())
      return expanded;
  } catch {}
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

function normalizeOutput(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function execCommand(
  command: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const shellInfo = resolveShell();
    const cwd = resolveCwd(options.cwd);
    const timeoutMs = Math.min(
      options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS,
      EXEC_MAX_TIMEOUT_MS,
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    };

    let proc: child_process.ChildProcess;

    try {
      proc = child_process.spawn(shellInfo.path, [...shellInfo.args, command], {
        cwd,
        env,
        windowsHide: true,
      });
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

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: truncate(normalizeOutput(stdout), EXEC_MAX_OUTPUT_BYTES),
        stderr: truncate(normalizeOutput(stderr), EXEC_MAX_OUTPUT_BYTES),
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

export { resolveShell, detectPlatform };
