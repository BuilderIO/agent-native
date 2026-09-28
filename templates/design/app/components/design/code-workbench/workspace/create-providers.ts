import { createInlineProvider } from "./inline-provider";
import { createLocalhostProvider } from "./localhost-provider";
import type { WorkspaceProvider } from "./types";

export interface CreateWorkspaceProvidersOptions {
  designId: string;
  canEdit: boolean;
  onDeleteInlineFile?: (fileId: string) => void | Promise<void>;
  localhostConnections: Array<{
    connectionId: string;
    label: string;
    rootPath?: string;
  }>;
}

export function createWorkspaceProviders(
  options: CreateWorkspaceProvidersOptions,
): WorkspaceProvider[] {
  const providers: WorkspaceProvider[] = [
    createInlineProvider({
      designId: options.designId,
      canEdit: options.canEdit,
      onDeleteFile: options.onDeleteInlineFile,
    }),
  ];
  for (const connection of options.localhostConnections) {
    providers.push(
      createLocalhostProvider({
        connectionId: connection.connectionId,
        label: connection.label,
        rootPath: connection.rootPath,
        canEdit: options.canEdit,
        designId: options.designId,
      }),
    );
  }
  return providers;
}
