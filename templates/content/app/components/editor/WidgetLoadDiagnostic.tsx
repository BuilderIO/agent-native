import { useT } from "@agent-native/core/client/i18n";
import { Component } from "react";
import { useEffect, useState, type ReactNode } from "react";

function exceptionName(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string" &&
    /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
  ) {
    return error.name;
  }
  return "Error";
}

export function WidgetLoadDiagnostic({
  active,
  stage,
  action,
  fallback,
  errorName: externalErrorName,
}: {
  active: boolean;
  stage: string;
  action: string;
  fallback?: ReactNode;
  errorName?: string | null;
}) {
  const t = useT();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    if (!active) return;
    const timeout = window.setTimeout(() => setTimedOut(true), 8_000);
    return () => window.clearTimeout(timeout);
  }, [active, action, stage]);

  const observedErrorName = externalErrorName;
  if (!active || (!timedOut && !observedErrorName)) return fallback ?? null;
  const diagnosticStage = observedErrorName
    ? `${stage} (${observedErrorName})`
    : stage;
  return (
    <div
      aria-live="assertive"
      className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground"
      data-widget-load-diagnostic
      role="alert"
    >
      {t("editor.widgetLoadStalled", {
        stage: diagnosticStage,
        action,
      })}
    </div>
  );
}

class WidgetEditorErrorBoundary extends Component<
  { action: string; children: ReactNode; stage: string },
  { errorName: string | null }
> {
  state = { errorName: null };

  static getDerivedStateFromError(error: unknown) {
    return { errorName: exceptionName(error) };
  }

  render() {
    return this.state.errorName ? (
      <WidgetLoadDiagnostic
        active
        stage={this.props.stage}
        action={this.props.action}
        errorName={this.state.errorName}
      />
    ) : (
      this.props.children
    );
  }
}

export function WidgetVisualEditorBoundary({
  active,
  action,
  children,
  stage,
}: {
  active: boolean;
  action: string;
  children: ReactNode;
  stage: string;
}) {
  return active ? (
    <WidgetEditorErrorBoundary action={action} stage={stage}>
      {children}
    </WidgetEditorErrorBoundary>
  ) : (
    children
  );
}
