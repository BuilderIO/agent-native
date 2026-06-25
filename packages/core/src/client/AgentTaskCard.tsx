import {
  IconLoader2,
  IconCheck,
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
import { cn } from "./utils.js";

export interface AgentTaskCardProps {
  taskId: string;
  threadId: string;
  description: string;
  onOpen?: (threadId: string) => void;
}

/**
 * Rich preview card for a sub-agent task. Listens for agent-task-event
 * CustomEvents to update its state in real-time.
 */
export function AgentTaskCard({
  taskId,
  threadId,
  description,
  onOpen,
}: AgentTaskCardProps) {
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
  const statusLabel = isRunning ? "Running" : isError ? "Error" : "Done";
  const statusClassName = cn(
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium",
    isError
      ? "bg-destructive/10 text-destructive"
      : isComplete
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : "bg-muted text-muted-foreground",
  );

  const displayText = isComplete && summary ? summary : preview;
  const hasContent = displayText.length > 0;
  const emptyMessage = isRunning
    ? "Waiting for updates"
    : isError
      ? "No error details yet"
      : "No summary available";

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-lg border bg-background/50 transition-colors",
        isError
          ? "border-destructive/30"
          : isComplete
            ? "border-emerald-500/20"
            : "border-border",
      )}
    >
      {/* Header */}
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-muted/45"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/70 px-1.5 text-[10px] font-medium text-muted-foreground">
          <IconSubtask className="h-3 w-3" />
          Sub-agent
        </span>

        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {taskTitle}
        </span>

        <span className={statusClassName}>
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : isError ? (
            <IconAlertCircle className="h-3 w-3" />
          ) : (
            <IconCheck className="h-3 w-3" />
          )}
          {statusLabel}
        </span>

        <IconChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-150",
            expanded && "rotate-90",
            "rtl:-scale-x-100",
          )}
        />
      </button>

      {expanded && isRunning && currentStepText && (
        <div className="flex gap-1.5 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-medium text-foreground/70">Now:</span>
          <span className="min-w-0 break-words">{currentStepText}</span>
        </div>
      )}

      {/* Preview content */}
      {expanded && hasContent && (
        <div className="px-3 pb-2 pt-1">
          <div
            ref={previewRef}
            className="agent-markdown prose prose-sm prose-invert max-h-48 max-w-none overflow-y-auto break-words rounded-md border border-border/50 bg-muted/25 px-3 py-2 text-xs text-muted-foreground"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayText.length > 800
                ? "..." + displayText.slice(-800)
                : displayText}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Footer with Open / Stop buttons */}
      {expanded && (
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/60">
            {!hasContent ? emptyMessage : ""}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {isRunning && (
              <button
                onClick={handleStop}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label="Stop sub-agent"
              >
                <IconPlayerStop className="h-3 w-3" />
                Stop
              </button>
            )}
            <button
              onClick={handleOpen}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Open thread
              <IconExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
