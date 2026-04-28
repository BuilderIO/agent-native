import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";

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

export function ErrorBoundary() {
  useApplyThemeClass();
  const error = useRouteError();
  let status: number | null = null;
  let title = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = "Page not found";
      details = "This page doesn’t exist. It may have been moved or deleted.";
    } else {
      title = `${error.status} Error`;
      details = error.statusText || details;
    }
  } else if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    error instanceof Error
  ) {
    details = error.message;
    stack = error.stack;
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
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer"
        >
          Go home
        </Link>
        {stack && (
          <pre className="mt-6 w-full text-left text-xs overflow-auto p-4 bg-muted rounded">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
