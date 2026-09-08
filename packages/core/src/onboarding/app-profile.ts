import { getAppConfig } from "../app-config/index.js";
import type { OnboardingCapability, OnboardingAppProfile } from "./types.js";

const LLM_CAPABILITY: OnboardingCapability = {
  id: "llm",
  label: "AI model",
  required: true,
  builderIncluded: true,
  keySummary: "Connect an AI provider or local model",
  why: "The agent uses a language model to understand requests and produce answers.",
};

const DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY: OnboardingCapability = {
  id: "design-system-intelligence",
  label: "Design system intelligence",
  required: false,
  builderIncluded: true,
  keySummary: "Builder Design System Intelligence",
  why: "Uses your brand and design-system guidance to keep generated work on brand.",
};

const FILE_UPLOAD_STORAGE_CAPABILITY: OnboardingCapability = {
  id: "file-storage",
  label: "File uploads and storage",
  required: false,
  suggested: true,
  builderIncluded: true,
  keySummary: "Builder storage or an S3-compatible bucket",
  why: "Uploaded images and files need durable object storage so the agent can reuse them throughout a thread.",
};

const VOICE_INPUT_CAPABILITY: OnboardingCapability = {
  id: "voice-input",
  label: "Voice input",
  required: false,
  suggested: true,
  builderIncluded: true,
  keySummary: "Browser speech recognition or speech-to-text",
  why: "Voice input turns spoken requests into text; typing always works without it.",
};

const PROFILES: Record<string, OnboardingAppProfile> = {
  analytics: {
    appId: "analytics",
    appName: "Analytics",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "data-sources",
        label: "Data sources",
        required: false,
        builderIncluded: false,
        keySummary: "Add data connectors in Settings",
        why: "Only needed for the services you want to query, such as GA4, Stripe, or HubSpot.",
      },
      {
        id: "replay-storage",
        label: "Replay storage",
        required: false,
        builderIncluded: true,
        keySummary: "S3-compatible bucket credentials",
        why: "Only needed when session replay is enabled so recordings can be stored.",
      },
    ],
  },
  assets: {
    appId: "assets",
    appName: "Assets",
    capabilities: [
      {
        id: "image-generation",
        label: "Image generation",
        required: true,
        builderIncluded: true,
        keySummary: "Builder credits or an image provider key",
        why: "Image generation is the core workflow for creating on-brand assets.",
      },
      {
        id: "video-generation",
        label: "Video generation",
        required: false,
        builderIncluded: false,
        keySummary: "Gemini API key",
        why: "Video generation is optional; the core Assets workflow is image generation.",
      },
      DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY,
      {
        id: "file-storage",
        label: "Media storage",
        required: true,
        builderIncluded: true,
        keySummary: "S3-compatible storage credentials",
        why: "Generated files need a durable place to live before they can be shared.",
      },
    ],
  },
  brain: {
    appId: "brain",
    appName: "Brain",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "embeddings",
        label: "Embeddings",
        required: false,
        builderIncluded: true,
        keySummary: "Embeddings provider key",
        why: "Embeddings improve semantic search. Keyword search still works without them.",
      },
      {
        id: "source-connections",
        label: "Source connections",
        required: false,
        builderIncluded: false,
        keySummary: "Connect a source in Settings",
        why: "Only needed for the sources you want to ingest into your knowledge base.",
      },
    ],
  },
  calendar: {
    appId: "calendar",
    appName: "Calendar",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "google-calendar",
        label: "Google Calendar",
        required: false,
        builderIncluded: false,
        keySummary: "Connect Google Calendar",
        why: "Calendar access is an OAuth connection, not an API key to paste.",
      },
      {
        id: "calendar-connectors",
        label: "Other calendar connections",
        required: false,
        builderIncluded: false,
        keySummary: "Connect optional calendar services",
        why: "Only needed for the provider features you turn on.",
      },
    ],
  },
  chat: {
    appId: "chat",
    appName: "Chat",
    capabilities: [LLM_CAPABILITY],
  },
  clips: {
    appId: "clips",
    appName: "Clips",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "transcription",
        label: "Transcription",
        required: false,
        builderIncluded: true,
        keySummary: "Speech-to-text provider key",
        why: "Transcription powers captions, titles, summaries, and searchable chapters. Native capture still works without it.",
      },
    ],
  },
  content: {
    appId: "content",
    appName: "Content",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "media-storage",
        label: "Media storage",
        required: false,
        builderIncluded: true,
        keySummary: "Builder or S3-compatible storage",
        why: "Only needed for documents that contain uploaded images, video, or audio.",
      },
      {
        id: "notion",
        label: "Notion",
        required: false,
        builderIncluded: false,
        keySummary: "Connect Notion",
        why: "Only needed if you want to import or sync workspace content from Notion.",
      },
    ],
  },
  crm: {
    appId: "crm",
    appName: "CRM",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "crm-connection",
        label: "CRM connection",
        required: false,
        builderIncluded: false,
        keySummary: "Connect HubSpot or Salesforce",
        why: "Connections are shared securely with CRM; no provider token needs to be pasted here.",
      },
    ],
  },
  design: {
    appId: "design",
    appName: "Design",
    capabilities: [
      LLM_CAPABILITY,
      DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY,
      {
        id: "assets-library",
        label: "Assets library",
        required: false,
        builderIncluded: true,
        keySummary: "Connect Assets",
        why: "Only needed when designs use managed images or other media assets.",
      },
      {
        id: "figma",
        label: "Figma",
        required: false,
        builderIncluded: false,
        keySummary: "Figma access token",
        why: "Only needed to read or update files in Figma.",
      },
      {
        id: "github",
        label: "GitHub",
        required: false,
        builderIncluded: false,
        keySummary: "GitHub access token",
        why: "Only needed when designs are connected to a repository.",
      },
    ],
  },
  dispatch: {
    appId: "dispatch",
    appName: "Dispatch",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "workspace-connections",
        label: "Workspace connections",
        required: false,
        builderIncluded: false,
        keySummary: "Connect providers from Settings",
        why: "Dispatch uses shared connections so provider tokens never need to be pasted into this app.",
      },
    ],
  },
  factory: {
    appId: "factory",
    appName: "Factory",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "builder-executor",
        label: "Builder executor",
        required: true,
        builderIncluded: true,
        keySummary: "Builder-managed agent runs",
        why: "The executor runs approved code and review workflows for Factory items.",
      },
      {
        id: "triage-connections",
        label: "Triage connections",
        required: false,
        builderIncluded: false,
        keySummary: "Connect GitHub, Slack, or Sentry",
        why: "Only needed for the feedback source you want Factory to monitor.",
      },
    ],
  },
  forms: {
    appId: "forms",
    appName: "Forms",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "file-storage",
        label: "File storage",
        required: false,
        builderIncluded: true,
        keySummary: "Builder or S3-compatible storage",
        why: "Text-only forms work without storage. Add it when a form accepts file uploads.",
      },
    ],
  },
  macros: {
    appId: "macros",
    appName: "Macros",
    capabilities: [LLM_CAPABILITY, VOICE_INPUT_CAPABILITY],
  },
  mail: {
    appId: "mail",
    appName: "Mail",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "gmail",
        label: "Gmail",
        required: true,
        builderIncluded: false,
        keySummary: "Connect Gmail",
        why: "Mail uses the workspace's managed Google connection; no key is pasted here.",
      },
      {
        id: "attachment-storage",
        label: "Attachment storage",
        required: false,
        builderIncluded: true,
        keySummary: "Builder or S3-compatible storage",
        why: "Only needed when attachments need to be retained outside Gmail.",
      },
    ],
  },
  plan: {
    appId: "plan",
    appName: "Plan",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "plan-assets",
        label: "Plan asset storage",
        required: false,
        builderIncluded: true,
        keySummary: "Builder or S3-compatible storage",
        why: "Only needed for screenshots and other visual plan assets.",
      },
      {
        id: "google-sign-in",
        label: "Google sign-in",
        required: false,
        builderIncluded: false,
        keySummary: "Google OAuth client",
        why: "Only needed when Google sign-in is enabled for the deployment.",
      },
    ],
  },
  slides: {
    appId: "slides",
    appName: "Slides",
    capabilities: [
      LLM_CAPABILITY,
      DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY,
      {
        id: "image-generation",
        label: "Image generation",
        required: false,
        builderIncluded: true,
        keySummary: "Gemini or OpenAI key",
        why: "Only needed when slides generate images instead of using uploaded assets.",
      },
      {
        id: "reference-storage",
        label: "Reference file storage",
        required: false,
        builderIncluded: true,
        keySummary: "Builder or S3-compatible storage",
        why: "Only needed for uploaded reference files and presentation assets.",
      },
      {
        id: "google-docs",
        label: "Google Docs",
        required: false,
        builderIncluded: false,
        keySummary: "Connect Google Docs",
        why: "Only needed to import source material from Google Drive or Docs.",
      },
    ],
  },
  tasks: {
    appId: "tasks",
    appName: "Tasks",
    capabilities: [LLM_CAPABILITY],
  },
};

