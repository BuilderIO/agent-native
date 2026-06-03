import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconBrowser,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFileExport,
  IconFileText,
  IconLayoutBoard,
  IconMessageCircle,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const plansQuery = usePlans();
  const plans = plansQuery.data ?? [];
  const selectedId = params.id ?? plans[0]?.id;
  const planQuery = usePlan(selectedId);
  const bundle = planQuery.data;
  const exportQuery = useExportPlan(selectedId);
  const createPlan = useCreatePlan();
  const visualizePlan = useVisualizePlan();
  const updatePlan = useUpdatePlan();

  useSetPageTitle(bundle?.plan.title || "Plans");

  useEffect(() => {
    if (!params.id && plans[0]?.id) {
      navigate(`/plans/${plans[0].id}`, { replace: true });
    }
  }, [navigate, params.id, plans]);

  useSetHeaderActions(
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void planQuery.refetch()}
            aria-label="Refresh plan"
          >
            <IconRefresh className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>
      <Button type="button" onClick={() => setCreateOpen(true)}>
        <IconPlus className="size-4" />
        New Plan
      </Button>
    </div>,
  );

  const documentHtml = useMemo(() => {
    if (!bundle) return "";
    return bundle.html || bundle.plan.html || buildClientPlanHtml(bundle);
  }, [bundle]);

  const copyExport = async () => {
    if (!selectedId) return;
    const result = await exportQuery.refetch();
    const html = result.data?.html;
    if (!html) return;
    await navigator.clipboard.writeText(html);
    toast.success("HTML copied to clipboard");
  };

  const approvePlan = () => {
    if (!selectedId) return;
    updatePlan.mutate({
      planId: selectedId,
      status: "approved",
      note: "Plan approved in the UI.",
    });
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
          {!bundle && planQuery.isLoading ? (
            <PlanSkeleton />
          ) : !bundle ? (
            <EmptyPlan onCreate={() => setCreateOpen(true)} />
          ) : (
            <>
              <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="truncate text-base font-semibold tracking-tight">
                      {bundle.plan.title}
                    </h1>
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      {statusLabel(bundle.plan.status)}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {bundle.plan.source}
                    {bundle.plan.repoPath ? ` / ${bundle.plan.repoPath}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCommentsOpen(true)}
                  >
                    <IconMessageCircle className="size-4" />
                    Comments
                  </Button>
                  <Button type="button" variant="ghost" onClick={copyExport}>
                    <IconFileExport className="size-4" />
                    Export
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={approvePlan}
                    disabled={bundle.plan.status === "approved"}
                  >
                    Approve
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
                <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric
                      icon={<IconFileText className="size-4" />}
                      label="Sections"
                      value={bundle.sections.length}
                    />
                    <Metric
                      icon={<IconLayoutBoard className="size-4" />}
                      label="Visual blocks"
                      value={
                        bundle.sections.filter((section) =>
                          ["diagram", "wireframe", "prototype"].includes(
                            section.type,
                          ),
                        ).length
                      }
                    />
                    <Metric
                      icon={<IconMessageCircle className="size-4" />}
                      label="Open comments"
                      value={bundle.summary.openCommentCount}
                    />
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <IconBrowser className="size-4" />
                        HTML plan document
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={copyExport}
                      >
                        <IconCopy className="size-4" />
                        Copy HTML
                      </Button>
                    </div>
                    <iframe
                      title={`${bundle.plan.title} HTML plan`}
                      srcDoc={documentHtml}
                      sandbox="allow-forms allow-popups allow-scripts"
                      className="h-[calc(100vh-16rem)] min-h-[620px] w-full bg-black"
                    />
                  </div>
                </div>
              </div>
            </>
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
        onOpenChange={setCommentsOpen}
        updatePlan={updatePlan}
      />
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
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
}: {
  bundle?: PlanBundle & { html?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updatePlan: ReturnType<typeof useUpdatePlan>;
}) {
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<PlanCommentKind>("comment");
  const [sectionId, setSectionId] = useState<string>("plan");
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
            createdBy: "human",
          },
        ],
        note: "Human added visual plan feedback.",
      },
      {
        onSuccess: () => {
          setMessage("");
          setKind("comment");
        },
      },
    );
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Plan comments</SheetTitle>
          <SheetDescription>
            Add concise feedback the agent can read with get-plan-feedback.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 py-4">
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    {shortDate(comment.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
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
        `<section class="section"><p class="type">${escape(section.type)}</p><h2>${escape(section.title)}</h2>${["diagram", "wireframe", "prototype"].includes(section.type) ? "<div class=\"visual\"><i></i><i></i><i></i></div>" : ""}<p>${escape(section.body)}</p></section>`,
    )
    .join("")}</main></body></html>`;
}
