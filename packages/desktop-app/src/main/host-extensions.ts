/// <reference types="vite/client" />

import type { IpcMainInvokeEvent } from "electron";

/**
 * What a host extension gets to wire itself into the main process. Handlers it
 * registers must check `isShell` themselves: other web contents can invoke the
 * same channels.
 */
export interface DesktopHostExtensionContext {
  ipc: {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ): void;
  };
  isShell(event: IpcMainInvokeEvent): boolean;
  identity(): { status: string; email: string | null } | null;
}

/**
 * A module dropped into `src/main/host-extensions/` by a build of this app that
 * adds its own native features. The directory is empty upstream.
 */
export interface DesktopHostExtension {
  id: string;
  register(context: DesktopHostExtensionContext): void;
}

function isHostExtension(value: unknown): value is DesktopHostExtension {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "register") === "function"
  );
}

/** Reads `import.meta.glob` results; a module without a valid `hostExtension` export throws. */
export function collectDesktopHostExtensions(
  modules: Record<string, unknown>,
): DesktopHostExtension[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, mod]) => {
      const extension =
        mod !== null && typeof mod === "object"
          ? Reflect.get(mod, "hostExtension")
          : undefined;
      if (!isHostExtension(extension))
        throw new Error(
          `${file} must export \`hostExtension\` with an id and register()`,
        );
      return extension;
    });
}

export function registerDesktopHostExtensions(
  extensions: readonly DesktopHostExtension[],
  context: DesktopHostExtensionContext,
): void {
  const seen = new Set<string>();
  for (const extension of extensions) {
    if (seen.has(extension.id))
      throw new Error(`Duplicate desktop host extension: ${extension.id}`);
    seen.add(extension.id);
    extension.register(context);
  }
}
