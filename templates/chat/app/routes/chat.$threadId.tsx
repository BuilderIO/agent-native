import { useEffect, useState, type ComponentType } from "react";

function ChatRouteFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full min-h-0 items-end justify-center overflow-hidden bg-background px-4 pb-4"
    >
      <div className="h-28 w-full max-w-3xl animate-pulse rounded-3xl bg-muted/40" />
    </div>
  );
}

let chatRouteContentPromise:
  | Promise<typeof import("@/components/chat/ChatRouteContent")>
  | undefined;
const maxChatRouteContentLoadAttempts = 5;

function loadChatRouteContent() {
  const promise = (chatRouteContentPromise ??=
    import("@/components/chat/ChatRouteContent"));
  return promise.catch((error: unknown) => {
    chatRouteContentPromise = undefined;
    throw error;
  });
}

function ClientChatRoute() {
  const [ChatRouteContent, setChatRouteContent] =
    useState<ComponentType | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    void loadChatRouteContent()
      .then((module) => {
        if (!cancelled) setChatRouteContent(() => module.default);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (loadAttempt >= maxChatRouteContentLoadAttempts - 1) {
            setLoadError(error);
            return;
          }
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setLoadAttempt((attempt) => attempt + 1);
          }, 250);
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [loadAttempt]);

  if (loadError) throw loadError;

  return ChatRouteContent ? <ChatRouteContent /> : <ChatRouteFallback />;
}

export { meta } from "./home";

export default function ChatThreadRoute() {
  return <ClientChatRoute />;
}
