import {
  createIntegrationsPlugin as createRuntimeIntegrationsPlugin,
  discordAdapter as createRuntimeDiscordAdapter,
  emailAdapter as createRuntimeEmailAdapter,
  googleDocsAdapter as createRuntimeGoogleDocsAdapter,
  microsoftTeamsAdapter as createRuntimeMicrosoftTeamsAdapter,
  slackAdapter as createRuntimeSlackAdapter,
  telegramAdapter as createRuntimeTelegramAdapter,
  whatsappAdapter as createRuntimeWhatsappAdapter,
  type IntegrationsPluginOptions,
  type PlatformAdapter,
} from "@agent-native/core/integrations/runtime";

export * from "@agent-native/core/integrations/runtime";

export function slackAdapter(
  ...args: Parameters<typeof createRuntimeSlackAdapter>
): PlatformAdapter {
  const runtimeAdapter = createRuntimeSlackAdapter(...args);
  return {
    ...runtimeAdapter,
    formatAgentResponse(text, formatOptions) {
      return runtimeAdapter.formatAgentResponse(text, formatOptions);
    },
  };
}

export function telegramAdapter(
  ...args: Parameters<typeof createRuntimeTelegramAdapter>
): PlatformAdapter {
  return { ...createRuntimeTelegramAdapter(...args) };
}

export function whatsappAdapter(
  ...args: Parameters<typeof createRuntimeWhatsappAdapter>
): PlatformAdapter {
  return { ...createRuntimeWhatsappAdapter(...args) };
}

export function microsoftTeamsAdapter(
  ...args: Parameters<typeof createRuntimeMicrosoftTeamsAdapter>
): PlatformAdapter {
  return { ...createRuntimeMicrosoftTeamsAdapter(...args) };
}

export function discordAdapter(
  ...args: Parameters<typeof createRuntimeDiscordAdapter>
): PlatformAdapter {
  return { ...createRuntimeDiscordAdapter(...args) };
}

export function googleDocsAdapter(
  ...args: Parameters<typeof createRuntimeGoogleDocsAdapter>
): PlatformAdapter {
  return { ...createRuntimeGoogleDocsAdapter(...args) };
}

export function emailAdapter(
  ...args: Parameters<typeof createRuntimeEmailAdapter>
): PlatformAdapter {
  return { ...createRuntimeEmailAdapter(...args) };
}

export function createIntegrationsPlugin(
  options: IntegrationsPluginOptions = {},
) {
  if (options.adapters !== undefined) {
    return createRuntimeIntegrationsPlugin(options);
  }
  return createRuntimeIntegrationsPlugin({
    ...options,
    adapterOverrides: [
      slackAdapter(),
      telegramAdapter(),
      whatsappAdapter(),
      microsoftTeamsAdapter(),
      discordAdapter(),
      googleDocsAdapter(),
      emailAdapter(),
      ...(options.adapterOverrides ?? []),
    ],
  });
}

export const defaultIntegrationsPlugin = createIntegrationsPlugin();
