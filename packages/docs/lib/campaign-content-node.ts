import fs from "node:fs";
import path from "node:path";

import { parseCampaignContent, type CampaignContent } from "./campaign-content";

export function loadCampaignContentFromDisk(rootDir: string): CampaignContent {
  function readSources(
    directory: string,
    extension: string,
  ): Record<string, string> {
    const dir = path.resolve(rootDir, "content", directory);
    try {
      return Object.fromEntries(
        fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
          .map((entry) => {
            const filename = path.join(dir, entry.name);
            return [filename, fs.readFileSync(filename, "utf8")];
          }),
      );
    } catch (cause) {
      throw new Error(`Unable to enumerate/read campaign content in ${dir}`, {
        cause,
      });
    }
  }
  // Translated use-case pages live in one folder per locale.
  function localeFolders(): string[] {
    const dir = path.resolve(rootDir, "content", "use-cases");
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join("use-cases", entry.name));
    } catch (cause) {
      throw new Error(`Unable to enumerate/read campaign content in ${dir}`, {
        cause,
      });
    }
  }
  return parseCampaignContent({
    useCases: readSources("use-cases", ".yaml"),
    useCaseTranslations: Object.assign(
      {},
      ...localeFolders().map((folder) => readSources(folder, ".yaml")),
    ),
    articles: readSources("articles", ".md"),
  });
}
