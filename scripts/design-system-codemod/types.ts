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

/** A name the transformed code imports from the new module. */
export interface ImportName {
  imported: string;
  local: string;
}

export type Analysis =
  | { ok: false; reason: string }
  | {
      ok: true;
      uses: ImportName[];
      /** Transformed, but a person should look: what differs and why. */
      reviews: string[];
      build(edits: Edits): void;
    };

export interface SiteContext {
  source: ts.SourceFile;
  checker: ts.TypeChecker;
  /** The legacy export this site references, and its local name. */
  imported: string;
  local: string;
  options: CodemodOptions;
  /** An identifier no other code in the file uses, unique per call. */
  fresh(base: string): string;
  /** Whether the file already has an identifier with this text. */
  nameInUse(name: string): boolean;
}

export interface ComponentDef {
  name: ComponentName;
  /** Module specifiers of the legacy component. */
  legacy: readonly string[];
  /** The new module's specifier. */
  next: string;
  /** Legacy export to new export; null when the new module has no counterpart. */
  names: Readonly<Record<string, string | null>>;
  jsx?(tag: JsxTag, context: SiteContext): Analysis;
  /** A reference that isn't a JSX tag; without it, such a reference is reported. */
  reference?(identifier: ts.Identifier, context: SiteContext): Analysis;
}

export interface CodemodOptions {
  /** Components to transform; all when unset. */
  transforms?: readonly ComponentName[];
  /**
   * The new Toaster's props, as JSX attributes, such as
   * `closeLabel={t("toast.close")} regionLabel={t("toast.region")}`.
   * Without them a sonner Toaster is reported instead of swapped.
   */
  toasterProps?: string;
}
