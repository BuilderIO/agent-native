import { randomUUID } from "node:crypto";

/**
 * Record ids carry a short type prefix so a stray id in a log or a URL says
 * what it points at: `prj_…` a project, `cel_…` a cell, `ver_…` a version.
 */
export type IdPrefix =
  | "prj"
  | "ver"
  | "cel"
  | "col"
  | "sts"
  | "run"
  | "viw"
  | "emb";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/** A stable id built from a seed, for sample data that must not change. */
export function seededId(prefix: IdPrefix, seed: string): string {
  return `${prefix}_${seed}`;
}
