export const phase1WarehouseFixtureKey = Symbol.for(
  "analytics-2.phase1.warehouse-fixture",
);

export type WarehouseFixtureBridge = {
  rest(
    connectionId: string,
    request: Pick<ProviderApiRequestArgs, "method" | "path" | "query" | "body">,
  ): { response: { ok: boolean; status: number; json: object } } | undefined;
  beforeStorageRead(
    connectionId: string,
    projectId: string,
    jobId: string,
  ): void;
};
import type { ProviderApiRequestArgs } from "@agent-native/core/provider-api";
