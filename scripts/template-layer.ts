/**
 * Edit a bundled template layer (template-layer.json) as a normal tree.
 *
 *   pnpm template-layer expand <template> --out <dir>
 *     Writes the base template with the layer applied, before any scaffold
 *     post-processing, so you can edit it like the app itself.
 *
 *   pnpm template-layer diff <template> --from <dir>
 *     Rewrites the layer from an edited tree: files that differ from the base
 *     become `<file>.patch`, files the base lacks are stored whole, and base
 *     files missing from the tree go in `delete`. The layer's package.json is
 *     a partial merged into the base's and is edited by hand.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  _findLocalTemplate,
  _shouldSkipScaffoldEntry,
} from "../packages/core/src/cli/create.ts";
import {
  LAYER_PATCH_SUFFIX,
  TEMPLATE_LAYER_FILE,
  createLayerPatch,
  readTemplateLayer,
} from "../packages/core/src/cli/template-layer.ts";
import { copyTemplateTree } from "../packages/core/src/cli/template-sync.ts";

type Entry = "file" | "symlink";

function listTree(root: string, rel = "", out = new Map<string, Entry>()) {
  for (const entry of fs.readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (_shouldSkipScaffoldEntry(entry.name, path.join(root, entryRel))) {
      continue;
    }
    if (entry.isSymbolicLink()) out.set(entryRel, "symlink");
    else if (entry.isDirectory()) listTree(root, entryRel, out);
    else out.set(entryRel, "file");
  }
  return out;
}

function layerDirFor(template: string): string {
  const dir = _findLocalTemplate(template);
  if (!dir || !readTemplateLayer(dir)) {
    throw new Error(`${template} is not a bundled template layer.`);
  }
  return dir;
}

function expand(template: string, out: string): void {
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    throw new Error(`${out} is not empty.`);
  }
  copyTemplateTree(layerDirFor(template), out);
  console.log(`Expanded ${template} into ${out}`);
}

function diff(template: string, from: string): void {
  const layerDir = layerDirFor(template);
  const layer = readTemplateLayer(layerDir)!;
  const baseDir = _findLocalTemplate(layer.base);
  if (!baseDir) throw new Error(`No local copy of base "${layer.base}".`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "template-layer-base-"));
  copyTemplateTree(baseDir, base);
  try {
    const baseFiles = listTree(base);
    const edited = listTree(from);
    const nextFiles = new Map<string, string>();
    for (const [rel, kind] of edited) {
      if (rel === "package.json") continue;
      if (kind === "symlink") {
        if (baseFiles.get(rel) !== "symlink") {
          throw new Error(`${rel} is a new symlink; layers carry files only.`);
        }
        continue;
      }
      const after = fs.readFileSync(path.join(from, rel), "utf-8");
      if (baseFiles.get(rel) !== "file") {
        nextFiles.set(rel, after);
        continue;
      }
      const before = fs.readFileSync(path.join(base, rel), "utf-8");
      if (before !== after) {
        nextFiles.set(
          `${rel}${LAYER_PATCH_SUFFIX}`,
          createLayerPatch(rel, before, after),
        );
      }
    }
    const missing = [...baseFiles.keys()].filter((rel) => !edited.has(rel));
    const deletes = new Set<string>();
    for (const rel of missing) {
      let top = rel;
      for (let dir = path.posix.dirname(rel); dir !== "."; ) {
        if (fs.existsSync(path.join(from, dir))) break;
        top = dir;
        dir = path.posix.dirname(dir);
      }
      deletes.add(top);
    }

    for (const entry of fs.readdirSync(layerDir)) {
      if (entry === "package.json" || entry === TEMPLATE_LAYER_FILE) continue;
      fs.rmSync(path.join(layerDir, entry), { recursive: true, force: true });
    }
    for (const [rel, content] of nextFiles) {
      const target = path.join(layerDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    fs.writeFileSync(
      path.join(layerDir, TEMPLATE_LAYER_FILE),
      `${JSON.stringify({ base: layer.base, delete: [...deletes].sort() }, null, 2)}\n`,
    );
    const patches = [...nextFiles.keys()].filter((rel) =>
      rel.endsWith(LAYER_PATCH_SUFFIX),
    ).length;
    console.log(
      `${template}: ${patches} patches, ${nextFiles.size - patches} new files, ${deletes.size} deletions.`,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const [command, template, flag, dir] = process.argv.slice(2);
if (
  !template ||
  !dir ||
  !(
    (command === "expand" && flag === "--out") ||
    (command === "diff" && flag === "--from")
  )
) {
  console.error(
    "Usage: pnpm template-layer expand <template> --out <dir>\n       pnpm template-layer diff <template> --from <dir>",
  );
  process.exit(2);
}
if (command === "expand") expand(template, path.resolve(dir));
else diff(template, path.resolve(dir));
