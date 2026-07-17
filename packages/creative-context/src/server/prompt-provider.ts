import { readAppState } from "@agent-native/core/application-state";
import { registerPromptContextProvider } from "@agent-native/core/server";

import { getBrandProfile } from "../store/brand.js";
import type { BrandDnaPayload } from "../types.js";
import {
  compilePublishedBrandContext,
  type PublishedBrandContextInput,
} from "./brand-context.js";

const PROVIDER_ID = "creative-context";
let unregisterProvider: (() => void) | null = null;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function publishedBrandContextInput(
  profileId: string,
  dnaVersionId: string,
  payload: BrandDnaPayload,
): PublishedBrandContextInput {
  const visual = objectValue(payload.visual);
  const voice = objectValue(payload.voice);
  return {
    profileId,
    dnaVersionId,
    colors: payload.colors ?? visual.colors,
    fonts: payload.fonts ?? visual.fonts,
    numericScales:
      payload.numericScales ?? visual.numericScales ?? visual.scales,
    voiceDescriptors:
      payload.voiceDescriptors ?? voice.descriptors ?? voice.tone,
    layoutPatterns:
      payload.layoutPatterns ?? visual.layoutPatterns ?? payload.motifs,
    logos: payload.logos ?? visual.logos,
    terminology: payload.terminology,
    exclusions: payload.exclusions ?? payload.constraints,
    inventory: payload.inventory,
  };
}

export function registerCreativeContextPromptProvider(): () => void {
  if (unregisterProvider) return unregisterProvider;
  const unregister = registerPromptContextProvider({
    id: PROVIDER_ID,
    async load() {
      const state = await readAppState("creative-context").catch(() => null);
      if (state?.contextMode === "off") return null;
      const { profile, dna } = await getBrandProfile({});
      if (!profile || !dna || dna.status !== "published") return null;
      return {
        label: "Published brand context",
        content: compilePublishedBrandContext(
          publishedBrandContextInput(profile.id, dna.id, dna.payload),
        ),
        provenance: "runtime-context",
        governance: profile.visibility === "org" ? "inherited" : "user",
        sourceRef: {
          scope: profile.visibility === "org" ? "organization" : "personal",
          path: "context/brand-context.md",
        },
      };
    },
  });
  unregisterProvider = () => {
    unregister();
    unregisterProvider = null;
  };
  return unregisterProvider;
}
