import { getAppConfig } from "../app-config/index.js";
import type { OnboardingCapability, OnboardingAppProfile } from "./types.js";

const LLM_CAPABILITY: OnboardingCapability = {
  id: "llm",
  label: "AI model",
  required: true,
  builderIncluded: true,
  keySummary:
    "One model key or local connection: Anthropic, OpenAI, OpenRouter, Gemini, Groq, Mistral, Cohere, or Ollama",
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
  keySummary:
    "Builder file storage or an S3-compatible bucket, credentials, and public base URL",
  why: "Uploaded images and files need durable object storage so the agent can reuse them throughout a thread.",
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
        keySummary: "Connectors are added individually in Settings",
        why: "Only needed for the services you want to query, such as GA4, Stripe, or HubSpot.",
      },
      {
        id: "replay-storage",
        label: "Replay storage",
        required: false,
        builderIncluded: true,
        keySummary: "S3-compatible bucket, access key, and secret",
        why: "Only needed when session replay is enabled so recordings can be stored.",
      },
    ],
  },
  assets: {
    appId: "assets",
    appName: "Assets",
    capabilities: [
      {
        id: "media-generation",
        label: "Image and video generation",
        required: true,
        builderIncluded: true,
        keySummary: "Gemini for video, or OpenAI / Gemini for images",
        why: "These providers create the images and videos requested in the app.",
      },
      DESIGN_SYSTEM_INTELLIGENCE_CAPABILITY,
      {
        id: "file-storage",
        label: "Media storage",
        required: true,
        builderIncluded: true,
        keySummary: "S3-compatible endpoint, bucket, access key, and secret",
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
        keySummary: "Gemini, Cohere, or Voyage key",
        why: "Embeddings improve semantic search. Keyword search still works without them.",
      },
      {
        id: "source-connections",
        label: "Source connections",
        required: false,
        builderIncluded: false,
        keySummary: "Slack, Granola, or GitHub connection",
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
        keySummary: "Connect Google Calendar with OAuth",
        why: "Calendar access is an OAuth connection, not an API key to paste.",
      },
      {
        id: "calendar-connectors",
        label: "Other calendar connections",
        required: false,
        builderIncluded: false,
        keySummary: "Zoom, CRM, or enrichment connection",
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
        id: "video-storage",
        label: "Video storage",
        required: true,
        builderIncluded: true,
        keySummary: "S3 endpoint, bucket, access key, and secret",
        why: "Recorded videos need durable storage before they can be played back or shared.",
      },
      {
        id: "transcription",
        label: "Transcription",
        required: false,
        builderIncluded: true,
        keySummary: "Groq or Google Speech key",
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
        keySummary: "Builder file storage or S3-compatible storage",
        why: "Only needed for documents that contain uploaded images, video, or audio.",
      },
      {
        id: "notion",
        label: "Notion",
        required: false,
        builderIncluded: false,
        keySummary: "Connect Notion with OAuth",
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
        keySummary: "Connect the Assets app",
        why: "Only needed when designs use managed images or other media assets.",
      },
      {
        id: "figma",
        label: "Figma",
        required: false,
        builderIncluded: false,
        keySummary: "Figma personal access token",
        why: "Only needed to read or update files in Figma.",
      },
      {
        id: "github",
        label: "GitHub",
        required: false,
        builderIncluded: false,
        keySummary: "GitHub token",
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
        keySummary: "Connect providers from the workspace registry",
        why: "Dispatch uses shared connections so provider tokens never need to be pasted into this app.",
      },
    ],
  },
  factory: {
    appId: "factory",
    appName: "Factory",
    capabilities: [
      {
        id: "builder-executor",
        label: "Builder executor",
        required: true,
        builderIncluded: true,
        keySummary:
          "Connect Builder for managed agent runs (free tier available)",
        why: "The executor runs approved code and review workflows for Factory items.",
      },
      {
        id: "triage-connections",
        label: "Triage connections",
        required: false,
        builderIncluded: false,
        keySummary: "GitHub, Slack, or Sentry connection",
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
        keySummary: "Builder file storage or S3-compatible storage",
        why: "Text-only forms work without storage. Add it when a form accepts file uploads.",
      },
    ],
  },
  macros: {
    appId: "macros",
    appName: "Macros",
    capabilities: [
      LLM_CAPABILITY,
      {
        id: "transcription",
        label: "Transcription",
        required: false,
        builderIncluded: true,
        keySummary: "Groq or Google Speech key",
        why: "Voice input uses transcription. Text entry always works without it.",
      },
    ],
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
        keySummary: "Google OAuth client ID and secret",
        why: "Mail needs OAuth access to read, send, and organize the mailbox.",
      },
      {
        id: "attachment-storage",
        label: "Attachment storage",
        required: false,
        builderIncluded: true,
        keySummary: "Builder file storage or S3-compatible storage",
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
        keySummary: "Builder file storage or S3-compatible storage",
        why: "Only needed for screenshots and other visual plan assets.",
      },
      {
        id: "google-sign-in",
        label: "Google sign-in",
        required: false,
        builderIncluded: false,
        keySummary: "Google OAuth client ID and secret",
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
        keySummary: "Builder file storage or S3-compatible storage",
        why: "Only needed for uploaded reference files and presentation assets.",
      },
      {
        id: "google-docs",
        label: "Google Docs",
        required: false,
        builderIncluded: false,
        keySummary: "Connect Google Docs with OAuth",
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
  const capabilities = profile.capabilities.some(
    (capability) => capability.id === FILE_UPLOAD_STORAGE_CAPABILITY.id,
  )
    ? profile.capabilities.map((capability) =>
        capability.id === FILE_UPLOAD_STORAGE_CAPABILITY.id
          ? {
              ...FILE_UPLOAD_STORAGE_CAPABILITY,
              // Assets and other domain-specific profiles can still make
              // storage required while sharing the framework-wide contract.
              required: capability.required,
              builderIncluded: capability.builderIncluded,
            }
          : { ...capability },
      )
    : profile.capabilities.flatMap((capability, index) =>
        index === 0
          ? [{ ...capability }, { ...FILE_UPLOAD_STORAGE_CAPABILITY }]
          : [{ ...capability }],
      );
  return {
    ...profile,
    capabilities,
  };
}
