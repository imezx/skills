export interface SkillInfo {
  name: string;
  description: string;
  skillMdPath: string;
  directoryPath: string;
  hasExtraFiles: boolean;
}

export interface SkillManifestFile {
  name?: string;
  description?: string;
}

export interface PersistedSettings {
  skillsPath: string;
  autoInject: boolean;
  maxSkillsInContext: number;
}

export interface EffectiveConfig {
  skillsPath: string;
  autoInject: boolean;
  maxSkillsInContext: number;
}

export interface DirectoryEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  sizeBytes?: number;
}
