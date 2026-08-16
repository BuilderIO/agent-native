import {
  IconLoader2,
  IconChevronRight,
  IconExternalLink,
  IconAlertCircle,
  IconPlayerStop,
  IconSubtask,
} from "@tabler/icons-react";
import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { agentNativePath } from "./api-path.js";
import { useT } from "./i18n.js";
import { cn } from "./utils.js";

export interface AgentTaskCardProps {
  taskId: string;
  threadId: string;
  description: string;
  onOpen?: (threadId: string) => void;
}

/**
 * Inline tool-call presentation for a spawned sub-agent. Listens for
 * agent-task-event CustomEvents to update its streamed output in real-time.
 */
export function AgentTaskCard({
  taskId,
  threadId,
  description,
  onOpen,
}: AgentTaskCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [status, setStatus] = useState<"running" | "completed" | "errored">(
    "running",
  );
  const [preview, setPreview] = useState("");
  const [currentStep, setCurrentStep] = useState("");
  const [summary, setSummary] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEvent(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.taskId || detail.taskId !== taskId) return;

      if (detail.type === "agent_task_update") {
        if (detail.preview != null) setPreview(detail.preview);
        if (detail.currentStep != null) setCurrentStep(detail.currentStep);
      } else if (detail.type === "agent_task_complete") {
        setStatus("completed");
        if (detail.summary) setSummary(detail.summary);
        setCurrentStep("");
      } else if (detail.type === "agent_task" && detail.status === "errored") {
        setStatus("errored");
        setCurrentStep("");
      }
    }

    window.addEventListener("agent-task-event", handleEvent);
    return () => window.removeEventListener("agent-task-event", handleEvent);
  }, [taskId]);

  // Poll for task status when running — the main chat's SSE stream may close
  // before the sub-agent completes, so SSE events alone aren't reliable.
  useEffect(() => {
    if (status !== "running") return;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 3000));
        if (stopped) break;
        try {
          const res = await fetch(
            agentNativePath(
              `/_agent-native/application-state/agent-task:${taskId}`,
            ),
          );
          if (!res.ok) continue;
          const data = await res.json();
          // The HTTP handler returns the value directly (not wrapped)
          const task = data?.value ?? data;
          if (!task || !task.status) continue;
          if (task.status === "completed") {
            setStatus("completed");
            if (task.summary) setSummary(task.summary);
            if (task.preview) setPreview(task.preview);
            setCurrentStep("");
            break;
          } else if (task.status === "errored") {
            setStatus("errored");
            if (task.summary) setSummary(task.summary);
            setCurrentStep("");
            break;
          } else {
            // Still running — update preview from persisted state
            if (task.preview) setPreview(task.preview);
            if (task.currentStep) setCurrentStep(task.currentStep);
          }
        } catch {
          // Polling error — continue
        }
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [status, taskId, threadId]);

  // Auto-scroll preview to bottom
  useEffect(() => {
    if (previewRef.current && status === "running") {
      previewRef.current.scrollTop = previewRef.current.scrollHeight;
    }
  }, [preview, status]);

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpen?.(threadId);
    },
    [onOpen, threadId],
  );

  const handleStop = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      // Optimistic UI: mark stopped immediately
      setStatus("errored");
      setCurrentStep("");
      try {
        await fetch(
          agentNativePath(
            `/_agent-native/agent-chat/runs/run-task-${taskId}/stop`,
          ),
          {
            method: "POST",
            headers: { "X-Agent-Native-CSRF": "1" },
          },
        );
      } catch {
        // best-effort
      }
    },
    [taskId],
  );

  const isRunning = status === "running";
  const isComplete = status === "completed";
  const isError = status === "errored";

  const taskTitle = description.trim() || "Task";
  const currentStepText = currentStep.trim();
  const displayText = isComplete && summary ? summary : preview;
  const hasContent = displayText.length > 0;
  const statusLabel = isRunning ? "Running" : isError ? "Error" : "Done";

  return (
    <div className="group/agent my-0.5 w-full">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {isRunning ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : isError ? (
            <IconAlertCircle className="size-3.5 text-destructive" />
          ) : (
            <>
              <IconSubtask
                className={cn(
                  "size-3.5 transition-opacity",
                  "group-hover/agent:opacity-0",
                )}
              />
              <IconChevronRight
                className={cn(
                  "absolute size-3.5 opacity-0 transition-[opacity,transform] group-hover/agent:opacity-100",
                  expanded && "rotate-90",
                )}
              />
            </>
          )}
        </span>
        <span
          className={cn(
            "min-w-0 truncate font-normal",
            isRunning && "agent-running-shimmer",
          )}
        >
          {t("agentTask.spawnedAgent")}: {taskTitle}
        </span>
        <span className="sr-only">{statusLabel}</span>
      </button>

      {expanded && (
        <div className="ms-1 border-s border-border/50 ps-2 pt-1">
          {isRunning && currentStepText && (
            <p
              className="ps-5 pb-1 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {currentStepText}
            </p>
          )}
          {hasContent && (
            <div className="ps-5 pb-1">
              <div
                ref={previewRef}
                aria-live={isRunning ? "polite" : undefined}
                data-streaming={isRunning ? "true" : undefined}
                className="agent-markdown prose prose-sm prose-invert max-h-48 max-w-none overflow-y-auto break-words text-xs text-muted-foreground"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {displayText.length > 800
                    ? "..." + displayText.slice(-800)
                    : displayText}
                </ReactMarkdown>
              </div>
            </div>
          )}
          {/* Keep task controls in the same compact tool-call rail. */}
          <div className="flex items-center gap-1 ps-5 pb-1">
            {isRunning && (
              <button
                onClick={handleStop}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                aria-label={t("agentTask.stop")}
              >
                <IconPlayerStop className="size-3" />
                Stop
              </button>
            )}
            <button
              onClick={handleOpen}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t("agentTask.openThread")}
              <IconExternalLink className="size-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
