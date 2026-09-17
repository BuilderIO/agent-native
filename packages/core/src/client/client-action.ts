import type {
  AgentNativeActionManifestEntry,
  AgentNativeClientAction,
  AgentNativeClientActionRuntime,
} from "./host-bridge.js";

export type AgentNativeClientActionRunner<TArgs, TResult> = (
  args: TArgs,
  runtime: AgentNativeClientActionRuntime,
) => TResult | Promise<TResult>;

export type AgentNativeClientActionDefinition<TArgs, TResult> =
  AgentNativeActionManifestEntry & {
    run: AgentNativeClientActionRunner<TArgs, TResult>;
  };

export function defineClientAction<TArgs = unknown, TResult = unknown>(
  action: AgentNativeClientActionDefinition<TArgs, TResult>,
): AgentNativeClientAction<TArgs, TResult> {
  return action;
}
