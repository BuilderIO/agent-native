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
  recovery: {
    signature: string;
    retryCount: number;
  } | null;
};

const MAX_ASSISTANT_UI_RECOVERABLE_RETRIES = 2;

export class AssistantUiStaleIndexErrorBoundary extends React.Component<
  AssistantUiStaleIndexErrorBoundaryProps,
  AssistantUiStaleIndexErrorBoundaryState
> {
  state: AssistantUiStaleIndexErrorBoundaryState = {
    error: null,
    retryToken: 0,
    recovery: null,
  };

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private recoverySignature(
    kind: AssistantUiRecoverableErrorKind,
    error: unknown,
  ): string {
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    return `${this.props.resetKey}:${kind}:${message}`;
  }

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
    const signature = this.recoverySignature(recoverable, error);
    const retryCount =
      this.state.recovery?.signature === signature
        ? this.state.recovery.retryCount + 1
        : 1;

    const retryBudgetExceeded =
      retryCount > MAX_ASSISTANT_UI_RECOVERABLE_RETRIES;
    if (retryBudgetExceeded) {
      captureError(error, {
        tags: {
          component: this.props.componentName ?? "AssistantChat",
          recoverable,
        },
        extra: {
          resetKey: this.props.resetKey,
          retryCount,
          componentStack: info.componentStack,
        },
      });
    }

    this.setState({
      recovery: { signature, retryCount },
    });
    if (retryBudgetExceeded) return;

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

  componentDidUpdate(
    prevProps: AssistantUiStaleIndexErrorBoundaryProps,
    prevState: AssistantUiStaleIndexErrorBoundaryState,
  ) {
    if (prevProps.resetKey !== this.props.resetKey) {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (
        this.state.error &&
        isAssistantUiRecoverableRenderError(this.state.error)
      ) {
        this.setState((state) => ({
          error: null,
          retryToken: state.retryToken + 1,
          recovery: null,
        }));
      } else if (this.state.recovery) {
        this.setState({ recovery: null });
      }
      return;
    }

    if (prevState.error && !this.state.error && this.state.recovery) {
      this.setState({ recovery: null });
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
      if (
        this.state.recovery &&
        this.state.recovery.retryCount > MAX_ASSISTANT_UI_RECOVERABLE_RETRIES
      ) {
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
