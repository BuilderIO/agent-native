import { migrationMoveMessage } from "./migration-message.js";

export interface TombstoneModuleOptions {
  from: string;
  to: string;
  helperImport: string;
  valueExports?: string[];
  typeExports?: string[];
}

export function renderTombstoneModule(options: TombstoneModuleOptions): string {
  const message = migrationMoveMessage(options.from, options.to);
  const lines = [
    `import { throwMovedAgentNativeModule, type DeprecatedExport } from ${JSON.stringify(options.helperImport)};`,
    "",
    `throwMovedAgentNativeModule(${JSON.stringify(options.from)}, ${JSON.stringify(options.to)});`,
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
