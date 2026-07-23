import {
  ActionButton,
  DesignSystemErrorBoundary,
  Status,
  Surface,
} from "@agent-native/toolkit/design-system";
import { IconCheck, IconPlugConnected } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { cn } from "../utils.js";
import {
  useBuilderConnectCardController,
  type BuilderConnectCardControllerOptions,
  type BuilderConnectCardViewModel,
} from "./useBuilderConnectCardController.js";

export interface BuilderConnectCardProps extends BuilderConnectCardControllerOptions {
  className?: string;
  render?: (context: BuilderConnectCardRenderContext) => ReactNode;
}

export interface BuilderConnectCardRenderContext {
  viewModel: BuilderConnectCardViewModel;
  className?: string;
}

export interface DefaultBuilderConnectCardViewProps {
  viewModel: BuilderConnectCardViewModel;
  className?: string;
}

export function DefaultBuilderConnectCardView({
  viewModel,
  className,
}: DefaultBuilderConnectCardViewProps) {
  const action = viewModel.action;
  const statusTone =
    viewModel.status.kind === "connected"
      ? "success"
      : viewModel.status.kind === "checking"
        ? "info"
        : "neutral";

  return (
    <Surface
      as="section"
      elevation="low"
      padding="none"
      className={cn(
        "rounded-lg border border-border bg-background p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
            viewModel.configured
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {viewModel.configured ? (
            <IconCheck className="size-4" />
          ) : (
            <IconPlugConnected className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {viewModel.title}
            </h2>
            <Status
              tone={statusTone}
              size="compact"
              className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {viewModel.status.label}
            </Status>
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {viewModel.description}
          </p>
          {viewModel.error ? (
            <p className="mt-2 text-xs text-destructive">{viewModel.error}</p>
          ) : null}
          {action ? (
            <div className="mt-3">
              <ActionButton
                type="button"
                intent="primary"
                size="compact"
                pending={action.pending}
                disabled={action.disabled}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
                leadingIcon={<IconPlugConnected className="size-3.5" />}
                onPress={action.onPress}
              >
                {action.label}
              </ActionButton>
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

export function BuilderConnectCard({
  title,
  description,
  trackingSource,
  className,
  onConnected,
  render,
}: BuilderConnectCardProps) {
  const viewModel = useBuilderConnectCardController({
    title,
    description,
    trackingSource,
    onConnected,
  });

  const fallback = (
    <DefaultBuilderConnectCardView
      viewModel={viewModel}
      className={className}
    />
  );
  return render ? (
    <DesignSystemErrorBoundary
      component="BuilderConnectCard"
      fallback={fallback}
    >
      <BuilderConnectCardCustomView
        render={render}
        viewModel={viewModel}
        className={className}
      />
    </DesignSystemErrorBoundary>
  ) : (
    fallback
  );
}

function BuilderConnectCardCustomView({
  render,
  viewModel,
  className,
}: Required<Pick<BuilderConnectCardProps, "render">> &
  BuilderConnectCardRenderContext) {
  return render({ viewModel, className });
}
