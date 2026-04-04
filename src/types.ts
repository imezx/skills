export interface SkillInfo {
  name: string;
  description: string;
  bodyExcerpt: string;
  tags: string[];
  skillMdPath: string;
  directoryPath: string;
  hasExtraFiles: boolean;
}

export interface SkillManifestFile {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface PersistedSettings {
  skillsPaths: string[];
  autoInject: boolean;
  maxSkillsInContext: number;
  shellPath: string;
}

export interface EffectiveConfig {
  skillsPaths: string[];
  autoInject: boolean;
  maxSkillsInContext: number;
  shellPath: string;
}

export interface DirectoryEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  sizeBytes?: number;
}
