import * as path from "path";
import { tool } from "@lmstudio/sdk";
import { z } from "zod";
import { resolveEffectiveConfig } from "./settings";
import { execCommand, resolveShell } from "./executor";
import {
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_MAX_COMMAND_LENGTH,
  LIST_SKILLS_DEFAULT_LIMIT,
} from "./constants";
import {
  scanSkills,
  searchSkills,
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
      "List or search available skills. " +
      "Without a query, returns all skills up to the limit. " +
      "With a query, scores and ranks skills by relevance across name, tags, description, and SKILL.md body content - use this to find skills relevant to a task without needing all skills in context. " +
      "Always call read_skill_file on any skill that looks relevant before starting work.",
    parameters: {
      query: z
        .string()
        .optional()
        .describe(
          "Optional search query to filter and rank skills by relevance. " +
            "Matches against skill names, tags, descriptions, and SKILL.md body using IDF-weighted token scoring, phrase proximity, and partial prefix matching. " +
            "Omit to list all skills.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe(
          `Maximum number of skills to return. Defaults to ${LIST_SKILLS_DEFAULT_LIMIT}. Omit the query and set a high limit to page through all installed skills.`,
        ),
    },
    implementation: async ({ query, limit }, { status }) => {
      const cfg = resolveEffectiveConfig(ctl);
      const cap = limit ?? LIST_SKILLS_DEFAULT_LIMIT;

      if (query && query.trim()) {
        status(`Searching skills for "${query.trim()}"..`);
        const results = searchSkills(cfg.skillsPaths, query.trim());

        if (results.length === 0) {
          return {
            query: query.trim(),
            found: 0,
            skills: [],
            note: "No skills matched. Try a broader query or omit the query to list all skills.",
          };
        }

        const page = results.slice(0, cap);
        status(
          `Found ${results.length} match${results.length !== 1 ? "es" : ""}`,
        );

        return {
          query: query.trim(),
          total: results.length,
          found: page.length,
          ...(results.length > cap
            ? {
                note: `Showing top ${cap} of ${results.length} matches. Refine your query or increase the limit to see more.`,
              }
            : {}),
          skills: page.map(({ skill, score }) => ({
            name: skill.name,
            description: skill.description,
            tags: skill.tags.length > 0 ? skill.tags : undefined,
            skillMdPath: skill.skillMdPath,
            hasExtraFiles: skill.hasExtraFiles,
            score: Math.round(score * 100) / 100,
          })),
        };
      }

      status("Scanning skills directory..");
      const skills = scanSkills(cfg.skillsPaths);

      if (skills.length === 0) {
        return {
          total: 0,
          found: 0,
          skillsPaths: cfg.skillsPaths,
          skills: [],
          note: "No skills found. Create skill directories with a SKILL.md file inside the configured skills paths.",
        };
      }

      const page = skills.slice(0, cap);
      status(`Found ${skills.length} skill${skills.length !== 1 ? "s" : ""}`);

      return {
        total: skills.length,
        found: page.length,
        skillsPaths: cfg.skillsPaths,
        ...(skills.length > cap
          ? {
              note: `Showing ${cap} of ${skills.length} skills. Increase the limit or use a query to find specific skills.`,
            }
          : {}),
        skills: page.map((s) => ({
          name: s.name,
          description: s.description,
          tags: s.tags.length > 0 ? s.tags : undefined,
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
      status(`Reading ${skill_name}${file_path ? ` / ${file_path}` : ""}..`);

      if (path.isAbsolute(skill_name)) {
        const cfg = resolveEffectiveConfig(ctl);
        const resolvedTarget = path.resolve(skill_name);
        const isAllowed = cfg.skillsPaths.some((p) =>
          resolvedTarget.startsWith(path.resolve(p) + path.sep),
        );
        if (!isAllowed) {
          return {
            success: false,
            error: "Path is outside the configured skills directories.",
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
      const skill = resolveSkillByName(cfg.skillsPaths, skill_name);

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
      status(`Listing files in ${skill_name}..`);

      if (path.isAbsolute(skill_name)) {
        const cfg = resolveEffectiveConfig(ctl);
        const resolvedTarget = path.resolve(skill_name);
        const isAllowed = cfg.skillsPaths.some((p) =>
          resolvedTarget.startsWith(path.resolve(p) + path.sep),
        );
        if (!isAllowed) {
          return {
            success: false,
            error: "Path is outside the configured skills directories.",
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
      const skill = resolveSkillByName(cfg.skillsPaths, skill_name);

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
      env: z
        .record(z.string())
        .optional()
        .describe(
          "Optional environment variables to set for this command, merged on top of the existing environment. Use for API keys, virtualenv paths, or any per-command configuration you do not want baked into the command string.",
        ),
    },
    implementation: async ({ command, cwd, timeout_ms, env }, { status }) => {
      const cfg = resolveEffectiveConfig(ctl);
      const shell = resolveShell(cfg.shellPath || undefined);
      status(
        `Running on ${shell.platform}: ${command.slice(0, 60)}${command.length > 60 ? "\u2026" : ""}`,
      );

      const result = await execCommand(command, {
        cwd,
        timeoutMs: timeout_ms,
        shellPath: cfg.shellPath || undefined,
        env,
      });

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
