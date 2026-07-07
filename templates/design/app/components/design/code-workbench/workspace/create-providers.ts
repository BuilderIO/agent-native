import { createInlineProvider } from "./inline-provider";
import { createLocalhostProvider } from "./localhost-provider";
import type { WorkspaceProvider } from "./types";

export interface CreateWorkspaceProvidersOptions {
  designId: string;
  canEdit: boolean;
  localhostConnections: Array<{
    connectionId: string;
    label: string;
  }>;
}

/**
 * Compose the workspace roots shown in the workbench explorer: the design's
 * SQL-backed files first, then one root per connected local app. Future
 * remote-container sources slot in here as additional providers.
 */
export function createWorkspaceProviders(
  options: CreateWorkspaceProvidersOptions,
): WorkspaceProvider[] {
  const providers: WorkspaceProvider[] = [
    createInlineProvider({
      designId: options.designId,
      canEdit: options.canEdit,
    }),
  ];
  for (const connection of options.localhostConnections) {
    providers.push(
      createLocalhostProvider({
        connectionId: connection.connectionId,
        label: connection.label,
        canEdit: options.canEdit,
        designId: options.designId,
      }),
    );
  }
  return providers;
}
