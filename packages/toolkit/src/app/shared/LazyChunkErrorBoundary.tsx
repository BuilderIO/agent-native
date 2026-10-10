import { recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";
import React from "react";

export class LazyChunkErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    fallback: React.ReactNode;
    shouldHandleError?: (error: unknown) => boolean;
    onError?: (error: unknown) => void;
  },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    this.props.onError?.(error);
    if (recoverFromStaleChunkError(error)) return;
    console.error("[agent-native] Lazy client chunk failed", error, errorInfo);
  }

  render() {
    if (
      this.state.error &&
      this.props.shouldHandleError &&
      !this.props.shouldHandleError(this.state.error)
    ) {
      throw this.state.error;
    }
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
