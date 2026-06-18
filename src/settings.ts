import * as fs from "fs";
import {
  PLUGIN_DATA_DIR,
  SETTINGS_FILE,
  DEFAULT_SKILLS_DIR,
  DEFAULT_MAX_SKILLS_IN_CONTEXT,
  RESET_TO_DEFAULT_SENTINEL,
  SKILLS_PATH_SEPARATOR,
  CONFIG_CACHE_TTL_MS,
} from "./constants";
import { configSchematics } from "./config";
import type { PersistedSettings, EffectiveConfig } from "./types";
import type { PluginController } from "./pluginTypes";

const DEFAULTS: PersistedSettings = {
  skillsPaths: [DEFAULT_SKILLS_DIR],
  autoInject: true,
  maxSkillsInContext: DEFAULT_MAX_SKILLS_IN_CONTEXT,
  shellPath: "",
  windowsShell: "cmd",
};

let cachedConfig: EffectiveConfig | null = null;
let cacheTime = 0;

function parseSkillsPaths(raw: string): string[] {
  return raw
    .split(SKILLS_PATH_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);
}

function loadSettings(): PersistedSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS };
    const parsed = JSON.parse(
      fs.readFileSync(SETTINGS_FILE, "utf-8"),
    ) as Partial<PersistedSettings>;

    let skillsPaths: string[];
    if (Array.isArray(parsed.skillsPaths) && parsed.skillsPaths.length > 0) {
      skillsPaths = parsed.skillsPaths;
    } else {
      skillsPaths = DEFAULTS.skillsPaths;
    }

    return {
      skillsPaths,
      autoInject:
        typeof parsed.autoInject === "boolean"
          ? parsed.autoInject
          : DEFAULTS.autoInject,
      maxSkillsInContext:
        typeof parsed.maxSkillsInContext === "number" &&
        parsed.maxSkillsInContext >= 1
          ? parsed.maxSkillsInContext
          : DEFAULTS.maxSkillsInContext,
      shellPath: typeof parsed.shellPath === "string" ? parsed.shellPath : "",
      windowsShell: (parsed.windowsShell === "powershell" || parsed.windowsShell === "cmd") 
        ? parsed.windowsShell 
        : DEFAULTS.windowsShell,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: PersistedSettings): void {
  try {
    fs.mkdirSync(PLUGIN_DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    cachedConfig = null;
  } catch {}
}

export function resolveEffectiveConfig(ctl: PluginController): EffectiveConfig {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CONFIG_CACHE_TTL_MS)
    return cachedConfig;

  const c = ctl.getPluginConfig(configSchematics);
  const autoInject = (c.get("autoInject") as string) === "on";
  const maxSkillsInContext =
    (c.get("maxSkillsInContext") as number) ?? DEFAULTS.maxSkillsInContext;
  const rawPaths = ((c.get("skillsPath") as string | undefined) ?? "").trim();
  const shellPath = ((c.get("shellPath") as string | undefined) ?? "").trim();
  const windowsShell = ((c.get("windowsShell") as "powershell" | "cmd" | undefined) ?? "cmd");

  const saved = loadSettings();

  if (rawPaths === RESET_TO_DEFAULT_SENTINEL) {
    const next: PersistedSettings = {
      autoInject,
      maxSkillsInContext,
      skillsPaths: DEFAULTS.skillsPaths,
      shellPath,
      windowsShell,
    };
    saveSettings(next);
    cachedConfig = next;
    cacheTime = now;
    return next;
  }

  const incomingPaths = parseSkillsPaths(rawPaths);
  const skillsPaths =
    incomingPaths.length > 0 &&
    incomingPaths.join(";") !== saved.skillsPaths.join(";")
      ? incomingPaths
      : saved.skillsPaths.length > 0
        ? saved.skillsPaths
        : DEFAULTS.skillsPaths;

  if (
    autoInject !== saved.autoInject ||
    maxSkillsInContext !== saved.maxSkillsInContext ||
    skillsPaths.join(";") !== saved.skillsPaths.join(";") ||
    shellPath !== saved.shellPath ||
    windowsShell !== saved.windowsShell
  ) {
    saveSettings({ skillsPaths, autoInject, maxSkillsInContext, shellPath, windowsShell });
  }

  const result: EffectiveConfig = {
    skillsPaths,
    autoInject,
    maxSkillsInContext,
    shellPath,
    windowsShell,
  };
  cachedConfig = result;
  cacheTime = now;
  return result;
}
