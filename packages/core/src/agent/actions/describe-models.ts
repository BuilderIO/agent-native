import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { registerBuiltinEngines } from "../engine/builtin.js";
import { getAgentEngineEntry } from "../engine/registry.js";
import {
  describeModelForEngine,
  MODEL_CATALOG,
  type ModelDescription,
} from "../model-catalog.js";
import {
  LIVE_METADATA_ENGINES,
  readAnthropicModelMetadata,
  type ProviderModelMetadataUnavailableReason,
} from "../provider-model-metadata.js";

export interface DescribeModelsResult {
  engine?: string;
  /**
   * Whether the engine's provider list was read. "unavailable" means the
   * descriptions fell back to the catalog because the read failed;
   * "not-applicable" means the engine has no provider list we read.
   */
  metadata:
    | { state: "available"; fetchedAt: number }
    | {
        state: "unavailable";
        reason: ProviderModelMetadataUnavailableReason;
        status?: number;
      }
    | { state: "not-applicable" };
  models: ModelDescription[];
}

export default defineAction({
  description:
    'Describe chat models the way the model picker does: name, one-line description, relative 1-5 cost/reasoning/speed ratings (each provider\'s own entry/mid/flagship ladder, not benchmarks or prices), context window, supported effort levels, and how the engine bills usage (billing.kind "builder-credits", "provider-key", or "subscription"). known: false means the model has no catalog entry, so only engine facts are returned; do not guess its ratings. providerDefaultEffort is the level the provider uses when no effort is chosen (requests then send none). For Anthropic engines the window and levels come from the provider\'s live model list (source "provider"); metadata.state "unavailable" means that read failed and the catalog was used. Pass engine (e.g. "builder", "anthropic", "ai-sdk:openai") to scope efforts and billing to that engine; with engine and no models, describes the models that engine offers.',
  schema: z.object({
    models: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .describe(
        'Model ids in any engine\'s spelling, e.g. "claude-opus-5-5" or "anthropic/claude-opus-5.5". Omit to describe the engine\'s models, or the whole catalog without an engine.',
      ),
    engine: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Engine name from manage-agent-engine list. Omit for model facts without engine billing or effort limits.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<DescribeModelsResult> => {
    let modelIds = args.models;
    if (!modelIds && args.engine) {
      registerBuiltinEngines();
      const entry = getAgentEngineEntry(args.engine);
      if (!entry) {
        fail(`Unknown engine "${args.engine}".`, {
          errorCode: "unknown_engine",
          statusCode: 404,
        });
      }
      modelIds = [...entry.supportedModels];
    }
    const metadata =
      args.engine && LIVE_METADATA_ENGINES.has(args.engine)
        ? await readAnthropicModelMetadata()
        : undefined;
    const live = metadata?.state === "available" ? metadata.models : undefined;
    const ids = modelIds ?? MODEL_CATALOG.map((entry) => entry.id);
    // A key can reach models the static list does not name; describe those
    // too, so the picker can show their real window and levels.
    const allIds =
      live && !args.models ? [...new Set([...ids, ...Object.keys(live)])] : ids;
    return {
      ...(args.engine ? { engine: args.engine } : {}),
      metadata: metadata
        ? metadata.state === "available"
          ? { state: "available", fetchedAt: metadata.fetchedAt }
          : {
              state: "unavailable",
              reason: metadata.reason,
              ...(metadata.status ? { status: metadata.status } : {}),
            }
        : { state: "not-applicable" },
      models: allIds.map((id) =>
        describeModelForEngine(id, args.engine, live?.[id]),
      ),
    };
  },
});
