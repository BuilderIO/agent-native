import { AgentChatSurface, type AgentChatSurfaceProps } from "./AgentPanel.js";
import { cn } from "./utils.js";

export interface AgentChatHomeProps extends Omit<
  AgentChatSurfaceProps,
  "className" | "isFullscreen" | "mode" | "style"
> {
  className?: string;
  contentClassName?: string;
  surfaceClassName?: string;
  chatViewTransition?: boolean;
}

export function AgentChatHome({
  className,
  contentClassName,
  surfaceClassName,
  chatViewTransition = true,
  defaultMode = "chat",
  showHeader = false,
  showTabBar = false,
  emptyStateDisplay = "hidden",
  centerComposerWhenEmpty = true,
  composerLayoutVariant = "hero",
  suggestionPlacement = "context-chips",
  homeIntroSlot,
  afterComposerSlot,
  ...props
}: AgentChatHomeProps) {
  return (
    <div className={cn("flex min-h-0 w-full flex-1 bg-background", className)}>
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
          showHeader={showHeader}
          showTabBar={showTabBar}
          emptyStateDisplay={emptyStateDisplay}
          centerComposerWhenEmpty={centerComposerWhenEmpty}
          composerLayoutVariant={composerLayoutVariant}
          suggestionPlacement={suggestionPlacement}
          homeIntroSlot={homeIntroSlot}
          afterComposerSlot={afterComposerSlot}
          chatViewTransition={chatViewTransition}
          className={cn("min-h-0 flex-1", surfaceClassName)}
        />
      </div>
    </div>
  );
}
