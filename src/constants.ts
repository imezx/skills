import * as os from "os";
import * as path from "path";

export const DEFAULT_SKILLS_DIR = path.join(
  os.homedir(),
  ".lmstudio",
  "skills",
);
export const PLUGIN_DATA_DIR = path.join(
  os.homedir(),
  ".lmstudio",
  "plugin-data",
  "lms-skills",
);
export const SETTINGS_FILE = path.join(PLUGIN_DATA_DIR, "settings.json");

export const SKILL_ENTRY_POINT = "SKILL.md";
export const SKILL_MANIFEST_FILE = "skill.json";
export const RESET_TO_DEFAULT_SENTINEL = "default";

export const MAX_FILE_SIZE_BYTES = 102_400;
export const MAX_DESCRIPTION_CHARS = 500;
export const BODY_EXCERPT_CHARS = 2_000;
export const MAX_DIRECTORY_DEPTH = 3;
export const MAX_DIRECTORY_ENTRIES = 200;
export const MIN_PROMPT_LENGTH = 10;

export const DEFAULT_MAX_SKILLS_IN_CONTEXT = 15;
export const MIN_MAX_SKILLS_IN_CONTEXT = 1;
export const MAX_MAX_SKILLS_IN_CONTEXT = 30;
export const LIST_SKILLS_DEFAULT_LIMIT = 50;

export const EXEC_DEFAULT_TIMEOUT_MS = 30_000;
export const EXEC_MAX_TIMEOUT_MS = 300_000;
export const EXEC_MAX_OUTPUT_BYTES = 100_000;
export const EXEC_MAX_COMMAND_LENGTH = 8_000;

export const SKILLS_PATH_SEPARATOR = ";";
export const CONFIG_CACHE_TTL_MS = 5_000;
export const REINJECT_INTERVAL_MS = 30 * 60 * 1_000;
