import {
  LazyChunkErrorBoundary,
  LazyChunkRetryFallback,
} from "@agent-native/toolkit/app/shared";
import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";

const loadChatFirst = () => import("@agent-native/toolkit/app/chat/chat-first");
const loadChatFirstAppsRail = () =>
  import("@agent-native/toolkit/app/chat/chat-first/apps-rail");
const loadChatFirstPrimaryNavigation = () =>
  import("@agent-native/toolkit/app/chat/chat-first/primary-nav");
const loadChat = () => import("@agent-native/toolkit/app/chat");

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
  loadChat().then((module) => ({ default: module.AgentChatSurface })),
);

export const ChatFirstAgentsPane = defer(() =>
  loadChatFirst().then((module) => ({ default: module.ChatFirstAgentsPane })),
);

export const ChatFirstAppPane = defer(() =>
  loadChatFirst().then((module) => ({ default: module.ChatFirstAppPane })),
);

export const ChatFirstAppsRail = defer(() =>
  loadChatFirstAppsRail().then((module) => ({
    default: module.ChatFirstAppsRail,
  })),
);

export const ChatFirstBrowserPane = defer(() =>
  loadChatFirst().then((module) => ({ default: module.ChatFirstBrowserPane })),
);

export const ChatFirstChatHistory = defer(() =>
  loadChatFirst().then((module) => ({ default: module.ChatFirstChatHistory })),
);

export const ChatFirstPrimaryNavigation = defer(() =>
  loadChatFirstPrimaryNavigation().then((module) => ({
    default: module.ChatFirstPrimaryNavigation,
  })),
);

export const ChatFirstSessionWatchPane = defer(() =>
  loadChatFirst().then((module) => ({
    default: module.ChatFirstSessionWatchPane,
  })),
);

export const ChatFirstSurfaceContent = defer(() =>
  loadChatFirst().then((module) => ({
    default: module.ChatFirstSurfaceContent,
  })),
);

export const ChatFirstSurfacePanel = defer(() =>
  loadChatFirst().then((module) => ({ default: module.ChatFirstSurfacePanel })),
);

export const ChatFirstSurfacePanelToggle = defer(() =>
  loadChatFirst().then((module) => ({
    default: module.ChatFirstSurfacePanelToggle,
  })),
);

export const ChatFirstSurfaceTabs = defer(() =>
  loadChatFirst().then((module) => ({ default: module.ChatFirstSurfaceTabs })),
);
