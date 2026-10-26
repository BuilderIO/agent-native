import { HISTORICAL_DOCUMENT_PIXEL_EFFECTS } from "./native-effect-document-pixels-v2";
import { nativeEffectExecutionPayload } from "./native-effect-trust";
import type { EffectDefinition } from "./native-effects";

const historicalPayloads = new Set(
  HISTORICAL_DOCUMENT_PIXEL_EFFECTS.map((definition) =>
    JSON.stringify(nativeEffectExecutionPayload(definition)),
  ),
);

export function nativeEffectRequiresHistoricalDensity(
  definition: EffectDefinition,
): boolean {
  return historicalPayloads.has(
    JSON.stringify(nativeEffectExecutionPayload(definition)),
  );
}
