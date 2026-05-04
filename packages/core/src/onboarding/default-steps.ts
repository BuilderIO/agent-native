/**
 * Default framework-level onboarding steps.
 *
 * Registered when `createOnboardingPlugin()` mounts (auto-mount or explicit).
 * Templates can override any step by registering another step with the same
 * `id` after these have been registered.
 */

import { registerOnboardingStep } from "./registry.js";
import type { OnboardingStep } from "./types.js";
import {
  PROVIDER_ENV_META,
  PROVIDER_ENV_VARS,
} from "../agent/engine/provider-env-vars.js";
import { isAgentEngineSettingConfigured } from "../agent/engine/registry.js";
import { getSetting } from "../settings/store.js";

type LlmKeyMethod = {
  provider: keyof typeof PROVIDER_ENV_META;
  id: string;
  label: string;
  description: string;
  primary?: boolean;
};

const LLM_KEY_METHODS: LlmKeyMethod[] = [
  {
    provider: "anthropic",
    id: "anthropic-key",
    label: "Anthropic",
    description: "Claude models with your own Anthropic key.",
  },
  {
    provider: "openai",
    id: "openai-key",
    label: "OpenAI",
    description: "GPT models with your own OpenAI key.",
  },
  {
    provider: "google",
    id: "google-key",
    label: "Google Gemini",
    description: "Gemini models with your own Google AI key.",
  },
  {
    provider: "openrouter",
    id: "openrouter-key",
    label: "OpenRouter",
    description: "OpenRouter models with your own OpenRouter key.",
  },
  {
    provider: "groq",
    id: "groq-key",
    label: "Groq",
    description: "Groq-hosted models with your own Groq key.",
  },
  {
    provider: "mistral",
    id: "mistral-key",
    label: "Mistral",
    description: "Mistral models with your own Mistral key.",
  },
  {
    provider: "cohere",
    id: "cohere-key",
    label: "Cohere",
    description: "Cohere models with your own Cohere key.",
  },
];

const llmStep: OnboardingStep = {
  id: "llm",
  order: 10,
  required: true,
  title: "Connect an AI engine",
  description: "Use Builder's managed gateway, or bring your own provider key.",
  methods: [
    {
      id: "builder",
      kind: "builder-cli-auth",
      label: "Connect Builder",
      description:
        "Free credits for Claude, GPT, Gemini, and more — no API key needed.",
      primary: true,
      payload: {
        scope: "llm",
      },
    },
    ...LLM_KEY_METHODS.map(({ provider, id, label, description, primary }) => {
      const meta = PROVIDER_ENV_META[provider];
      return {
        id,
        kind: "form" as const,
        label,
        description,
        ...(primary ? { primary: true } : {}),
        payload: {
          writeScope: "workspace" as const,
          fields: [
            {
              key: meta.envVar,
              label: meta.envVar,
              placeholder: meta.placeholder,
              secret: true,
            },
          ],
        },
      };
    }),
  ],
  isComplete: async () => {
    try {
      const { resolveHasBuilderPrivateKey } =
        await import("../server/credential-provider.js");
      if (await resolveHasBuilderPrivateKey()) return true;
    } catch {
      if (process.env.BUILDER_PRIVATE_KEY) return true;
    }
    if (PROVIDER_ENV_VARS.some((k) => !!process.env[k])) return true;
    try {
      return isAgentEngineSettingConfigured(await getSetting("agent-engine"));
    } catch {
      return false;
    }
  },
};

/** Step 2 — where application data lives. The default DB is non-blocking. */
const databaseStep: OnboardingStep = {
  id: "database",
  order: 20,
  required: false,
  title: "Database",
  description:
    "Agent-native stores app data in SQL. Set DATABASE_URL when you want to point this app at a specific database.",
  methods: [
    {
      id: "database-url",
      kind: "form",
      label: "Set DATABASE_URL",
      description: "Paste the SQL connection string this app should use.",
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "DATABASE_URL",
            label: "DATABASE_URL",
            placeholder: "postgres://..., libsql://..., file:./data/app.db",
          },
          {
            key: "DATABASE_AUTH_TOKEN",
            label: "DATABASE_AUTH_TOKEN (if needed)",
            placeholder: "Token for providers such as Turso/libSQL",
            secret: true,
          },
        ],
      },
    },
  ],
  // The default local database means this step is always satisfied.
  isComplete: () => true,
};

