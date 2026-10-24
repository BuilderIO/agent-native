import { useT } from "@agent-native/core/client/i18n";
import { IconAlertCircle } from "@tabler/icons-react";
import { Component, type ReactNode } from "react";

import { cn } from "@/lib/utils";

class PreviewBoundary extends Component<
  { children: ReactNode; className?: string; label: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "native-preview-failed";
    return (
      <div
        role="alert"
        className={cn(
          "flex aspect-video flex-col items-center justify-center gap-2 overflow-hidden bg-muted px-3 text-center text-muted-foreground",
          this.props.className,
        )}
      >
        <IconAlertCircle className="size-6 shrink-0" aria-hidden />
        <span className="text-sm">{this.props.label}</span>
        <code className="max-w-full break-all text-xs">{code}</code>
      </div>
    );
  }
}

export function NativePreviewErrorBoundary({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <PreviewBoundary className={className} label={t("common.genericError")}>
      {children}
    </PreviewBoundary>
  );
}
