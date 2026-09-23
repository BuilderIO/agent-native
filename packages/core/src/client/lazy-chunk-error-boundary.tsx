import React from "react";

import { recoverFromStaleChunkError } from "./route-chunk-recovery.js";

export class LazyChunkErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    if (recoverFromStaleChunkError(error)) return;
    console.error("[agent-native] Lazy client chunk failed", error, errorInfo);
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
