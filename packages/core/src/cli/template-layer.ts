import fs from "node:fs";
import path from "node:path";

import { applyPatch, createTwoFilesPatch } from "diff";

export const TEMPLATE_LAYER_FILE = "template-layer.json";
export const LAYER_PATCH_SUFFIX = ".patch";

export interface TemplateLayer {
  base: string;
  delete: string[];
}

/**
 * A bundled template that holds only what it changes on top of another
 * template. Materialize copies the base, deletes `delete`, applies each
 * `<file>.patch` (a unified diff) to the base's `<file>`, copies the layer's
 * other files as new files, and merges the layer's package.json fields into
 * the base's. A patch whose context no longer matches the base fails the
 * materialize instead of silently dropping the change.
 */
export function readTemplateLayer(templateDir: string): TemplateLayer | null {
  const file = path.join(templateDir, TEMPLATE_LAYER_FILE);
  if (!fs.existsSync(file)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const deletes = record.delete ?? [];
  if (
    typeof record.base !== "string" ||
    !record.base ||
    !Array.isArray(deletes) ||
    !deletes.every((entry) => typeof entry === "string")
  ) {
    throw new Error(
      `${file} must name a "base" template and list "delete" paths as strings.`,
    );
  }
  return { base: record.base, delete: deletes as string[] };
}

/**
 * Applies the layer onto `dest`, which already holds the base tree. `only`
 * limits it to one subtree (for example `.agents/skills`) and skips the
 * package.json merge.
 */
export function applyTemplateLayer(
  layerDir: string,
  layer: TemplateLayer,
  dest: string,
  options: { only?: string } = {},
): void {
  const inScope = (rel: string) =>
    !options.only || rel === options.only || rel.startsWith(`${options.only}/`);
  for (const rel of layer.delete.filter(inScope)) {
    fs.rmSync(pathInside(dest, rel), { recursive: true, force: true });
  }
  for (const rel of listLayerFiles(layerDir).filter(inScope)) {
    const source = path.join(layerDir, rel);
    if (rel.endsWith(LAYER_PATCH_SUFFIX)) {
      applyLayerPatch(source, dest, rel.slice(0, -LAYER_PATCH_SUFFIX.length));
      continue;
    }
    const target = pathInside(dest, rel);
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (existing && !existing.isSymbolicLink()) {
      throw new Error(
        `Template layer file ${source} would replace the base's ${rel} wholesale; ship ${rel}${LAYER_PATCH_SUFFIX} instead so base edits keep flowing in.`,
      );
    }
    // The base may ship a symlink here (CLAUDE.md -> AGENTS.md); writing
    // through it would overwrite the link target instead.
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  if (options.only) return;
  const basePkgPath = path.join(dest, "package.json");
  const merged = mergePackageFields(
    JSON.parse(fs.readFileSync(basePkgPath, "utf-8")),
    JSON.parse(fs.readFileSync(path.join(layerDir, "package.json"), "utf-8")),
  );
  fs.writeFileSync(basePkgPath, `${JSON.stringify(merged, null, 2)}\n`);
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = path.relative(root, candidate);
  return !fromRoot.startsWith("..") && !path.isAbsolute(fromRoot);
}

function pathInside(root: string, rel: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, rel);
  // Deletes and writes follow a symlinked parent, so the real path of the
  // nearest existing parent must stay inside the real destination too.
  let parent = path.dirname(resolved);
  while (!fs.existsSync(parent) && isInside(resolvedRoot, parent)) {
    parent = path.dirname(parent);
  }
  if (
    resolved === resolvedRoot ||
    !isInside(resolvedRoot, resolved) ||
    !isInside(fs.realpathSync(resolvedRoot), fs.realpathSync(parent))
  ) {
    throw new Error(
      `Template layer path "${rel}" must name something inside the template.`,
    );
  }
  return resolved;
}

/** The unified diff a layer stores for `rel` to turn `before` into `after`. */
export function createLayerPatch(
  rel: string,
  before: string,
  after: string,
): string {
  return createTwoFilesPatch(`a/${rel}`, `b/${rel}`, before, after);
}

function applyLayerPatch(patchFile: string, dest: string, rel: string): void {
  const target = pathInside(dest, rel);
  if (!fs.existsSync(target)) {
    throw new Error(
      `Template layer patch ${patchFile} targets ${rel}, which the base template no longer has.`,
    );
  }
  // Writing a patched file follows a symlink at the target itself.
  if (!isInside(fs.realpathSync(dest), fs.realpathSync(target))) {
    throw new Error(
      `Template layer path "${rel}" must name something inside the template.`,
    );
  }
  const patched = applyPatch(
    fs.readFileSync(target, "utf-8"),
    fs.readFileSync(patchFile, "utf-8"),
  );
  if (patched === false) {
    throw new Error(
      `Template layer patch ${patchFile} no longer applies to ${rel}; the base template changed the patched lines. In the agent-native repo, run \`pnpm template-layer rebase\` and then \`pnpm template-layer diff\`.`,
    );
  }
  fs.writeFileSync(target, patched);
}

/** Layer-relative paths of every file the layer contributes. */
export function listLayerFiles(layerDir: string, rel = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(layerDir, rel), {
    withFileTypes: true,
  })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entryRel === TEMPLATE_LAYER_FILE || entryRel === "package.json") {
      continue;
    }
    if (entry.isDirectory()) files.push(...listLayerFiles(layerDir, entryRel));
    else files.push(entryRel);
  }
  return files.sort();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePackageFields(
  base: Record<string, unknown>,
  layer: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergePackageFields(current, value)
        : value;
  }
  return merged;
}
