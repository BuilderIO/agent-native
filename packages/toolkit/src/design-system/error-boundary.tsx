import { Component, type ErrorInfo, type ReactNode } from "react";

import type { DesignSystemComponentName } from "./types.js";

interface DesignSystemErrorBoundaryProps {
  component: DesignSystemComponentName | string;
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
  state: DesignSystemErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DesignSystemErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[agent-native] Custom design-system component ${this.props.component} failed; rendering the default adapter for this control.`,
      error,
      info,
    );
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
