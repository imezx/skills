# lms-plugin-skills

A 1:1 clone of Claude's internal skill system, built as an LM Studio plugin.

## How It Works

Claude reads a list of available skills at the start of every context, then uses a `view` tool to read the relevant `SKILL.md` file before working on tasks that skill covers. This plugin replicates that system exactly for LM Studio.

### The Skill System - Three Components

**1. Prompt Preprocessor**
Before every message, the plugin scans the skills directory and injects an `<available_skills>` block into the prompt. The model sees this and knows which skills exist, their descriptions, and their file paths - exactly like Claude's system prompt injection.

**2. Tools**

| Tool | Purpose |
|---|---|
| `list_skills` | List all available skills with names and descriptions |
| `read_skill_file` | Read any file within a skill directory (defaults to `SKILL.md`) |
| `list_skill_files` | Explore the full file tree of a skill directory |

**3. Persistent Settings**
LM Studio does not save plugin settings across new chats. This plugin solves that by writing settings to `~/.lmstudio/plugin-data/lms-skills/settings.json` - the skills path and all configuration survive chat resets.

---

## Skill Directory Structure

A skill is any subdirectory inside your skills folder that contains a `SKILL.md` file.

```
~/.lmstudio/skills/          ← default skills directory
├── docx/
│   ├── SKILL.md             ← entry point (required)
│   ├── scripts/
│   │   └── helper.py
│   └── templates/
│       └── base.docx
├── pptx/
│   ├── SKILL.md
│   └── editing.md
└── my-custom-skill/
    ├── SKILL.md
    └── skill.json           ← optional: override name/description
```

### `skill.json` (optional)

Place a `skill.json` in any skill directory to override its display name and description:

```json
{
  "name": "My Custom Skill",
  "description": "Use this skill when the user asks to do X, Y, or Z."
}
```

If absent, the plugin uses the directory name and extracts the description from the first paragraph of `SKILL.md`.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Auto-Inject Skills List | On | Injects skills block into every prompt |
| Max Skills in Context | 10 | Max skills listed in each injected block |
| Skills Directory Path | *(empty)* | Custom path to skills directory |

### Skills Directory Path

- **Empty** - uses the last saved path (or `~/.lmstudio/skills` on first run)
- **`default`** - resets the saved path back to `~/.lmstudio/skills`
- **Any absolute path** - saves that path and uses it immediately

Settings (including the skills path) are written to disk and survive new chat sessions.

---

## Local Development

```bash
cd lms-plugin-skills
bun install
bun run dev
```

---

## Default Skills Path by Platform

The default path `~/.lmstudio/skills` resolves to:

| Platform | Path |
|---|---|
| Windows | `C:\Users\<you>\.lmstudio\skills` |
| macOS | `/Users/<you>/.lmstudio/skills` |
| Linux | `/home/<you>/.lmstudio/skills` |

---

## Model Workflow

1. User sends a message
2. Preprocessor fires - scans skills dir, injects `<available_skills>` block
3. Model reads the block and recognises a relevant skill
4. Model calls `read_skill_file("skill-name")` -> receives full `SKILL.md` content
5. `SKILL.md` may reference other files -> model calls `list_skill_files` then `read_skill_file` with specific path
6. Model follows the skill's instructions to produce high-quality output

## License

Apache 2.0