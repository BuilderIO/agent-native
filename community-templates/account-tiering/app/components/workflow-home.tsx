import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  IconArrowUpRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";
import { type WorkflowDefinition, type WorkflowSnapshot } from "@/lib/workflow";

function statusIcon(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("healthy")) {
    return <IconCircleCheck className="size-4 text-emerald-600" />;
  }
  if (normalized.includes("hold") || normalized.includes("watch")) {
    return <IconClock className="size-4 text-amber-600" />;
  }
  if (normalized.includes("lost") || normalized.includes("risk")) {
    return <IconCircleX className="size-4 text-rose-600" />;
  }
  return <IconCircleDashed className="size-4 text-muted-foreground" />;
}

export function WorkflowHome({ workflow }: { workflow: WorkflowDefinition }) {
  const { data } = useActionQuery<WorkflowSnapshot>("get-workflow");
  const selectItem = useActionMutation<{ selectedId: string }, { id: string }>(
    "set-workflow-selection",
  );
  const currentWorkflow = data?.workflow ?? workflow;
  const [selectedId, setSelectedId] = useState(
    currentWorkflow.items[0]?.id ?? "",
  );
  const selectedIdRef = useRef(selectedId);
  const confirmedSelectedIdRef = useRef(selectedId);
  useEffect(() => {
    if (data?.selectedId) {
      selectedIdRef.current = data.selectedId;
      confirmedSelectedIdRef.current = data.selectedId;
      setSelectedId(data.selectedId);
    }
  }, [data?.selectedId]);
  const selected =
    currentWorkflow.items.find((item) => item.id === selectedId) ??
    currentWorkflow.items[0];

  function askAgent() {
    if (!selected) return;
    sendToAgentChat({
      message: `${currentWorkflow.primaryAction} for ${selected.name}.`,
      context: `${currentWorkflow.title} workspace. Selected item: ${selected.name}. ${selected.detail} Status: ${selected.status}. Score: ${selected.score}.`,
      submit: true,
      openSidebar: true,
    });
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">
              {APP_TITLE}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {currentWorkflow.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {currentWorkflow.summary}
            </p>
          </div>
          <Button className="shrink-0 gap-2" onClick={askAgent}>
            <IconSparkles className="size-4" />
            {currentWorkflow.primaryAction}
            <IconArrowUpRight className="size-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <Card className="min-h-0 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b py-4">
              <CardTitle className="text-base">
                {currentWorkflow.queueLabel}
              </CardTitle>
              <div className="text-right">
                <div className="text-lg font-semibold leading-none">
                  {currentWorkflow.metric.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {currentWorkflow.metric.label}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {currentWorkflow.items.map((item) => {
                  const active = item.id === selected?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={selectItem.isPending}
                      onClick={() => {
                        const previousSelectedId =
                          confirmedSelectedIdRef.current;
                        selectedIdRef.current = item.id;
                        setSelectedId(item.id);
                        selectItem.mutate(
                          { id: item.id },
                          {
                            onSuccess: () => {
                              confirmedSelectedIdRef.current = item.id;
                            },
                            onError: () => {
                              if (selectedIdRef.current !== item.id) return;
                              selectedIdRef.current = previousSelectedId;
                              confirmedSelectedIdRef.current =
                                previousSelectedId;
                              setSelectedId(previousSelectedId);
                              toast.error("Could not save selection.");
                            },
                          },
                        );
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        active && "bg-muted/60",
                      )}
                    >
                      <div className="mt-0.5 shrink-0">
                        {statusIcon(item.status)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="truncate text-sm font-medium">
                            {item.name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {item.score}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.meta}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.status}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">
                {currentWorkflow.detailTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              {selected ? (
                <>
                  <div>
                    <div className="text-lg font-semibold">{selected.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {selected.meta}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-6">
                    {selected.detail}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border p-3">
                      <div className="font-medium">{selected.status}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="font-medium">{selected.score}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {currentWorkflow.metric.label}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={askAgent}
                  >
                    {currentWorkflow.primaryAction}
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
