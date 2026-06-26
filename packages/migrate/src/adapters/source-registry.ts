import type {
  MigrationInputKind,
  MigrationRun,
  SourceAdapter,
} from "../types.js";
import { inferMigrationInputKind } from "./agent-introspection.js";
import { nextjsSourceAdapter } from "./nextjs.js";

export type SourceAdapterRegistry = readonly SourceAdapter[];

export const sourceAdapterRegistry: SourceAdapterRegistry = [
  nextjsSourceAdapter,
];

export interface SelectSourceAdapterOptions {
  sourceRoot: string;
  inputKind?: MigrationInputKind | string;
  inputDescription?: string;
  registry?: SourceAdapterRegistry;
}

export async function selectSourceAdapter(
  input: string | MigrationRun | SelectSourceAdapterOptions,
): Promise<SourceAdapter | null> {
  const options = normalizeSelectionInput(input);
  const inputKind =
    options.inputKind ?? inferMigrationInputKind(options.sourceRoot);
  const registry = options.registry ?? sourceAdapterRegistry;

  for (const adapter of registry) {
    if (adapter.inputKinds && !adapter.inputKinds.includes(inputKind)) {
      continue;
    }
    try {
      if (await adapter.detect(options.sourceRoot)) {
        return adapter;
      }
    } catch {
      // Adapter detection is advisory. A failing detector should not prevent
      // later deterministic adapters or agent-introspection fallback.
    }
  }

  return null;
}

function normalizeSelectionInput(
  input: string | MigrationRun | SelectSourceAdapterOptions,
): SelectSourceAdapterOptions {
  if (typeof input === "string") {
    return { sourceRoot: input };
  }
  return input;
}
