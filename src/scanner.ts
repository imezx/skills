import * as fs from "fs";
import * as path from "path";
import {
  SKILL_ENTRY_POINT,
  SKILL_MANIFEST_FILE,
  MAX_FILE_SIZE_BYTES,
  MAX_DESCRIPTION_CHARS,
  BODY_EXCERPT_CHARS,
  MAX_DIRECTORY_DEPTH,
  MAX_DIRECTORY_ENTRIES,
  BM25_K1,
  BM25_B,
  FIELD_WEIGHTS,
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

function extractBodyExcerpt(content: string): string {
  const lines = content.split("\n");
  const collected: string[] = [];
  let passedH1 = false;
  let passedDescription = false;
  let inCodeFence = false;
  let descriptionDone = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (!passedH1) {
      if (trimmed.startsWith("# ")) passedH1 = true;
      continue;
    }

    if (!descriptionDone) {
      if (!passedDescription) {
        if (trimmed && !trimmed.startsWith("#")) {
          passedDescription = true;
          continue;
        }
        continue;
      }
      if (!trimmed) {
        descriptionDone = true;
        continue;
      }
      continue;
    }

    if (!trimmed) continue;

    const stripped = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1");

    if (!stripped) continue;

    collected.push(stripped);
    if (collected.join(" ").length >= BODY_EXCERPT_CHARS) break;
  }

  return collected.join(" ").trim().slice(0, BODY_EXCERPT_CHARS);
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

function scanSkillsDir(skillsDir: string): SkillInfo[] {
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

      const bodyExcerpt = skillMdContent
        ? extractBodyExcerpt(skillMdContent)
        : "";

      const tags = Array.isArray(manifest?.tags)
        ? manifest.tags.filter((t): t is string => typeof t === "string")
        : [];

      skills.push({
        name: manifest?.name ?? entry.name,
        description,
        bodyExcerpt,
        tags,
        skillMdPath,
        directoryPath: skillDir,
        hasExtraFiles: hasExtraFiles(skillDir),
      });
    }

    return skills;
  } catch {
    return [];
  }
}

let cachedSkills: SkillInfo[] | null = null;
let searchIndex: SearchIndex | null = null;
let watchers: fs.FSWatcher[] = [];
let isWatchingPaths = "";

function setupWatchers(skillsDirs: string[]) {
  const currentPaths = skillsDirs.join(";");
  if (isWatchingPaths === currentPaths) return;

  watchers.forEach((w) => {
    try { w.close(); } catch { }
  });
  watchers = [];
  isWatchingPaths = currentPaths;

  for (const dir of skillsDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, { recursive: true }, () => {
        cachedSkills = null;
        searchIndex = null;
      });
      w.on("error", () => { }); // catch watch limits silently
      watchers.push(w);
    } catch {
      try {
        const w = fs.watch(dir, () => {
          cachedSkills = null;
          searchIndex = null;
        });
        w.on("error", () => { });
        watchers.push(w);
      } catch {
        // watcher unsupported on this OS configuration
      }
    }
  }
}

export function scanSkills(skillsDirs: string[]): SkillInfo[] {
  setupWatchers(skillsDirs);

  if (cachedSkills) return cachedSkills;

  const seen = new Set<string>();
  const merged: SkillInfo[] = [];

  for (const dir of skillsDirs) {
    for (const skill of scanSkillsDir(dir)) {
      if (!seen.has(skill.directoryPath)) {
        seen.add(skill.directoryPath);
        merged.push(skill);
      }
    }
  }

  cachedSkills = merged.sort((a, b) => a.name.localeCompare(b.name));
  return cachedSkills;
}

export interface SkillSearchResult {
  skill: SkillInfo;
  score: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_/\\.,;:()\[\]{}|]+/)
    .filter((t) => t.length > 0);
}

interface SearchIndex {
  idf: Map<string, number>;
  avgLengths: Record<keyof typeof FIELD_WEIGHTS, number>;
  docTokens: Map<string, Record<keyof typeof FIELD_WEIGHTS, string[]>>;
}

