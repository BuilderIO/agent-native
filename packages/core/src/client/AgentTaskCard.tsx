import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconLoader2,
  IconCheck,
  IconChevronRight,
  IconExternalLink,
  IconAlertCircle,
  IconSubtask,
} from "@tabler/icons-react";
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
    let pollCount = 0;
    const poll = async () => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 3000));
        if (stopped) break;
        pollCount++;
        try {
          const res = await fetch(
            `/_agent-native/application-state/agent-task:${taskId}`,
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

          // Fallback: every 5th poll, check if the sub-agent's run is still
          // active. If it's gone (completed without updating app-state), mark
          // the task as completed so the card doesn't spin forever.
          if (pollCount % 5 === 0) {
            try {
              const runRes = await fetch(
                `/_agent-native/agent-chat/runs/active?threadId=${encodeURIComponent(threadId)}`,
              );
              if (runRes.ok) {
                const runData = await runRes.json();
                // null or non-running status means the run finished
                if (
                  !runData ||
                  runData.status === "completed" ||
                  runData.status === "errored"
                ) {
                  const finalStatus =
                    runData?.status === "errored" ? "errored" : "completed";
                  setStatus(finalStatus);
                  setCurrentStep("");
                  setSummary(
                    (prev) => prev || task?.preview || "Task completed.",
                  );
                  break;
                }
              }
            } catch {
              // Fallback check failed — continue normal polling
            }
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

  const isRunning = status === "running";
  const isComplete = status === "completed";
  const isError = status === "errored";

  const displayText = isComplete && summary ? summary : preview;
  const hasContent = displayText.length > 0;

  return (
    <div
      className={cn(
        "my-2 rounded-lg border overflow-hidden transition-colors",
        isError
          ? "border-destructive/30"
          : isComplete
            ? "border-emerald-500/20"
            : "border-border",
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : isError ? (
            <IconAlertCircle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <IconCheck className="h-3.5 w-3.5 text-emerald-500" />
          )}
        </span>

        <IconSubtask className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />

        <span className="text-xs font-medium truncate min-w-0 flex-1">
          {description}
        </span>

        {currentStep && isRunning && (
          <span className="text-[10px] text-muted-foreground/70 truncate max-w-[180px] shrink-0">
            {currentStep}
          </span>
        )}

        {isComplete && (
          <span className="text-[10px] text-emerald-500/70 shrink-0">Done</span>
        )}

        <IconChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
      </div>

      {/* Preview content */}
      {expanded && hasContent && (
        <div className="px-3 pb-2">
          <div
            ref={previewRef}
            className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground break-words max-h-48 overflow-y-auto agent-markdown prose prose-sm prose-invert max-w-none"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayText.length > 800
                ? "..." + displayText.slice(-800)
                : displayText}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Footer with Open button */}
      {expanded && (
        <div className="flex items-center justify-between px-3 pb-2">
          {isRunning && !hasContent && (
            <span className="text-[10px] text-muted-foreground/50">
              Working...
            </span>
          )}
          {!isRunning && !hasContent && <span />}
          {hasContent && <span />}
          <button
            onClick={handleOpen}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            Open
            <IconExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
