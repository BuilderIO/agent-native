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
  resetKey: unknown;
};

export class BlockRenderErrorBoundary extends Component<
  BlockRenderErrorBoundaryProps,
  BlockRenderErrorBoundaryState
> {
  constructor(props: BlockRenderErrorBoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromProps(
    props: BlockRenderErrorBoundaryProps,
    state: BlockRenderErrorBoundaryState,
  ): Partial<BlockRenderErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
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
      <BlockRenderErrorFallback
        blockId={this.props.blockId}
        blockType={this.props.blockType}
        message={this.state.error.message}
        interactive={this.props.interactive}
      />
    );
  }
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
