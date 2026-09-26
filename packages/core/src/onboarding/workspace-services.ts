/**
 * The services every app in a workspace shares, in the order first-run
 * "Choose your setup" and Settings › Organization › Infrastructure list them.
 * First-run reads them through the app profile (`getOnboardingAppProfile`)
 * and Infrastructure renders one Services row per entry, so a service added
 * here shows up in both.
 *
 * Client-safe: no server imports.
 */

import type {
  OnboardingCapability,
  WorkspaceBuilderOnlyServiceId,
  WorkspaceProviderServiceId,
} from "./types.js";

export type {
  WorkspaceBuilderOnlyServiceId,
  WorkspaceProviderServiceId,
  WorkspaceServiceId,
} from "./types.js";

export type WorkspaceService = WorkspaceServiceFields &
  (
    | /** Settings › Model owns the providers. */ {
        kind: "model";
        id: "model";
      }
    | /** The shared S3-compatible storage form (`manage-file-storage`). */ {
        kind: "storage";
        id: "storage";
      }
    | /** A provider picked per service (`manage-service-providers`). */ {
        kind: "provider";
        id: WorkspaceProviderServiceId;
      }
    | /** Builder.io only; there is no bring-your-own path. */ {
        kind: "builder-only";
        id: WorkspaceBuilderOnlyServiceId;
      }
  );

export type WorkspaceServiceKind = WorkspaceService["kind"];

interface WorkspaceServiceFields {
  /**
   * Profile capability ids that stand for this service. An app profile that
   * declares one of them tailors the service's copy and can raise its setup
   * tag; otherwise `capability` is used.
   */
  capabilityIds: readonly string[];
  /**
   * Whether every app's first-run lists it. When false, only apps whose
   * profile declares it do; Infrastructure lists every service either way.
   */
  everyApp: boolean;
  capability: OnboardingCapability;
}

export const LLM_CAPABILITY: OnboardingCapability = {
  id: "llm",
  label: "AI model",
  required: true,
  builderIncluded: true,
  keySummary: "Connect your own AI model",
  labelKey: "agentChat.settingsInfra.aiModel",
  keySummaryKey: "agentChat.onboarding.capability.llm.keySummary",
  why: "The agent uses a language model to understand requests and produce answers.",
};

export const FILE_UPLOAD_STORAGE_CAPABILITY: OnboardingCapability = {
  id: "file-storage",
  label: "File uploads and storage",
  required: false,
  suggested: true,
  builderIncluded: true,
  keySummary: "File uploads and storage",
  labelKey: "agentChat.settingsShell.search.fileUploads",
  keySummaryKey: "agentChat.onboarding.capability.fileStorage.keySummary",
  why: "Uploaded images and files need durable object storage so the agent can reuse them throughout a thread.",
};

export const VOICE_INPUT_CAPABILITY: OnboardingCapability = {
  id: "voice-input",
  label: "Voice input",
  required: false,
  suggested: true,
  builderIncluded: true,
  keySummary: "Voice input",
  labelKey: "agentChat.onboarding.capability.voiceInput.label",
  keySummaryKey: "agentChat.onboarding.capability.voiceInput.keySummary",
  whyKey: "agentChat.onboarding.capability.voiceInput.why",
  why: "Voice input turns spoken requests into text; typing always works without it.",
};

export const IMAGE_GENERATION_CAPABILITY: OnboardingCapability = {
  id: "image-generation",
  label: "Image generation",
  required: false,
  builderIncluded: true,
  keySummary: "Image generation",
  labelKey: "agentChat.onboarding.capability.assetsImageGeneration.label",
  keySummaryKey: "agentChat.onboarding.capability.assetsImageGeneration.label",
  whyKey: "agentChat.settingsInfra.whyImages",
  why: "Generates images for slides and designs.",
};

export const EMBEDDINGS_CAPABILITY: OnboardingCapability = {
  id: "embeddings",
  label: "Embeddings",
  required: false,
  suggested: true,
  builderIncluded: true,
  keySummary: "Embeddings",
  labelKey: "agentChat.onboarding.capability.embeddings.label",
  keySummaryKey: "agentChat.onboarding.capability.embeddings.keySummary",
  whyKey: "agentChat.onboarding.capability.embeddings.why",
  why: "Embeddings improve semantic search. Keyword search still works without them.",
};

export const DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY: OnboardingCapability = {
  id: "design-system-intelligence",
  label: "Design system intelligence",
  required: false,
  builderIncluded: true,
  keySummary: "Builder Design System Intelligence",
  labelKey: "agentChat.settingsInfra.designSystem",
  why: "Uses your brand and design-system guidance to keep generated work on brand.",
};

export const BACKGROUND_AGENTS_CAPABILITY: OnboardingCapability = {
  id: "background-agents",
  label: "Background agents",
  required: false,
  builderIncluded: true,
  keySummary: "Background agents",
  labelKey: "agentChat.settingsShell.search.backgroundAgents",
  keySummaryKey: "agentChat.settingsShell.search.backgroundAgents",
  whyKey: "agentChat.settingsInfra.whyBackground",
  why: "Makes code changes from production.",
};

export const BROWSER_AUTOMATION_CAPABILITY: OnboardingCapability = {
  id: "browser-automation",
  label: "Browser automation",
  required: false,
  builderIncluded: true,
  keySummary: "Browser automation",
  labelKey: "agentChat.settingsShell.search.browserAutomation",
  keySummaryKey: "agentChat.settingsShell.search.browserAutomation",
  whyKey: "agentChat.settingsInfra.whyBrowser",
  why: "Lets the agent use a browser in production.",
};

export const WORKSPACE_SERVICES: readonly WorkspaceService[] = [
  {
    id: "model",
    kind: "model",
    capabilityIds: ["llm"],
    everyApp: true,
    capability: LLM_CAPABILITY,
  },
  {
    id: "storage",
    kind: "storage",
    capabilityIds: ["file-storage", "video-storage"],
    everyApp: true,
    capability: FILE_UPLOAD_STORAGE_CAPABILITY,
  },
  {
    id: "voice",
    kind: "provider",
    capabilityIds: ["voice-input"],
    everyApp: true,
    capability: VOICE_INPUT_CAPABILITY,
  },
  {
    id: "images",
    kind: "provider",
    capabilityIds: ["image-generation", "media-generation"],
    everyApp: true,
    capability: IMAGE_GENERATION_CAPABILITY,
  },
  {
    id: "embeddings",
    kind: "provider",
    capabilityIds: ["embeddings"],
    everyApp: true,
    capability: EMBEDDINGS_CAPABILITY,
  },
  {
    id: "design-system-intelligence",
    kind: "builder-only",
    capabilityIds: ["design-system-intelligence"],
    everyApp: false,
    capability: DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY,
  },
  {
    id: "background-agents",
    kind: "builder-only",
    capabilityIds: ["background-agents"],
    everyApp: true,
    capability: BACKGROUND_AGENTS_CAPABILITY,
  },
  {
    id: "browser-automation",
    kind: "builder-only",
    capabilityIds: ["browser-automation"],
    everyApp: true,
    capability: BROWSER_AUTOMATION_CAPABILITY,
  },
];

/** The shared service a profile capability stands for, if any. */
export function workspaceServiceForCapability(
  capabilityId: string,
): WorkspaceService | undefined {
  return WORKSPACE_SERVICES.find((service) =>
    service.capabilityIds.includes(capabilityId),
  );
}
