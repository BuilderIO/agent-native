import { toAppDefinition, type AppConfig } from "@shared/app-registry";
import { IconX } from "@tabler/icons-react";

import AppWebview from "./AppWebview.js";
import { DesktopChatFirstAppIcon } from "./DesktopChatFirstRail.js";

export default function DesktopChatFirstAppPane({
  app,
  path,
  view,
  onClose,
}: {
  app: AppConfig;
  path?: string;
  view?: string;
  onClose: () => void;
}) {
  return (
    <aside
      className="desktop-chat-first-app-pane"
      aria-label={app.name + " app"}
    >
      <header className="desktop-chat-first-app-pane__header">
        <span className="desktop-chat-first-app-pane__icon">
          <DesktopChatFirstAppIcon app={app} size={16} />
        </span>
        <div className="desktop-chat-first-app-pane__title">
          <strong>{app.name}</strong>
          <span>
            {view
              ? `Contextual view · ${view}`
              : path
                ? "Contextual view"
                : "Workspace app"}
          </span>
        </div>
        <span className="desktop-chat-first-app-pane__actions">
          <button
            type="button"
            className="desktop-chat-first-app-pane__button"
            title="Close app"
            aria-label="Close app"
            onClick={onClose}
          >
            <IconX size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className="desktop-chat-first-app-pane__body">
        <AppWebview
          app={toAppDefinition(app)}
          appConfig={app}
          isActive
          urlPath={path}
          urlParams={{ embedded: "1", chatFirst: "1" }}
        />
      </div>
    </aside>
  );
}
