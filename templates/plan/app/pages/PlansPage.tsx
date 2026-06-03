import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCursorText,
  IconFileExport,
  IconMessageCircle,
  IconMessagePlus,
  IconPlus,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
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
  useExportPlan,
  usePlan,
  usePlans,
  useUpdatePlan,
  useVisualizePlan,
} from "@/hooks/use-plans";
import { cn } from "@/lib/utils";
import type { PlanBundle, PlanCommentKind, PlanSource } from "@shared/types";

const SOURCE_OPTIONS: Array<{ value: PlanSource; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "pi", label: "Pi" },
  { value: "manual", label: "Manual" },
  { value: "imported", label: "Imported" },
];

const COMMENT_KINDS: Array<{ value: PlanCommentKind; label: string }> = [
  { value: "comment", label: "Comment" },
  { value: "correction", label: "Correction" },
  { value: "question", label: "Question" },
  { value: "decision", label: "Decision" },
  { value: "annotation", label: "Annotation" },
];

type PlanAnnotationAnchor = {
  x: number;
  y: number;
  sectionId?: string;
  sectionTitle?: string;
  snippet?: string;
  tagName?: string;
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

export function PlansPage() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const documentStateRef = useRef<PlanDocumentState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] =
    useState<PlanAnnotationAnchor | null>(null);
  const plansQuery = usePlans();
  const plans = plansQuery.data ?? [];
  const selectedId = params.id;
  const planQuery = usePlan(selectedId);
  const bundle = planQuery.data;
  const exportQuery = useExportPlan(selectedId);
  const createPlan = useCreatePlan();
  const visualizePlan = useVisualizePlan();
  const updatePlan = useUpdatePlan();

  useSetPageTitle(bundle?.plan.title || "Plans");

  const documentHtml = useMemo(() => {
    if (!bundle) return "";
    return bundle.html || bundle.plan.html || buildClientPlanHtml(bundle);
  }, [bundle]);

  const annotatedDocumentHtml = useMemo(() => {
    if (!bundle) return "";
    return injectAnnotationRuntime(documentHtml, bundle.comments, annotateMode);
  }, [annotateMode, bundle, documentHtml]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as
        | {
            type?: string;
            anchor?: PlanAnnotationAnchor;
            href?: string;
            state?: PlanDocumentState;
          }
        | undefined;
      if (data?.type === "agent-native-plan-annotate" && data.anchor) {
        setPendingAnnotation(data.anchor);
        setCommentsOpen(true);
      }
      if (data?.type === "agent-native-plan-open-comments") {
        setCommentsOpen(true);
      }
      if (data?.type === "agent-native-plan-link-blocked") {
        toast.info(
          "Plan links are disabled in review so the document stays put.",
        );
      }
      if (data?.type === "agent-native-plan-doc-state" && data.state) {
        documentStateRef.current = data.state;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleCommentsOpenChange = (open: boolean) => {
    setCommentsOpen(open);
    if (!open) {
      setPendingAnnotation(null);
    }
  };

  const copyExport = async () => {
    if (!selectedId) return;
    const result = await exportQuery.refetch();
    const html = result.data?.html;
    if (!html) return;
    await navigator.clipboard.writeText(html);
    toast.success("HTML copied to clipboard");
  };

  const handleAnnotationClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const doc = documentStateRef.current;
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
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
    setCommentsOpen(true);
  };

  return (
    <div className="plans-workspace flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div
        className="plans-grid grid min-h-0 flex-1"
        data-rail={railCollapsed ? "collapsed" : "expanded"}
      >
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
                    Create a plan to see the HTML document surface.
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
            <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
              <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/82 p-1 shadow-2xl backdrop-blur-xl">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={annotateMode ? "secondary" : "ghost"}
                      size="sm"
                      className="pointer-events-auto"
                      onClick={() => setAnnotateMode((value) => !value)}
                    >
                      <IconCursorText className="size-4" />
                      Annotate
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Click anywhere in the plan to pin feedback
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto relative size-8"
                      onClick={() => setCommentsOpen(true)}
                      aria-label="Open comments"
                    >
                      <IconMessageCircle className="size-4" />
                      {bundle.summary.openCommentCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                          {bundle.summary.openCommentCount}
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Comments</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={() => void planQuery.refetch()}
                      aria-label="Refresh plan"
                    >
                      <IconRefresh className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={copyExport}
                      aria-label="Export HTML"
                    >
                      <IconFileExport className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export HTML</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={() => setCreateOpen(true)}
                      aria-label="New plan"
                    >
                      <IconPlus className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New Plan</TooltipContent>
                </Tooltip>
              </div>
              {annotateMode && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border/70 bg-background/82 px-3 py-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-xl">
                  Click the plan to pin feedback
                </div>
              )}
              <iframe
                ref={iframeRef}
                title={`${bundle.plan.title} HTML plan`}
                srcDoc={annotatedDocumentHtml}
                sandbox="allow-forms allow-scripts"
                className={cn(
                  "h-full min-h-full w-full border-0 bg-black",
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
      <CommentsSheet
        bundle={bundle}
        open={commentsOpen}
        onOpenChange={handleCommentsOpenChange}
        updatePlan={updatePlan}
        pendingAnnotation={pendingAnnotation}
        onAnnotationSaved={() => setPendingAnnotation(null)}
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
          Create a plan that reads like a polished document, then layer in
          diagrams, wireframes, prototypes, and comments.
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
  const [title, setTitle] = useState("Agent-Native Plans HTML Plan Mode");
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
            body: "A document-first plan with a generated HTML page in the center and annotations off to the side.",
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
          <DialogTitle>Create HTML plan</DialogTitle>
          <DialogDescription>
            Start fresh or paste an existing Claude Code/Codex plan to turn it
            into a visual companion.
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

function CommentsSheet({
  bundle,
  open,
  onOpenChange,
  updatePlan,
  pendingAnnotation,
  onAnnotationSaved,
}: {
  bundle?: PlanBundle & { html?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updatePlan: ReturnType<typeof useUpdatePlan>;
  pendingAnnotation?: PlanAnnotationAnchor | null;
  onAnnotationSaved: () => void;
}) {
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<PlanCommentKind>("comment");
  const [sectionId, setSectionId] = useState<string>("plan");
  const pendingSectionId =
    pendingAnnotation?.sectionId &&
    bundle?.sections.some(
      (section) => section.id === pendingAnnotation.sectionId,
    )
      ? pendingAnnotation.sectionId
      : "plan";

  useEffect(() => {
    if (!pendingAnnotation) return;
    setKind("annotation");
    setSectionId(pendingSectionId);
    setMessage("");
  }, [pendingAnnotation, pendingSectionId]);

  if (!bundle) return null;
  const submit = () => {
    if (!message.trim()) return;
    updatePlan.mutate(
      {
        planId: bundle.plan.id,
        comments: [
          {
            kind,
            message,
            sectionId: sectionId === "plan" ? undefined : sectionId,
            anchor: pendingAnnotation
              ? JSON.stringify(pendingAnnotation)
              : undefined,
            createdBy: "human",
          },
        ],
        note: "Human added visual plan feedback.",
      },
      {
        onSuccess: () => {
          setMessage("");
          setKind("comment");
          onAnnotationSaved();
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan comments</DialogTitle>
          <DialogDescription>
            Add concise feedback the agent can read with get-plan-feedback.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as PlanCommentKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMENT_KINDS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plan">Whole plan</SelectItem>
              {bundle.sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pendingAnnotation && (
            <div className="rounded-lg border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <IconMessagePlus className="size-4" />
                Pinned annotation
              </div>
              <p className="mt-1">
                {formatAnchorLabel(pendingAnnotation)}
                {pendingAnnotation.snippet
                  ? ` near "${pendingAnnotation.snippet}"`
                  : ""}
              </p>
            </div>
          )}
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            placeholder="What should change?"
          />
          <Button
            type="button"
            onClick={submit}
            disabled={updatePlan.isPending || !message.trim()}
          >
            Add Comment
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 pr-3">
            {bundle.comments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No comments yet.
              </p>
            ) : (
              bundle.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">{comment.kind}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {comment.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6">{comment.message}</p>
                  {comment.anchor && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatAnchorLabel(parseAnchor(comment.anchor))}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {shortDate(comment.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
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
) {
  const annotations = comments
    .map((comment, index) => ({
      id: comment.id,
      index: index + 1,
      message: comment.message,
      kind: comment.kind,
      status: comment.status,
      anchor: parseAnchor(comment.anchor),
    }))
    .filter((comment) => comment.anchor);
  const payload = JSON.stringify({ annotateMode, annotations }).replace(
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
    .an-plan-annotating, .an-plan-annotating * { cursor: crosshair !important; }
    .an-plan-annotation-layer { position: absolute; inset: 0; z-index: 2147483000; pointer-events: none; }
    .an-plan-marker { position: absolute; transform: translate(-50%, -50%); width: 26px; height: 26px; border: 1px solid rgba(255,255,255,.32); border-radius: 999px; background: #f3f3f4; color: #0a0a0b; font: 700 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 10px 28px rgba(0,0,0,.36); pointer-events: auto; }
    .an-plan-marker[data-status="resolved"] { opacity: .46; }
    .an-plan-hint { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483001; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(12,12,14,.86); color: #f2f2f3; padding: 8px 12px; font: 500 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; backdrop-filter: blur(18px); box-shadow: 0 10px 30px rgba(0,0,0,.28); }
  </style><script>
    (() => {
      const state = ${payload};
      const root = document.documentElement;
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
          window.parent.postMessage({ type: "agent-native-plan-open-comments", commentId: item.id }, "*");
        });
        layer.appendChild(button);
      }
      if (state.annotateMode) {
        const hint = document.createElement("div");
        hint.className = "an-plan-hint";
        hint.textContent = "Click anywhere to pin a plan comment";
        document.body.appendChild(hint);
      }
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
        if (!state.annotateMode) return;
        if (event.target instanceof Element && event.target.closest("[data-agent-native-plan-marker]")) return;
        event.preventDefault();
        event.stopPropagation();
        const doc = document.documentElement;
        const section = closestSection(event.target);
        const sectionTitle = section?.querySelector?.("h1,h2,h3,[data-plan-section-title]")?.textContent?.replace(/\\s+/g, " ").trim() || "";
        window.parent.postMessage({
          type: "agent-native-plan-annotate",
          anchor: {
            x: pct(event.pageX, doc.scrollWidth),
            y: pct(event.pageY, Math.max(doc.scrollHeight, document.body.scrollHeight)),
            sectionId: section?.getAttribute("data-plan-section-id") || section?.id || undefined,
            sectionTitle: sectionTitle || undefined,
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
  :root{color-scheme:dark;--bg:#0a0a0b;--paper:#111113;--line:#28282c;--text:#f2f2f3;--muted:#a4a4aa;--accent:#64d2c8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}main{width:min(960px,calc(100vw - 32px));margin:0 auto;padding:72px 0 96px}h1{margin:0;font-size:clamp(42px,8vw,82px);line-height:.94;letter-spacing:-.055em}.lede{max-width:760px;margin:24px 0 0;color:#d7d7da;font-size:clamp(20px,3vw,28px);line-height:1.35}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:28px}.meta span{border:1px solid var(--line);border-radius:999px;padding:6px 10px;color:var(--muted);font-size:12px}.section{margin-top:18px;border:1px solid var(--line);border-radius:18px;background:var(--paper);padding:clamp(22px,4vw,34px)}.type{margin:0 0 12px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.section h2{margin:0;font-size:clamp(26px,4vw,42px);letter-spacing:-.035em}.section p{max-width:760px;color:#d7d7da;font-size:17px}.visual{margin:24px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.visual i{display:block;height:120px;border:1px solid rgba(100,210,200,.25);border-radius:14px;background:rgba(100,210,200,.12)}@media(max-width:760px){.visual{grid-template-columns:1fr}main{padding-top:44px}}
  </style></head><body><main><p class="type">HTML plan mode</p><h1>${escape(
    bundle.plan.title,
  )}</h1><p class="lede">${escape(
    bundle.plan.brief,
  )}</p><div class="meta"><span>${escape(
    bundle.plan.source,
  )}</span><span>${escape(statusLabel(bundle.plan.status))}</span></div>${bundle.sections
    .map(
      (section) =>
        `<section class="section"><p class="type">${escape(section.type)}</p><h2>${escape(section.title)}</h2>${["diagram", "wireframe", "prototype"].includes(section.type) ? '<div class="visual"><i></i><i></i><i></i></div>' : ""}<p>${escape(section.body)}</p></section>`,
    )
    .join("")}</main></body></html>`;
}
