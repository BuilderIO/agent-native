import * as Sentry from "@sentry/electron/renderer";

export function initializeDesktopRendererSentry() {
  if (!window.electronAPI?.sentry.enabled || Sentry.isInitialized()) return;

  Sentry.init({
    beforeSend(event) {
      event.tags = {
        ...event.tags,
        runtime: "electron-renderer",
        "desktop.shell": "agent-native",
        "desktop.process": "renderer",
      };
      event.contexts = {
        ...event.contexts,
        app: {
          ...event.contexts?.app,
          app_name: "Agent Native",
        },
      };
      return event;
    },
  });

  Sentry.setTag("runtime", "electron-renderer");
  Sentry.setTag("desktop.shell", "agent-native");
  Sentry.setTag("desktop.process", "renderer");
  Sentry.setContext("desktop", {
    process: "renderer",
    shell: "agent-native",
  });
}
