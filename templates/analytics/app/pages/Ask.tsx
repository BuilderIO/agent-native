import { AgentChatSurface } from "@agent-native/core/client";
import {
  IconMessageCircle,
  IconDatabase,
  IconChartBar,
} from "@tabler/icons-react";

export default function AskPage() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="h-full"
        defaultMode="chat"
        restoreActiveThread={false}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask Analytics about your data."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask about data, dashboards, metrics, or sources..."
        composerSlot={
          <div className="mx-auto mb-6 flex max-w-2xl flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted/30 text-foreground">
              <IconMessageCircle className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Ask Analytics
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                Use the assistant to inspect connected data, explain metrics,
                compare dashboards, or decide what to build next.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <IconDatabase className="h-3.5 w-3.5" />
                Sources
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <IconChartBar className="h-3.5 w-3.5" />
                Dashboards
              </span>
            </div>
          </div>
        }
      />
    </div>
  );
}
