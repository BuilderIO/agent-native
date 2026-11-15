import fs from "node:fs";
import path from "node:path";

export function inventoryPublicAssets(publicDir: string): string[] {
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(absolutePath);
      if (!entry.isFile()) {
        throw new Error(`Cannot inventory public asset: ${absolutePath}`);
      }
      return entry.name.endsWith(".md")
        ? [path.relative(publicDir, absolutePath).split(path.sep).join("/")]
        : [];
    });
  }
  return files(publicDir).sort();
}

export default {
  virtual: {
    "virtual:docs-markdown-inventory": "export default null;",
  },
  hooks: {
    "build:before": (nitro: {
      options: {
        dev: boolean;
        output: { publicDir: string };
        virtual: Record<string, string | (() => string)>;
      };
    }) => {
      if (nitro.options.dev) return;
      // Core copies the client artifact into publicDir before this build hook.
      const assets = inventoryPublicAssets(nitro.options.output.publicDir);
      nitro.options.virtual["virtual:docs-markdown-inventory"] =
        `export default ${JSON.stringify(assets)};`;
    },
  },
};
