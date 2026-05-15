import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconCheck, IconClock, IconX } from "@tabler/icons-react";
import { type ReviewQueueResponse, sampleReviewItems } from "@/lib/brain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
  PriorityBadge,
} from "@/components/brain/Surface";

export default function ReviewRoute() {
  const [params, setParams] = useSearchParams();
  const priority = params.get("priority") ?? "all";

  const reviewQuery = useActionQuery<ReviewQueueResponse>(
    "list-proposals" as any,
    { priority: priority === "all" ? undefined : priority } as any,
  );
  const decide = useActionMutation<
    unknown,
    { id: string; decision: "approve" | "reject" | "needs_changes" }
  >("review-proposal" as any);

  const actionItems = reviewQuery.data?.items ?? reviewQuery.data?.proposals;
  const items = actionItems?.length ? actionItems : sampleReviewItems;
  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        priority === "all" ? true : (item.priority ?? "medium") === priority,
      ),
    [items, priority],
  );

  function updatePriority(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("priority");
    else next.set("priority", value);
    setParams(next, { replace: true });
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Review"
        title="Memory review queue"
        description="Approve, reject, or send proposed memories back for changes before they become durable company knowledge."
        actions={
          <Select value={priority} onValueChange={updatePriority}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        {reviewQuery.isLoading ? (
          <LoadingRows rows={4} />
        ) : filteredItems.length ? (
          <div className="grid gap-4">
            {filteredItems.map((item) => (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                          {item.title}
                        </CardTitle>
                        <PriorityBadge priority={item.priority ?? "medium"} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.sourceName ?? item.sourceId ?? "Source"} ·{" "}
                        {item.createdAt ?? "Queued"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate({
                            id: item.id,
                            decision: "needs_changes",
                          })
                        }
                      >
                        <IconClock className="size-4" />
                        Needs changes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate({ id: item.id, decision: "reject" })
                        }
                      >
                        <IconX className="size-4" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate({ id: item.id, decision: "approve" })
                        }
                      >
                        <IconCheck className="size-4" />
                        Approve
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="rounded-md border border-border bg-muted/35 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Proposed memory
                    </p>
                    <p className="mt-2 text-sm leading-7">
                      {item.proposedAnswer ?? item.body ?? "No proposal body."}
                    </p>
                  </div>
                  <Separator />
                  <div className="grid gap-2 text-sm md:grid-cols-[160px_1fr]">
                    <span className="text-muted-foreground">Reason</span>
                    <span>
                      {item.reason ?? item.rationale ?? "Needs review"}
                    </span>
                    <span className="text-muted-foreground">Source</span>
                    <span>{item.sourceName ?? item.sourceId ?? "Source"}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyActionState
            title="No review items"
            detail="Brain has no proposed memories matching this priority filter."
          />
        )}

        {reviewQuery.isError || decide.isError ? (
          <EmptyActionState
            title="Review actions are not available yet"
            detail="This queue is wired to list-proposals and review-proposal and is showing scaffold data until they land."
          />
        ) : null}
      </div>
    </div>
  );
}
