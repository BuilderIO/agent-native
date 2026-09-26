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
          showHeader={showHeader}
          showTabBar={showTabBar}
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
