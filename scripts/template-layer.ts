/**
 * Edit a bundled template layer (template-layer.json) as a normal tree.
 *
 *   pnpm template-layer expand <template> --out <dir>
 *     Writes the base template with the layer applied, before any scaffold
 *     post-processing, so you can edit it like the app itself.
 *
 *   pnpm template-layer rebase <template> --out <dir> [--base-ref <ref>]
 *     For when the base changed under a patch: three-way merges each patched
 *     file (the base at <ref>, default origin/main, vs. the base now) into an
 *     expanded tree, leaving conflict markers where both sides edited the same
 *     lines. Resolve them, then run `diff`.
 *
 *   pnpm template-layer check
 *     Applies every bundled layer to its base in a temp dir and fails when a
 *     patch no longer applies. Runs as `guard:template-layers`, so a change to
 *     a base template (templates/chat) that breaks a layer fails in that PR.
 *
 *   pnpm template-layer diff <template> --from <dir>
 *     Rewrites the layer from an edited tree: files that differ from the base
 *     become `<file>.patch`, files the base lacks are stored whole, and base
 *     files missing from the tree go in `delete`. The layer's package.json is
 *     a partial merged into the base's and is edited by hand.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  _copyDir,
  _copyTemplateTree as copyTemplateTree,
  _findLocalTemplate,
  _shouldSkipScaffoldEntry,
} from "../packages/core/src/cli/create.ts";
import {
  LAYER_PATCH_SUFFIX,
  PACKAGED_TEMPLATE_EXCLUDE,
  TEMPLATE_LAYER_FILE,
  createLayerPatch,
  applyTemplateLayer,
  listLayerFiles,
  readTemplateLayer,
} from "../packages/core/src/cli/template-layer.ts";

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

function rebase(template: string, out: string, baseRef: string): void {
  const layerDir = layerDirFor(template);
  const layer = readTemplateLayer(layerDir)!;
  const newBase = _findLocalTemplate(layer.base);
  if (!newBase) throw new Error(`No local copy of base "${layer.base}".`);
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    throw new Error(`${out} is not empty.`);
  }
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: newBase,
    encoding: "utf-8",
  }).trim();
  const baseRel = path.relative(repoRoot, newBase);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "template-layer-rebase-"));
  try {
    const archive = execFileSync("git", ["archive", baseRef, baseRel], {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", work], { input: archive });
    const oldBase = path.join(work, baseRel);
    const oldExpanded = path.join(work, "old-expanded");
    _copyDir(oldBase, oldExpanded);
    applyTemplateLayer(layerDir, layer, oldExpanded);

    _copyDir(newBase, out);
    const patches = listLayerFiles(layerDir).filter((rel) =>
      rel.endsWith(LAYER_PATCH_SUFFIX),
    );
    const patched = new Set(
      patches.map((rel) => rel.slice(0, -LAYER_PATCH_SUFFIX.length)),
    );
    // Everything except the patches applies to the new base as usual.
    const scratch = path.join(work, "layer-without-patches");
    _copyDir(layerDir, scratch);
    for (const rel of patches) fs.rmSync(path.join(scratch, rel));
    applyTemplateLayer(scratch, layer, out);

    const conflicts: string[] = [];
    for (const rel of patched) {
      const target = path.join(out, rel);
      if (!fs.existsSync(target)) {
        conflicts.push(`${rel} (removed from the base)`);
        continue;
      }
      const result = spawnSync(
        "git",
        [
          "merge-file",
          "-p",
          "-L",
          `${template}`,
          "-L",
          `${layer.base}@${baseRef}`,
          "-L",
          `${layer.base} (working tree)`,
          path.join(oldExpanded, rel),
          path.join(oldBase, rel),
          target,
        ],
        { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
      );
      if (result.status === null || result.status < 0) {
        throw new Error(`git merge-file failed on ${rel}: ${result.stderr}`);
      }
      fs.writeFileSync(target, result.stdout);
      if (result.status > 0) conflicts.push(rel);
    }
    console.log(
      `Rebased ${template} onto the current ${layer.base} in ${out}.`,
    );
    if (conflicts.length > 0) {
      console.log(
        `Resolve the conflict markers in:\n${conflicts.map((rel) => `  ${rel}`).join("\n")}`,
      );
    }
    console.log(`Then run: pnpm template-layer diff ${template} --from ${out}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function check(): number {
  const templatesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../packages/core/src/templates",
  );
  const layers = fs
    .readdirSync(templatesDir)
    .filter((name) =>
      fs.existsSync(path.join(templatesDir, name, TEMPLATE_LAYER_FILE)),
    );
  if (layers.length === 0) {
    console.error("template-layer check: found no bundled template layers.");
    return 2;
  }
  let failed = 0;
  for (const name of layers) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "template-layer-check-"));
    const layerDir = path.join(templatesDir, name);
    try {
      copyTemplateTree(layerDir, out);
    } catch (error) {
      failed += 1;
      console.error(
        `template-layer check: ${name} no longer applies to its base.\n  ${
          error instanceof Error ? error.message : String(error)
        }\n  Fix: pnpm template-layer rebase ${name} --out .tmp/${name}, resolve any conflict markers it reports, then pnpm template-layer diff ${name} --from .tmp/${name}.`,
      );
      fs.rmSync(out, { recursive: true, force: true });
      continue;
    }
    // The published core ships its bases without spec/test files, and npm
    // drops symlinks, so a layer must also apply to that copy or
    // materializing from npm fails.
    const packaged = path.join(out, ".packaged");
    try {
      const layer = readTemplateLayer(layerDir)!;
      const baseDir = _findLocalTemplate(layer.base);
      if (!baseDir) throw new Error(`No local copy of base "${layer.base}".`);
      copyTemplateTree(baseDir, packaged);
      for (const [rel, kind] of listTree(packaged)) {
        if (kind === "symlink" || PACKAGED_TEMPLATE_EXCLUDE.test(rel)) {
          fs.rmSync(path.join(packaged, rel));
        }
      }
      applyTemplateLayer(layerDir, layer, packaged);
      console.log(`template-layer check: ${name} applies cleanly.`);
    } catch (error) {
      failed += 1;
      console.error(
        `template-layer check: ${name} fails against the published copy of its base, which has no spec/test files or symlinks.\n  ${
          error instanceof Error ? error.message : String(error)
        }\n  Fix: list a base spec/test file under "delete" in ${TEMPLATE_LAYER_FILE} instead of patching it.`,
      );
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  return failed > 0 ? 1 : 0;
}

const [command, template, flag, dir] = process.argv.slice(2);
if (command === "check") process.exit(check());
if (command === "rebase") {
  const args = process.argv.slice(3);
  const valueOf = (name: string) => args[args.indexOf(name) + 1];
  if (!args[0] || !args.includes("--out")) {
    console.error(
      "Usage: pnpm template-layer rebase <template> --out <dir> [--base-ref <ref>]",
    );
    process.exit(2);
  }
  rebase(
    args[0],
    path.resolve(valueOf("--out")),
    args.includes("--base-ref") ? valueOf("--base-ref") : "origin/main",
  );
  process.exit(0);
}
if (
  !template ||
  !dir ||
  !(
    (command === "expand" && flag === "--out") ||
    (command === "diff" && flag === "--from")
  )
) {
  console.error(
    "Usage: pnpm template-layer check\n       pnpm template-layer expand <template> --out <dir>\n       pnpm template-layer diff <template> --from <dir>\n       pnpm template-layer rebase <template> --out <dir> [--base-ref <ref>]",
  );
  process.exit(2);
}
if (command === "expand") expand(template, path.resolve(dir));
else diff(template, path.resolve(dir));
