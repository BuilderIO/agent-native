import {
  LazyChunkErrorBoundary,
  LazyChunkRetryFallback,
} from "@agent-native/toolkit/app/shared";
import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";

function defer<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): ComponentType<ComponentProps<T>> {
  const LazyComponent = lazy(loader);
  return function DeferredComponent(props: ComponentProps<T>) {
    return (
      <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
        <Suspense fallback={null}>
          <LazyComponent {...props} />
        </Suspense>
      </LazyChunkErrorBoundary>
    );
  };
}

export const AgentChatSurface = defer(() =>
  import("@agent-native/toolkit/app/chat/AgentPanel").then((module) => ({
    default: module.AgentChatSurface,
  })),
);

export const ChatFirstAgentsPane = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/agents-pane").then(
    (module) => ({ default: module.ChatFirstAgentsPane }),
  ),
);

export const ChatFirstAppPane = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/app-pane").then(
    (module) => ({ default: module.ChatFirstAppPane }),
  ),
);

export const ChatFirstAppsRail = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/apps-rail").then(
    (module) => ({
      default: module.ChatFirstAppsRail,
    }),
  ),
);

export const ChatFirstBrowserPane = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/browser-pane").then(
    (module) => ({ default: module.ChatFirstBrowserPane }),
  ),
);

export const ChatFirstChatHistory = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/chat-history").then(
    (module) => ({ default: module.ChatFirstChatHistory }),
  ),
);

export const ChatFirstPrimaryNavigation = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/primary-nav").then(
    (module) => ({
      default: module.ChatFirstPrimaryNavigation,
    }),
  ),
);

export const ChatFirstSessionWatchPane = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/session-watch-pane").then(
    (module) => ({ default: module.ChatFirstSessionWatchPane }),
  ),
);

export const ChatFirstSurfaceContent = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/surface-tabs").then(
    (module) => ({ default: module.ChatFirstSurfaceContent }),
  ),
);

export const ChatFirstSurfacePanel = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/surface-panel").then(
    (module) => ({ default: module.ChatFirstSurfacePanel }),
  ),
);

export const ChatFirstSurfacePanelToggle = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/ChatFirstSurfacePanelToggle").then(
    (module) => ({ default: module.ChatFirstSurfacePanelToggle }),
  ),
);

export const ChatFirstSurfaceTabs = defer(() =>
  import("@agent-native/toolkit/app/chat/chat-first/surface-tabs").then(
    (module) => ({ default: module.ChatFirstSurfaceTabs }),
  ),
);
