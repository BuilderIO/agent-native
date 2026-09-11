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

// Inline styles (not a class in shell.css) so the fallback still renders
// correctly even if the crash happened before/during stylesheet application.
// Colors reuse the same tokens shell.css defines, so light/dark still match.
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

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
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

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: "var(--label-active)",
  color: "var(--shell-bg)",
  background: "var(--label-active)",
};

/**
 * Catches render-time and commit-phase-effect throws from anywhere under
 * `<App />`. Without this, React unmounts the whole tree on any such throw
 * and the window goes blank with no recovery short of quitting and
 * relaunching. Only a class component can implement getDerivedStateFromError
 * / componentDidCatch.
 */
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
        <p>Something went wrong. You can try again or reload the app.</p>
        <div style={actionsStyle}>
          <button type="button" style={buttonStyle} onClick={this.reset}>
            Try again
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
