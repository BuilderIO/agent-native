import { useEffect, useState } from "react";
import {
  isRouteErrorResponse,
  useInRouterContext,
  useRouteError,
} from "react-router";
import { appPath } from "./api-path.js";
import {
  isDynamicImportFailureMessage,
  recoverFromStaleChunkError,
} from "./route-chunk-recovery.js";

const homeLinkClassName =
  "mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer";

function useApplyThemeClass() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("dark") || root.classList.contains("light"))
      return;
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "dark") {
        root.classList.add("dark");
      } else if (stored === "light") {
        root.classList.add("light");
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      }
    } catch {}
  }, []);
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/**
 * When a route renders against a stale lazy chunk after a deploy (the chunk's
 * hashed filename no longer exists), the import rejection surfaces here. Reload
 * once to fetch fresh assets instead of stranding the user on an error screen.
 * The reload is loop-guarded; if it cannot recover, fall back to the screen.
 */
function useStaleChunkRecovery(error: unknown): boolean {
  const [recovering, setRecovering] = useState(() =>
    isDynamicImportFailureMessage(errorMessageOf(error)),
  );
  useEffect(() => {
    if (!isDynamicImportFailureMessage(errorMessageOf(error))) {
      setRecovering(false);
      return;
    }
    if (!recoverFromStaleChunkError(error)) setRecovering(false);
  }, [error]);
  return recovering;
}

function UpdatingScreen() {
  return (
    <main className="flex items-center justify-center min-h-screen p-4 bg-background text-foreground">
      <p className="text-muted-foreground text-sm">
        Loading the latest version…
      </p>
    </main>
  );
}

function ErrorScreen({ error }: { error: unknown }) {
  const recovering = useStaleChunkRecovery(error);
  // While auto-recovering a stale chunk, show a neutral state and skip the
  // console.error below so the transient, self-healing failure does not get
  // reported as a hard error.
  if (recovering) return <UpdatingScreen />;

  let status: number | null = null;
  let title = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = "Page not found";
      details = "We couldn't find this page.";
    } else {
      title = `${error.status} Error`;
      details = error.statusText || details;
    }
  } else if (error instanceof Error) {
    // Always surface the underlying error message — a generic
    // "An unexpected error occurred." in production tells users (and us)
    // nothing. The stack trace is still gated to dev so we don't leak
    // internals to end users.
    if (error.message) {
      details = error.message;
    }
    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV !== "production"
    ) {
      stack = error.stack;
    }
  } else if (typeof error === "string" && error) {
    details = error;
  }

  // Log to the console so the underlying failure is recoverable from
  // browser devtools / Sentry even when the UI hides the stack.
  if (typeof console !== "undefined" && error) {
    console.error("[ErrorBoundary]", error);
  }

  return (
    <main className="flex items-center justify-center min-h-screen p-4 bg-background text-foreground">
      <div className="flex flex-col items-center text-center max-w-md">
        {status && (
          <span className="text-7xl font-bold tracking-tight text-muted-foreground/40">
            {status}
          </span>
        )}
        <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{details}</p>
        <a href={appPath("/")} className={homeLinkClassName}>
          Go home
        </a>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
        >
          Reload
        </button>
        {stack && (
          <pre className="mt-6 w-full text-left text-xs overflow-auto p-4 bg-muted rounded">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}

function RoutedErrorScreen() {
  return <ErrorScreen error={useRouteError()} />;
}

export function ErrorBoundary() {
  useApplyThemeClass();
  if (!useInRouterContext()) return <ErrorScreen error={undefined} />;
  return <RoutedErrorScreen />;
}
