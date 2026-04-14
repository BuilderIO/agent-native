/**
 * Default framework-level onboarding steps.
 *
 * Registered when `createOnboardingPlugin()` mounts (auto-mount or explicit).
 * Templates can override any step by registering another step with the same
 * `id` after these have been registered.
 */

import { registerOnboardingStep } from "./registry.js";
import type { OnboardingStep } from "./types.js";

/** Step 1 — an LLM must be reachable for the agent chat to work. */
const llmStep: OnboardingStep = {
  id: "llm",
  order: 10,
  required: true,
  title: "Connect an AI engine",
  description: "Agent-native needs an LLM to power the agent chat.",
  methods: [
    {
      id: "anthropic-key",
      kind: "form",
      label: "Use your Anthropic API key",
      description: "Paste a key — stored locally in your .env file.",
      primary: true,
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "ANTHROPIC_API_KEY",
            label: "ANTHROPIC_API_KEY",
            placeholder: "sk-ant-...",
            secret: true,
          },
        ],
      },
    },
    {
      id: "builder",
      kind: "builder-cli-auth",
      // TODO: expand scope to "llm" once the Builder LLM gateway ships so
      // connecting Builder also provisions a managed model.
      label: "Connect Builder",
      description: "Unlocks LLM + browser automation + more. Free during beta.",
      badge: "free",
      payload: { scope: "browser" },
    },
  ],
  isComplete: () =>
    !!process.env.ANTHROPIC_API_KEY || !!process.env.BUILDER_PRIVATE_KEY,
};

/** Step 2 — where application data lives. SQLite default means non-blocking. */
const databaseStep: OnboardingStep = {
  id: "database",
  order: 20,
  required: false,
  title: "Database",
  description: "Where your app data lives.",
  methods: [
    {
      id: "sqlite-default",
      kind: "link",
      label: "Use SQLite (default)",
      description: "Zero setup, local dev only.",
      primary: true,
      payload: { url: "#" },
    },
    {
      id: "postgres-url",
      kind: "form",
      label: "Use Postgres / Neon",
      description: "Paste a DATABASE_URL for any SQL-compatible provider.",
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "DATABASE_URL",
            label: "DATABASE_URL",
            placeholder: "postgres://user:pass@host/db",
          },
        ],
      },
    },
  ],
  // SQLite default means this step is always satisfied — never blocks setup.
  isComplete: () => true,
};

/** Step 3 — how users sign in. Dev-mode keeps solo local workflows easy. */
const authStep: OnboardingStep = {
  id: "auth",
  order: 30,
  required: false,
  title: "Authentication",
  description: "How users sign in. Dev mode is fine for local work.",
  methods: [
    {
      id: "local-dev",
      kind: "link",
      label: "Use local mode (dev)",
      description: "Solo dev with no login step.",
      primary: true,
      payload: { url: "#" },
    },
    {
      id: "better-auth-google",
      kind: "form",
      label: "Sign in with Google",
      description: "Paste Google OAuth credentials (client ID + secret).",
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
  ],
  isComplete: () => {
    if (process.env.AUTH_MODE === "local") return true;
    if (process.env.ACCESS_TOKEN || process.env.ACCESS_TOKENS) return true;
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  },
};

/** Step 4 — transactional email (password resets, invitations). Optional. */
const emailStep: OnboardingStep = {
  id: "email",
  order: 40,
  required: false,
  title: "Email delivery",
  description:
    "Needed to send password reset links and future invitation emails. Without a provider, reset emails are logged to the server console.",
  methods: [
    {
      id: "resend",
      kind: "form",
      label: "Use Resend",
      description: "Paste an API key from resend.com.",
      primary: true,
      badge: "recommended",
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
        ],
      },
    },
    {
      id: "sendgrid",
      kind: "form",
      label: "Use SendGrid",
      description: "Paste an API key from sendgrid.com.",
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
