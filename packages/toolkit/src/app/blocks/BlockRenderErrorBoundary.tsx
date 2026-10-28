import { useT } from "@agent-native/core/client/i18n";
import { Component, type ReactNode } from "react";

type BlockRenderErrorBoundaryProps = {
  blockId: string;
  blockType: string;
  resetKey: unknown;
  interactive?: boolean;
  children: ReactNode;
};

type BlockRenderErrorBoundaryState = {
  error: Error | null;
  blockId: string;
  blockType: string;
  resetKey: unknown;
};

export class BlockRenderErrorBoundary extends Component<
  BlockRenderErrorBoundaryProps,
  BlockRenderErrorBoundaryState
> {
  constructor(props: BlockRenderErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
      blockId: props.blockId,
      blockType: props.blockType,
      resetKey: props.resetKey,
    };
  }

  static getDerivedStateFromProps(
    props: BlockRenderErrorBoundaryProps,
    state: BlockRenderErrorBoundaryState,
  ): Partial<BlockRenderErrorBoundaryState> | null {
    if (
      props.blockId === state.blockId &&
      props.blockType === state.blockType &&
      Object.is(props.resetKey, state.resetKey)
    ) {
      return null;
    }
    return {
      error: null,
      blockId: props.blockId,
      blockType: props.blockType,
      resetKey: props.resetKey,
    };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<BlockRenderErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(
      `[BlockRenderErrorBoundary] render failed for ${this.props.blockType}`,
      error,
    );
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <BlockRenderUnavailableFallback
        blockId={this.props.blockId}
        blockType={this.props.blockType}
        interactive={this.props.interactive}
      />
    );
  }
}

function BlockRenderUnavailableFallback({
  blockId,
  blockType,
  interactive,
}: {
  blockId: string;
  blockType: string;
  interactive?: boolean;
}) {
  const t = useT();
  return (
    <BlockRenderErrorFallback
      blockId={blockId}
      blockType={blockType}
      message={t("agentChat.block.renderUnavailable")}
      interactive={interactive}
    />
  );
}

export function BlockRenderSuspenseFallback({
  blockId,
  blockType,
}: {
  blockId: string;
  blockType: string;
}) {
  const t = useT();

  // Server rendering routes both suspension and recoverable errors through
  // this fallback, so it cannot identify a confirmed renderer failure.
  return (
    <div
      role="status"
      aria-label={t("agentChat.block.loading")}
      aria-busy="true"
      data-block-render-loading
      data-block-id={blockId}
      data-block-type={blockType}
      className="space-y-2 rounded-md border border-border px-3 py-2"
    >
      <div
        aria-hidden="true"
        className="skeleton-shimmer h-3 w-1/3 rounded-md bg-muted"
      />
      <div
        aria-hidden="true"
        className="skeleton-shimmer h-3 w-2/3 rounded-md bg-muted"
      />
    </div>
  );
}

export function BlockRenderErrorFallback({
  blockId,
  blockType,
  message,
  rawSource,
  interactive = false,
}: {
  blockId?: string;
  blockType?: string;
  message: string;
  rawSource?: string;
  interactive?: boolean;
}) {
  return (
    <div
      contentEditable={false}
      data-block-render-error
      data-block-id={blockId}
      data-block-type={blockType}
      data-plan-interactive={interactive ? "" : undefined}
      className="space-y-2 rounded-md border border-border px-3 py-2 text-sm"
    >
      {rawSource ? (
        <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs text-foreground">
          {rawSource}
        </pre>
      ) : null}
      <p role="alert" className="text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
