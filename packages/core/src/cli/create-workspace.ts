/**
 * @deprecated `create-workspace` is now an alias for `create`. In current
 * versions, `agent-native create <name>` asks for a starting shape and its
 * Chat/first-party template paths scaffold a workspace. Use `--standalone`
 * for a single-app standalone scaffold.
 *
 * This module is kept for backwards compatibility with older docs and
 * scripts that still invoke `agent-native create-workspace`.
 */
import { createApp, type CreateAppOptions } from "./create.js";

export interface CreateWorkspaceOptions {
  name?: string;
  template?: string;
  noInstall?: boolean;
}

export async function createWorkspace(
  opts: CreateWorkspaceOptions = {},
): Promise<void> {
  const passthrough: CreateAppOptions = {
    template: opts.template,
    noInstall: opts.noInstall,
    forceWorkspace: true,
  };
  await createApp(opts.name, passthrough);
}
