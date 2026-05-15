import { useMemo } from "react";
import { AgentChatSurface, useActionQuery } from "@agent-native/core/client";
import {
  IconBook2,
  IconChecks,
  IconDatabase,
  IconMessageCircle,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link } from "react-router";
import {
  type ReviewQueueResponse,
  type SourcesResponse,
  sampleReviewItems,
  sampleSources,
  sourceHealth,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const assistantSuggestions = [
  "What were the most important product decisions we made recently, and why?",
  "How does the current in-development Brain feature work and why?",
  "What unresolved company questions should leadership review?",
  "What customer context should I know before this week's roadmap review?",
];

export default function AskRoute() {
  const reviewQuery = useActionQuery<ReviewQueueResponse>(
    "list-proposals" as any,
    {} as any,
  );
  const sourcesQuery = useActionQuery<SourcesResponse>(
    "list-sources" as any,
    { includeArchived: false } as any,
  );

  const reviewItems = reviewQuery.data?.items ?? reviewQuery.data?.proposals;
  const reviewQueue = reviewItems?.length ? reviewItems : sampleReviewItems;
  const sources = sourcesQuery.data?.sources?.length
    ? sourcesQuery.data.sources
    : sampleSources;
  const healthySources = useMemo(
    () => sources.filter((source) => sourceHealth(source) === "healthy").length,
    [sources],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="brain-chat-panel"
        defaultMode="chat"
        emptyStateText="Ask your company anything."
        suggestions={assistantSuggestions}
        chatNotice={
          <BrainChatNotice
            sources={sources.length}
            healthySources={healthySources}
            reviewCount={reviewQueue.length}
          />
        }
      />
    </div>
  );
}

function BrainChatNotice({
  sources,
  healthySources,
  reviewCount,
}: {
  sources: number;
  healthySources: number;
  reviewCount: number;
}) {
  return (
    <div className="flex flex-col gap-2 bg-background/95 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <IconMessageCircle className="size-3" />
          Company assistant
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <IconShieldCheck className="size-3" />
          Cited answers
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <IconDatabase className="size-3" />
          {healthySources}/{sources} sources healthy
        </Badge>
        {reviewCount > 0 ? (
          <Badge variant="outline" className="gap-1.5">
            <IconChecks className="size-3" />
            {reviewCount} to review
          </Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button asChild variant="ghost" size="sm">
          <Link to="/knowledge">
            <IconBook2 className="size-4" />
            Knowledge
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/sources">
            <IconDatabase className="size-4" />
            Sources
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings">
            <IconSettings className="size-4" />
            Customize
          </Link>
        </Button>
      </div>
    </div>
  );
}
