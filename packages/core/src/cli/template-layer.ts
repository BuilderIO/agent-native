import fs from "node:fs";
import path from "node:path";

export const TEMPLATE_LAYER_FILE = "template-layer.json";

export interface TemplateLayer {
  base: string;
  delete: string[];
}

/**
 * A bundled template that holds only what it changes on top of another
 * template. Materialize copies the base, deletes `delete`, replaces whole
 * files (and whole skill folders) with the layer's own, and merges the
 * layer's package.json fields into the base's.
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

export function applyTemplateLayer(
  layerDir: string,
  layer: TemplateLayer,
  dest: string,
): void {
  for (const rel of layer.delete) {
    fs.rmSync(path.join(dest, rel), { recursive: true, force: true });
  }
  // `skills update` copies a skill folder from the first source that has it,
  // so an overridden skill replaces the base folder rather than merging.
  const layerSkills = path.join(layerDir, ".agents", "skills");
  if (fs.existsSync(layerSkills)) {
    for (const skill of fs.readdirSync(layerSkills)) {
      fs.rmSync(path.join(dest, ".agents", "skills", skill), {
        recursive: true,
        force: true,
      });
    }
  }
  copyLayerFiles(layerDir, dest, "");
  const basePkgPath = path.join(dest, "package.json");
  const merged = mergePackageFields(
    JSON.parse(fs.readFileSync(basePkgPath, "utf-8")),
    JSON.parse(fs.readFileSync(path.join(layerDir, "package.json"), "utf-8")),
  );
  fs.writeFileSync(basePkgPath, `${JSON.stringify(merged, null, 2)}\n`);
}

function copyLayerFiles(layerDir: string, dest: string, rel: string): void {
  for (const entry of fs.readdirSync(path.join(layerDir, rel), {
    withFileTypes: true,
  })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entryRel === TEMPLATE_LAYER_FILE || entryRel === "package.json") {
      continue;
    }
    if (entry.isDirectory()) {
      copyLayerFiles(layerDir, dest, entryRel);
      continue;
    }
    const target = path.join(dest, entryRel);
    // The base may ship a symlink here (CLAUDE.md -> AGENTS.md); writing
    // through it would overwrite the link target instead.
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(layerDir, entryRel), target);
  }
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