function buildSearchIndex(skills: SkillInfo[]) {
  const idf = new Map<string, number>();
  const docFreq = new Map<string, number>();
  const lengths = { name: 0, tags: 0, description: 0, bodyExcerpt: 0 };
  const docTokens = new Map<string, Record<keyof typeof FIELD_WEIGHTS, string[]>>();

  const N = skills.length;

  for (const skill of skills) {
    const tokens = {
      name: tokenize(skill.name),
      tags: skill.tags.flatMap((t) => tokenize(t)),
      description: tokenize(skill.description),
      bodyExcerpt: tokenize(skill.bodyExcerpt),
    };
    docTokens.set(skill.directoryPath, tokens);

    lengths.name += tokens.name.length;
    lengths.tags += tokens.tags.length;
    lengths.description += tokens.description.length;
    lengths.bodyExcerpt += tokens.bodyExcerpt.length;

    const uniqueTokens = new Set([
      ...tokens.name,
      ...tokens.tags,
      ...tokens.description,
      ...tokens.bodyExcerpt,
    ]);

    for (const t of uniqueTokens) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }

  const avgLengths = {
    name: lengths.name / (N || 1),
    tags: lengths.tags / (N || 1),
    description: lengths.description / (N || 1),
    bodyExcerpt: lengths.bodyExcerpt / (N || 1),
  };

  for (const [token, df] of docFreq) {
    const idfValue = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    idf.set(token, idfValue);
  }

  searchIndex = { idf, avgLengths, docTokens };
}

export function searchSkills(
  skillsDirs: string[],
  query: string,
): SkillSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const queryLower = query.toLowerCase().trim();
  const allSkills = scanSkills(skillsDirs);

  if (!searchIndex) buildSearchIndex(allSkills);
  const { idf, avgLengths, docTokens } = searchIndex!;

  const results: SkillSearchResult[] = [];

  for (const skill of allSkills) {
    const nameLower = skill.name.toLowerCase();

    if (nameLower === queryLower) {
      results.push({ skill, score: 100.0 });
      continue;
    }

    const tokens = docTokens.get(skill.directoryPath)!;
    let totalScore = 0;

    for (const qToken of queryTokens) {
      let matchedIdf = idf.get(qToken) ?? 0;
      let isPrefix = false;

      if (matchedIdf === 0) {
        for (const [k, v] of idf.entries()) {
          if (k.startsWith(qToken) && qToken.length >= 3) {
            matchedIdf = Math.max(matchedIdf, v * 0.5);
            isPrefix = true;
          }
        }
      }

      if (matchedIdf === 0) continue;

      for (const [fieldStr, weight] of Object.entries(FIELD_WEIGHTS)) {
        const field = fieldStr as keyof typeof FIELD_WEIGHTS;
        const fieldTokens = tokens[field];
        if (fieldTokens.length === 0) continue;

        let tf = 0;
        for (const ft of fieldTokens) {
          if (ft === qToken) tf += 1;
          else if (isPrefix && ft.startsWith(qToken)) tf += 0.5;
          else if (qToken.length >= 4 && ft.includes(qToken)) tf += 0.3;
        }

        if (tf > 0) {
          const avgdl = avgLengths[field] || 1;
          const fieldScore =
            matchedIdf *
            ((tf * (BM25_K1 + 1)) /
              (tf + BM25_K1 * (1 - BM25_B + BM25_B * (fieldTokens.length / avgdl))));
          totalScore += fieldScore * weight;
        }
      }
    }

    if (nameLower.includes(queryLower)) totalScore += 5.0;
    if (skill.description.toLowerCase().includes(queryLower)) totalScore += 2.0;
    if (skill.tags.some((t) => t.toLowerCase() === queryLower)) totalScore += 4.0;

    if (totalScore > 0.5) {
      results.push({ skill, score: totalScore });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function resolveSkillByName(
  skillsDirs: string[],
  skillName: string,
): SkillInfo | null {
  const lower = skillName.toLowerCase().trim();
  return (
    scanSkills(skillsDirs).find(
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
      error: `File not found: ${targetRel}. Use \`list_skill_files\` to see available files.`,
    };
  }
  if (fs.statSync(resolved).isDirectory()) {
    return {
      error: `"${targetRel}" is a directory. Use \`list_skill_files\` to explore it.`,
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
      error: `"${resolved}" is a directory. Use \`list_skill_files\` to explore it.`,
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
      } catch { }
      entries.push({ name: entry.name, relativePath, type: "file", sizeBytes });
    }
  }

  return entries;
}
