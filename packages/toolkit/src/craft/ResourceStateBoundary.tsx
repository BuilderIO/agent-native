import * as React from "react";

import { Button } from "../ui/button.js";
import { cn } from "../utils.js";

/**
 * Structured configuration for an actionable empty state with a mandatory CTA.
 */
export interface ResourceEmptyStateConfig {
  title: string;
  description?: string;
  actionLabel: string;
  onAction: () => void;
  icon?: React.ReactNode;
}

/**
 * Context passed to a custom error renderer inside `ResourceStateBoundary`.
 */
export interface ResourceErrorRenderContext {
  error: unknown;
  message: string;
  onRetry: () => void;
}

/**
 * Props for `ResourceStateBoundary`. Requires a loading `skeleton`, an
 * actionable `empty` state, and an `onRetry` handler so async screens never
 * fall back to bare `"Loading..."` strings or dead-end error views.
 */
export interface ResourceStateBoundaryProps<T> {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  skeleton: React.ReactNode;
  empty: ResourceEmptyStateConfig | React.ReactNode;
  isEmpty?: (data: T) => boolean;
  errorTitle?: string;
  retryLabel?: string;
  renderError?: (context: ResourceErrorRenderContext) => React.ReactNode;
  className?: string;
  children: (data: T) => React.ReactNode;
}

function isStructuredEmptyConfig(
  value: ResourceEmptyStateConfig | React.ReactNode,
): value is ResourceEmptyStateConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    !React.isValidElement(value) &&
    "title" in value &&
    "actionLabel" in value &&
    "onAction" in value &&
    typeof value.title === "string" &&
    typeof value.actionLabel === "string" &&
    typeof value.onAction === "function"
  );
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "An unexpected error occurred while loading this data.";
}

function defaultIsEmpty<T>(data: T): boolean {
  if (Array.isArray(data)) {
    return data.length === 0;
  }
  return false;
}

/**
 * Enforces complete async UI states: layout-matched skeleton while loading,
 * recoverable error state with retry, actionable empty state with CTA, and
 * populated content when ready.
 */
export function ResourceStateBoundary<T>({
  data,
  isLoading,
  error,
  onRetry,
  skeleton,
  empty,
  isEmpty = defaultIsEmpty,
  errorTitle = "Unable to load data",
  retryLabel = "Try again",
  renderError,
  className,
  children,
}: ResourceStateBoundaryProps<T>): React.ReactElement {
  if (isLoading && data === undefined) {
    return (
      <div
        role="status"
        aria-busy="true"
        data-craft-state="loading"
        className={className}
      >
        {skeleton}
      </div>
    );
  }

  if (error !== null && error !== undefined && data === undefined) {
    const message = resolveErrorMessage(error);
    if (renderError) {
      return (
        <div role="alert" data-craft-state="error" className={className}>
          {renderError({ error, message, onRetry })}
        </div>
      );
    }

    return (
      <div
        role="alert"
        data-craft-state="error"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-6 text-center",
          className,
        )}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-foreground">{errorTitle}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    );
  }

  if (data === undefined || isEmpty(data)) {
    if (isStructuredEmptyConfig(empty)) {
      return (
        <div
          data-craft-state="empty"
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center",
            className,
          )}
        >
          {empty.icon ? (
            <div className="text-muted-foreground">{empty.icon}</div>
          ) : null}
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">
              {empty.title}
            </h3>
            {empty.description ? (
              <p className="max-w-md text-sm text-muted-foreground">
                {empty.description}
              </p>
            ) : null}
          </div>
          <Button type="button" size="sm" onClick={empty.onAction}>
            {empty.actionLabel}
          </Button>
        </div>
      );
    }

    return (
      <div data-craft-state="empty" className={className}>
        {empty}
      </div>
    );
  }

  return <>{children(data)}</>;
}
