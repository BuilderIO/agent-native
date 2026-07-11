export interface AuthMarketingContent {
  appName: string;
  tagline: string;
  description?: string;
  features?: string[];
  runLocalCommand?: string;
  signupLocalModeNote?: {
    text: string;
    command: string;
  };
}

const PLAN_LOCAL_FILES_COMMAND =
  "npx @agent-native/core@latest skills add visual-plan --mode local-files --scope user";

export interface ResolveBuiltInAuthMarketingOptions {
  requestHost?: string;
  requestPath?: string;
}

export const BUILT_IN_AUTH_MARKETING: Record<string, AuthMarketingContent> = {
  analytics: {
    appName: "Agent-Native Analytics",
    tagline:
      "Your AI agent queries your data sources, builds dashboards, and answers business questions alongside you.",
    features: [
      "Ask any question and get answers from BigQuery, HubSpot, Jira, and more",
      "Agent-built dashboards that pull live data from all your sources",
      "Saved analyses the agent can re-run on demand with fresh numbers",
    ],
  },
  brain: {
    appName: "Agent-Native Brain",
    tagline:
      "A company memory layer where raw conversations become reviewed, searchable institutional knowledge.",
    features: [
      "Import transcripts, notes, Slack exports, and Granola summaries",
      "Validate every fact against exact source quotes",
      "Review company-wide knowledge through proposal workflows",
    ],
  },
  calendar: {
    appName: "Agent-Native Calendar",
    tagline:
      "Your AI agent schedules, reschedules, and manages your calendar so you never have to.",
    features: [
      "Finds open slots and books meetings on your behalf",
      "Manages availability and booking links automatically",
      "Answers schedule questions and resolves conflicts instantly",
    ],
  },
  clips: {
    appName: "Agent-Native Clips",
    tagline:
      "Your AI agent transcribes, summarizes, and searches everything you record alongside you.",
    features: [
      "One-click screen recording with automatic titles, summaries, and chapters",
      "Calendar-synced meeting notes with live transcripts and action items",
      "One searchable library across recordings, meetings, and dictations",
    ],
  },
  content: {
    appName: "Agent-Native Content",
    tagline:
      "Open-source Obsidian for MDX: your AI agent edits local docs, creates custom blocks, and organizes everything alongside you.",
    features: [
      "Edit local Markdown/MDX files directly, with hosted sync when you need it",
      "Generate rich interactive custom MDX blocks and edit their props visually",
      "Search, summarize, cross-reference, and restructure document trees instantly",
    ],
  },
  plan: {
    appName: "Agent-Native Plan",
    tagline:
      "Visual plans, PR recaps, diagrams, wireframes, and shareable reviews for coding-agent work.",
    features: [
      "Turn implementation plans into structured visual artifacts",
      "Review PR recaps with diagrams, file maps, and annotated code",
      "Share links for async comments and product review",
    ],
    runLocalCommand: PLAN_LOCAL_FILES_COMMAND,
    signupLocalModeNote: {
      text: "Prefer no account or self-hosting? Switch /visual-plan to local files only:",
      command: PLAN_LOCAL_FILES_COMMAND,
    },
  },
  design: {
    appName: "Agent-Native Design",
    tagline:
      "Design and prototype by describing what you want. The AI agent turns your ideas into interactive, fully responsive designs in seconds.",
    features: [
      "Create polished prototypes just by describing them",
      "Build and apply design systems to keep everything on-brand",
      "Export your work or share it with a link",
    ],
  },
  dispatch: {
    appName: "Agent-Native Dispatch",
    tagline:
      "Your AI agent manages secrets, orchestrates other agents, and routes messages across your workspace.",
    features: [
      "Centralized vault for secrets with granular per-app grants",
      "Cross-agent orchestration and delegation to specialist apps",
      "Slack and Telegram routing with approval workflows",
    ],
  },
  forms: {
    appName: "Agent-Native Forms",
    tagline:
      "Your AI agent builds, publishes, and analyzes forms alongside you.",
    features: [
      "Create complete forms from a single sentence",
      "Instant publishing with shareable links and captcha",
      "Response summaries, exports, and trend analysis on demand",
    ],
  },
  assets: {
    appName: "Agent-Native Assets",
    tagline:
      "Your AI agent creates, refines, and organizes on-brand assets alongside you.",
    features: [
      "Build reusable asset libraries from logos, product shots, videos, and references",
      "Generate heroes, diagrams, slide art, product visuals, and videos from a prompt",
      "Audit prompts, references, outputs, and refinements across every run",
    ],
  },
  mail: {
    appName: "Agent-Native Mail",
    tagline: "Your AI agent reads, drafts, and organizes email alongside you.",
    features: [
      "Replies that match your tone and style",
      "Multi-account Gmail in a single unified inbox",
      "Autonomous triage, archiving, and follow-ups",
    ],
    runLocalCommand:
      "npx @agent-native/core@latest create my-mail-app --template mail",
  },
  slides: {
    appName: "Agent-Native Slides",
    tagline:
      "Your AI agent builds, edits, and refines presentations alongside you.",
    features: [
      "Generate entire decks from a single prompt",
      "Surgical slide edits while you present or review",
      "Real-time collaboration between you and the agent",
    ],
  },
  chat: {
    appName: "Agent-Native Chat",
    tagline:
      "Start from a chat-first app and add actions, screens, and workflows as your agent grows.",
    features: [
      "Full-page chat with durable threads and tool call history",
      "Actions work from chat, UI, HTTP, MCP, A2A, and CLI",
      "Use the built-in app-agent loop or plug in your own agent backend",
    ],
  },
};

