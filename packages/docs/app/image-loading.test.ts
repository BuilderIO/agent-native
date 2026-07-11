import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appDir = path.dirname(fileURLToPath(import.meta.url));

function tsxFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) return tsxFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [absolutePath] : [];
  });
}

describe("docs image loading", () => {
  it("lazy-loads and asynchronously decodes every image", () => {
    const violations: string[] = [];

    for (const file of tsxFiles(appDir)) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/<img\b[\s\S]*?>/g)) {
        const image = match[0];
        if (
          !image.includes('loading="lazy"') ||
          !image.includes('decoding="async"')
        ) {
          violations.push(
            `${path.relative(appDir, file)}:${source.slice(0, match.index).split("\n").length}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
