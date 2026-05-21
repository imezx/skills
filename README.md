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
| `read_file` | Read the contents of any file in the workspace outside of the skills directory |
| `write_file` | Create or overwrite a file with exact contents, avoiding shell escaping issues |
| `patch_file` | Find and replace a specific string inside an existing file for surgical code edits |
| `delete_file` | Delete files or directories: requires explicit `recursive=true` to delete non-empty directories (prevents accidental folder deletion), with guards to handle non-existent paths gracefully. |
| `move_file` | Move files/directories: matches shell `mv` behavior (moves source into existing destination directories), and automatically creates missing parent directories for new nested paths. |
| `rename_file` | Rename files/directories within their current directory only: validates no path separators in the new name, and fails instead of overwriting existing files to prevent accidental data loss. |
| `append_to_file` | Atomically append content to files (OS-level atomicity safe for logs), and creates missing parent directories (can also create new files with initial content). |
| `create_directory` | Idempotent `mkdir -p` wrapper that creates nested directories without errors if they already exist. |
| `list_directory` | List directory contents: walks one level deep by default (`recursive=false`, lean output), or caps at 10 levels when `recursive=true` to avoid overwhelming output. Reuses shared tree formatting to match `list_skill_files` output. |
| `get_current_directory` | Returns home directory, current working directory, and platform info to eliminate path guessing across operating systems. |
| `run_command` | Execute shell commands, run scripts, and interact directly with the local system |

**3. Persistent Settings**
LM Studio does not save plugin settings across new chats. This plugin solves that by writing settings to `~/.lmstudio/plugin-data/lms-skills/settings.json` - the skills path and all configuration survive chat resets.

---

## Skill Directory Structure

A skill is any subdirectory inside your skills folder that contains a `SKILL.md` file.

```
~/.lmstudio/skills/          <- default skills directory
├── docx/
│   ├── SKILL.md             <- entry point (required)
│   ├── scripts/
│   │   └── helper.py
│   └── templates/
│       └── base.docx
├── pptx/
│   ├── SKILL.md
│   └── editing.md
└── my-custom-skill/
    ├── SKILL.md
    └── skill.json           <- optional: override name/description
```

### `skill.json` (optional)

Place a `skill.json` in any skill directory to override its display name and description:

```json
{
  "name": "My Custom Skill",
  "description": "Use this skill when the user asks to do X, Y, or Z.",
  "tags": [
    "data analysis",
    "csv",
    "statistics",
    "charts",
    "visualisation",
    "pandas",
    "trends",
    "dataset"
  ]
}
```

If absent, the plugin uses the directory name and extracts the description from the first paragraph of `SKILL.md`.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Auto-Inject Skills List | On | Injects skills block into every prompt |
| Max Skills in Context | 15 | Max skills listed in each injected block |
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
lms dev
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
7. Model uses `read_file`, `patch_file`, and `write_file` to execute the actual coding and file management tasks required by the user

## License

- [Apache 2.0](LICENSE)