const SLUG_ALIASES: Record<string, string> = {
  "agent-native": "",
  "blank-app": "chat",
  starter: "chat",
  asset: "assets",
  image: "assets",
  images: "assets",
};

function cloneMarketing(marketing: AuthMarketingContent): AuthMarketingContent {
  return {
    ...marketing,
    features: marketing.features ? [...marketing.features] : undefined,
    signupLocalModeNote: marketing.signupLocalModeNote
      ? { ...marketing.signupLocalModeNote }
      : undefined,
  };
}

function normalizeSlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let slug = value.trim().toLowerCase();
  if (!slug) return undefined;

  slug = slug.replace(/^@agent-native\//, "");
  slug = slug
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  slug = slug.replace(/^agent-native-/, "");
  slug = SLUG_ALIASES[slug] ?? slug;
  if (!slug) return undefined;
  return BUILT_IN_AUTH_MARKETING[slug] ? slug : undefined;
}

function slugFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return slugFromHost(url.host) ?? slugFromPath(url.pathname);
  } catch {
    return undefined;
  }
}

function slugFromHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const host = value.split(",")[0]?.trim().split(":")[0]?.toLowerCase();
  if (!host) return undefined;
  if (host.endsWith(".agent-native.com")) {
    return normalizeSlug(host.slice(0, -".agent-native.com".length));
  }
  return undefined;
}

function slugFromPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const firstSegment = value.split("?")[0]?.split("/").filter(Boolean)[0];
  return normalizeSlug(firstSegment);
}

function candidateSlugs(
  opts: ResolveBuiltInAuthMarketingOptions = {},
): string[] {
  const env = process.env;
  const candidates = [
    opts.requestHost ? slugFromHost(opts.requestHost) : undefined,
    opts.requestPath ? slugFromPath(opts.requestPath) : undefined,
    normalizeSlug(env.AGENT_NATIVE_TEMPLATE),
    normalizeSlug(env.APP_NAME),
    normalizeSlug(env.npm_package_name),
    slugFromPath(env.APP_BASE_PATH),
    slugFromPath(env.VITE_APP_BASE_PATH),
    slugFromUrl(env.APP_URL),
    slugFromUrl(env.BETTER_AUTH_URL),
    slugFromUrl(env.VITE_BETTER_AUTH_URL),
    slugFromUrl(env.URL),
    slugFromUrl(env.DEPLOY_URL),
    slugFromUrl(env.DEPLOY_PRIME_URL),
  ];

  return candidates.filter((slug): slug is string => !!slug);
}

export function resolveBuiltInAuthMarketing(
  opts: ResolveBuiltInAuthMarketingOptions = {},
): AuthMarketingContent | undefined {
  for (const slug of candidateSlugs(opts)) {
    const marketing = BUILT_IN_AUTH_MARKETING[slug];
    if (marketing) return cloneMarketing(marketing);
  }
  return undefined;
}

export function resolveBuiltInAuthMarketingByName(
  value: string | undefined,
): AuthMarketingContent | undefined {
  const slug = normalizeSlug(value);
  const marketing = slug ? BUILT_IN_AUTH_MARKETING[slug] : undefined;
  return marketing ? cloneMarketing(marketing) : undefined;
}
