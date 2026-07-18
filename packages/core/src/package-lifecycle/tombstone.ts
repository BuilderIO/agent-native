import {
  migrationMoveStatus,
  type MigrationManifest,
} from "./migration-manifest.js";
import { migrationMoveMessage } from "./migration-message.js";

export interface TombstoneModuleOptions {
  from: string;
  manifest: MigrationManifest;
  helperImport: string;
  valueExports?: string[];
  typeExports?: string[];
}

export function renderTombstoneModule(options: TombstoneModuleOptions): string {
  const move = options.manifest.moves[options.from];
  if (!move || migrationMoveStatus(move) !== "active") {
    throw new Error(
      `Cannot render a tombstone for ${options.from} without an active exact migration manifest move.`,
    );
  }
  const to = move.to;
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
