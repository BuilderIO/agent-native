import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import {
  useJob,
  useJobPipeline,
  useMoveApplication,
} from "@/hooks/use-greenhouse";
import { cn, daysAgo, getInitials, getAvatarColor } from "@/lib/utils";
import {
  IconArrowLeft,
  IconLoader2,
  IconGripVertical,
  IconUser,
} from "@tabler/icons-react";
import type { PipelineStage, GreenhouseApplication } from "@shared/types";

export function JobDetailPage() {
  const { jobId } = useParams();
  const id = Number(jobId);
  const navigate = useNavigate();
  const { data: job, isLoading: jobLoading } = useJob(id);
  const { data: pipeline = [], isLoading: pipelineLoading } =
    useJobPipeline(id);
  const moveApp = useMoveApplication();

  const [dragState, setDragState] = useState<{
    applicationId: number;
    fromStageId: number;
  } | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<number | null>(null);

  const isLoading = jobLoading || pipelineLoading;

  const handleDragStart = (
    e: React.DragEvent,
    applicationId: number,
    fromStageId: number,
  ) => {
    setDragState({ applicationId, fromStageId });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStageId(stageId);
  };

  const handleDragLeave = () => {
    setDragOverStageId(null);
  };

  const handleDrop = (e: React.DragEvent, toStageId: number) => {
    e.preventDefault();
    setDragOverStageId(null);
    if (!dragState || dragState.fromStageId === toStageId) return;

    moveApp.mutate({
      applicationId: dragState.applicationId,
      fromStageId: dragState.fromStageId,
      toStageId,
    });
    setDragState(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 h-14 flex-shrink-0">
        <button
          onClick={() => navigate("/jobs")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-foreground truncate">
            {job.name}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {job.departments.map((d) => d.name).join(", ")}
            {job.offices.length > 0 && (
              <span> &middot; {job.offices.map((o) => o.name).join(", ")}</span>
            )}
          </div>
        </div>
        <span
          className={cn(
            "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            job.status === "open"
              ? "bg-green-500/10 text-green-600"
              : job.status === "closed"
                ? "bg-red-500/10 text-red-600"
                : "bg-yellow-500/10 text-yellow-600",
          )}
        >
          {job.status}
        </span>
      </div>

      {/* Pipeline board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex h-full gap-3 p-4 min-w-max">
          {pipeline.map((stage) => (
            <div
              key={stage.stage.id}
              className={cn(
                "pipeline-column flex w-64 flex-col rounded-lg border border-border bg-muted/30 flex-shrink-0",
                dragOverStageId === stage.stage.id && "drag-over",
              )}
              onDragOver={(e) => handleDragOver(e, stage.stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.stage.id)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                <span className="text-xs font-medium text-foreground truncate">
                  {stage.stage.name}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums ml-2">
                  {stage.applications.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {stage.applications.map((app) => (
                  <CandidateCard
                    key={app.id}
                    app={app}
                    stageId={stage.stage.id}
                    onDragStart={handleDragStart}
                  />
                ))}
                {stage.applications.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground/50">
                    No candidates
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  app,
  stageId,
  onDragStart,
}: {
  app: GreenhouseApplication & {
    candidate_name: string;
    candidate_company: string | null;
  };
  stageId: number;
  onDragStart: (
    e: React.DragEvent,
    applicationId: number,
    fromStageId: number,
  ) => void;
}) {
  const navigate = useNavigate();
  const days = daysAgo(app.last_activity_at || app.applied_at);
  const initials = getInitials(app.candidate_name);
  const color = getAvatarColor(app.candidate_name);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, app.id, stageId)}
      onClick={() => navigate(`/candidates/${app.candidate_id}`)}
      className="pipeline-card rounded-md border border-border bg-background p-3 cursor-pointer hover:border-border/80 hover:bg-accent/30"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
            color,
          )}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground truncate">
            {app.candidate_name}
          </div>
          {app.candidate_company && (
            <div className="text-[11px] text-muted-foreground truncate">
              {app.candidate_company}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        {app.source && <span>{app.source.public_name}</span>}
        {days > 0 && <span>&middot; {days}d in stage</span>}
      </div>
    </div>
  );
}
