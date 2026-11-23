import type ts from "typescript";

import type { Edits } from "./edits.ts";
import type { JsxTag } from "./jsx.ts";

export const COMPONENT_NAMES = [
  "button",
  "badge",
  "input",
  "text-area",
  "skeleton",
  "spinner",
  "toast",
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

export interface ImportName {
  imported: string;
  local: string;
}

export type Analysis =
  | { ok: false; reason: string }
  | {
      ok: true;
      uses: ImportName[];
      reviews: string[];
      build(edits: Edits): void;
    };

export interface SiteContext {
  source: ts.SourceFile;
  checker: ts.TypeChecker;
  imported: string;
  local: string;
  options: CodemodOptions;
  fresh(base: string): string;
  nameInUse(name: string): boolean;
}

export interface ComponentDef {
  name: ComponentName;
  legacy: readonly string[];
  next: string;
  names: Readonly<Record<string, string | null>>;
  jsx?(tag: JsxTag, context: SiteContext): Analysis;
  reference?(identifier: ts.Identifier, context: SiteContext): Analysis;
}

export interface CodemodOptions {
  transforms?: readonly ComponentName[];
  toasterProps?: string;
}
