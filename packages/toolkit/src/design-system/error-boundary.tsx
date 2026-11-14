import { Component, type ErrorInfo, type ReactNode } from "react";

import type { DesignSystemComponentName } from "./types.js";

interface DesignSystemErrorBoundaryProps {
  component: DesignSystemComponentName | (string & {});
  fallback: ReactNode;
  children: ReactNode;
}

interface DesignSystemErrorBoundaryState {
  failed: boolean;
}

export class DesignSystemErrorBoundary extends Component<
  DesignSystemErrorBoundaryProps,
  DesignSystemErrorBoundaryState
> {
  override state: DesignSystemErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DesignSystemErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[agent-native] Custom design-system component ${this.props.component} failed; rendering the default adapter for this control.`,
      error,
      info,
    );
  }

  override render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
