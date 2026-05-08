import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Link,
  useInRouterContext,
  useRouteError,
} from "react-router";

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

function ErrorScreen({
  error,
  canUseRouterLink,
}: {
  error: unknown;
  canUseRouterLink: boolean;
}) {
  let status: number | null = null;
  let title = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = "Page not found";
      const path =
        typeof window !== "undefined" ? window.location.pathname : "this path";
      details = `The app does not define a route for ${path}. If this should be a workspace app, make sure it is added and enabled in Dispatch; if it is a new screen, it may need to be shipped first.`;
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
        {canUseRouterLink ? (
          <Link to="/" className={homeLinkClassName}>
            Go home
          </Link>
        ) : (
          <a href="/" className={homeLinkClassName}>
            Go home
          </a>
        )}
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
  return <ErrorScreen error={useRouteError()} canUseRouterLink />;
}

export function ErrorBoundary() {
  useApplyThemeClass();
  const inRouterContext = useInRouterContext();

  if (!inRouterContext) {
    return <ErrorScreen error={undefined} canUseRouterLink={false} />;
  }

  return <RoutedErrorScreen />;
}
