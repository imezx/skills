import * as path from "path";
import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { resolveEffectiveConfig } from "./settings";
import { execCommand, resolveShell, detectPlatform } from "./executor";
import {
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_MAX_COMMAND_LENGTH,
} from "./constants";
import {
  scanSkills,
  resolveSkillByName,
  readSkillFile,
  readAbsolutePath,
  listSkillDirectory,
  listAbsoluteDirectory,
} from "./scanner";
import type { PluginController } from "./pluginTypes";
import type { DirectoryEntry } from "./types";

function formatDirEntries(entries: DirectoryEntry[], rootName: string): string {
  if (entries.length === 0) return "Directory is empty.";

  const lines: string[] = [`${rootName}/`];
  for (const entry of entries) {
    const depth = entry.relativePath.split(/[/\\]/).length - 1;
    const indent = "  ".repeat(depth);
    if (entry.type === "directory") {
      lines.push(`${indent}${entry.name}/`);
    } else {
      const size =
        entry.sizeBytes !== undefined
          ? entry.sizeBytes >= 1024
            ? `${Math.round(entry.sizeBytes / 1024)}K`
            : `${entry.sizeBytes}B`
          : "";
      lines.push(`${indent}${entry.name}${size ? `  (${size})` : ""}`);
    }
  }
  return lines.join("\n");
}

