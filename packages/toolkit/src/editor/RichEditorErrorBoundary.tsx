import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Isolate a crash inside the rich editor.
 *
 * The fallback is a small inline box instead of the route-level error screen, so
 * one bad node does not take the whole page down; the error is reported through
 * `onError`.
 */
export class RichEditorErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  override render() {
    if (this.state.failed) {
      return (
        <div
          className="an-rich-md-error"
          style={{
            border: "1px solid hsl(var(--destructive))",
            color: "hsl(var(--destructive))",
            padding: 8,
          }}
        >
          The editor hit an error.
        </div>
      );
    }
    return this.props.children;
  }
}
