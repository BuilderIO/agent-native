import { createHash } from "node:crypto";

export interface FigmaSyncBaseline {
  figmaVersion: string | null;
  figmaNodeHash: string;
  designHash: string;
}

export type FigmaSyncStatus =
  | "untracked"
  | "in-sync"
  | "figma-changed"
  | "design-changed"
  | "both-changed";

export function stableJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol") return "null";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value: unknown): string {
  return hashText(stableJson(value));
}

export function classifyFigmaSync(input: {
  baseline?: Partial<FigmaSyncBaseline> | null;
  figmaNodeHash: string;
  designHash: string;
}): FigmaSyncStatus {
  const baseline = input.baseline;
  if (!baseline?.figmaNodeHash || !baseline.designHash) return "untracked";

  const figmaChanged = baseline.figmaNodeHash !== input.figmaNodeHash;
  const designChanged = baseline.designHash !== input.designHash;

  if (figmaChanged && designChanged) return "both-changed";
  if (figmaChanged) return "figma-changed";
  if (designChanged) return "design-changed";
  return "in-sync";
}
