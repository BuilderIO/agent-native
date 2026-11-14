type Plugin = (nitroApp: unknown) => void | Promise<void>;

// Import concrete plugin modules instead of the public server barrel. A dynamic
// namespace import of that barrel retains every server export in each function.
const loaders: Record<string, () => Promise<Plugin>> = {
  "agent-chat": () =>
    import("./agent-chat-plugin.js").then((m) => m.defaultAgentChatPlugin),
  auth: () => import("./auth-plugin.js").then((m) => m.defaultAuthPlugin),
  "context-xray": () =>
    import("../agent/context-xray/plugin.js").then(
      (m) => m.defaultContextXrayPlugin,
    ),
  "core-routes": () =>
    import("./core-routes-plugin.js").then((m) => m.defaultCoreRoutesPlugin),
  integrations: () =>
    import("../integrations/plugin.js").then(
      (m) => m.defaultIntegrationsPlugin,
    ),
  "observational-memory": () =>
    import("../agent/observational-memory/plugin.js").then(
      (m) => m.defaultObservationalMemoryPlugin,
    ),
  onboarding: () =>
    import("../onboarding/plugin.js").then((m) => m.defaultOnboardingPlugin),
  org: () => import("../org/plugin.js").then((m) => m.defaultOrgPlugin),
  resources: () =>
    import("./resources-plugin.js").then((m) => m.defaultResourcesPlugin),
  sentry: () => import("./sentry-plugin.js").then((m) => m.defaultSentryPlugin),
  terminal: () =>
    import("../terminal/terminal-plugin.js").then(
      (m) => m.defaultTerminalPlugin,
    ),
};

export function loadFrameworkDefaultPlugin(
  stem: string,
): Promise<Plugin> | undefined {
  const load = Object.hasOwn(loaders, stem) ? loaders[stem] : undefined;
  return load === undefined ? undefined : load();
}
