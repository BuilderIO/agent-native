import { toAppDefinition, type AppConfig } from "@shared/app-registry";

import AppWebview from "./AppWebview.js";

export default function DesktopChatFirstAgentChat({
  app,
  isActive,
}: {
  app: AppConfig;
  isActive: boolean;
}) {
  return (
    <div
      className="desktop-chat-first-agent-chat"
      aria-label={`${app.name} chat`}
    >
      <AppWebview
        app={toAppDefinition(app)}
        appConfig={app}
        isActive={isActive}
        urlPath="/chat"
        urlParams={{ embedded: "1", chatFirst: "1" }}
      />
    </div>
  );
}

export function DesktopChatFirstUnavailable({ message }: { message: string }) {
  return (
    <div className="desktop-chat-first-agent-chat__unavailable" role="status">
      {message}
    </div>
  );
}
