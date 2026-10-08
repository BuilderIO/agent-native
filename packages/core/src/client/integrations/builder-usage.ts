import type { ServiceProviderServiceStatus } from "../../agent/actions/manage-service-providers.js";
import type { BuilderDefaultModel } from "../../secrets/usage.js";

export type BuilderUsageId =
  | "ai-model"
  | "file-storage"
  | "voice"
  | "images"
  | "embeddings"
  | "design-system"
  | "background-agents"
  | "browser-automation";

/** What happens to a use when the Builder.io connection goes away. */
export type BuilderUsageLoss =
  | "model-picker"
  | "default-switches"
  | "default-stops"
  | "uploads-fail"
  | "service-stops"
  | "stops";

export interface BuilderUsage {
  id: BuilderUsageId;
  loss: BuilderUsageLoss;
  /** Set when the default model runs on Builder.io. */
  defaultModel?: { model: string; next?: string };
}

export interface BuilderUsageInput {
  /**
   * Whether new uploads go to Builder.io storage. `null` means the storage
   * status couldn't be read, so the row is left out rather than guessed.
   */
  storageOnBuilder: boolean | null;
  /**
   * The organization services and who answers each. `null` means they couldn't
   * be read; `[]` means there are none to check (no organization).
   */
  services: readonly ServiceProviderServiceStatus[] | null;
  /**
   * Whether the default model runs on Builder.io. `null` means it couldn't be
   * read, so the row keeps the model-picker note rather than guessing.
   */
  defaultModel: BuilderDefaultModel | null;
}

const SERVICE_USAGE: Record<string, BuilderUsageId> = {
  voice: "voice",
  images: "images",
  embeddings: "embeddings",
};

function aiModelUsage(defaultModel: BuilderDefaultModel | null): BuilderUsage {
  if (defaultModel?.status !== "builder") {
    return { id: "ai-model", loss: "model-picker" };
  }
  const { whenDisconnected } = defaultModel;
  return whenDisconnected.status === "switches"
    ? {
        id: "ai-model",
        loss: "default-switches",
        defaultModel: {
          model: defaultModel.model,
          next: whenDisconnected.next,
        },
      }
    : {
        id: "ai-model",
        loss: "default-stops",
        defaultModel: { model: defaultModel.model },
      };
}

/**
 * What the Builder.io connection powers for this viewer, in page order. The
 * services and storage count only while Builder.io is what answers them; the
 * Builder-only capabilities have no other provider.
 */
export function builderUsages({
  storageOnBuilder,
  services,
  defaultModel,
}: BuilderUsageInput): BuilderUsage[] {
  const usages: BuilderUsage[] = [aiModelUsage(defaultModel)];
  if (storageOnBuilder === true) {
    usages.push({ id: "file-storage", loss: "uploads-fail" });
  }
  for (const service of services ?? []) {
    const id = SERVICE_USAGE[service.service];
    if (id && service.effectiveProvider === "builder") {
      usages.push({ id, loss: "service-stops" });
    }
  }
  usages.push(
    { id: "design-system", loss: "stops" },
    { id: "background-agents", loss: "stops" },
    { id: "browser-automation", loss: "stops" },
  );
  return usages;
}
