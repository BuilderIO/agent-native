import { isProductionServerlessFunctionRuntime } from "@agent-native/core/db";

export function isProductionServerlessRuntime(): boolean {
  return isProductionServerlessFunctionRuntime();
}
