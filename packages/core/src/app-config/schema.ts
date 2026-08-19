import { z } from "zod";

import { a2aConfig } from "./a2a.js";
import { agentConfig } from "./agent.js";
import { appConfig } from "./app.js";
import { authConfig } from "./auth.js";
import { integrationsConfig } from "./integrations.js";
import { privateBlobConfig } from "./private-blob.js";
import { workspaceConfig } from "./workspace.js";

/**
 * The server-side configurable surface of the framework, in one schema.
 *
 * One object of optional per-domain subobjects. A domain adds a file next to
 * this one and a single line here; nothing else has to learn about it.
 *
 * This object is never serialized. Client-visible configuration is a different
 * object with a different lifetime — `AgentNativeConfig` in `src/config.ts`,
 * resolved at build time and projected into the bundle. Anything that must not
 * reach a browser belongs here, not there.
 */
// Every domain wraps in `.prefault({})`, not `.optional()` or `.default({})`.
// An optional domain never materializes the defaults declared inside it, and
// `.default({})` hands back the literal `{}` without parsing it — both leave
// readers with `undefined` where the type promises a value. `.prefault` runs
// the domain schema over the empty object, so a declared default is there.
export const appConfigSchema = z.object({
  a2a: a2aConfig.prefault({}),
  agent: agentConfig.prefault({}),
  app: appConfig.prefault({}),
  auth: authConfig.prefault({}),
  integrations: integrationsConfig.prefault({}),
  privateBlob: privateBlobConfig.prefault({}),
  workspace: workspaceConfig.prefault({}),
});

/**
 * Accepted by `defineAppConfig`.
 *
 * Distinct from `AppConfig` because a field with `.default()` is optional on
 * the way in and guaranteed present on the way out.
 */
export type AppConfigInput = z.input<typeof appConfigSchema>;

/** Returned by `getAppConfig`, with declared defaults applied. */
export type AppConfig = z.output<typeof appConfigSchema>;
