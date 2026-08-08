import type { AppDefinition } from "@shared/app-registry";
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconRefresh,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useRef } from "react";

import AppWebview, { type AppWebviewHandle } from "./AppWebview.js";

const BROWSER_APP: AppDefinition = {
  id: "chat-first-browser",
  name: "Browser",
  icon: "Globe",
  description: "A browser surface opened by an agent.",
  devPort: 0,
};

export default function DesktopChatFirstBrowserPane({
  url,
  title,
  isActive,
  onClose,
}: {
  url: string;
  title?: string;
  isActive: boolean;
  onClose: () => void;
}) {
  const webviewRef = useRef<AppWebviewHandle | null>(null);

  return (
    <aside className="desktop-chat-first-browser-pane">
      <header className="desktop-chat-first-browser-pane__chrome">
        <div className="desktop-chat-first-browser-pane__controls">
          <button
            type="button"
            onClick={() => webviewRef.current?.goBack()}
            aria-label="Back"
            title="Back"
          >
            <IconArrowLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => webviewRef.current?.goForward()}
            aria-label="Forward"
            title="Forward"
          >
            <IconArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => webviewRef.current?.reload()}
            aria-label="Reload page"
            title="Reload page"
          >
            <IconRefresh size={15} />
          </button>
        </div>
        <div className="desktop-chat-first-browser-pane__address" title={url}>
          <IconWorld size={13} aria-hidden="true" />
          <span>{url}</span>
        </div>
        <div className="desktop-chat-first-browser-pane__actions">
          {title ? <span title={title}>{title}</span> : null}
          <button
            type="button"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            aria-label="Open in external browser"
            title="Open in external browser"
          >
            <IconExternalLink size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close browser"
            title="Close browser"
          >
            <IconX size={15} />
          </button>
        </div>
      </header>
      <div className="desktop-chat-first-browser-pane__body">
        {/* Explicit browser targets use the existing isolated webview host;
            unlike app panes, the address is always visible in the shell. */}
        <AppWebview
          key={url}
          ref={webviewRef}
          app={BROWSER_APP}
          sourceUrl={url}
          isActive={isActive}
        />
      </div>
    </aside>
  );
}
