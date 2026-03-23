import { isRouteErrorResponse } from "react-router";

export function ErrorBoundary({ error }: { error: unknown }) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    error instanceof Error
  ) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">{message}</h1>
        <p className="text-muted-foreground">{details}</p>
        {stack && (
          <pre className="mt-4 text-left text-xs overflow-auto max-w-lg mx-auto p-4 bg-muted rounded">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
