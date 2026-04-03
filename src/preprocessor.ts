import { resolveEffectiveConfig } from "./settings";
import { scanSkills } from "./scanner";
import { MIN_PROMPT_LENGTH } from "./constants";
import type { PluginController } from "./pluginTypes";
import type { SkillInfo } from "./types";

function buildAvailableSkillsBlock(skills: SkillInfo[], limit: number): string {
  const skillTags = skills
    .slice(0, limit)
    .map((s) =>
      [
        `<skill>`,
        `<name>`,
        s.name,
        `</name>`,
        `<description>`,
        s.description,
        `</description>`,
        `<location>`,
        s.skillMdPath,
        `</location>`,
        `</skill>`,
      ].join("\n"),
    )
    .join("\n\n");

  return `<available_skills>\n${skillTags}\n</available_skills>`;
}

function buildInstruction(): string {
  return "You have access to a set of skills listed in <available_skills>. Each skill is a directory containing a SKILL.md file with instructions and best practices built from real trial and error. Before starting any task that matches a skill, call read_skill_file with the skill name or its location path to load its instructions - always do this before writing any code, creating files, or producing output the skill covers. Multiple skills may be relevant to a single task; read all of them before proceeding, do not limit yourself to one. After reading SKILL.md, if it references additional files, call list_skill_files to discover them, then read whichever ones apply. Use list_skills to refresh the available skills list at any time.";
}

function buildInjection(skills: SkillInfo[], limit: number): string {
  return [
    buildInstruction(),
    "",
    buildAvailableSkillsBlock(skills, limit),
  ].join("\n");
}

type MessageContent =
  | { type: "text"; text: string }
  | { type: string; [key: string]: unknown };
type MessageInput = string | { content: string | MessageContent[] } | unknown;

function extractText(message: MessageInput): string {
  if (typeof message === "string") return message;
  if (message !== null && typeof message === "object") {
    const m = message as Record<string, unknown>;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter(
          (c): c is MessageContent =>
            typeof c === "object" &&
            c !== null &&
            (c as MessageContent).type === "text",
        )
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("");
    }
    if (typeof m.text === "string") return m.text;
  }
  return String(message ?? "");
}

function injectIntoMessage(
  message: MessageInput,
  injection: string,
): MessageInput {
  if (typeof message === "string") {
    return `${injection}\n\n---\n\n${message}`;
  }
  if (message !== null && typeof message === "object") {
    const m = message as Record<string, unknown>;
    if (typeof m.content === "string") {
      return { ...m, content: `${injection}\n\n---\n\n${m.content}` };
    }
    if (Array.isArray(m.content)) {
      const first = m.content.findIndex(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          (c as MessageContent).type === "text",
      );
      if (first !== -1) {
        const updated = [...m.content] as MessageContent[];
        const block = updated[first] as { type: "text"; text: string };
        updated[first] = {
          ...block,
          text: `${injection}\n\n---\n\n${block.text}`,
        };
        return { ...m, content: updated };
      }
      return {
        ...m,
        content: [{ type: "text", text: injection }, ...m.content],
      };
    }
  }
  return message;
}

export async function promptPreprocessor(
  ctl: PluginController,
  userMessage: MessageInput,
): Promise<MessageInput> {
  const cfg = resolveEffectiveConfig(ctl);

  if (!cfg.autoInject) return userMessage;

  const text = extractText(userMessage);
  if (text.trim().length < MIN_PROMPT_LENGTH) return userMessage;

  try {
    const skills = scanSkills(cfg.skillsPath);
    if (skills.length === 0) return userMessage;
    return injectIntoMessage(
      userMessage,
      buildInjection(skills, cfg.maxSkillsInContext),
    );
  } catch {
    return userMessage;
  }
}
