import { migrationMoveMessage } from "./migration-message.js";

declare const deprecatedExportBrand: unique symbol;

export type DeprecatedExport<Message extends string> = never & {
  readonly [deprecatedExportBrand]: Message;
};

export class AgentNativeUpgradeError extends Error {
  override readonly name = "AgentNativeUpgradeError";

  constructor(from: string, to: string) {
    super(migrationMoveMessage(from, to));
  }
}

export function throwMovedAgentNativeModule(from: string, to: string): never {
  throw new AgentNativeUpgradeError(from, to);
}
