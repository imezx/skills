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
      displayName: "Skills Directory Path",
      subtitle:
        'Path to your skills directory. Leave empty to use the last saved path. Enter "default" to reset to ~/.lmstudio/skills',
    },
    "",
  )
  .field(
    "recommendedSystemPrompt",
    "string",
    {
      displayName: "Recommended System Prompt",
      subtitle:
        "Copy this into your model's system prompt. It tells the model when and how to use skills - kept here so it only needs to be set once, not repeated on every message.",
    },
    "You have access to a set of skills listed in <available_skills>. Each skill is a directory containing a SKILL.md file with instructions and best practices built from real trial and error. Before starting any task that matches a skill, call read_skill_file with the skill name or its location path to load its instructions - always do this before writing any code, creating files, or producing output the skill covers. Multiple skills may be relevant to a single task; read all of them before proceeding, do not limit yourself to one. After reading SKILL.md, if it references additional files, call list_skill_files to discover them, then read whichever ones apply. Use list_skills to refresh the available skills list at any time.",
  )
  .build();
