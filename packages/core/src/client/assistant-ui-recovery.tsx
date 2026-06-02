import React from "react";

import { captureError } from "./analytics.js";

type AssistantUiRecoverableErrorKind =
  | "assistant-ui-stale-message-index"
  | "assistant-ui-duplicate-resource-key"
  | "assistant-ui-react-fiber-unmount";

export function assistantUiRecoverableRenderErrorKind(
  error: unknown,
): AssistantUiRecoverableErrorKind | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /^tapClientLookup: Index \d+ out of bounds \(length: \d+\)$/.test(message)
  ) {
    return "assistant-ui-stale-message-index";
  }
  if (/^Duplicate key .+ in tapResources$/.test(message)) {
    return "assistant-ui-duplicate-resource-key";
  }
  if (/^Tried to unmount a fiber that is already unmounted\b/.test(message)) {
    return "assistant-ui-react-fiber-unmount";
  }
  return null;
}

export function isAssistantUiStaleIndexError(error: unknown): boolean {
  return (
    assistantUiRecoverableRenderErrorKind(error) ===
    "assistant-ui-stale-message-index"
  );
}

export function isAssistantUiRecoverableRenderError(error: unknown): boolean {
  return assistantUiRecoverableRenderErrorKind(error) !== null;
}

type AssistantUiStaleIndexErrorBoundaryProps = {
  resetKey: string;
  componentName?: string;
  children: React.ReactNode;
};

type AssistantUiStaleIndexErrorBoundaryState = {
  error: Error | null;
  retryToken: number;
};

export class AssistantUiStaleIndexErrorBoundary extends React.Component<
  AssistantUiStaleIndexErrorBoundaryProps,
  AssistantUiStaleIndexErrorBoundaryState
> {
  state: AssistantUiStaleIndexErrorBoundaryState = {
    error: null,
    retryToken: 0,
  };

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<AssistantUiStaleIndexErrorBoundaryState> {
    return {
      error: error instanceof Error ? error : new Error(String(error ?? "")),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const recoverable = assistantUiRecoverableRenderErrorKind(error);
    if (!recoverable) return;

    captureError(error, {
      tags: {
        component: this.props.componentName ?? "AssistantChat",
        recoverable,
      },
      extra: {
        resetKey: this.props.resetKey,
        componentStack: info.componentStack,
      },
    });

    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.setState((state) => {
        if (!state.error || !isAssistantUiRecoverableRenderError(state.error)) {
          return null;
        }
        return { error: null, retryToken: state.retryToken + 1 };
      });
    }, 0);
  }

  componentDidUpdate(prevProps: AssistantUiStaleIndexErrorBoundaryProps) {
    if (
      this.state.error &&
      isAssistantUiRecoverableRenderError(this.state.error) &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState((state) => ({
        error: null,
        retryToken: state.retryToken + 1,
      }));
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  render() {
    if (this.state.error) {
      if (!isAssistantUiRecoverableRenderError(this.state.error)) {
        throw this.state.error;
      }
      return null;
    }

    return (
      <React.Fragment key={`${this.props.resetKey}:${this.state.retryToken}`}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export function AssistantMessageListErrorBoundary({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}) {
  return (
    <AssistantUiStaleIndexErrorBoundary
      resetKey={resetKey}
      componentName="AssistantMessageList"
    >
      {children}
    </AssistantUiStaleIndexErrorBoundary>
  );
}
