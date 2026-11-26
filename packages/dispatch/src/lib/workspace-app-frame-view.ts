import { EMBED_TOKEN_QUERY_PARAM } from "@agent-native/core/shared";

import { DISPATCH_CHILD_BROWSER_TAB_PARAM } from "../shared/chat-first-pane";

const VIEW_REQUEST_TIMEOUT_MS = 1_000;

export interface WorkspaceAppFrameView {
  path: string;
  title?: string;
  selectedText?: string;
}

export function workspaceAppFramePath(url: URL): string {
  const safe = new URL(url);
  if (safe.searchParams.has(EMBED_TOKEN_QUERY_PARAM)) {
    safe.searchParams.delete(EMBED_TOKEN_QUERY_PARAM);
  }
  if (safe.searchParams.has(DISPATCH_CHILD_BROWSER_TAB_PARAM)) {
    safe.searchParams.delete(DISPATCH_CHILD_BROWSER_TAB_PARAM);
  }
  return safe.pathname + safe.search + safe.hash;
}

export function workspaceAppFramePathAtMount(
  url: URL,
  mount: URL,
): string | null {
  const base = mount.pathname.replace(/\/+$/, "");
  if (
    url.origin !== mount.origin ||
    (url.pathname !== base && !url.pathname.startsWith(`${base}/`))
  ) {
    return null;
  }
  return workspaceAppFramePath(url);
}

/** A transferred port belongs to this request and only reaches the named origin. */
export function requestWorkspaceAppFrameView(
  target: Window,
  origin: string,
  request: { operation: "read" } | { operation: "navigate"; path: string },
  signal: AbortSignal,
): Promise<WorkspaceAppFrameView | null> {
  if (signal.aborted || typeof MessageChannel === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (view: WorkspaceAppFrameView | null) => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      channel.port1.close();
      resolve(view);
    };
    const abort = () => finish(null);
    const timer = window.setTimeout(abort, VIEW_REQUEST_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      const view =
        data && typeof data === "object" && "result" in data
          ? data.result
          : null;
      finish(
        view &&
          typeof view === "object" &&
          "path" in view &&
          typeof view.path === "string" &&
          view.path.startsWith("/") &&
          !view.path.startsWith("//")
          ? {
              path: view.path,
              ...("title" in view &&
                typeof view.title === "string" && { title: view.title }),
              ...("selectedText" in view &&
                typeof view.selectedText === "string" && {
                  selectedText: view.selectedText,
                }),
            }
          : null,
      );
    };
    try {
      target.postMessage(
        {
          type: "agentNative.viewRequest",
          ...request,
          deadline: Date.now() + VIEW_REQUEST_TIMEOUT_MS,
        },
        origin,
        [channel.port2],
      );
    } catch {
      channel.port2.close();
      finish(null);
    }
  });
}