/** Step 3 — how users sign in. Built-in account auth is non-blocking. */
const authStep: OnboardingStep = {
  id: "auth",
  order: 30,
  required: false,
  title: "Authentication",
  description:
    "Built-in email/password accounts work by default. Add OAuth or access tokens only if you want another sign-in path.",
  methods: [
    {
      id: "google-oauth",
      kind: "form",
      label: "Google OAuth",
      description: "Add Google as an optional sign-in provider.",
      payload: {
        writeScope: "workspace",
        fields: [
          { key: "GOOGLE_CLIENT_ID", label: "GOOGLE_CLIENT_ID" },
          {
            key: "GOOGLE_CLIENT_SECRET",
            label: "GOOGLE_CLIENT_SECRET",
            secret: true,
          },
        ],
      },
    },
    {
      id: "github-oauth",
      kind: "form",
      label: "GitHub OAuth",
      description: "Add GitHub as an optional sign-in provider.",
      payload: {
        writeScope: "workspace",
        fields: [
          { key: "GITHUB_CLIENT_ID", label: "GITHUB_CLIENT_ID" },
          {
            key: "GITHUB_CLIENT_SECRET",
            label: "GITHUB_CLIENT_SECRET",
            secret: true,
          },
        ],
      },
    },
    {
      id: "access-token",
      kind: "form",
      label: "Shared access token",
      description: "Use a simple token gate for private deployments.",
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "ACCESS_TOKEN",
            label: "ACCESS_TOKEN",
            placeholder: "Paste a strong shared token",
            secret: true,
          },
        ],
      },
    },
  ],
  isComplete: () => true,
};

/** Step 4 — transactional email (password resets, invitations). Optional. */
const emailStep: OnboardingStep = {
  id: "email",
  order: 40,
  required: false,
  title: "Email delivery",
  description:
    "Optional for local work. Before deploying with password resets, invitations, or share notifications, connect an email provider.",
  methods: [
    {
      id: "resend",
      kind: "form",
      label: "Resend",
      description: "Use Resend for transactional email.",
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "RESEND_API_KEY",
            label: "RESEND_API_KEY",
            placeholder: "re_...",
            secret: true,
          },
          {
            key: "EMAIL_FROM",
            label: "EMAIL_FROM (from address)",
            placeholder: "Agent Native <noreply@yourdomain.com>",
          },
          {
            key: "APP_NAME",
            label: "APP_NAME (shown in invite emails)",
            placeholder: "Acme Forms",
          },
        ],
      },
    },
    {
      id: "sendgrid",
      kind: "form",
      label: "SendGrid",
      description: "Use SendGrid for transactional email.",
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "SENDGRID_API_KEY",
            label: "SENDGRID_API_KEY",
            placeholder: "SG....",
            secret: true,
          },
          {
            key: "EMAIL_FROM",
            label: "EMAIL_FROM (from address)",
            placeholder: "Agent Native <noreply@yourdomain.com>",
          },
        ],
      },
    },
  ],
  isComplete: () => {
    if (process.env.RESEND_API_KEY) return true;
    // SendGrid rejects Resend's sandbox sender, so EMAIL_FROM must also be
    // set — otherwise sendEmail() throws at runtime even though the API key
    // is configured.
    if (process.env.SENDGRID_API_KEY) return !!process.env.EMAIL_FROM;
    return false;
  },
};

let registered = false;

/** Idempotent. Safe to call from every plugin-mount call. */
export function registerDefaultOnboardingSteps(): void {
  if (registered) return;
  registered = true;
  registerOnboardingStep(llmStep);
  registerOnboardingStep(databaseStep);
  registerOnboardingStep(authStep);
  registerOnboardingStep(emailStep);
}
