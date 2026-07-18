import { migrationMoveMessage } from "./migration-message.js";
import type { MigrationManifest } from "./migration-manifest.js";

export interface TombstoneModuleOptions {
  from: string;
  manifest: MigrationManifest;
  helperImport: string;
  valueExports?: string[];
  typeExports?: string[];
}

export function renderTombstoneModule(options: TombstoneModuleOptions): string {
  const to = options.manifest.moves[options.from]?.to;
  if (!to) {
    throw new Error(
      `Cannot render a tombstone for ${options.from} without an exact migration manifest move.`,
    );
  }
  const message = migrationMoveMessage(options.from, to);
  const lines = [
    `import { throwMovedAgentNativeModule, type DeprecatedExport } from ${JSON.stringify(options.helperImport)};`,
    "",
    `throwMovedAgentNativeModule(${JSON.stringify(options.from)}, ${JSON.stringify(to)});`,
  ];
  for (const name of [...(options.valueExports ?? [])].sort()) {
    lines.push(
      "",
      `/** @deprecated ${message} */`,
      `export const ${name} = undefined as DeprecatedExport<${JSON.stringify(message)}>;`,
    );
  }
  for (const name of [...(options.typeExports ?? [])].sort()) {
    lines.push(
      "",
      `/** @deprecated ${message} */`,
      `export type ${name} = DeprecatedExport<${JSON.stringify(message)}>;`,
    );
  }
  return `${lines.join("\n")}\n`;
}