const FALLBACK_PROFILE: OnboardingAppProfile = {
  appId: "app",
  appName: "Your app",
  capabilities: [LLM_CAPABILITY],
};

function normalizeAppId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "app";
  return (
    normalized
      .replace(/^@[^/]+\//, "")
      .replace(/^agent-native-/, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "app"
  );
}

export function resolveOnboardingAppId(explicit?: string): string {
  return normalizeAppId(
    explicit ?? getAppConfig().app.id ?? getAppConfig().app.packageName,
  );
}

export function getOnboardingAppProfile(appId?: string): OnboardingAppProfile {
  const resolvedId = resolveOnboardingAppId(appId);
  const profile = PROFILES[resolvedId] ?? FALLBACK_PROFILE;
  const appCapabilities = profile.capabilities.filter(
    (capability) =>
      capability.id !== "llm" &&
      capability.id !== FILE_UPLOAD_STORAGE_CAPABILITY.id &&
      capability.id !== VOICE_INPUT_CAPABILITY.id,
  );
  const configuredLlm = profile.capabilities.find(
    (capability) => capability.id === "llm",
  );
  const configuredStorage = profile.capabilities.find(
    (capability) => capability.id === FILE_UPLOAD_STORAGE_CAPABILITY.id,
  );
  const configuredVoiceInput = profile.capabilities.find(
    (capability) => capability.id === VOICE_INPUT_CAPABILITY.id,
  );
  const storageRequired =
    resolvedId === "clips" || Boolean(configuredStorage?.required);
  const capabilities = [
    {
      ...(configuredLlm ?? LLM_CAPABILITY),
      required: true,
      suggested: false,
    },
    {
      ...(configuredStorage ?? FILE_UPLOAD_STORAGE_CAPABILITY),
      required: storageRequired,
      suggested: !storageRequired,
    },
    {
      ...(configuredVoiceInput ?? VOICE_INPUT_CAPABILITY),
      required: false,
      suggested: true,
    },
    ...appCapabilities.map((capability) => ({ ...capability })),
  ];
  return {
    ...profile,
    capabilities,
  };
}
