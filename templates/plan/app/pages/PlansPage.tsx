import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconCursorText,
  IconMessageCircle,
  IconMoon,
  IconPlus,
  IconShare3,
  IconSparkles,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSetPageTitle } from "@/components/layout/HeaderActions";
import {
  useCreatePlan,
  usePlan,
  usePlans,
  useUpdatePlan,
  useVisualizePlan,
} from "@/hooks/use-plans";
import { cn } from "@/lib/utils";
import type { PlanBundle, PlanSource } from "@shared/types";

const SOURCE_OPTIONS: Array<{ value: PlanSource; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "pi", label: "Pi" },
  { value: "manual", label: "Manual" },
  { value: "imported", label: "Imported" },
];

type PlanAnnotationAnchor = {
  x: number;
  y: number;
  sectionId?: string;
  sectionTitle?: string;
  snippet?: string;
  tagName?: string;
};

type RuntimeAnnotation = {
  id: string;
  index: number;
  message: string;
  kind: string;
  status: string;
  createdAt?: string;
  anchor: PlanAnnotationAnchor;
};

type InlineCommentPosition = {
  left: number;
  top: number;
  pinLeft: number;
  pinTop: number;
  width: number;
};

type PlanDocumentState = {
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveInlineCommentPosition(input: {
  pointX: number;
  pointY: number;
  viewportWidth: number;
  viewportHeight: number;
}): InlineCommentPosition {
  const popoverWidth = Math.min(360, Math.max(260, input.viewportWidth - 32));
  const popoverHeight = 158;
  const gap = 14;
  const opensRight =
    input.pointX + popoverWidth + gap + 16 <= input.viewportWidth;
  const left = opensRight
    ? input.pointX + gap
    : input.pointX - popoverWidth - gap;
  return {
    pinLeft: clamp(input.pointX, 12, Math.max(12, input.viewportWidth - 12)),
    pinTop: clamp(input.pointY, 12, Math.max(12, input.viewportHeight - 12)),
    left: clamp(
      left,
      12,
      Math.max(12, input.viewportWidth - popoverWidth - 12),
    ),
    top: clamp(
      input.pointY - 18,
      12,
      Math.max(12, input.viewportHeight - popoverHeight - 12),
    ),
    width: popoverWidth,
  };
}

export function PlansPage() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const documentStateRef = useRef<PlanDocumentState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [planFullscreen, setPlanFullscreen] = useState(true);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] =
    useState<PlanAnnotationAnchor | null>(null);
  const [inlineCommentPosition, setInlineCommentPosition] =
    useState<InlineCommentPosition | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<{
    annotation: RuntimeAnnotation;
    position: InlineCommentPosition;
  } | null>(null);
  const plansQuery = usePlans();
  const plans = plansQuery.data ?? [];
  const selectedId = params.id;
  const immersiveReader = Boolean(selectedId && planFullscreen);
  const planQuery = usePlan(selectedId);
  const bundle = planQuery.data;
  const createPlan = useCreatePlan();
  const visualizePlan = useVisualizePlan();
  const updatePlan = useUpdatePlan();
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkTheme = resolvedTheme !== "light";
  const planTheme = isDarkTheme ? "dark" : "light";

  useSetPageTitle(bundle?.plan.title || "Plans");

  const documentHtml = useMemo(() => {
    if (!bundle) return "";
    return bundle.html || bundle.plan.html || buildClientPlanHtml(bundle);
  }, [bundle]);

  const annotatedDocumentHtml = useMemo(() => {
    if (!bundle) return "";
    return injectAnnotationRuntime(
      documentHtml,
      bundle.comments,
      annotateMode,
      planTheme,
    );
  }, [annotateMode, bundle, documentHtml, planTheme]);

  const getPositionFromAnchor = useCallback((anchor: PlanAnnotationAnchor) => {
    const rect = iframeRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const doc = documentStateRef.current;
    const pointX = doc
      ? ((anchor.x / 100) * doc.scrollWidth - doc.scrollX) *
        (rect.width / Math.max(doc.clientWidth, 1))
      : (anchor.x / 100) * rect.width;
    const pointY = doc
      ? ((anchor.y / 100) * doc.scrollHeight - doc.scrollY) *
        (rect.height / Math.max(doc.clientHeight, 1))
      : (anchor.y / 100) * rect.height;
    return resolveInlineCommentPosition({
      pointX,
      pointY,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as
        | {
            type?: string;
            anchor?: PlanAnnotationAnchor;
            comment?: RuntimeAnnotation;
            href?: string;
            state?: PlanDocumentState;
          }
        | undefined;
      if (data?.type === "agent-native-plan-annotate" && data.anchor) {
        setActiveAnnotation(null);
        setPendingAnnotation(data.anchor);
        setInlineCommentPosition(getPositionFromAnchor(data.anchor));
      }
      if (
        data?.type === "agent-native-plan-open-comment" &&
        data.comment?.anchor
      ) {
        const position = getPositionFromAnchor(data.comment.anchor);
        if (position) {
          closeInlineComment();
          setAnnotationsOpen(false);
          setActiveAnnotation({ annotation: data.comment, position });
        }
      }
      if (data?.type === "agent-native-plan-close-comment-popover") {
        setActiveAnnotation(null);
      }
      if (data?.type === "agent-native-plan-link-blocked") {
        toast.info(
          "Plan links are disabled in review so the document stays put.",
        );
      }
      if (data?.type === "agent-native-plan-doc-state" && data.state) {
        documentStateRef.current = data.state;
        setActiveAnnotation((current) => {
          if (!current) return current;
          const position = getPositionFromAnchor(current.annotation.anchor);
          return position ? { ...current, position } : current;
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [getPositionFromAnchor]);

  const closeInlineComment = () => {
    setAnnotateMode(false);
    setPendingAnnotation(null);
    setInlineCommentPosition(null);
  };

  const copyShareLink = async () => {
    if (!selectedId) return;
    const url = `${window.location.origin}/plans/${selectedId}`;
    await navigator.clipboard.writeText(url);
    toast.success("Plan link copied");
  };

  const handleAnnotationClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const doc = documentStateRef.current;
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    setActiveAnnotation(null);
    const x = doc
      ? ((clickX + doc.scrollX) / Math.max(doc.scrollWidth, 1)) * 100
      : (clickX / Math.max(rect.width, 1)) * 100;
    const y = doc
      ? ((clickY + doc.scrollY) / Math.max(doc.scrollHeight, 1)) * 100
      : (clickY / Math.max(rect.height, 1)) * 100;
    setPendingAnnotation({
      x: Number(Math.max(0, Math.min(100, x)).toFixed(3)),
      y: Number(Math.max(0, Math.min(100, y)).toFixed(3)),
      sectionTitle: "Visible plan area",
    });
    setInlineCommentPosition(
      resolveInlineCommentPosition({
        pointX: clickX,
        pointY: clickY,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
      }),
    );
  };

  const submitInlineComment = (message: string) => {
    if (!bundle || !pendingAnnotation) return;
    const sectionId =
      pendingAnnotation.sectionId &&
      bundle.sections.some(
        (section) => section.id === pendingAnnotation.sectionId,
      )
        ? pendingAnnotation.sectionId
        : undefined;
    updatePlan.mutate(
      {
        planId: bundle.plan.id,
        comments: [
          {
            kind: "annotation",
            message,
            sectionId,
            anchor: JSON.stringify(pendingAnnotation),
            createdBy: "human",
          },
        ],
        note: "Human added inline visual plan feedback.",
      },
      {
        onSuccess: () => {
          closeInlineComment();
          toast.success("Comment added");
        },
      },
    );
  };

  return (
    <div className="plans-workspace flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div
        className="plans-grid grid min-h-0 flex-1"
        data-view={immersiveReader ? "immersive" : "app"}
        data-rail={railCollapsed ? "collapsed" : "expanded"}
      >
        {!immersiveReader && (
          <aside className="plans-rail-pane flex min-h-0 flex-col border-b border-border bg-muted/15 md:border-b-0">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
              {!railCollapsed && (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">Plans</p>
                  <p className="text-xs text-muted-foreground">
                    {plans.length} document{plans.length === 1 ? "" : "s"}
                  </p>
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    onClick={() => setRailCollapsed((value) => !value)}
                    aria-label={
                      railCollapsed ? "Expand plan list" : "Collapse plan list"
                    }
                  >
                    {railCollapsed ? (
                      <IconChevronRight className="size-4" />
                    ) : (
                      <IconChevronLeft className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {railCollapsed ? "Expand plan list" : "Collapse plan list"}
                </TooltipContent>
              </Tooltip>
            </div>
            {railCollapsed ? (
              <div className="flex flex-col items-center gap-2 p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setCreateOpen(true)}
                  aria-label="New plan"
                >
                  <IconPlus className="size-4" />
                </Button>
                {plans.slice(0, 8).map((plan) => (
                  <Tooltip key={plan.id}>
                    <TooltipTrigger asChild>
                      <Link
                        to={`/plans/${plan.id}`}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-md border text-xs font-medium",
                          selectedId === plan.id
                            ? "border-foreground/20 bg-accent text-foreground"
                            : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )}
                      >
                        {plan.title.slice(0, 1).toUpperCase()}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{plan.title}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-2 p-3">
                  {plansQuery.isLoading ? (
                    <>
                      <Skeleton className="h-24 rounded-lg" />
                      <Skeleton className="h-24 rounded-lg" />
                    </>
                  ) : plans.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      Create a plan to see the visual plan surface.
                    </div>
                  ) : (
                    plans.map((plan) => (
                      <Link
                        key={plan.id}
                        to={`/plans/${plan.id}`}
                        className={cn(
                          "block rounded-lg border p-3 transition-colors",
                          selectedId === plan.id
                            ? "border-foreground/20 bg-accent/60"
                            : "border-border bg-background/30 hover:bg-accent/35",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium">
                            {plan.title}
                          </p>
                          {plan.openCommentCount > 0 && (
                            <Badge variant="secondary" className="shrink-0">
                              {plan.openCommentCount}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {plan.brief}
                        </p>
                        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{statusLabel(plan.status)}</span>
                          <span>·</span>
                          <span>{shortDate(plan.updatedAt)}</span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </aside>
        )}

        <section className="flex min-h-0 min-w-0 flex-col">
          {!params.id ? (
            <PlansOverview
              plans={plans}
              isLoading={plansQuery.isLoading}
              onCreate={() => setCreateOpen(true)}
            />
          ) : !bundle && planQuery.isLoading ? (
            <PlanSkeleton />
          ) : !bundle ? (
            <EmptyPlan onCreate={() => setCreateOpen(true)} />
          ) : (
            <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
              <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/82 p-1 shadow-2xl backdrop-blur-xl">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={() =>
                        setPlanFullscreen((value) => {
                          if (value) closeInlineComment();
                          return !value;
                        })
                      }
                      aria-label={
                        immersiveReader
                          ? "Minimize to app view"
                          : "Open full screen"
                      }
                    >
                      {immersiveReader ? (
                        <IconArrowsMinimize className="size-4" />
                      ) : (
                        <IconArrowsMaximize className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {immersiveReader ? "App view" : "Full screen"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
                      aria-label={
                        isDarkTheme
                          ? "Switch to light mode"
                          : "Switch to dark mode"
                      }
                    >
                      {isDarkTheme ? (
                        <IconSun className="size-4" />
                      ) : (
                        <IconMoon className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isDarkTheme ? "Light mode" : "Dark mode"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={copyShareLink}
                      aria-label="Share plan"
                    >
                      <IconShare3 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy share link</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={annotateMode ? "secondary" : "default"}
                      size="sm"
                      className="pointer-events-auto relative"
                      onClick={() => {
                        if (annotateMode) {
                          closeInlineComment();
                          return;
                        }
                        setActiveAnnotation(null);
                        setAnnotationsOpen(false);
                        setAnnotateMode(true);
                      }}
                    >
                      <IconCursorText className="size-4" />
                      {annotateMode ? "Cancel" : "Comment"}
                      {!annotateMode && bundle.summary.openCommentCount > 0 && (
                        <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-background/20 text-[10px] font-medium">
                          {bundle.summary.openCommentCount}
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Click anywhere in the plan to pin feedback
                  </TooltipContent>
                </Tooltip>
              </div>
              {annotateMode && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border/70 bg-background/82 px-3 py-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-xl">
                  Click the plan to pin feedback
                </div>
              )}
              <iframe
                ref={iframeRef}
                title={`${bundle.plan.title} plan`}
                srcDoc={annotatedDocumentHtml}
                sandbox="allow-forms allow-scripts"
                className={cn(
                  "h-full min-h-full w-full border-0 bg-background",
                  annotateMode && "ring-1 ring-inset ring-primary/35",
                )}
              />
              {annotateMode && (
                <button
                  type="button"
                  aria-label="Pin a comment on this part of the plan"
                  className="absolute inset-0 z-[5] cursor-crosshair bg-transparent"
                  onClick={handleAnnotationClick}
                />
              )}
              {pendingAnnotation && inlineCommentPosition && (
                <>
                  <div
                    className="pointer-events-none absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-[#00B5FF] text-[11px] font-semibold text-black shadow-2xl shadow-black/35"
                    style={{
                      left: inlineCommentPosition.pinLeft,
                      top: inlineCommentPosition.pinTop,
                    }}
                  >
                    {bundle.summary.commentCount + 1}
                  </div>
                  <InlineCommentPopover
                    position={inlineCommentPosition}
                    anchor={pendingAnnotation}
                    isPending={updatePlan.isPending}
                    onCancel={closeInlineComment}
                    onSubmit={submitInlineComment}
                  />
                </>
              )}
              {activeAnnotation && (
                <AnnotationPopover
                  annotation={activeAnnotation.annotation}
                  position={activeAnnotation.position}
                />
              )}
              {annotationsOpen && (
                <AnnotationsPanel
                  bundle={bundle}
                  onClose={() => setAnnotationsOpen(false)}
                />
              )}
            </div>
          )}
        </section>
      </div>

      <CreatePlanDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createPlan={createPlan}
        visualizePlan={visualizePlan}
        onCreated={(id) => navigate(`/plans/${id}`)}
      />
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Skeleton className="h-12 w-1/2" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="min-h-[560px] flex-1 rounded-xl" />
    </div>
  );
}

function EmptyPlan({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-border bg-muted/30">
          <IconSparkles className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          Start with an HTML plan
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Create a polished plan with diagrams, wireframes, prototypes, and
          comments before implementation starts.
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <IconPlus className="size-4" />
          New Plan
        </Button>
      </div>
    </div>
  );
}

function PlansOverview({
  plans,
  isLoading,
  onCreate,
}: {
  plans: Array<{
    id: string;
    title: string;
    brief: string;
    status: string;
    updatedAt: string;
    openCommentCount: number;
  }>;
  isLoading: boolean;
  onCreate: () => void;
}) {
  if (isLoading) {
    return <PlanSkeleton />;
  }
  if (plans.length === 0) {
    return <EmptyPlan onCreate={onCreate} />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              Plans
            </h1>
            <p className="text-sm text-muted-foreground">
              {plans.length} document{plans.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button type="button" onClick={onCreate}>
            <IconPlus className="size-4" />
            New Plan
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {plans.map((plan) => (
            <Link
              key={plan.id}
              to={`/plans/${plan.id}`}
              className="rounded-lg border border-border bg-background p-4 transition-colors hover:bg-accent/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">{plan.title}</h2>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {plan.brief}
                  </p>
                </div>
                {plan.openCommentCount > 0 && (
                  <Badge variant="secondary" className="shrink-0">
                    {plan.openCommentCount}
                  </Badge>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{statusLabel(plan.status)}</span>
                <span>·</span>
                <span>{shortDate(plan.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreatePlanDialog({
  open,
  onOpenChange,
  createPlan,
  visualizePlan,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createPlan: ReturnType<typeof useCreatePlan>;
  visualizePlan: ReturnType<typeof useVisualizePlan>;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("Agent-Native Plans Product Plan");
  const [brief, setBrief] = useState(
    "Make coding-agent plans visual, scannable, and commentable before implementation.",
  );
  const [source, setSource] = useState<PlanSource>("codex");
  const [planText, setPlanText] = useState("");

  const isPending = createPlan.isPending || visualizePlan.isPending;
  const submit = () => {
    const onSuccess = (result: PlanBundle & { planId?: string }) => {
      onOpenChange(false);
      onCreated(result.planId || result.plan.id);
    };
    if (planText.trim()) {
      visualizePlan.mutate(
        {
          title,
          brief,
          source,
          planText,
        },
        { onSuccess },
      );
      return;
    }
    createPlan.mutate(
      {
        title,
        brief,
        source,
        sections: [
          {
            type: "summary",
            title: "The plan in one screen",
            body: brief,
          },
          {
            type: "wireframe",
            title: "Review surface",
            body: "A document-first plan with visuals in the center and annotations one click away.",
          },
          {
            type: "diagram",
            title: "How feedback changes the build",
            body: "The user reacts to visuals, comments on the plan, and the agent reads feedback before editing.",
          },
        ],
      },
      { onSuccess },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create plan</DialogTitle>
          <DialogDescription>
            Start fresh or paste an existing Claude Code/Codex plan to turn it
            into a richer visual version.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="plan-title">Title</Label>
            <Input
              id="plan-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="plan-brief">Brief</Label>
            <Textarea
              id="plan-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-2">
            <Label>Source</Label>
            <Select
              value={source}
              onValueChange={(value) => setSource(value as PlanSource)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="plan-text">Existing plan text</Label>
            <Textarea
              id="plan-text"
              value={planText}
              onChange={(event) => setPlanText(event.target.value)}
              rows={7}
              placeholder="Paste a Markdown/Codex/Claude Code plan here to visualize it."
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending}>
            {planText.trim() ? "Visualize Plan" : "Create Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InlineCommentPopover({
  position,
  anchor,
  isPending,
  onCancel,
  onSubmit,
}: {
  position: InlineCommentPosition;
  anchor: PlanAnnotationAnchor;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const canSubmit = message.trim().length > 0 && !isPending;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(message.trim());
  };
  return (
    <div
      className="absolute z-30 rounded-xl border border-border/80 bg-background/96 p-2 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="flex items-start gap-2">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          rows={2}
          autoFocus
          placeholder="Add a comment..."
          className="min-h-11 resize-none border-border/80 bg-background text-sm shadow-none focus-visible:ring-1"
        />
        <Button
          type="button"
          size="sm"
          className="h-11 shrink-0 px-3"
          onClick={submit}
          disabled={!canSubmit}
        >
          Save
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-11 shrink-0"
          onClick={onCancel}
          aria-label="Cancel comment"
        >
          <IconX className="size-4" />
        </Button>
      </div>
      <p className="mt-2 px-1 text-[11px] text-muted-foreground">
        {formatAnchorLabel(anchor)}
      </p>
    </div>
  );
}

function AnnotationPopover({
  annotation,
  position,
}: {
  annotation: RuntimeAnnotation;
  position: InlineCommentPosition;
}) {
  return (
    <div
      className="pointer-events-auto absolute z-30 max-h-[min(280px,calc(100%-24px))] overflow-auto rounded-xl border border-border/80 bg-background/96 p-3 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#00B5FF] text-[10px] font-bold text-black">
          {annotation.index}
        </span>
        <IconMessageCircle className="size-4" />
        <span className="font-medium uppercase tracking-[0.14em]">Comment</span>
      </div>
      {annotation.anchor.snippet && (
        <blockquote className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs leading-5 text-muted-foreground">
          "{annotation.anchor.snippet}"
        </blockquote>
      )}
      <p className="mt-2 text-sm leading-6">{annotation.message}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatAnchorLabel(annotation.anchor)}
      </p>
    </div>
  );
}

function AnnotationsPanel({
  bundle,
  onClose,
}: {
  bundle: PlanBundle & { html?: string };
  onClose: () => void;
}) {
  const openComments = bundle.comments.filter(
    (comment) => comment.status === "open",
  );
  const comments = openComments.length > 0 ? openComments : bundle.comments;
  return (
    <aside className="absolute right-3 top-16 z-20 flex max-h-[calc(100%-5rem)] w-[min(360px,calc(100vw-24px))] flex-col rounded-xl border border-border/80 bg-background/96 shadow-2xl backdrop-blur-xl">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">Annotations</h2>
          <Badge variant="secondary" className="h-5 rounded-md px-1.5">
            {comments.length}
          </Badge>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onClose}
          aria-label="Close annotations"
        >
          <IconX className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {comments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
              No annotations yet. Click Comment, then click the plan.
            </p>
          ) : (
            comments.map((comment) => {
              const anchor = parseAnchor(comment.anchor);
              return (
                <article
                  key={comment.id}
                  className="rounded-lg border border-border/80 bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-[0.14em] text-primary">
                      {comment.kind}
                    </span>
                    <span>{shortDate(comment.createdAt)}</span>
                  </div>
                  {anchor?.snippet && (
                    <blockquote className="mt-2 rounded-md bg-muted/45 px-2 py-1.5 font-mono text-xs leading-5 text-muted-foreground">
                      "{anchor.snippet}"
                    </blockquote>
                  )}
                  <p className="mt-2 text-sm leading-6">{comment.message}</p>
                  {anchor && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatAnchorLabel(anchor)}
                    </p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function parseAnchor(anchor: string | PlanAnnotationAnchor | null | undefined) {
  if (!anchor) return null;
  if (typeof anchor !== "string") return anchor;
  try {
    const parsed = JSON.parse(anchor) as Partial<PlanAnnotationAnchor>;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return parsed as PlanAnnotationAnchor;
    }
  } catch {
    return null;
  }
  return null;
}

function formatAnchorLabel(anchor: PlanAnnotationAnchor | null) {
  if (!anchor) return "Pinned to plan";
  const section = anchor.sectionTitle ? `${anchor.sectionTitle}, ` : "";
  return `${section}${Math.round(anchor.x)}% across / ${Math.round(anchor.y)}% down`;
}

function injectAnnotationRuntime(
  html: string,
  comments: PlanBundle["comments"],
  annotateMode: boolean,
  theme: "dark" | "light",
) {
  const annotations = comments
    .map((comment, index) => ({
      id: comment.id,
      index: index + 1,
      message: comment.message,
      kind: comment.kind,
      status: comment.status,
      createdAt: comment.createdAt,
      anchor: parseAnchor(comment.anchor),
    }))
    .filter((comment) => comment.anchor);
  const payload = JSON.stringify({ annotateMode, annotations, theme }).replace(
    /[<>&\u2028\u2029]/g,
    (char) =>
      ({
        "<": "\\u003c",
        ">": "\\u003e",
        "&": "\\u0026",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
      })[char] ?? char,
  );
  const runtime = `<style>
    :root[data-agent-native-theme="light"] {
      color-scheme: light;
      --bg: #f7f7f4;
      --paper: #ffffff;
      --paper-2: #f3f3ef;
      --paper-3: #e9e9e3;
      --line: #dadad2;
      --line-soft: #e8e8e2;
      --text: #171717;
      --soft: #4b4b4b;
      --muted: #70706c;
      --faint: #999992;
      --accent: #00B5FF;
      --accent-soft: rgba(0, 181, 255, .11);
      --shadow: 0 24px 70px rgba(29, 29, 24, .08);
    }
    :root[data-agent-native-theme="light"] body { background: var(--bg) !important; color: var(--text) !important; }
    :root[data-agent-native-theme="light"] code { background: #eeeeea !important; color: #242424 !important; }
    :root[data-agent-native-theme="light"] .mock-plan,
    :root[data-agent-native-theme="light"] .mock-sidebar,
    :root[data-agent-native-theme="light"] .diagram-card,
    :root[data-agent-native-theme="light"] .mock-browser { background-color: #ffffff !important; }
    :root[data-agent-native-theme="light"] .floating-tools,
    :root[data-agent-native-theme="light"] .product-screen,
    :root[data-agent-native-theme="light"] .comment-screen,
    :root[data-agent-native-theme="light"] .annotation-card,
    :root[data-agent-native-theme="light"] .inline-comment,
    :root[data-agent-native-theme="light"] .panel { background-color: #f5f5f1 !important; }
    :root[data-agent-native-theme="light"] .doc-title,
    :root[data-agent-native-theme="light"] .tool.primary,
    :root[data-agent-native-theme="light"] .pin { background: #171717 !important; color: #ffffff !important; }
    :root[data-agent-native-theme="light"] .doc-line,
    :root[data-agent-native-theme="light"] .panel i,
    :root[data-agent-native-theme="light"] .pill { background: #d8d8d2 !important; }
    ::selection { background: rgba(0,181,255,.32); }
    .an-plan-annotating, .an-plan-annotating * { cursor: crosshair !important; }
    .an-plan-annotation-layer { position: absolute; inset: 0; z-index: 2147483000; pointer-events: none; }
    .an-plan-marker { position: absolute; transform: translate(-50%, -50%); width: 26px; height: 26px; border: 1px solid rgba(255,255,255,.32); border-radius: 999px; background: #00B5FF; color: #031018; font: 800 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 10px 28px rgba(0,0,0,.36); pointer-events: auto; }
    .an-plan-marker[data-status="resolved"] { opacity: .46; }
    .an-plan-selection-toolbar { position: absolute; z-index: 2147483001; display: none; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,.16); border-radius: 14px; background: rgba(16,16,18,.96); padding: 5px; box-shadow: 0 14px 42px rgba(0,0,0,.34); backdrop-filter: blur(16px); }
    :root[data-agent-native-theme="light"] .an-plan-selection-toolbar { border-color: rgba(0,0,0,.12); background: rgba(255,255,255,.97); box-shadow: 0 14px 42px rgba(29,29,24,.13); }
    .an-plan-selection-toolbar button { height: 34px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 10px; background: transparent; color: var(--text); padding: 0 11px; font: 650 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
    .an-plan-selection-toolbar button:hover { background: rgba(255,255,255,.08); }
    :root[data-agent-native-theme="light"] .an-plan-selection-toolbar button:hover { background: rgba(0,0,0,.06); }
    .an-plan-selection-toolbar svg { width: 17px; height: 17px; color: #00B5FF; }
  </style><script>
    (() => {
      const state = ${payload};
      const root = document.documentElement;
      root.dataset.agentNativeTheme = state.theme || "dark";
      if (state.annotateMode) root.classList.add("an-plan-annotating");
      function postDocState() {
        const doc = document.documentElement;
        window.parent.postMessage({
          type: "agent-native-plan-doc-state",
          state: {
            scrollX: window.scrollX || doc.scrollLeft || 0,
            scrollY: window.scrollY || doc.scrollTop || 0,
            scrollWidth: Math.max(doc.scrollWidth, document.body?.scrollWidth || 0),
            scrollHeight: Math.max(doc.scrollHeight, document.body?.scrollHeight || 0),
            clientWidth: doc.clientWidth,
            clientHeight: doc.clientHeight
          }
        }, "*");
      }
      postDocState();
      window.addEventListener("scroll", postDocState, { passive: true });
      window.addEventListener("resize", postDocState);
      function pct(value, total) {
        return Math.max(0, Math.min(100, Number(((value / Math.max(total, 1)) * 100).toFixed(3))));
      }
      function closestSection(target) {
        if (!(target instanceof Element)) return null;
        return target.closest("[data-plan-section-id], section[id], article[id], [id]");
      }
      function textSnippet(target) {
        if (!(target instanceof Element)) return "";
        const text = (target.innerText || target.textContent || "").replace(/\\s+/g, " ").trim();
        return text.slice(0, 90);
      }
      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }
      function ensureLayer() {
        let layer = document.querySelector(".an-plan-annotation-layer");
        if (!layer) {
          layer = document.createElement("div");
          layer.className = "an-plan-annotation-layer";
          document.body.style.position = document.body.style.position || "relative";
          document.body.appendChild(layer);
        }
        return layer;
      }
      function sectionForNode(node) {
        const element = node instanceof Element ? node : node?.parentElement;
        return closestSection(element);
      }
      function sectionTitle(section) {
        return section?.querySelector?.("h1,h2,h3,[data-plan-section-title]")?.textContent?.replace(/\\s+/g, " ").trim() || "";
      }
      function anchorFromRange(range, selectedText) {
        const rect = range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        const doc = document.documentElement;
        const section = sectionForNode(range.commonAncestorContainer);
        return {
          x: pct(rect.left + window.scrollX + rect.width / 2, doc.scrollWidth),
          y: pct(rect.top + window.scrollY + rect.height / 2, Math.max(doc.scrollHeight, document.body.scrollHeight)),
          sectionId: section?.getAttribute("data-plan-section-id") || section?.id || undefined,
          sectionTitle: sectionTitle(section) || undefined,
          snippet: selectedText.slice(0, 160),
          tagName: "selection"
        };
      }
      function ensureSelectionToolbar() {
        let toolbar = document.querySelector(".an-plan-selection-toolbar");
        if (!toolbar) {
          toolbar = document.createElement("div");
          toolbar.className = "an-plan-selection-toolbar";
          toolbar.innerHTML = '<button type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9h8"/><path d="M8 13h6"/><path d="M12 20l-3-3H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4.5"/><path d="M19 16v6"/><path d="M16 19h6"/></svg><span>Comment</span></button>';
          const button = toolbar.querySelector("button");
          button?.addEventListener("mousedown", (event) => event.preventDefault());
          button?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
            const selectedText = selection.toString().replace(/\\s+/g, " ").trim();
            if (!selectedText) return;
            const anchor = anchorFromRange(selection.getRangeAt(0), selectedText);
            if (!anchor) return;
            toolbar.style.display = "none";
            window.parent.postMessage({ type: "agent-native-plan-annotate", anchor }, "*");
          });
          document.body.appendChild(toolbar);
        }
        return toolbar;
      }
      function hideSelectionToolbar() {
        const toolbar = document.querySelector(".an-plan-selection-toolbar");
        if (toolbar) toolbar.style.display = "none";
      }
      function updateSelectionToolbar() {
        if (state.annotateMode) {
          hideSelectionToolbar();
          return;
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          hideSelectionToolbar();
          return;
        }
        const selectedText = selection.toString().replace(/\\s+/g, " ").trim();
        if (!selectedText) {
          hideSelectionToolbar();
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) {
          hideSelectionToolbar();
          return;
        }
        const toolbar = ensureSelectionToolbar();
        toolbar.style.display = "flex";
        const width = toolbar.offsetWidth || 124;
        const left = clamp(rect.left + window.scrollX + rect.width / 2 - width / 2, window.scrollX + 10, window.scrollX + document.documentElement.clientWidth - width - 10);
        const top = Math.max(window.scrollY + 10, rect.top + window.scrollY - (toolbar.offsetHeight || 44) - 10);
        toolbar.style.left = left + "px";
        toolbar.style.top = top + "px";
      }
      const layer = ensureLayer();
      for (const item of state.annotations) {
        if (!item.anchor) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "an-plan-marker";
        button.dataset.status = item.status || "open";
        button.dataset.agentNativePlanMarker = "true";
        button.style.left = item.anchor.x + "%";
        button.style.top = item.anchor.y + "%";
        button.textContent = String(item.index);
        button.title = item.message || "Plan comment";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.parent.postMessage({ type: "agent-native-plan-open-comment", comment: item }, "*");
        });
        layer.appendChild(button);
      }
      document.addEventListener("selectionchange", () => requestAnimationFrame(updateSelectionToolbar));
      document.addEventListener("mouseup", () => setTimeout(updateSelectionToolbar, 0));
      document.addEventListener("keyup", updateSelectionToolbar);
      document.addEventListener("click", (event) => {
        const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
        if (!state.annotateMode && link) {
          const href = link.getAttribute("href") || "";
          if (href && !href.startsWith("#")) {
            event.preventDefault();
            event.stopPropagation();
            window.parent.postMessage({ type: "agent-native-plan-link-blocked", href }, "*");
            return;
          }
        }
        if (!state.annotateMode) {
          if (event.target instanceof Element && event.target.closest(".an-plan-selection-toolbar")) return;
          window.parent.postMessage({ type: "agent-native-plan-close-comment-popover" }, "*");
          return;
        }
        if (!state.annotateMode) return;
        if (event.target instanceof Element && event.target.closest("[data-agent-native-plan-marker]")) return;
        hideSelectionToolbar();
        event.preventDefault();
        event.stopPropagation();
        const doc = document.documentElement;
        const section = closestSection(event.target);
        window.parent.postMessage({
          type: "agent-native-plan-annotate",
          anchor: {
            x: pct(event.pageX, doc.scrollWidth),
            y: pct(event.pageY, Math.max(doc.scrollHeight, document.body.scrollHeight)),
            sectionId: section?.getAttribute("data-plan-section-id") || section?.id || undefined,
            sectionTitle: sectionTitle(section) || undefined,
            snippet: textSnippet(event.target),
            tagName: event.target instanceof Element ? event.target.tagName.toLowerCase() : undefined
          }
        }, "*");
      }, true);
    })();
  </script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${runtime}</body>`);
  }
  return `${html}${runtime}`;
}

function buildClientPlanHtml(bundle: PlanBundle) {
  const escape = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escape(
    bundle.plan.title,
  )}</title><style>
  :root{color-scheme:dark;--bg:#0a0a0b;--paper:#111113;--line:#28282c;--text:#f2f2f3;--muted:#a4a4aa;--accent:#64d2c8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}main{width:min(1080px,calc(100vw - 48px));margin:0 auto;padding:96px 0 96px}h1{max-width:760px;margin:0;font-size:clamp(36px,5vw,58px);line-height:1.03;letter-spacing:-.04em}.lede{max-width:760px;margin:20px 0 0;color:#d7d7da;font-size:clamp(18px,2vw,23px);line-height:1.45}.meta{display:grid;gap:7px;margin:24px 0 0;padding-left:20px;color:var(--muted);font-size:13px}.meta li::marker{color:var(--accent)}.section{margin-top:70px;padding-top:46px;border-top:1px solid var(--line)}.type{margin:0 0 12px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.section h2{margin:0;font-size:clamp(26px,4vw,42px);letter-spacing:-.035em}.section p{max-width:760px;color:#d7d7da;font-size:17px}.visual{margin:24px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.visual i{display:block;height:120px;border:1px solid rgba(100,210,200,.25);border-radius:14px;background:rgba(100,210,200,.12)}@media(max-width:760px){.visual{grid-template-columns:1fr}main{width:min(100vw - 24px,980px);padding-top:72px}}
  </style></head><body><main><p class="type">Working plan</p><h1>${escape(
    bundle.plan.title,
  )}</h1><p class="lede">${escape(
    bundle.plan.brief,
  )}</p><ul class="meta"><li>${escape(
    bundle.plan.source,
  )}</li><li>${escape(statusLabel(bundle.plan.status))}</li></ul>${bundle.sections
    .map(
      (section) =>
        `<section class="section"><p class="type">${escape(section.type)}</p><h2>${escape(section.title)}</h2>${["diagram", "wireframe", "prototype"].includes(section.type) ? '<div class="visual"><i></i><i></i><i></i></div>' : ""}<p>${escape(section.body)}</p></section>`,
    )
    .join("")}</main></body></html>`;
}
