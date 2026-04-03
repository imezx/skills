import { configSchematics } from "./config";
import { toolsProvider } from "./toolsProvider";
import { promptPreprocessor } from "./preprocessor";
import { bootstrapSkillsDir } from "./setup";
import { DEFAULT_SKILLS_DIR } from "./constants";
import type { PluginContext } from "./pluginTypes";

export async function main(context: PluginContext) {
  bootstrapSkillsDir(DEFAULT_SKILLS_DIR);
  context.withConfigSchematics(configSchematics);
  context.withToolsProvider(toolsProvider);
  context.withPromptPreprocessor(promptPreprocessor);
}
