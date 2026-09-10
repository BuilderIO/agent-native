import {
  AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND,
  migrationMoveMessage,
} from "./migration-message.js";

declare const deprecatedExportBrand: unique symbol;

export type DeprecatedExport<Message extends string> = never & {
  readonly [deprecatedExportBrand]: Message;
};

export class AgentNativeUpgradeError extends Error {
  override readonly name = "AgentNativeUpgradeError";

  constructor(
    from: string,
    to: string,
    symbolTargets: Readonly<Record<string, string>> = {},
  ) {
    const overrides = Object.entries(symbolTargets).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    super(
      overrides.length === 0
        ? migrationMoveMessage(from, to)
        : `${from} exports moved to multiple entrypoints: ${overrides.map(([symbol, target]) => `${symbol} -> ${target}`).join("; ")}; all other exports -> ${to}. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`,
    );
  }
}

export function throwMovedAgentNativeModule(
  from: string,
  to: string,
  symbolTargets: Readonly<Record<string, string>> = {},
): never {
  throw new AgentNativeUpgradeError(from, to, symbolTargets);
}
