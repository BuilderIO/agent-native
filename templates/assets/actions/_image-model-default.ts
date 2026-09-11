import { readAppState } from "@agent-native/core/application-state";

import { IMAGE_MODELS, type ImageModel } from "../shared/api.js";

export const IMAGE_MODEL_STATE_KEY = "imageGenerationModel";

function imageModelValue(value: unknown): ImageModel | undefined {
  return typeof value === "string" &&
    (IMAGE_MODELS as readonly string[]).includes(value)
    ? (value as ImageModel)
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function readImageModelDefault(): Promise<ImageModel | undefined> {
  const raw = await readAppState(IMAGE_MODEL_STATE_KEY).catch(() => null);
  const state = recordValue(raw);
  return imageModelValue(state.model) ?? imageModelValue(raw);
}
