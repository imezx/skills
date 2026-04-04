import { createConfigSchematics } from "@lmstudio/sdk";
import {
  DEFAULT_MAX_SKILLS_IN_CONTEXT,
  MIN_MAX_SKILLS_IN_CONTEXT,
  MAX_MAX_SKILLS_IN_CONTEXT,
} from "./constants";

export const configSchematics = createConfigSchematics()
  .field(
    "autoInject",
    "select",
    {
      displayName: "Auto-Inject Skills List",
      subtitle:
        "Automatically inject the list of available skills into every prompt so the model knows when to use them",
      options: [
        {
          value: "on",
          displayName: "On - inject skill list into every prompt (recommended)",
        },
        {
          value: "off",
          displayName: "Off - only use skills when tools are called explicitly",
        },
      ],
    },
    "on",
  )
  .field(
    "maxSkillsInContext",
    "numeric",
    {
      displayName: "Max Skills in Context",
      subtitle: `Maximum number of skills to list in the injected prompt (${MIN_MAX_SKILLS_IN_CONTEXT}-${MAX_MAX_SKILLS_IN_CONTEXT})`,
      min: MIN_MAX_SKILLS_IN_CONTEXT,
      max: MAX_MAX_SKILLS_IN_CONTEXT,
      int: true,
      slider: {
        step: 1,
        min: MIN_MAX_SKILLS_IN_CONTEXT,
        max: MAX_MAX_SKILLS_IN_CONTEXT,
      },
    },
    DEFAULT_MAX_SKILLS_IN_CONTEXT,
  )
  .field(
    "skillsPath",
    "string",
    {
      displayName: "Skills Paths",
      subtitle:
        'Semicolon-separated list of skill directories, loaded in order. Leave empty to use last saved paths. Enter "default" to reset to ~/.lmstudio/skills',
    },
    "",
  )
  .field(
    "shellPath",
    "string",
    {
      displayName: "Shell Path (optional)",
      subtitle:
        "Override the shell used by run_command. Leave empty to auto-detect (bash on Unix, pwsh/powershell/cmd on Windows).",
    },
    "",
  )
  .build();
