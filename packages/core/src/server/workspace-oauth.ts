/**
 * Whether workspace OAuth callbacks use the root framework relay.
 *
 * Workspace deploy wrappers normally provide the runtime flags, but mounted
 * app bundles can retain only their workspace app id or build-time Vite env.
 * Redirect construction and callback handling must use this exact same
 * predicate so a callback sent to the root relay is always forwarded back to
 * the mounted app that initiated it.
 */
export function isWorkspaceOAuthCallbackRelayEnabled(): boolean {
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;

  return (
    [
      process.env.AGENT_NATIVE_WORKSPACE,
      process.env.VITE_AGENT_NATIVE_WORKSPACE,
      metaEnv?.AGENT_NATIVE_WORKSPACE,
      metaEnv?.VITE_AGENT_NATIVE_WORKSPACE,
    ].some((value) => value === "1" || value === "true") ||
    [
      process.env.AGENT_NATIVE_WORKSPACE_APP_ID,
      process.env.VITE_AGENT_NATIVE_WORKSPACE_APP_ID,
      metaEnv?.AGENT_NATIVE_WORKSPACE_APP_ID,
      metaEnv?.VITE_AGENT_NATIVE_WORKSPACE_APP_ID,
    ].some((value) => typeof value === "string" && value.trim().length > 0)
  );
}
