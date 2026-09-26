import { z } from "zod";

import { a2aConfig } from "./a2a.js";
import { accessConfig } from "./access.js";
import { agentConfig } from "./agent.js";
import { analyticsConfig } from "./analytics.js";
import { appConfig } from "./app.js";
import { authConfig } from "./auth.js";
import { integrationsConfig } from "./integrations.js";
import { launchDarklyConfig } from "./launchdarkly.js";
import { migrationConfig } from "./migration.js";
import { observabilityConfig } from "./observability.js";
import { onboardingConfig } from "./onboarding.js";
import { pluginsConfig } from "./plugins.js";
import { privateBlobConfig } from "./private-blob.js";
import { runtimeConfig } from "./runtime.js";
import { workspaceConfig } from "./workspace.js";

export const appConfigSchema = z.object({
  a2a: a2aConfig.prefault({}),
  access: accessConfig.prefault({}),
  agent: agentConfig.prefault({}),
  analytics: analyticsConfig.prefault({}),
  app: appConfig.prefault({}),
  auth: authConfig.prefault({}),
  integrations: integrationsConfig.prefault({}),
  launchDarkly: launchDarklyConfig.prefault({}),
  migration: migrationConfig.prefault({}),
  observability: observabilityConfig.prefault({}),
  onboarding: onboardingConfig.prefault({}),
  plugins: pluginsConfig.prefault({}),
  privateBlob: privateBlobConfig.prefault({}),
  runtime: runtimeConfig.prefault({}),
  workspace: workspaceConfig.prefault({}),
});

export type AppConfigInput = z.input<typeof appConfigSchema>;

export type AppConfig = z.output<typeof appConfigSchema>;
