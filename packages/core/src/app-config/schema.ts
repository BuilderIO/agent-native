import { z } from "zod";

import { a2aConfig } from "./a2a.js";
import { accessConfig } from "./access.js";
import { agentConfig } from "./agent.js";
import { analyticsConfig } from "./analytics.js";
import { appConfig } from "./app.js";
import { authConfig } from "./auth.js";
import { clipsConfig } from "./clips.js";
import { decisionsConfig } from "./decisions.js";
import { dispatchConfig } from "./dispatch.js";
import { extensionsConfig } from "./extensions.js";
import { hostedStorageConfig } from "./hosted-storage.js";
import { integrationsConfig } from "./integrations.js";
import { launchDarklyConfig } from "./launchdarkly.js";
import { mcpConfig } from "./mcp.js";
import { migrationConfig } from "./migration.js";
import { nativeCapabilities } from "./native-capabilities.js";
import { observabilityConfig } from "./observability.js";
import { onboardingConfig } from "./onboarding.js";
import { openAiAppsConfig } from "./openai-apps.js";
import { pluginsConfig } from "./plugins.js";
import { privateBlobConfig } from "./private-blob.js";
import { runtimeConfig } from "./runtime.js";
import { testIdentityConfig } from "./test-identity.js";
import { workspaceConfig } from "./workspace.js";

export const nativeCapabilitySchema = z.enum(nativeCapabilities);

const nativeId = z.string().min(1);
const nativeRoute = z.string().startsWith("/");
export const nativeManifestSchema = z.strictObject({
  uses: z.array(nativeCapabilitySchema),
  menubar: z
    .strictObject({
      id: nativeId,
      icon: nativeId,
      popover: nativeRoute,
      size: z.tuple([z.number().positive(), z.number().positive()]),
    })
    .optional(),
  hotkeys: z
    .array(
      z.strictObject({ id: nativeId, default: nativeId, action: nativeId }),
    )
    .optional(),
  surfaces: z
    .array(
      z.strictObject({
        id: nativeId,
        route: nativeRoute,
        kind: z.enum(["overlay", "window"]),
        excludeFromCapture: z.boolean().optional(),
        clickThrough: z.boolean().optional(),
      }),
    )
    .optional(),
  background: z
    .strictObject({
      keepAlive: z.boolean().optional(),
      launchAtLogin: z.union([z.boolean(), z.literal("ask")]).optional(),
    })
    .optional(),
  extensions: z
    .array(z.strictObject({ id: nativeId, version: nativeId }))
    .optional(),
});
export type NativeManifest = z.infer<typeof nativeManifestSchema>;

export const appConfigSchema = z.object({
  a2a: a2aConfig.prefault({}),
  access: accessConfig.prefault({}),
  agent: agentConfig.prefault({}),
  analytics: analyticsConfig.prefault({}),
  app: appConfig.prefault({}),
  auth: authConfig.prefault({}),
  clips: clipsConfig.prefault({}),
  decisions: decisionsConfig.prefault({}),
  dispatch: dispatchConfig.prefault({}),
  extensions: extensionsConfig.prefault({}),
  hostedStorage: hostedStorageConfig.prefault({}),
  integrations: integrationsConfig.prefault({}),
  launchDarkly: launchDarklyConfig.prefault({}),
  mcp: mcpConfig.prefault({}),
  migration: migrationConfig.prefault({}),
  native: nativeManifestSchema.optional(),
  observability: observabilityConfig.prefault({}),
  onboarding: onboardingConfig.prefault({}),
  openAiApps: openAiAppsConfig.prefault({}),
  plugins: pluginsConfig.prefault({}),
  privateBlob: privateBlobConfig.prefault({}),
  runtime: runtimeConfig.prefault({}),
  testIdentity: testIdentityConfig.prefault({}),
  workspace: workspaceConfig.prefault({}),
});

export type AppConfigInput = z.input<typeof appConfigSchema>;

export type AppConfig = z.output<typeof appConfigSchema>;
