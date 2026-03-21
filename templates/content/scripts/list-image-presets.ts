import fs from "fs";
import path from "path";
import { getAllPresets } from "../server/handlers/image-gen.js";
import { loadEnv, IMAGE_REFS_DIR } from "./_utils.js";

function listFolderPresets() {
  if (!fs.existsSync(IMAGE_REFS_DIR)) return [];
  return fs
    .readdirSync(IMAGE_REFS_DIR)
    .filter((d) => fs.statSync(path.join(IMAGE_REFS_DIR, d)).isDirectory())
    .map((name) => {
      const images = fs
        .readdirSync(path.join(IMAGE_REFS_DIR, name))
        .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
      return { name, imageCount: images.length };
    });
}

export default async function main(_args: string[]) {
  loadEnv();

  const namedPresets = getAllPresets();
  const folderPresets = listFolderPresets();

  if (!namedPresets.length && !folderPresets.length) {
    console.log(
      "No image presets found. Create presets via the UI or add folders under content/shared-resources/image-references/.",
    );
    return;
  }

  if (namedPresets.length) {
    console.log("Curated presets (use these by name):");
    for (const p of namedPresets) {
      console.log(`  - ${p.name} (${p.paths.length} curated images)`);
    }
  }

  if (folderPresets.length) {
    console.log("\nFolder presets (fallback):");
    for (const p of folderPresets) {
      console.log(`  - ${p.name} (${p.imageCount} images)`);
    }
  }

  console.log('\nUse these with: pnpm script generate-image --preset "<name>"');
}
