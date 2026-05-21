import * as fs from "fs";
import * as os from "os";
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

  const readFileTool = tool({
    name: "read_file",
    description: "Read the contents of any file in the user's workspace. Use this to inspect code, data, or configuration files outside of the skills directory.",
    parameters: {
      file_path: z
        .string()
        .min(1)
        .describe("Absolute path to the file to read."),
    },
    implementation: async ({ file_path }, { status }) => {
      status(`Reading ${path.basename(file_path)}..`);
      const result = readAbsolutePath(file_path);
      if ("error" in result) return { success: false, error: result.error };
      status(`Read ${Math.round(result.content.length / 1024)}KB`);
      return {
        success: true,
        filePath: result.resolvedPath,
        content: result.content,
      };
    },
  });

  const writeFileTool = tool({
    name: "write_file",
    description: "Create or overwrite a file completely with new content. Prefer this over run_command for writing code or text, as it avoids shell escaping issues.",
    parameters: {
      file_path: z
        .string()
        .min(1)
        .describe("Absolute path to the file to write."),
      content: z
        .string()
        .describe("The full content to write to the file."),
    },
    implementation: async ({ file_path, content }, { status }) => {
      status(`Writing ${path.basename(file_path)}..`);
      try {
        const resolved = path.resolve(file_path);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content, "utf-8");
        status(`Wrote ${Math.round(content.length / 1024)}KB`);
        return {
          success: true,
          filePath: resolved,
          bytesWritten: Buffer.byteLength(content, "utf8"),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const patchFileTool = tool({
    name: "patch_file",
    description: "Modify an existing file by replacing a specific search string with a new string. Prefer this over write_file when making small changes to large files.",
    parameters: {
      file_path: z
        .string()
        .min(1)
        .describe("Absolute path to the file to modify."),
      search_string: z
        .string()
        .min(1)
        .describe("The exact string to find in the file. Must match exactly, including whitespace and indentation."),
      replace_string: z
        .string()
        .describe("The string to replace the search_string with."),
    },
    implementation: async ({ file_path, search_string, replace_string }, { status }) => {
      status(`Patching ${path.basename(file_path)}..`);
      try {
        const resolved = path.resolve(file_path);
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `File not found: ${resolved}` };
        }
        const content = fs.readFileSync(resolved, "utf-8");
        if (!content.includes(search_string)) {
          return {
            success: false,
            error: "Search string not found in file. Ensure exact whitespace/indentation.",
          };
        }
        const patched = content.replace(search_string, replace_string);
        fs.writeFileSync(resolved, patched, "utf-8");
        status(`Patched file`);
        return {
          success: true,
          filePath: resolved,
          note: "Replaced first occurrence of search_string.",
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const runCommandTool = tool({
    name: "run_command",
    description:
      "Execute a shell command on the user's machine. " +
      "On Windows this runs in PowerShell Core (pwsh.exe), PowerShell (powershell.exe), or cmd.exe - whichever is available, in that order. " +
      "On macOS and Linux this runs in bash or sh. " +
      "The platform and shell fields in the response tell you exactly which shell was used so you can adapt syntax accordingly. " +
      "Use this to run scripts, install packages, or perform system tasks. " +
      "IMPORTANT: Do NOT use this to write or edit files via `echo` or `cat`. Use the `write_file` or `patch_file` tools instead. " +
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

  const createDirectoryTool = tool({
    name: "create_directory",
    description:
      "Create a directory (and any missing parent directories) at the given path. " +
      "Idempotent: succeeds silently if the directory already exists, so it is safe to call " +
      "without checking first. Equivalent to `mkdir -p` / `New-Item -Force -ItemType Directory`.",
    parameters: {
      dir_path: z
        .string()
        .min(1)
        .describe("Absolute path of the directory to create. Supports ~ for the home directory."),
    },
    implementation: async ({ dir_path }, { status }) => {
      status(`Creating directory ${path.basename(dir_path)}..`);
      try {
        const resolved = path.resolve(dir_path.replace(/^~/, os.homedir()));
        const alreadyExisted = fs.existsSync(resolved);
        fs.mkdirSync(resolved, { recursive: true });
        status(alreadyExisted ? "Already exists" : "Created");
        return {
          success: true,
          dirPath: resolved,
          alreadyExisted,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const getCurrentDirectoryTool = tool({
    name: "get_current_directory",
    description:
      "Return path information about the user's environment: home directory, current working " +
      "directory, platform, and path separator. " +
      "Call this at the start of any task that involves absolute paths so you know the correct " +
      "base path without guessing the username or drive letter " +
      "(e.g. C:\\Users\\user on Windows, /Users/user on macOS, /home/user on Linux).",
    parameters: {},
    implementation: async (_params, { status }) => {
      status("Resolving paths..");
      const homeDir = os.homedir();
      const cwd = process.cwd();
      const platform = os.platform(); // 'win32' | 'darwin' | 'linux' | ...
      const sep = path.sep; // '\\' on Windows, '/' elsewhere
      status("Done");
      return {
        success: true,
        homeDir,
        cwd,
        platform,
        pathSeparator: sep,
        note:
          platform === "win32"
            ? "Windows: use backslashes or forward slashes in paths."
            : "Unix-like: use forward slashes in paths.",
      };
    },
  });

  const listDirectoryTool = tool({
    name: "list_directory",
    description:
      "List the contents of any directory on the user's machine, returning a tree of files and " +
      "subdirectories. Use this to understand a project's structure before reading or editing files. " +
      "Prefer this over running `ls` or `dir` via `run_command` - it works the same on every platform.",
    parameters: {
      dir_path: z
        .string()
        .min(1)
        .describe("Absolute path of the directory to list. Supports ~ for the home directory."),
      recursive: z
        .boolean()
        .optional()
        .describe(
          "When true, lists all files and subdirectories recursively. " +
          "Defaults to false (one level only). Avoid on very large trees.",
        ),
    },
    implementation: async ({ dir_path, recursive = false }, { status }) => {
      status(`Listing ${path.basename(dir_path)}..`);
      try {
        const resolved = path.resolve(dir_path.replace(/^~/, os.homedir()));

        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Directory not found: ${resolved}` };
        }

        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          return { success: false, error: `Path is not a directory: ${resolved}` };
        }

        const MAX_DEPTH = recursive ? 10 : 1;
        const entries: Array<{ name: string; relativePath: string; type: "file" | "directory"; sizeBytes?: number }> = [];

        function walk(dir: string, relBase: string, depth: number) {
          if (depth > MAX_DEPTH) return;
          const children = fs.readdirSync(dir, { withFileTypes: true });
          for (const child of children) {
            const rel = relBase ? `${relBase}/${child.name}` : child.name;
            const abs = path.join(dir, child.name);
            if (child.isDirectory()) {
              entries.push({ name: child.name, relativePath: rel, type: "directory" });
              walk(abs, rel, depth + 1);
            } else {
              const size = fs.statSync(abs).size;
              entries.push({ name: child.name, relativePath: rel, type: "file", sizeBytes: size });
            }
          }
        }

        walk(resolved, "", 0);
        const formatted = formatDirEntries(entries, path.basename(resolved));
        status(`Found ${entries.length} entries`);

        return {
          success: true,
          dirPath: resolved,
          entryCount: entries.length,
          tree: formatted,
          entries: entries.map((e) => ({
            name: e.name,
            path: e.relativePath,
            type: e.type,
            ...(e.sizeBytes !== undefined ? { sizeBytes: e.sizeBytes } : {}),
          })),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const deleteFileTool = tool({
    name: "delete_file",
    description:
      "Permanently delete a file or an empty directory. " +
      "To delete a directory and all its contents recursively, set recursive to true - " +
      "use with caution as this cannot be undone. " +
      "Prefer this over shell commands like `rm` or `Remove-Item` for cross-platform reliability.",
    parameters: {
      file_path: z
        .string()
        .min(1)
        .describe("Absolute path to the file or directory to delete. Supports ~ for the home directory."),
      recursive: z
        .boolean()
        .optional()
        .describe(
          "When true, deletes a directory and all its contents recursively. " +
          "Defaults to false. Has no effect on plain files.",
        ),
    },
    implementation: async ({ file_path, recursive = false }, { status }) => {
      status(`Deleting ${path.basename(file_path)}..`);
      try {
        const resolved = path.resolve(file_path.replace(/^~/, os.homedir()));

        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Path not found: ${resolved}` };
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          // rmSync with recursive:true is the modern cross-platform approach (Node 14.14+)
          fs.rmSync(resolved, { recursive, force: false });
        } else {
          fs.unlinkSync(resolved);
        }

        status("Deleted");
        return { success: true, deletedPath: resolved };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const moveFileTool = tool({
    name: "move_file",
    description:
      "Move a file or directory from one location to another. " +
      "Works across the same filesystem volume. If you need to move across volumes, " +
      "use run_command as a fallback. " +
      "Fails if the destination already exists to prevent accidental overwrites.",
    parameters: {
      source_path: z
        .string()
        .min(1)
        .describe("Absolute path of the file or directory to move. Supports ~."),
      destination_path: z
        .string()
        .min(1)
        .describe(
          "Absolute path of the destination. " +
          "If the destination is an existing directory, the source is moved inside it. " +
          "Otherwise the source is moved to this exact path (effectively a move + rename).",
        ),
    },
    implementation: async ({ source_path, destination_path }, { status }) => {
      status(`Moving ${path.basename(source_path)}..`);
      try {
        const src = path.resolve(source_path.replace(/^~/, os.homedir()));
        let dst = path.resolve(destination_path.replace(/^~/, os.homedir()));

        if (!fs.existsSync(src)) {
          return { success: false, error: `Source not found: ${src}` };
        }

        // if destination is an existing directory, move source into it
        if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) {
          dst = path.join(dst, path.basename(src));
        }

        if (fs.existsSync(dst)) {
          return {
            success: false,
            error: `Destination already exists: ${dst}. Delete or rename it first.`,
          };
        }

        // ensure the destination parent directory exists
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);

        status("Moved");
        return { success: true, sourcePath: src, destinationPath: dst };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const renameFileTool = tool({
    name: "rename_file",
    description:
      "Rename a file or directory in place (same parent directory). " +
      "For moving to a different location use move_file instead. " +
      "Fails if a file with the new name already exists.",
    parameters: {
      file_path: z
        .string()
        .min(1)
        .describe("Absolute path of the file or directory to rename. Supports ~."),
      new_name: z
        .string()
        .min(1)
        .describe("New name only (not a full path) - e.g. 'index.ts' not '/home/user/project/index.ts'."),
    },
    implementation: async ({ file_path, new_name }, { status }) => {
      status(`Renaming ${path.basename(file_path)} → ${new_name}..`);
      try {
        const resolved = path.resolve(file_path.replace(/^~/, os.homedir()));

        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Path not found: ${resolved}` };
        }

        // reject full paths in new_name to keep the operation clearly in-place.
        if (path.basename(new_name) !== new_name) {
          return {
            success: false,
            error: "new_name must be a plain name without directory separators. Use `move_file` to relocate.",
          };
        }

        const destination = path.join(path.dirname(resolved), new_name);

        if (fs.existsSync(destination)) {
          return {
            success: false,
            error: `A file named "${new_name}" already exists in that directory.`,
          };
        }

        fs.renameSync(resolved, destination);
        status("Renamed");
        return { success: true, oldPath: resolved, newPath: destination };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const appendToFileTool = tool({
    name: "append_to_file",
    description:
      "Append text to the end of an existing file without reading or rewriting the whole thing. " +
      "Ideal for adding lines to logs, .env files, config lists, or any growing file. " +
      "Creates the file (and any missing parent directories) if it does not exist yet.",
    parameters: {
      file_path: z
        .string()
        .min(1)
        .describe("Absolute path to the file to append to. Supports ~."),
      content: z
        .string()
        .describe("Text to append. Include a leading newline if you want a blank line before the new content."),
    },
    implementation: async ({ file_path, content }, { status }) => {
      status(`Appending to ${path.basename(file_path)}..`);
      try {
        const resolved = path.resolve(file_path.replace(/^~/, os.homedir()));
        // ensure parent directories exist so the tool works even on a new file
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.appendFileSync(resolved, content, "utf-8");
        status(`Appended ${Buffer.byteLength(content, "utf8")} bytes`);
        return {
          success: true,
          filePath: resolved,
          bytesAppended: Buffer.byteLength(content, "utf8"),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  return [
    listSkillsTool,
    readSkillFileTool,
    listSkillFilesTool,
    readFileTool,
    writeFileTool,
    patchFileTool,
    appendToFileTool,
    createDirectoryTool,
    listDirectoryTool,
    deleteFileTool,
    moveFileTool,
    renameFileTool,
    getCurrentDirectoryTool,
    runCommandTool,
  ];
}