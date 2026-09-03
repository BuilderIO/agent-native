import {
  migrationMoveStatus,
  resolveMigrationSymbolMove,
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
  const targetForExport = (name: string): string =>
    resolveMigrationSymbolMove(move, name)?.to ?? to;
  const exportNames = [
    ...(options.valueExports ?? []),
    ...(options.typeExports ?? []),
  ].sort();
  const symbolTargets = Object.fromEntries(
    [...new Set(exportNames)].flatMap((name) => {
      const target = targetForExport(name);
      return target === to ? [] : [[name, target]];
    }),
  );
  const lines = [
    `import { throwMovedAgentNativeModule, type DeprecatedExport } from ${JSON.stringify(options.helperImport)};`,
    "",
    `throwMovedAgentNativeModule(${JSON.stringify(options.from)}, ${JSON.stringify(to)}${Object.keys(symbolTargets).length > 0 ? `, ${JSON.stringify(symbolTargets)}` : ""});`,
  ];
  for (const name of [...(options.valueExports ?? [])].sort()) {
    const message = migrationMoveMessage(options.from, targetForExport(name));
    lines.push(
      "",
      `/** @deprecated ${message} */`,
      `export const ${name} = undefined as DeprecatedExport<${JSON.stringify(message)}>;`,
    );
  }
  for (const name of [...(options.typeExports ?? [])].sort()) {
    const message = migrationMoveMessage(options.from, targetForExport(name));
    lines.push(
      "",
      `/** @deprecated ${message} */`,
      `export type ${name} = DeprecatedExport<${JSON.stringify(message)}>;`,
    );
  }
  return `${lines.join("\n")}\n`;
}
