import { runMigrations } from "@agent-native/core/db";
import {
  registerPackageActions,
  type NitroPluginDef,
} from "@agent-native/core/server";
import { registerShareableResource } from "@agent-native/core/sharing";
import { registerWorkspaceConnectionLifecycleListener } from "@agent-native/core/workspace-connections";

import { creativeContextActions } from "../actions/index.js";
import { createDefaultContextConnectorExecutionContext } from "../connectors/index.js";
import type { ContextConnectorExecutionContext } from "../connectors/types.js";
import {
  createCreativeContextWorkerPlugin,
  registerCreativeContextImportContinuationDispatcher,
  type CreativeContextImportContinuationDispatcher,
} from "../jobs/index.js";
import * as schema from "../schema/index.js";
import { creativeContextMigrations } from "../schema/migrations.js";
import { handleWorkspaceConnectionLifecycle } from "../store/index.js";
import {
  configureCreativeContext,
  getCreativeContext,
  type CreativeContextServerContext,
} from "./context.js";
import { createCreativeContextMediaPlugin } from "./media.js";
import { registerCreativeContextPromptProvider } from "./prompt-provider.js";
import { getCreativeContextResourcePath } from "./resource-paths.js";

export interface CreativeContextSetupOptions extends Partial<
  Omit<CreativeContextServerContext, "connectorContext">
> {
  appId?: string;
  connectorContext?: Partial<ContextConnectorExecutionContext>;
  continuationDispatcher?: CreativeContextImportContinuationDispatcher;
}

registerPackageActions(creativeContextActions);
registerWorkspaceConnectionLifecycleListener(async (event) => {
  await handleWorkspaceConnectionLifecycle(event);
});

function registerCreativeContextShareables(): void {
  const getDb = () => getCreativeContext().getDb();
  registerShareableResource({
    type: "creative-context",
    resourceTable: schema.creativeContexts,
    sharesTable: schema.creativeContextShares,
    displayName: "Creative context",
    titleColumn: "name",
    getResourcePath: getCreativeContextResourcePath,
    getDb,
    allowPublic: false,
    requireOrgMemberForUserShares: true,
  });
  registerShareableResource({
    type: "creative-context-source",
    resourceTable: schema.contextSources,
    sharesTable: schema.contextSourceShares,
    displayName: "Creative context source",
    titleColumn: "name",
    getResourcePath: getCreativeContextResourcePath,
    getDb,
    allowPublic: false,
  });
  registerShareableResource({
    type: "creative-context-brand",
    resourceTable: schema.brandProfiles,
    sharesTable: schema.brandProfileShares,
    displayName: "Brand profile",
    titleColumn: "name",
    getResourcePath: getCreativeContextResourcePath,
    getDb,
    allowPublic: false,
  });
  registerShareableResource({
    type: "creative-context-pack",
    resourceTable: schema.contextPacks,
    sharesTable: schema.contextPackShares,
    displayName: "Creative context pack",
    titleColumn: "name",
    getResourcePath: getCreativeContextResourcePath,
    getDb,
    allowPublic: false,
  });
}

registerCreativeContextShareables();

const creativeContextDbPlugin = runMigrations(
  creativeContextMigrations as Parameters<typeof runMigrations>[0],
  { table: "creative_context_migrations" },
);

export function setupCreativeContext(
  options: CreativeContextSetupOptions = {},
): NitroPluginDef {
  const appId = options.appId ?? "creative-context";
  const defaultConnectorContext = createDefaultContextConnectorExecutionContext(
    { appId },
  );
  configureCreativeContext({
    getDb: options.getDb,
    schema: options.schema,
    vectorAdapter: options.vectorAdapter,
    connectors: options.connectors,
    projections: options.projections,
    enrichment: options.enrichment,
    connectorContext: {
      ...defaultConnectorContext,
      ...options.connectorContext,
      appId,
    },
  });
  registerCreativeContextShareables();
  registerCreativeContextPromptProvider();
  if (options.continuationDispatcher) {
    registerCreativeContextImportContinuationDispatcher(
      options.continuationDispatcher,
    );
  }
  const workerPlugin = createCreativeContextWorkerPlugin({
    appId,
    registerDispatcher: !options.continuationDispatcher,
  });
  const mediaPlugin = createCreativeContextMediaPlugin();
  return async (nitroApp) => {
    await creativeContextDbPlugin(nitroApp);
    await workerPlugin(nitroApp);
    await mediaPlugin(nitroApp);
  };
}

export { creativeContextDbPlugin };
export * from "./brand-context.js";
export * from "./context.js";
export * from "./generation-context.js";
export * from "./enrichment.js";
export * from "./prompt-provider.js";
export * from "./retrieval.js";
export * from "./untrusted-reference.js";
export * from "./media.js";
export * from "./native-resource-capture.js";
export {
  CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE,
  CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
  createCreativeContextWorkerPlugin,
} from "../jobs/index.js";
