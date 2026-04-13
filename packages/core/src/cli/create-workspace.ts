/**
 * @deprecated `create-workspace` is now an alias for `create`. In current
 * versions, `agent-native create <name>` defaults to scaffolding a workspace
 * with a multi-select template picker. Use `--standalone` for a single-app
 * standalone scaffold.
 *
 * This module is kept for backwards compatibility with older docs and
 * scripts that still invoke `agent-native create-workspace`.
 */
import { createApp, type CreateAppOptions } from "./create.js";

export interface CreateWorkspaceOptions {
  name?: string;
  /** Pre-select these templates in the picker. */
  template?: string;
  noInstall?: boolean;
}

export async function createWorkspace(
  opts: CreateWorkspaceOptions = {},
): Promise<void> {
  const passthrough: CreateAppOptions = {
    template: opts.template,
    noInstall: opts.noInstall,
  };
  await createApp(opts.name, passthrough);
}
