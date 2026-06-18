import { AgentChatSurface, type AgentChatSurfaceProps } from "./AgentPanel.js";
import { cn } from "./utils.js";

export interface AgentChatHomeProps extends Omit<
  AgentChatSurfaceProps,
  "className" | "isFullscreen" | "mode" | "style"
> {
  /** CSS class for the full-page shell around the chat surface. */
  className?: string;
  /** CSS class for the inner width/height rail. */
  contentClassName?: string;
  /** CSS class for the AgentChatSurface itself. */
  surfaceClassName?: string;
  /**
   * Apply the shared chat view-transition name to the surface so it can morph
   * into an AgentSidebar with `chatViewTransition` enabled.
   * Default: true.
   */
  chatViewTransition?: boolean;
}

/**
 * Minimal full-page chat route primitive for chat-first apps.
 *
 * It keeps the actual chat runtime in AgentChatSurface while providing a stable
 * first-viewport shell that templates can use for `/`, `/ask`, or `/chat`.
 */
export function AgentChatHome({
  className,
  contentClassName,
  surfaceClassName,
  chatViewTransition = true,
  defaultMode = "chat",
  ...props
}: AgentChatHomeProps) {
  return (
    <main
      className={cn(
        "flex min-h-screen w-full bg-background px-3 py-3 sm:px-4 sm:py-4",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col",
          contentClassName,
        )}
      >
        <AgentChatSurface
          {...props}
          mode="page"
          defaultMode={defaultMode}
          chatViewTransition={chatViewTransition}
          className={cn(
            "min-h-0 flex-1 rounded-lg border border-border shadow-sm",
            surfaceClassName,
          )}
        />
      </div>
    </main>
  );
}
