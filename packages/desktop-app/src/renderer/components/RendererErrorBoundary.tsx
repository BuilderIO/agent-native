import * as Sentry from "@sentry/electron/renderer";
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  error: Error | null;
}

const overlayStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  height: "100%",
  padding: 24,
  textAlign: "center",
  color: "var(--shell-fg)",
  background: "var(--shell-bg)",
};

const buttonStyle: CSSProperties = {
  minHeight: 32,
  padding: "6px 14px",
  border: "1px solid var(--separator)",
  borderRadius: 6,
  color: "var(--shell-fg)",
  background: "var(--surface-active-bg)",
  font: "inherit",
  fontSize: 13,
  cursor: "pointer",
};

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[desktop-renderer] Unhandled render error", error, info);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={overlayStyle} data-renderer-error-boundary>
        <p>Something went wrong. You can try again.</p>
        <button type="button" style={buttonStyle} onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
