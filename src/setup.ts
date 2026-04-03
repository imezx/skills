import * as fs from "fs";
import * as path from "path";

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function bootstrapSkillsDir(skillsPath: string): void {
  if (fs.existsSync(skillsPath)) return;

  fs.mkdirSync(skillsPath, { recursive: true });

  const samplesDir = path.resolve(__dirname, "..", "samples");
  if (!fs.existsSync(samplesDir)) return;

  copyDir(samplesDir, skillsPath);
}
