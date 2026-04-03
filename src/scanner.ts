import * as fs from "fs";
import * as path from "path";
import {
  SKILL_ENTRY_POINT,
  SKILL_MANIFEST_FILE,
  MAX_FILE_SIZE_BYTES,
  MAX_DESCRIPTION_CHARS,
  MAX_DIRECTORY_DEPTH,
  MAX_DIRECTORY_ENTRIES,
} from "./constants";
import type { SkillInfo, SkillManifestFile, DirectoryEntry } from "./types";

function readFileSafe(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= MAX_FILE_SIZE_BYTES) {
      return fs.readFileSync(filePath, "utf-8");
    }

    const headBytes = Math.floor(MAX_FILE_SIZE_BYTES * 0.8);
    const tailBytes = MAX_FILE_SIZE_BYTES - headBytes;

    const fd = fs.openSync(filePath, "r");
    const headBuf = Buffer.alloc(headBytes);
    const tailBuf = Buffer.alloc(tailBytes);

    fs.readSync(fd, headBuf, 0, headBytes, 0);
    fs.readSync(fd, tailBuf, 0, tailBytes, stat.size - tailBytes);
    fs.closeSync(fd);

    const head = headBuf.toString("utf-8").replace(/\uFFFD.*$/, "");
    const tail = tailBuf.toString("utf-8").replace(/^.*?\uFFFD/, "");
    const omitted = Math.round((stat.size - MAX_FILE_SIZE_BYTES) / 1024);

    return `${head}\n\n[... ${omitted}KB omitted - middle of file truncated ...]\n\n${tail}`;
  } catch {
    return null;
  }
}

function extractDescription(content: string): string {
  const lines = content.split("\n");
  const collected: string[] = [];
  let passedH1 = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collected.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("# ") && !passedH1) {
      passedH1 = true;
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("<!--")
    ) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(trimmed);
    if (collected.join(" ").length >= MAX_DESCRIPTION_CHARS) break;
  }

  return (
    collected.join(" ").trim().slice(0, MAX_DESCRIPTION_CHARS) ||
    "No description available."
  );
}

function loadManifest(skillDir: string): SkillManifestFile | null {
  const manifestPath = path.join(skillDir, SKILL_MANIFEST_FILE);
  try {
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    ) as SkillManifestFile;
  } catch {
    return null;
  }
}

function hasExtraFiles(skillDir: string): boolean {
  try {
    return fs
      .readdirSync(skillDir)
      .some((e) => e !== SKILL_ENTRY_POINT && e !== SKILL_MANIFEST_FILE);
  } catch {
    return false;
  }
}

export function scanSkills(skillsDir: string): SkillInfo[] {
  try {
    if (!fs.existsSync(skillsDir)) return [];

    const skills: SkillInfo[] = [];

    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, SKILL_ENTRY_POINT);

      if (!fs.existsSync(skillMdPath)) continue;

      const manifest = loadManifest(skillDir);
      const skillMdContent = readFileSafe(skillMdPath);
      const description =
        manifest?.description ??
        (skillMdContent
          ? extractDescription(skillMdContent)
          : "No description available.");

      skills.push({
        name: manifest?.name ?? entry.name,
        description,
        skillMdPath,
        directoryPath: skillDir,
        hasExtraFiles: hasExtraFiles(skillDir),
      });
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function resolveSkillByName(
  skillsDir: string,
  skillName: string,
): SkillInfo | null {
  const lower = skillName.toLowerCase().trim();
  return (
    scanSkills(skillsDir).find(
      (s) =>
        s.name.toLowerCase() === lower ||
        path.basename(s.directoryPath).toLowerCase() === lower,
    ) ?? null
  );
}

export function readSkillFile(
  skill: SkillInfo,
  relativeFilePath?: string,
): { content: string; resolvedPath: string } | { error: string } {
  const targetRel = relativeFilePath?.trim() || SKILL_ENTRY_POINT;
  const resolved = path.resolve(skill.directoryPath, targetRel);

  if (!resolved.startsWith(path.resolve(skill.directoryPath))) {
    return { error: "Path traversal outside skill directory is not allowed." };
  }
  if (!fs.existsSync(resolved)) {
    return {
      error: `File not found: ${targetRel}. Use list_skill_files to see available files.`,
    };
  }
  if (fs.statSync(resolved).isDirectory()) {
    return {
      error: `"${targetRel}" is a directory. Use list_skill_files to explore it.`,
    };
  }

  const content = readFileSafe(resolved);
  if (content === null) return { error: `Unable to read file: ${targetRel}` };

  return { content, resolvedPath: resolved };
}

export function readAbsolutePath(
  absolutePath: string,
): { content: string; resolvedPath: string } | { error: string } {
  const resolved = path.resolve(absolutePath);

  if (!fs.existsSync(resolved)) {
    return { error: `File not found: ${resolved}` };
  }
  if (fs.statSync(resolved).isDirectory()) {
    return {
      error: `"${resolved}" is a directory. Use list_skill_files to explore it.`,
    };
  }

  const content = readFileSafe(resolved);
  if (content === null) return { error: `Unable to read file: ${resolved}` };

  return { content, resolvedPath: resolved };
}

export function listSkillDirectory(
  skill: SkillInfo,
  relativeSubPath?: string,
): DirectoryEntry[] {
  const base = relativeSubPath
    ? path.resolve(skill.directoryPath, relativeSubPath.trim())
    : skill.directoryPath;

  if (!base.startsWith(path.resolve(skill.directoryPath))) return [];

  return walkDirectory(base, skill.directoryPath, 0);
}

export function listAbsoluteDirectory(absolutePath: string): DirectoryEntry[] {
  const resolved = path.resolve(absolutePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory())
    return [];
  return walkDirectory(resolved, resolved, 0);
}

function walkDirectory(
  dir: string,
  rootDir: string,
  depth: number,
): DirectoryEntry[] {
  if (depth > MAX_DIRECTORY_DEPTH) return [];

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: DirectoryEntry[] = [];

  for (const entry of dirEntries) {
    if (entries.length >= MAX_DIRECTORY_ENTRIES) break;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      entries.push({ name: entry.name, relativePath, type: "directory" });
      if (depth < MAX_DIRECTORY_DEPTH) {
        entries.push(...walkDirectory(fullPath, rootDir, depth + 1));
      }
    } else if (entry.isFile()) {
      let sizeBytes: number | undefined;
      try {
        sizeBytes = fs.statSync(fullPath).size;
      } catch {}
      entries.push({ name: entry.name, relativePath, type: "file", sizeBytes });
    }
  }

  return entries;
}
