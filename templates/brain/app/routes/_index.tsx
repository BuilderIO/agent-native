import { AgentChatSurface, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconChecks,
  IconDatabase,
  IconMessageCircle,
} from "@tabler/icons-react";
import { Link } from "react-router";
import { type BrainHealthResponse } from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const assistantSuggestions = [
  "What changed in our product direction recently, and what sources support it?",
  "What customer context should I know before this week's roadmap discussion?",
  "Which open decisions are waiting for review?",
  "What do we know about our current launch plan?",
];

export default function AskRoute() {
  const healthQuery = useActionQuery<BrainHealthResponse>(
    "get-brain-health" as any,
    {} as any,
  );
  const health = healthQuery.data;
  const sourceCount = health?.sources.total ?? 0;
  const healthySources = health?.sources.healthy ?? 0;
  const reviewCount = health?.proposals.pending ?? 0;
  const attentionCount =
    (health?.sources.needsSetup ?? 0) +
    (health?.sources.needsSync ?? 0) +
    (health?.sources.stale ?? 0) +
    (health?.sources.error ?? 0) +
    (health?.distillationQueue.failed ?? 0) +
    (health?.distillationQueue.stale ?? 0);
  const needsFirstSource =
    !healthQuery.isLoading && Boolean(health) && sourceCount === 0;
  const showNotice = needsFirstSource || reviewCount > 0 || attentionCount > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="brain-chat-panel"
        defaultMode="chat"
        emptyStateText="Ask Brain about company memory."
        suggestions={assistantSuggestions}
        emptyStateAddon={needsFirstSource ? <FirstSourcePrompt /> : undefined}
        chatNotice={
          showNotice ? (
            <BrainChatNotice
              attentionCount={attentionCount}
              reviewCount={reviewCount}
              sourceCount={sourceCount}
              healthySources={healthySources}
              needsFirstSource={needsFirstSource}
            />
          ) : undefined
        }
      />
    </div>
  );
}

function FirstSourcePrompt() {
  return (
    <div className="w-full max-w-[380px] rounded-md border border-border bg-card p-4 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <IconDatabase className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Connect one source</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Brain gets useful once it has an approved place to read from.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Button asChild size="sm">
          <Link to="/sources">
            <IconDatabase className="size-4" />
            Add source
          </Link>
        </Button>
      </div>
    </div>
  );
}

function BrainChatNotice({
  attentionCount,
  reviewCount,
  sourceCount,
  healthySources,
  needsFirstSource,
}: {
  attentionCount: number;
  reviewCount: number;
  sourceCount: number;
  healthySources: number;
  needsFirstSource: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-background/95 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <IconMessageCircle className="size-3" />
          Cited answers
        </Badge>
        {sourceCount > 0 ? (
          <Badge variant="outline" className="gap-1.5">
            <IconDatabase className="size-3" />
            {healthySources}/{sourceCount} sources healthy
          </Badge>
        ) : null}
        {reviewCount > 0 ? (
          <Badge variant="outline" className="gap-1.5">
            <IconChecks className="size-3" />
            {reviewCount} to review
          </Badge>
        ) : null}
        {attentionCount > 0 ? (
          <Badge variant="outline" className="gap-1.5">
            <IconAlertTriangle className="size-3" />
            {attentionCount} need attention
          </Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {needsFirstSource || attentionCount > 0 ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/sources">Sources</Link>
          </Button>
        ) : null}
        {reviewCount > 0 ? (
          <Button asChild size="sm">
            <Link to="/review">Review</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