export async function toolsProvider(ctl: PluginController) {
  const listSkillsTool = tool({
    name: "list_skills",
    description:
      "List all available skills in the skills directory. " +
      "Each skill is a directory with a SKILL.md entry point containing instructions and best practices. " +
      "Call this first when you are unsure which skills are available. " +
      "After listing, call read_skill_file to read the SKILL.md of any skill relevant to your current task.",
    parameters: {},
    implementation: async (_, { status }) => {
      status("Scanning skills directory…");
      const cfg = resolveEffectiveConfig(ctl);
      const skills = scanSkills(cfg.skillsPath);

      if (skills.length === 0) {
        return {
          found: 0,
          skillsPath: cfg.skillsPath,
          skills: [],
          note: "No skills found. Create skill directories with a SKILL.md file inside the skills path.",
        };
      }

      status(`Found ${skills.length} skill${skills.length !== 1 ? "s" : ""}`);

      return {
        found: skills.length,
        skillsPath: cfg.skillsPath,
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          skillMdPath: s.skillMdPath,
          hasExtraFiles: s.hasExtraFiles,
        })),
      };
    },
  });

  const readSkillFileTool = tool({
    name: "read_skill_file",
    description:
      "Read a file from within a skill directory. " +
      "Accepts either a skill name (e.g. 'docx') or an absolute path to any file within a skill directory. " +
      "Defaults to reading the SKILL.md entry point when no file_path is given. " +
      "ALWAYS call this before starting any task the skill covers - the SKILL.md contains critical instructions built from trial and error. " +
      "Multiple skills may be relevant to a task; read all of them before proceeding.",
    parameters: {
      skill_name: z
        .string()
        .min(1)
        .describe(
          "Skill directory name (e.g. 'docx') or an absolute path to a file within a skill directory.",
        ),
      file_path: z
        .string()
        .optional()
        .describe(
          "Relative path to a file within the skill directory. Omit to read SKILL.md. " +
            "Ignored when skill_name is an absolute path.",
        ),
    },
    implementation: async ({ skill_name, file_path }, { status }) => {
      status(`Reading ${skill_name}${file_path ? ` / ${file_path}` : ""}…`);

      if (path.isAbsolute(skill_name)) {
        const cfg = resolveEffectiveConfig(ctl);
        const resolvedSkillsPath = path.resolve(cfg.skillsPath);
        if (
          !path.resolve(skill_name).startsWith(resolvedSkillsPath + path.sep)
        ) {
          return {
            success: false,
            error: "Path is outside the skills directory.",
          };
        }
        const result = readAbsolutePath(skill_name);
        if ("error" in result) return { success: false, error: result.error };
        status(`Read ${Math.round(result.content.length / 1024)}KB`);
        return {
          success: true,
          filePath: result.resolvedPath,
          content: result.content,
        };
      }

      const cfg = resolveEffectiveConfig(ctl);
      const skill = resolveSkillByName(cfg.skillsPath, skill_name);

      if (!skill) {
        return {
          success: false,
          error: `Skill "${skill_name}" not found. Call list_skills to see available skills.`,
        };
      }

      const result = readSkillFile(skill, file_path);
      if ("error" in result)
        return { success: false, skill: skill_name, error: result.error };

      status(
        `Read ${Math.round(result.content.length / 1024)}KB from ${skill_name}`,
      );

      return {
        success: true,
        skill: skill.name,
        filePath: file_path || "SKILL.md",
        resolvedPath: result.resolvedPath,
        content: result.content,
        hasExtraFiles: skill.hasExtraFiles,
        ...(skill.hasExtraFiles
          ? {
              hint: "This skill has additional files. Call list_skill_files to explore them.",
            }
          : {}),
      };
    },
  });

  const listSkillFilesTool = tool({
    name: "list_skill_files",
    description:
      "List all files inside a skill directory. " +
      "Accepts either a skill name (e.g. 'docx') or an absolute path to a skill directory. " +
      "Use this after reading SKILL.md when you need to discover additional supporting files " +
      "such as helper scripts, templates, or supplementary documentation the SKILL.md references.",
    parameters: {
      skill_name: z
        .string()
        .min(1)
        .describe(
          "Skill directory name (e.g. 'docx') or an absolute path to a skill directory.",
        ),
      sub_path: z
        .string()
        .optional()
        .describe(
          "Optional relative sub-path within the skill directory to list. Omit to list the entire skill directory.",
        ),
    },
    implementation: async ({ skill_name, sub_path }, { status }) => {
      status(`Listing files in ${skill_name}…`);

      if (path.isAbsolute(skill_name)) {
        const cfg = resolveEffectiveConfig(ctl);
        const resolvedSkillsPath = path.resolve(cfg.skillsPath);
        if (
          !path.resolve(skill_name).startsWith(resolvedSkillsPath + path.sep)
        ) {
          return {
            success: false,
            error: "Path is outside the skills directory.",
          };
        }
        const entries = listAbsoluteDirectory(skill_name);
        const formatted = formatDirEntries(entries, path.basename(skill_name));
        status(`Found ${entries.length} entries`);
        return {
          success: true,
          directoryPath: skill_name,
          entryCount: entries.length,
          tree: formatted,
          entries: entries.map((e) => ({
            name: e.name,
            path: e.relativePath,
            type: e.type,
            ...(e.sizeBytes !== undefined ? { sizeBytes: e.sizeBytes } : {}),
          })),
        };
      }

      const cfg = resolveEffectiveConfig(ctl);
      const skill = resolveSkillByName(cfg.skillsPath, skill_name);

      if (!skill) {
        return {
          success: false,
          error: `Skill "${skill_name}" not found. Call list_skills to see available skills.`,
        };
      }

      const entries = listSkillDirectory(skill, sub_path);
      const formatted = formatDirEntries(entries, skill.name);

      status(`Found ${entries.length} entries in ${skill_name}`);

      return {
        success: true,
        skill: skill.name,
        directoryPath: skill.directoryPath,
        entryCount: entries.length,
        tree: formatted,
        entries: entries.map((e) => ({
          name: e.name,
          path: e.relativePath,
          type: e.type,
          ...(e.sizeBytes !== undefined ? { sizeBytes: e.sizeBytes } : {}),
        })),
      };
    },
  });

  const runCommandTool = tool({
    name: "run_command",
    description:
      "Execute a shell command on the user's machine. " +
      "On Windows this runs in PowerShell Core (pwsh.exe), PowerShell (powershell.exe), or cmd.exe - whichever is available, in that order. " +
      "On macOS and Linux this runs in bash or sh. " +
      "The platform and shell fields in the response tell you exactly which shell was used so you can adapt syntax accordingly. " +
      "Use this to run Python scripts from skills, install packages, read or write files, or perform any system task. " +
      "Python scripts referenced by skills can be executed directly - copy the script path from list_skill_files and run it with python3 (or python on Windows).",
    parameters: {
      command: z
        .string()
        .min(1)
        .max(EXEC_MAX_COMMAND_LENGTH)
        .describe("The shell command to execute."),
      cwd: z
        .string()
        .optional()
        .describe(
          "Working directory for the command. Supports ~ for home directory. Defaults to the user's home directory if omitted or invalid.",
        ),
      timeout_ms: z
        .number()
        .int()
        .min(1_000)
        .max(EXEC_MAX_TIMEOUT_MS)
        .optional()
        .describe(
          `Timeout in milliseconds. Defaults to ${EXEC_DEFAULT_TIMEOUT_MS}ms. Maximum ${EXEC_MAX_TIMEOUT_MS}ms. Increase for long-running scripts.`,
        ),
    },
    implementation: async ({ command, cwd, timeout_ms }, { status }) => {
      const shell = resolveShell();
      status(
        `Running on ${shell.platform}: ${command.slice(0, 60)}${command.length > 60 ? "\u2026" : ""}`,
      );

      const result = await execCommand(command, { cwd, timeoutMs: timeout_ms });

      if (result.timedOut) {
        status("Timed out");
      } else {
        status(`Exit ${result.exitCode}`);
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        platform: result.platform,
        shell: result.shell,
        ...(result.timedOut
          ? {
              hint: "Command exceeded the timeout. Try increasing timeout_ms or splitting into smaller steps.",
            }
          : {}),
        ...(result.exitCode !== 0 && !result.timedOut && result.stderr
          ? {
              hint: "Command exited with a non-zero code. Check stderr for details.",
            }
          : {}),
      };
    },
  });

  return [
    listSkillsTool,
    readSkillFileTool,
    listSkillFilesTool,
    runCommandTool,
  ];
}
