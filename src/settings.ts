import * as fs from "fs";
import {
  PLUGIN_DATA_DIR,
  SETTINGS_FILE,
  DEFAULT_SKILLS_DIR,
  DEFAULT_MAX_SKILLS_IN_CONTEXT,
  RESET_TO_DEFAULT_SENTINEL,
} from "./constants";
import { configSchematics } from "./config";
import type { PersistedSettings, EffectiveConfig } from "./types";
import type { PluginController } from "./pluginTypes";

const DEFAULTS: PersistedSettings = {
  skillsPath: DEFAULT_SKILLS_DIR,
  autoInject: true,
  maxSkillsInContext: DEFAULT_MAX_SKILLS_IN_CONTEXT,
};

function loadSettings(): PersistedSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS };
    const parsed = JSON.parse(
      fs.readFileSync(SETTINGS_FILE, "utf-8"),
    ) as Partial<PersistedSettings>;
    return {
      skillsPath:
        typeof parsed.skillsPath === "string" && parsed.skillsPath
          ? parsed.skillsPath
          : DEFAULTS.skillsPath,
      autoInject:
        typeof parsed.autoInject === "boolean"
          ? parsed.autoInject
          : DEFAULTS.autoInject,
      maxSkillsInContext:
        typeof parsed.maxSkillsInContext === "number" &&
        parsed.maxSkillsInContext >= 1
          ? parsed.maxSkillsInContext
          : DEFAULTS.maxSkillsInContext,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: PersistedSettings): void {
  try {
    fs.mkdirSync(PLUGIN_DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch {}
}

export function resolveEffectiveConfig(ctl: PluginController): EffectiveConfig {
  const c = ctl.getPluginConfig(configSchematics);
  const autoInject = (c.get("autoInject") as string) === "on";
  const maxSkillsInContext =
    (c.get("maxSkillsInContext") as number) ?? DEFAULTS.maxSkillsInContext;
  const lmsPath = ((c.get("skillsPath") as string | undefined) ?? "").trim();

  const saved = loadSettings();

  if (lmsPath === RESET_TO_DEFAULT_SENTINEL) {
    const next: PersistedSettings = {
      autoInject,
      maxSkillsInContext,
      skillsPath: DEFAULTS.skillsPath,
    };
    saveSettings(next);
    return next;
  }

  if (lmsPath && lmsPath !== saved.skillsPath) {
    const next: PersistedSettings = {
      autoInject,
      maxSkillsInContext,
      skillsPath: lmsPath,
    };
    saveSettings(next);
    return next;
  }

  const skillsPath = saved.skillsPath || DEFAULTS.skillsPath;

  if (
    autoInject !== saved.autoInject ||
    maxSkillsInContext !== saved.maxSkillsInContext
  ) {
    saveSettings({ skillsPath, autoInject, maxSkillsInContext });
  }

  return { skillsPath, autoInject, maxSkillsInContext };
}
