import type { Page, Request, Response } from "@playwright/test";

type Entry = {
  kind: string;
  started: number;
  ended?: number;
  status: number | null;
  state: "pending" | "finished" | "failed";
};

export function observeNotebookReload(page: Page, clock = Date.now) {
  const origin = clock();
  const entries = new Map<Request, Entry>();
  let omitted = 0;
  const onRequest = (request: Request) => {
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const kind =
      method === "GET" && path.endsWith("/_agent-native/actions/get-project")
        ? "get-project"
        : method === "GET" &&
            path.endsWith("/_agent-native/actions/get-workspace-bootstrap")
          ? "bootstrap"
          : method === "GET" && path.endsWith("/_agent-native/auth/session")
            ? "session"
            : method === "GET" && path.endsWith("/_agent-native/org/me")
              ? "org"
              : method === "POST" &&
                  path.endsWith("/_agent-native/actions/get-actions-batch")
                ? "batch-membership-unknown"
                : null;
    if (!kind) return;
    if (entries.size >= 20) {
      omitted++;
      return;
    }
    entries.set(request, {
      kind,
      started: clock(),
      status: null,
      state: "pending",
    });
  };
  const onResponse = (response: Response) => {
    const entry = entries.get(response.request());
    if (entry) entry.status = response.status();
  };
  const end = (request: Request, state: "finished" | "failed") => {
    const entry = entries.get(request);
    if (entry) {
      entry.state = state;
      entry.ended = clock();
    }
  };
  const onFinished = (request: Request) => end(request, "finished");
  const onFailed = (request: Request) => end(request, "failed");
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return {
    snapshot: () => ({
      omitted,
      requests: [...entries.values()].map((entry) => ({
        kind: entry.kind,
        startedMs: entry.started - origin,
        status: entry.status,
        state: entry.state,
        elapsedMs: (entry.ended ?? clock()) - entry.started,
      })),
    }),
    dispose: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    },
  };
}

export async function captureNotebookReloadDom(page: Page) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page
        .evaluate(() => {
          const editor = document.querySelector(
            '[role="textbox"][aria-label^="Edit Text"], textarea[aria-label^="Edit Text"], input[aria-label^="Edit Text"]',
          );
          const loader = document.querySelector(
            '[role="status"][aria-label="Loading notebook"]',
          );
          return {
            outcome: "observed" as const,
            loader:
              loader !== null &&
              loader.checkVisibility({ visibilityProperty: true }),
            editor:
              editor !== null &&
              editor.checkVisibility({ visibilityProperty: true }),
            editorFocused: editor !== null && document.activeElement === editor,
          };
        })
        .catch(() => ({ outcome: "unreadable" as const })),
      new Promise<{ outcome: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ outcome: "timeout" }), 2000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
