import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardText,
  IconCopy,
  IconDotsVertical,
  IconLayoutSidebarRight,
  IconPencil,
  IconMessageCircle,
  IconMoon,
  IconPlus,
  IconShare3,
  IconSparkles,
  IconSun,
  IconX,
  IconSend,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  SIDEBAR_STATE_CHANGE_EVENT,
  sendToAgentChat,
  setAgentChatContextItem,
  type AgentSidebarStateChangeDetail,
} from "@agent-native/core/client";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type PreferredEditor =
  | "vscode"
  | "cursor"
  | "finder"
  | "terminal"
  | "ghostty"
  | "xcode";

const PREFERRED_EDITOR_STORAGE_KEY = "agent-native-plans.preferredEditor";
const PREFERRED_EDITOR_VALUES: PreferredEditor[] = [
  "vscode",
  "cursor",
  "finder",
  "terminal",
  "ghostty",
  "xcode",
];

const EDITOR_OPTIONS: Array<{ value: PreferredEditor; label: string }> = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "finder", label: "Finder" },
  { value: "terminal", label: "Terminal" },
  { value: "ghostty", label: "Ghostty" },
  { value: "xcode", label: "Xcode" },
];

const EDITOR_ICON_HTML: Record<PreferredEditor, string> = {
  vscode: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-brand-vscode" aria-hidden="true"><path d="M16 3v18l4 -2.5v-13l-4 -2.5"></path><path d="M9.165 13.903l-4.165 3.597l-2 -1l4.333 -4.5m1.735 -1.802l6.932 -7.198v5l-4.795 4.141"></path><path d="M16 16.5l-11 -10l-2 1l13 13.5"></path></svg>`,
  cursor: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-cube" aria-hidden="true"><path d="M21 16.008v-8.018a1.98 1.98 0 0 0 -1 -1.717l-7 -4.008a2.016 2.016 0 0 0 -2 0l-7 4.008c-.619 .355 -1 1.01 -1 1.718v8.018c0 .709 .381 1.363 1 1.717l7 4.008a2.016 2.016 0 0 0 2 0l7 -4.008c.619 -.355 1 -1.01 1 -1.718"></path><path d="M12 22v-10"></path><path d="M12 12l8.73 -5.04"></path><path d="M3.27 6.96l8.73 5.04"></path></svg>`,
  finder: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-brand-finder" aria-hidden="true"><path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -14"></path><path d="M7 8v1"></path><path d="M17 8v1"></path><path d="M12.5 4c-.654 1.486 -1.26 3.443 -1.5 9h2.5c-.19 2.867 .094 5.024 .5 7"></path><path d="M7 15.5c3.667 2 6.333 2 10 0"></path></svg>`,
  terminal: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-terminal-2" aria-hidden="true"><path d="M8 9l3 3l-3 3"></path><path d="M13 15l3 0"></path><path d="M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12"></path></svg>`,
  ghostty: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-ghost-3" aria-hidden="true"><path d="M5 11a7 7 0 0 1 14 0v7a1.78 1.78 0 0 1 -3.1 1.4a1.65 1.65 0 0 0 -2.6 0a1.65 1.65 0 0 1 -2.6 0a1.65 1.65 0 0 0 -2.6 0a1.78 1.78 0 0 1 -3.1 -1.4v-7"></path><path d="M10 10h.01"></path><path d="M14 10h.01"></path></svg>`,
  xcode: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-hammer" aria-hidden="true"><path d="M11.414 10l-7.383 7.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l7.407 -7.385"></path><path d="M18.121 15.293l2.586 -2.586a1 1 0 0 0 0 -1.414l-7.586 -7.586a1 1 0 0 0 -1.414 0l-2.586 2.586a1 1 0 0 0 0 1.414l7.586 7.586a1 1 0 0 0 1.414 0"></path></svg>`,
};

function readPreferredEditor(): PreferredEditor {
  if (typeof window === "undefined") return "vscode";
  const stored = window.localStorage.getItem(PREFERRED_EDITOR_STORAGE_KEY);
  return PREFERRED_EDITOR_VALUES.includes(stored as PreferredEditor)
    ? (stored as PreferredEditor)
    : "vscode";
}

type PlanAnnotationAnchor = {
  x: number;
  y: number;
  sectionId?: string;
  sectionTitle?: string;
  tabPanelId?: string;
  tabLabel?: string;
  snippet?: string;
  targetSelector?: string;
  targetX?: number;
  targetY?: number;
  tagName?: string;
  anchorKind?: "text" | "visual" | "point";
  textQuote?: string;
  visualLabel?: string;
  visualX?: number;
  visualY?: number;
};

type RuntimeAnnotation = {
  id: string;
  index: number;
  message: string;
  kind: string;
  status: string;
  sectionId?: string | null;
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

function buildPlanAgentContext(input: {
  bundle: PlanBundle & { html?: string };
  documentHtml: string;
  url: string;
}) {
  const openComments = input.bundle.comments
    .filter((comment) => comment.status === "open")
    .slice(0, 6)
    .map((comment, index) => {
      const anchorContext = formatAnchorForAgent(parseAnchor(comment.anchor));
      return `${index + 1}. ${comment.message}${anchorContext ? `\n   Context: ${anchorContext}` : ""}`;
    })
    .join("\n");

  return [
    "Current Agent-Native Plans review context:",
    `Plan ID: ${input.bundle.plan.id}`,
    `Title: ${input.bundle.plan.title}`,
    `Status: ${input.bundle.plan.status}`,
    `URL: ${input.url}`,
    `Rendered HTML length: ${input.documentHtml.length} characters`,
    "",
    "Fast iteration workflow:",
    "1. Call get-visual-plan with this plan ID to read the full current HTML, sections, comments, and activity.",
    "2. Patch the document with update-visual-plan by passing the revised full html string.",
    "3. Preserve the user's existing annotation comments and intent unless the user asks to remove or resolve them.",
    "4. Keep the output as a polished HTML plan document: prose, tables, diagrams, implementation maps, high-fidelity mockups, and minimal app chrome.",
    "5. After applying feedback, keep the plan scannable and visually reactive instead of turning it into a dashboard.",
    openComments ? `\nOpen comments:\n${openComments}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildApplyFeedbackMessage(openCommentCount: number) {
  return `Apply the ${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this visual plan. Read the plan with get-visual-plan, read feedback with get-plan-feedback, then update the HTML plan and any related implementation details as needed.`;
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
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>(() =>
    readPreferredEditor(),
  );
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(false);
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
      false,
      planTheme,
      preferredEditor,
    );
  }, [bundle, documentHtml, planTheme, preferredEditor]);

  const planAgentContext = useMemo(() => {
    if (!bundle) return "";
    const url =
      typeof window === "undefined" || !selectedId
        ? `/plans/${selectedId ?? bundle.plan.id}`
        : `${window.location.origin}/plans/${selectedId}`;
    return buildPlanAgentContext({ bundle, documentHtml, url });
  }, [bundle, documentHtml, selectedId]);

  useEffect(() => {
    const onSidebarState = (event: Event) => {
      const detail = (event as CustomEvent<AgentSidebarStateChangeDetail>)
        .detail;
      setAgentSidebarOpen(detail?.open === true);
    };
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, onSidebarState);
    return () =>
      window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, onSidebarState);
  }, []);

  const postRuntimeState = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "agent-native-plan-runtime-state",
        annotateMode,
        theme: planTheme,
        preferredEditor,
      },
      "*",
    );
  }, [annotateMode, planTheme, preferredEditor]);

  useEffect(() => {
    const frame = requestAnimationFrame(postRuntimeState);
    return () => cancelAnimationFrame(frame);
  }, [annotatedDocumentHtml, postRuntimeState]);

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
            editor?: PreferredEditor;
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
      if (data?.type === "agent-native-plan-open-editor" && data.href) {
        if (
          /^(vscode|cursor|xcode|terminal|ghostty):/i.test(data.href) ||
          /^file:\/\//i.test(data.href)
        ) {
          window.location.href = data.href;
          toast.info("Opening file in your editor");
        }
      }
      if (data?.type === "agent-native-plan-editor-preference") {
        const editor = PREFERRED_EDITOR_VALUES.includes(
          data.editor as PreferredEditor,
        )
          ? (data.editor as PreferredEditor)
          : "vscode";
        setPreferredEditor(editor);
        window.localStorage.setItem(PREFERRED_EDITOR_STORAGE_KEY, editor);
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

  const copyPlanHtml = async () => {
    if (!documentHtml) return;
    await navigator.clipboard.writeText(documentHtml);
    toast.success("Plan HTML copied");
  };

  const startCommenting = () => {
    setActiveAnnotation(null);
    setAnnotationsOpen(false);
    setAnnotateMode(true);
  };

  const togglePlansAgent = () => {
    if (!bundle) return;
    if (!agentSidebarOpen) {
      setAgentChatContextItem({
        key: `visual-plan:${bundle.plan.id}`,
        title: bundle.plan.title,
        context: planAgentContext,
        openSidebar: false,
      });
      window.dispatchEvent(
        new CustomEvent("agent-panel:set-mode", {
          detail: { mode: "chat" },
        }),
      );
    }
    window.dispatchEvent(new Event("agent-panel:toggle"));
  };

  const sendPlanFeedbackToInlineAgent = () => {
    if (!bundle) return;
    const openCommentCount = bundle.summary.openCommentCount;
    if (openCommentCount === 0) {
      startCommenting();
      return;
    }
    sendToAgentChat({
      type: "content",
      submit: true,
      context: planAgentContext,
      message: buildApplyFeedbackMessage(openCommentCount),
    });
    toast.success("Sent comments to the agent");
  };

  const copyPlanFeedbackForAgent = async () => {
    if (!bundle) return;
    const openCommentCount = bundle.summary.openCommentCount;
    if (openCommentCount === 0) {
      startCommenting();
      return;
    }
    await navigator.clipboard.writeText(
      [buildApplyFeedbackMessage(openCommentCount), "", planAgentContext].join(
        "\n",
      ),
    );
    toast.success("Feedback instructions copied");
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

  const updateAnnotationComment = (
    annotation: RuntimeAnnotation,
    message: string,
  ) => {
    if (!bundle) return;
    updatePlan.mutate(
      {
        planId: bundle.plan.id,
        comments: [
          {
            id: annotation.id,
            kind: annotation.kind as PlanBundle["comments"][number]["kind"],
            status:
              annotation.status as PlanBundle["comments"][number]["status"],
            message,
            sectionId: annotation.sectionId ?? annotation.anchor.sectionId,
            anchor: JSON.stringify(annotation.anchor),
            createdBy: "human",
          },
        ],
        note: "Human edited visual plan feedback.",
      },
      {
        onSuccess: () => {
          setActiveAnnotation(null);
          toast.success("Comment updated");
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
                {annotateMode || bundle.summary.openCommentCount === 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={annotateMode ? "secondary" : "default"}
                        size="sm"
                        className="pointer-events-auto"
                        onClick={() => {
                          if (annotateMode) {
                            closeInlineComment();
                          } else {
                            startCommenting();
                          }
                        }}
                      >
                        {annotateMode ? "Cancel" : "Comment"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {annotateMode
                        ? "Stop commenting"
                        : "Click anywhere in the plan to pin feedback"}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="pointer-events-auto size-8"
                          onClick={startCommenting}
                          aria-label="Add another comment"
                        >
                          <IconMessageCircle className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Add another comment</TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="pointer-events-auto gap-1.5"
                        >
                          Send to agent
                          <span className="flex size-4 items-center justify-center rounded-full bg-background/20 text-[10px] font-medium">
                            {bundle.summary.openCommentCount}
                          </span>
                          <IconChevronDown className="size-3.5 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-64 rounded-xl"
                      >
                        <DropdownMenuLabel>Send feedback</DropdownMenuLabel>
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={sendPlanFeedbackToInlineAgent}
                            className="gap-2"
                          >
                            <IconSend className="size-4" />
                            Send to inline agent
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={copyPlanFeedbackForAgent}
                            className="gap-2"
                          >
                            <IconClipboardText className="size-4" />
                            Copy for this agent
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      aria-label="Plan actions"
                    >
                      <IconDotsVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-xl">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() =>
                          setAnnotationsOpen((value) => {
                            if (!value) closeInlineComment();
                            return !value;
                          })
                        }
                        className="gap-2"
                      >
                        <IconMessageCircle className="size-4" />
                        <span className="flex-1">
                          {annotationsOpen ? "Hide comments" : "Comments"}
                        </span>
                        {bundle.summary.openCommentCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {bundle.summary.openCommentCount}
                          </span>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          setPlanFullscreen((value) => {
                            if (value) closeInlineComment();
                            return !value;
                          })
                        }
                        className="gap-2"
                      >
                        {immersiveReader ? (
                          <IconArrowsMinimize className="size-4" />
                        ) : (
                          <IconArrowsMaximize className="size-4" />
                        )}
                        {immersiveReader ? "App view" : "Full screen"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
                        className="gap-2"
                      >
                        {isDarkTheme ? (
                          <IconSun className="size-4" />
                        ) : (
                          <IconMoon className="size-4" />
                        )}
                        {isDarkTheme ? "Light mode" : "Dark mode"}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={copyShareLink}
                        className="gap-2"
                      >
                        <IconShare3 className="size-4" />
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={copyPlanHtml}
                        className="gap-2"
                      >
                        <IconCopy className="size-4" />
                        Copy HTML
                      </DropdownMenuItem>
                      {bundle.summary.openCommentCount > 0 && (
                        <DropdownMenuItem
                          onClick={copyPlanFeedbackForAgent}
                          className="gap-2"
                        >
                          <IconClipboardText className="size-4" />
                          Copy feedback
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      onClick={togglePlansAgent}
                      aria-label="Toggle agent sidebar"
                    >
                      <IconLayoutSidebarRight className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Toggle side chat</TooltipContent>
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
                onLoad={postRuntimeState}
                sandbox="allow-forms allow-scripts"
                className={cn(
                  "h-full min-h-full w-full border-0 bg-background",
                  annotateMode && "ring-1 ring-inset ring-primary/35",
                )}
              />
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
                  isPending={updatePlan.isPending}
                  onSave={(message) =>
                    updateAnnotationComment(
                      activeAnnotation.annotation,
                      message,
                    )
                  }
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
  isPending,
  onCancel,
  onSubmit,
}: {
  position: InlineCommentPosition;
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
    </div>
  );
}

function AnnotationPopover({
  annotation,
  position,
  isPending,
  onSave,
}: {
  annotation: RuntimeAnnotation;
  position: InlineCommentPosition;
  isPending: boolean;
  onSave: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(annotation.message);
  const canSave = message.trim().length > 0 && !isPending;
  const save = () => {
    if (!canSave) return;
    onSave(message.trim());
  };
  return (
    <div
      className="pointer-events-auto absolute z-30 max-h-[min(300px,calc(100%-24px))] overflow-auto rounded-xl border border-border/80 bg-background/96 p-3 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      {editing ? (
        <div className="grid gap-2">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                save();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
                setMessage(annotation.message);
              }
            }}
            rows={3}
            autoFocus
            className="min-h-20 resize-none border-border/80 bg-background text-sm shadow-none focus-visible:ring-1"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setMessage(annotation.message);
              }}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!canSave}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-sm leading-6">
            {annotation.message}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                onClick={() => setEditing(true)}
                aria-label="Edit comment"
              >
                <IconPencil className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit comment</TooltipContent>
          </Tooltip>
        </div>
      )}
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
            comments.map((comment) => (
              <article
                key={comment.id}
                className="rounded-lg border border-border/80 bg-muted/20 p-3"
              >
                <p className="text-sm leading-6">{comment.message}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {shortDate(comment.createdAt)}
                </p>
              </article>
            ))
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

function formatAnchorForAgent(anchor: PlanAnnotationAnchor | null) {
  if (!anchor) return "";
  const section =
    anchor.sectionTitle && anchor.sectionTitle !== "Visible plan area"
      ? `${anchor.sectionTitle}: `
      : "";
  const tab = anchor.tabLabel ? `${anchor.tabLabel} tab / ` : "";
  const quote = anchor.textQuote || anchor.snippet;
  if (quote) return `${tab}${section}"${quote}"`;
  if (anchor.anchorKind === "visual") {
    const label = anchor.visualLabel || anchor.sectionTitle || "visual";
    const x = Math.round(anchor.visualX ?? anchor.x);
    const y = Math.round(anchor.visualY ?? anchor.y);
    return `${tab}${section}${label} at ${x}% across / ${y}% down`;
  }
  return tab || section
    ? `${tab}${section}`.replace(/: $/, "")
    : "Pinned to plan";
}

function injectAnnotationRuntime(
  html: string,
  comments: PlanBundle["comments"],
  annotateMode: boolean,
  theme: "dark" | "light",
  preferredEditor: PreferredEditor,
) {
  const annotations = comments
    .map((comment, index) => ({
      id: comment.id,
      index: index + 1,
      message: comment.message,
      kind: comment.kind,
      status: comment.status,
      sectionId: comment.sectionId,
      createdAt: comment.createdAt,
      anchor: parseAnchor(comment.anchor),
    }))
    .filter((comment) => comment.anchor);
  const payload = JSON.stringify({
    annotateMode,
    annotations,
    theme,
    preferredEditor,
  }).replace(/[<>&\u2028\u2029]/g, (char) => {
    return (
      {
        "<": "\\u003c",
        ">": "\\u003e",
        "&": "\\u0026",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
      }[char] ?? char
    );
  });
  const editorOptionsPayload = JSON.stringify(EDITOR_OPTIONS).replace(
    /[<>&\u2028\u2029]/g,
    (char) => {
      return (
        {
          "<": "\\u003c",
          ">": "\\u003e",
          "&": "\\u0026",
          "\u2028": "\\u2028",
          "\u2029": "\\u2029",
        }[char] ?? char
      );
    },
  );
  const editorIconPayload = JSON.stringify(EDITOR_ICON_HTML).replace(
    /[<>&\u2028\u2029]/g,
    (char) => {
      return (
        {
          "<": "\\u003c",
          ">": "\\u003e",
          "&": "\\u0026",
          "\u2028": "\\u2028",
          "\u2029": "\\u2029",
        }[char] ?? char
      );
    },
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
    .an-plan-marker[hidden] { display: none !important; }
    .an-plan-marker[data-status="resolved"] { opacity: .46; }
    .an-plan-selection-toolbar { position: absolute; z-index: 2147483001; display: none; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,.16); border-radius: 14px; background: rgba(16,16,18,.96); padding: 5px; box-shadow: 0 14px 42px rgba(0,0,0,.34); backdrop-filter: blur(16px); }
    :root[data-agent-native-theme="light"] .an-plan-selection-toolbar { border-color: rgba(0,0,0,.12); background: rgba(255,255,255,.97); box-shadow: 0 14px 42px rgba(29,29,24,.13); }
    .an-plan-selection-toolbar button { height: 34px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 10px; background: transparent; color: var(--text); padding: 0 11px; font: 650 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
    .an-plan-selection-toolbar button:hover { background: rgba(255,255,255,.08); }
    :root[data-agent-native-theme="light"] .an-plan-selection-toolbar button:hover { background: rgba(0,0,0,.06); }
    .an-plan-selection-toolbar svg { width: 17px; height: 17px; color: #00B5FF; }
    .an-plan-code-popover { position: absolute; z-index: 2147483001; width: min(760px, calc(100vw - 24px)); max-height: min(520px, calc(100vh - 24px)); overflow: hidden; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; background: rgba(16,16,18,.98); box-shadow: 0 24px 70px rgba(0,0,0,.42); backdrop-filter: blur(18px); }
    :root[data-agent-native-theme="light"] .an-plan-code-popover { border-color: rgba(0,0,0,.12); background: rgba(255,255,255,.98); box-shadow: 0 24px 70px rgba(29,29,24,.16); }
    .an-plan-code-popover-header { display: flex; min-height: 46px; align-items: center; gap: 12px; border-bottom: 1px solid var(--line, rgba(255,255,255,.12)); padding: 7px 9px 7px 14px; color: var(--muted, #a4a4aa); font: 650 12px/1.3 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .an-plan-code-popover-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #f4f4f5); font: 650 13px/1.3 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .an-plan-code-popover-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
    .an-plan-code-popover-close { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font-size: 18px; }
    .an-plan-code-popover-close:hover { background: rgba(255,255,255,.08); color: var(--text, #f4f4f5); }
    :root[data-agent-native-theme="light"] .an-plan-code-popover-close:hover { background: rgba(0,0,0,.06); }
    .an-plan-code-popover .code-preview-title { display: none !important; }
    .an-plan-code-popover .code-preview { border: 0 !important; background: transparent !important; box-shadow: none !important; }
    .an-plan-code-popover .code-preview pre { margin: 0 !important; max-height: 474px; overflow: auto; padding: 14px 16px !important; background: #0c0c0e !important; color: #e9e9ea; font: 12px/1.65 "SFMono-Regular", Consolas, "Liberation Mono", monospace !important; tab-size: 2; }
    .an-plan-code-popover .code-preview pre code { display: block !important; min-width: max-content; border: 0 !important; background: transparent !important; color: inherit !important; font: inherit !important; padding: 0 !important; white-space: pre !important; }
    .an-plan-code-popover .code-preview pre code * { margin: 0 !important; border: 0 !important; border-radius: 0 !important; outline: 0 !important; background: transparent !important; background-image: none !important; box-shadow: none !important; padding: 0 !important; text-decoration: none !important; font: inherit !important; }
    .an-plan-code-popover .code-preview pre code code { display: inline !important; }
    .editor-picker { position: relative; display: inline-flex; min-height: 32px; align-items: stretch; overflow: visible; border: 1px solid var(--line, rgba(255,255,255,.14)); border-radius: 8px; background: transparent; }
    .editor-picker:focus-within, .editor-picker:hover { border-color: rgba(0,181,255,.44); background: rgba(0,181,255,.06); }
    .editor-picker button { min-height: 30px; border: 0; border-radius: 0; background: transparent; color: var(--soft, #d4d4d8); padding: 0 10px; font: 650 12px/30px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
    .editor-picker button:hover { color: var(--text, #f4f4f5); background: rgba(255,255,255,.05); }
    .editor-picker-trigger { display: inline-flex; width: 48px; align-items: center; justify-content: center; gap: 6px; border-right: 1px solid var(--line, rgba(255,255,255,.14)) !important; border-radius: 7px 0 0 7px !important; }
    .editor-picker-open { border-radius: 0 7px 7px 0 !important; color: var(--text, #f4f4f5) !important; }
    .editor-picker-select { display: none; }
    .editor-picker-caret { width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-1px) rotate(45deg); opacity: .72; }
    .editor-picker-menu { position: absolute; top: calc(100% + 7px); right: 0; z-index: 2147483002; display: none; width: 188px; border: 1px solid var(--line, rgba(255,255,255,.14)); border-radius: 12px; background: var(--paper, #111113); padding: 6px; box-shadow: 0 18px 50px rgba(0,0,0,.32); }
    .editor-picker[data-open="true"] .editor-picker-menu { display: grid; gap: 2px; }
    .editor-picker-option { display: flex !important; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; border-radius: 8px !important; text-align: left; }
    .editor-picker-option:hover, .editor-picker-option.is-active { background: rgba(255,255,255,.06); color: var(--text, #f4f4f5); }
    .editor-icon { display: inline-flex; width: 18px; height: 18px; flex: 0 0 auto; align-items: center; justify-content: center; }
    .editor-icon svg { width: 18px; height: 18px; stroke-width: 2; }
    .editor-icon-vscode { color: #41a6f6; }
    .editor-icon-cursor { color: var(--text, #f4f4f5); }
    .editor-icon-finder { color: #4aa9ff; }
    .editor-icon-terminal { color: #73d99f; }
    .editor-icon-ghostty { color: #a78bfa; }
    .editor-icon-xcode { color: #54a7ff; }
    .editor-picker-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
    :root[data-agent-native-theme="light"] .editor-picker button { color: var(--soft, #4b4b4b); }
    :root[data-agent-native-theme="light"] .editor-picker button:hover, :root[data-agent-native-theme="light"] .editor-picker-option.is-active { background: rgba(0,0,0,.06); color: var(--text, #171717); }
    :root[data-agent-native-theme="light"] .editor-picker-menu { background: var(--paper, #ffffff); box-shadow: 0 18px 50px rgba(29,29,24,.13); }
    .visual-tabs[data-plan-tabs] { display: grid; gap: 14px; }
    .visual-tabs[data-plan-tabs] .tab-list { display: inline-flex; width: fit-content; max-width: 100%; gap: 4px; border: 1px solid var(--line, rgba(255,255,255,.14)); border-radius: 11px; background: var(--paper-2, rgba(255,255,255,.04)); padding: 4px; overflow-x: auto; }
    .visual-tabs[data-plan-tabs] .tab-button { min-height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--muted, #a4a4aa); padding: 0 11px; font: 650 12px/30px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; cursor: pointer; }
    .visual-tabs[data-plan-tabs] .tab-button:hover { color: var(--text, #f4f4f5); background: rgba(255,255,255,.05); }
    .visual-tabs[data-plan-tabs] .tab-button.is-active { background: var(--text, #f4f4f5); color: var(--bg, #0a0a0b); }
    :root[data-agent-native-theme="light"] .visual-tabs[data-plan-tabs] .tab-button:hover { background: rgba(0,0,0,.06); }
    .visual-tabs[data-plan-tabs] .tab-panel { display: none; }
    .visual-tabs[data-plan-tabs] .tab-panel.is-active { display: block; }
    .implementation-map { margin: 24px 0; border-top: 1px solid var(--line, rgba(255,255,255,.14)); }
    .implementation-map-header { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; color: var(--muted, #a4a4aa); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .implementation-file-tabs { min-height: 330px; display: grid; grid-template-columns: minmax(220px, .44fr) minmax(0, 1fr); border-top: 1px solid var(--line, rgba(255,255,255,.14)); border-bottom: 1px solid var(--line, rgba(255,255,255,.14)); }
    .implementation-file-list { display: grid; align-content: start; border-right: 1px solid var(--line, rgba(255,255,255,.14)); }
    .implementation-file-tab { width: 100%; display: grid; gap: 3px; border: 0; border-bottom: 1px solid var(--line, rgba(255,255,255,.14)); background: transparent; color: var(--muted, #a4a4aa); padding: 13px 14px; text-align: left; cursor: pointer; }
    .implementation-file-tab:hover { background: rgba(255,255,255,.035); color: var(--soft, #d4d4d8); }
    .implementation-file-tab.is-active { background: var(--paper-2, rgba(255,255,255,.04)); color: var(--text, #f4f4f5); box-shadow: inset 2px 0 0 var(--accent, #00B5FF); }
    .file-tab-name, .file-tab-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-tab-name { font: 700 14px/1.35 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .file-tab-path { font: 500 12px/1.35 "SFMono-Regular", Consolas, "Liberation Mono", monospace; color: var(--muted, #a4a4aa); }
    .implementation-file-tab.is-active .file-tab-path { color: var(--soft, #d4d4d8); }
    .implementation-file-panels { min-width: 0; }
    .implementation-file-panel { display: none; min-height: 100%; padding: 18px 20px 20px; border: 0 !important; }
    .implementation-file-panel.is-active { display: block; }
    .file-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--line, rgba(255,255,255,.14)); }
    .file-title-stack { min-width: 0; display: grid; gap: 5px; }
    .file-name { margin: 0; color: var(--text, #f4f4f5); font: 750 18px/1.25 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .file-path { margin: 0; overflow-wrap: anywhere; color: var(--muted, #a4a4aa); font: 500 12px/1.45 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .file-detail-body { padding-top: 16px; }
    .file-summary { max-width: 760px; margin: 0; color: var(--soft, #d4d4d8); font-size: 15px; }
    .inline-code-preview { margin-top: 18px; overflow: hidden; border: 1px solid var(--line, rgba(255,255,255,.14)); border-radius: 10px; background: #0c0c0e; }
    .code-preview pre, .inline-code-preview pre { margin: 0 !important; max-height: 420px; overflow: auto; padding: 14px 16px !important; background: #0c0c0e !important; color: #e9e9ea; font: 12px/1.65 "SFMono-Regular", Consolas, "Liberation Mono", monospace !important; tab-size: 2; }
    .code-preview pre code, .inline-code-preview pre code { display: block !important; min-width: max-content; border: 0 !important; background: transparent !important; color: inherit !important; font: inherit !important; padding: 0 !important; white-space: pre !important; }
    .code-preview pre code *, .inline-code-preview pre code * { margin: 0 !important; border: 0 !important; border-radius: 0 !important; outline: 0 !important; background: transparent !important; background-image: none !important; box-shadow: none !important; padding: 0 !important; text-decoration: none !important; font: inherit !important; }
    .code-preview pre code code, .inline-code-preview pre code code { display: inline !important; }
    .syntax-keyword { color: #7cc7ff; }
    .syntax-string { color: #a6e3a1; }
    .syntax-literal { color: #c4b5fd; }
    .syntax-comment { color: #7a7a83; }
    .file-actions { display: flex; align-items: flex-start; gap: 8px; }
    @media (max-width: 760px) { .implementation-file-tabs { grid-template-columns: 1fr; } .implementation-file-list { border-right: 0; } .implementation-file-panels { border-top: 1px solid var(--line, rgba(255,255,255,.14)); } .implementation-map-header, .file-detail-header, .file-actions { flex-wrap: wrap; } }
  </style><script>
    (() => {
      const state = ${payload};
      const editorOptions = ${editorOptionsPayload};
      const editorIconMap = ${editorIconPayload};
      const root = document.documentElement;
      root.dataset.agentNativeTheme = state.theme || "dark";
      if (state.annotateMode) root.classList.add("an-plan-annotating");
      function removeEmptyPlanSections() {
        const candidates = Array.from(document.querySelectorAll("section[data-plan-section-id], section.plan-section, section[id]"));
        for (const section of candidates) {
          const text = (section.textContent || "").replace(/\\s+/g, " ").trim();
          const hasMedia = Boolean(section.querySelector("img,svg,canvas,video,iframe,table,pre,code,template,.visual,.flow-diagram,.wireframe-shell,.implementation-map,[data-plan-tabs],[data-agent-native-code-preview]"));
          if (!text && !hasMedia) section.remove();
        }
      }
      function initializePlanTabs() {
        const tabsets = Array.from(document.querySelectorAll("[data-plan-tabs]"));
        for (const tabset of tabsets) {
          const buttons = Array.from(tabset.querySelectorAll("[data-tab-target]"));
          const panels = Array.from(tabset.querySelectorAll("[data-tab-panel]"));
          if (buttons.length === 0 || panels.length === 0) continue;
          const activate = (target, notify = true) => {
            for (const button of buttons) {
              const isActive = button.getAttribute("data-tab-target") === target;
              button.classList.toggle("is-active", isActive);
              button.setAttribute("aria-selected", String(isActive));
            }
            for (const panel of panels) {
              panel.classList.toggle("is-active", panel.getAttribute("data-tab-panel") === target);
            }
            requestAnimationFrame(syncAnnotationMarkers);
            if (notify) {
              window.parent.postMessage({ type: "agent-native-plan-close-comment-popover" }, "*");
            }
            postDocState();
          };
          for (const button of buttons) {
            button.setAttribute("role", "tab");
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              activate(button.getAttribute("data-tab-target") || "");
            });
          }
          for (const panel of panels) panel.setAttribute("role", "tabpanel");
          const initial = buttons.find((button) => button.classList.contains("is-active")) || buttons[0];
          activate(initial.getAttribute("data-tab-target") || "", false);
        }
      }
      function displayFilePath(rawPath) {
        return String(rawPath || "").replace(/\\s+/g, " ").trim().replace(/:\\d+$/, "");
      }
      function basenameForPath(path) {
        return path.split("/").filter(Boolean).pop() || path || "File";
      }
      function removeImplementationSymbolList(file) {
        file.querySelector(".symbol-list")?.remove();
      }
      function removeImplementationPreviewButtons(container) {
        for (const button of Array.from(container.querySelectorAll("[data-agent-native-code-preview]"))) {
          button.removeAttribute("data-agent-native-code-preview");
          button.removeAttribute("data-agent-native-hover-preview");
          if (button.tagName === "BUTTON" && button.closest(".file-actions")) button.remove();
        }
      }
      function inlinePreviewFromTemplate(template) {
        const preview = template?.content?.querySelector?.(".code-preview");
        if (!preview) return null;
        const clone = preview.cloneNode(true);
        clone.classList.add("inline-code-preview");
        clone.querySelector?.(".code-preview-title")?.remove?.();
        return clone;
      }
      function ensureInlineCodePreview(file) {
        const body = file.querySelector(".file-detail-body");
        const template = file.querySelector("template");
        if (body && !body.querySelector(".inline-code-preview")) {
          const inline = inlinePreviewFromTemplate(template);
          if (inline) body.appendChild(inline);
        }
        template?.remove?.();
        removeImplementationPreviewButtons(file);
      }
      function upgradeImplementationFileMaps() {
        const maps = Array.from(document.querySelectorAll(".implementation-map"));
        for (const map of maps) {
          const oldContainer = map.querySelector(":scope > .implementation-files");
          if (!oldContainer) {
            removeImplementationPreviewButtons(map);
            for (const file of Array.from(map.querySelectorAll(".implementation-file"))) {
              removeImplementationSymbolList(file);
              file.querySelector(".file-path span")?.remove();
              ensureInlineCodePreview(file);
            }
            continue;
          }
          const files = Array.from(oldContainer.querySelectorAll(":scope > .implementation-file"));
          if (files.length === 0) continue;
          map.dataset.planTabs = "true";
          oldContainer.className = "implementation-file-tabs";
          const list = document.createElement("div");
          list.className = "implementation-file-list";
          list.setAttribute("role", "tablist");
          list.setAttribute("aria-label", "Files touched");
          const panels = document.createElement("div");
          panels.className = "implementation-file-panels";
          oldContainer.replaceChildren(list, panels);
          files.forEach((file, index) => {
            const path = displayFilePath(file.getAttribute("data-file-path") || file.querySelector(".file-path")?.textContent || ("File " + (index + 1)));
            const existingActions = file.querySelector(":scope > .file-actions") || file.querySelector(".file-actions");
            const existingTemplates = Array.from(file.querySelectorAll(":scope > template"));
            const existingInfo = Array.from(file.children).find((child) => child !== existingActions && child.tagName !== "TEMPLATE");
            const summary = existingInfo?.querySelector?.(".file-summary") || file.querySelector(".file-summary");
            const legacyButtons = Array.from(existingActions?.querySelectorAll("[data-agent-native-open-editor]") || []);
            const vscodeHref = legacyButtons.map((button) => button.getAttribute("data-agent-native-open-editor") || "").find((href) => href.startsWith("vscode://file/")) || "";
            const cursorHref = legacyButtons.map((button) => button.getAttribute("data-agent-native-open-editor") || "").find((href) => href.startsWith("cursor://file/")) || "";
            const openFile = openFileFromHref(vscodeHref || cursorHref);
            const target = "runtime-file-" + index + "-" + path.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "implementation-file-tab" + (index === 0 ? " is-active" : "");
            tab.dataset.tabTarget = target;
            tab.dataset.filePath = path;
            if (openFile) tab.dataset.agentNativeOpenFile = openFile;
            tab.innerHTML = '<span class="file-tab-name"></span><span class="file-tab-path"></span>';
            tab.querySelector(".file-tab-name").textContent = basenameForPath(path);
            tab.querySelector(".file-tab-path").textContent = path;
            list.appendChild(tab);

            file.className = "implementation-file implementation-file-panel tab-panel" + (index === 0 ? " is-active" : "");
            file.dataset.tabPanel = target;
            file.dataset.filePath = path;

            const header = document.createElement("div");
            header.className = "file-detail-header";
            const title = document.createElement("div");
            title.className = "file-title-stack";
            title.innerHTML = '<p class="file-name"></p><p class="file-path"></p>';
            title.querySelector(".file-name").textContent = basenameForPath(path);
            title.querySelector(".file-path").textContent = path;
            header.appendChild(title);
            if (existingActions) header.appendChild(existingActions);

            const body = document.createElement("div");
            body.className = "file-detail-body";
            if (summary) body.appendChild(summary);
            const inlinePreview = inlinePreviewFromTemplate(existingTemplates[0]);
            if (inlinePreview) body.appendChild(inlinePreview);

            removeImplementationPreviewButtons(file);
            file.replaceChildren(header, body);
            removeImplementationSymbolList(file);
            ensureInlineCodePreview(file);
            panels.appendChild(file);
          });
        }
      }
      const editorValues = editorOptions.map((option) => option.value);
      let preferredEditor = normalizeEditor(state.preferredEditor);
      function normalizeEditor(value) {
        return editorValues.includes(value) ? value : "vscode";
      }
      function editorLabel(editor) {
        return editorOptions.find((option) => option.value === editor)?.label || "VS Code";
      }
      function editorIconHtml(editor) {
        const normalized = normalizeEditor(editor);
        return '<span class="editor-icon editor-icon-' + normalized + '">' + (editorIconMap[normalized] || "") + '</span>';
      }
      function editorTriggerHtml(editor) {
        const normalized = normalizeEditor(editor);
        return editorIconHtml(normalized) + '<span class="editor-picker-sr">Preferred editor: ' + editorLabel(normalized) + '</span><span class="editor-picker-caret" aria-hidden="true"></span>';
      }
      function editorSelectOptionsHtml() {
        return editorOptions.map(({ value, label }) => '<option value="' + value + '">' + label + '</option>').join("");
      }
      function editorMenuHtml(activeEditor) {
        const active = normalizeEditor(activeEditor);
        return editorOptions.map(({ value, label }) => {
          const selected = value === active;
          return '<button type="button" class="editor-picker-option' + (selected ? " is-active" : "") + '" data-agent-native-editor-option="' + value + '" role="menuitemradio" aria-checked="' + (selected ? "true" : "false") + '">' + editorIconHtml(value) + '<span>' + label + '</span></button>';
        }).join("");
      }
      function closeEditorMenus(exceptPicker) {
        for (const picker of document.querySelectorAll("[data-agent-native-editor-picker]")) {
          if (picker !== exceptPicker) {
            picker.removeAttribute("data-open");
            picker.querySelector("[data-agent-native-editor-trigger]")?.setAttribute("aria-expanded", "false");
          }
        }
      }
      function setPreferredEditor(editor, notifyParent) {
        preferredEditor = normalizeEditor(editor);
        for (const picker of document.querySelectorAll("[data-agent-native-editor-picker]")) {
          picker.dataset.editor = preferredEditor;
          const trigger = picker.querySelector("[data-agent-native-editor-trigger]");
          if (trigger) {
            trigger.innerHTML = editorTriggerHtml(preferredEditor);
            trigger.setAttribute("aria-label", "Choose editor. Current: " + editorLabel(preferredEditor));
          }
          const select = picker.querySelector("[data-agent-native-editor-select]");
          if (select) select.value = preferredEditor;
          const menu = picker.querySelector("[data-agent-native-editor-menu]");
          if (menu) menu.innerHTML = editorMenuHtml(preferredEditor);
        }
        if (notifyParent) {
          window.parent.postMessage({ type: "agent-native-plan-editor-preference", editor: preferredEditor }, "*");
        }
      }
      function splitFileLocation(filePath, explicitLine) {
        const value = filePath || "";
        const match = value.match(/^(.*?)(?::(\\d+)(?::(\\d+))?)?$/);
        return {
          path: match?.[1] || value,
          line: explicitLine || match?.[2] || "",
          column: match?.[3] || "1"
        };
      }
      function openFileFromHref(href) {
        const match = String(href || "").match(/^(?:vscode|cursor):\\/\\/file(.+)$/);
        return match?.[1] ? decodeURI(match[1]) : "";
      }
      function directoryForPath(filePath) {
        const index = filePath.lastIndexOf("/");
        return index > 0 ? filePath.slice(0, index) : filePath;
      }
      function hrefForEditor(editor, filePath, line) {
        if (!filePath) return "";
        const normalized = normalizeEditor(editor);
        const location = splitFileLocation(filePath, line);
        const lineSuffix = location.line ? ":" + location.line + ":" + location.column : "";
        if (normalized === "finder") return "file://" + encodeURI(location.path);
        if (normalized === "xcode") {
          return "xcode://open?url=" + encodeURIComponent("file://" + location.path) + (location.line ? "&line=" + encodeURIComponent(location.line) : "");
        }
        if (normalized === "terminal") {
          return "terminal://open?path=" + encodeURIComponent(directoryForPath(location.path));
        }
        if (normalized === "ghostty") {
          return "ghostty://open?path=" + encodeURIComponent(directoryForPath(location.path));
        }
        return normalized + "://file" + encodeURI(location.path) + lineSuffix;
      }
      function createEditorPicker(openFile, hrefs = {}, line = "") {
        const picker = document.createElement("div");
        picker.className = "editor-picker";
        picker.dataset.agentNativeEditorPicker = "true";
        picker.dataset.editor = preferredEditor;
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "editor-picker-trigger";
        trigger.dataset.agentNativeEditorTrigger = "true";
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-label", "Choose editor. Current: " + editorLabel(preferredEditor));
        trigger.innerHTML = editorTriggerHtml(preferredEditor);
        const select = document.createElement("select");
        select.className = "editor-picker-select";
        select.dataset.agentNativeEditorSelect = "true";
        select.setAttribute("aria-hidden", "true");
        select.setAttribute("tabindex", "-1");
        select.innerHTML = editorSelectOptionsHtml();
        const menu = document.createElement("div");
        menu.className = "editor-picker-menu";
        menu.dataset.agentNativeEditorMenu = "true";
        menu.setAttribute("role", "menu");
        menu.innerHTML = editorMenuHtml(preferredEditor);
        const open = document.createElement("button");
        open.type = "button";
        open.className = "editor-picker-open";
        open.textContent = "Open";
        open.dataset.agentNativeOpenSelectedEditor = "true";
        if (openFile) open.dataset.agentNativeOpenFile = openFile;
        if (line) open.dataset.agentNativeOpenLine = line;
        if (hrefs.vscode) open.dataset.agentNativeOpenVscode = hrefs.vscode;
        if (hrefs.cursor) open.dataset.agentNativeOpenCursor = hrefs.cursor;
        picker.append(trigger, select, menu, open);
        return picker;
      }
      function upgradeEditorPickerElement(picker) {
        if (picker.querySelector("[data-agent-native-editor-trigger]")) return;
        const select = picker.querySelector("[data-agent-native-editor-select]");
        const open = picker.querySelector("[data-agent-native-open-selected-editor], [data-agent-native-open-file]") || document.createElement("button");
        const editor = normalizeEditor(select?.value || picker.dataset.editor || preferredEditor);
        const openFile = open.getAttribute?.("data-agent-native-open-file") || "";
        const openLine = open.getAttribute?.("data-agent-native-open-line") || "";
        const vscode = open.getAttribute?.("data-agent-native-open-vscode") || "";
        const cursor = open.getAttribute?.("data-agent-native-open-cursor") || "";
        const upgraded = createEditorPicker(openFile, { vscode, cursor }, openLine);
        picker.replaceChildren(...Array.from(upgraded.childNodes));
        picker.className = "editor-picker";
        picker.dataset.agentNativeEditorPicker = "true";
        picker.dataset.editor = editor;
      }
      function initializeEditorPickers() {
        const actionGroups = Array.from(document.querySelectorAll(".file-actions"));
        for (const actions of actionGroups) {
          if (actions.querySelector("[data-agent-native-editor-picker]")) {
            for (const picker of Array.from(actions.querySelectorAll("[data-agent-native-editor-picker]"))) {
              upgradeEditorPickerElement(picker);
            }
            continue;
          }
          const legacyButtons = Array.from(actions.querySelectorAll("[data-agent-native-open-editor]"));
          if (legacyButtons.length === 0) continue;
          const hrefs = {};
          for (const button of legacyButtons) {
            const href = button.getAttribute("data-agent-native-open-editor") || "";
            if (href.startsWith("cursor://file/")) hrefs.cursor = href;
            if (href.startsWith("vscode://file/")) hrefs.vscode = href;
            button.remove();
          }
          const openFile = openFileFromHref(hrefs.vscode || hrefs.cursor);
          if (!openFile && !hrefs.cursor && !hrefs.vscode) continue;
          actions.appendChild(createEditorPicker(openFile, hrefs));
        }
        for (const picker of Array.from(document.querySelectorAll("[data-agent-native-editor-picker]"))) {
          upgradeEditorPickerElement(picker);
        }
        setPreferredEditor(preferredEditor, false);
      }
      function escapeCodeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }
      function highlightPlainCodeBlocks() {
        const blocks = Array.from(document.querySelectorAll(".code-preview pre, .inline-code-preview pre"));
        for (const pre of blocks) {
          const target = pre.querySelector("code") || pre;
          if (target.querySelector(".syntax-keyword,.syntax-string,.syntax-literal,.syntax-comment")) continue;
          const text = target.textContent || "";
          if (!text.trim()) continue;
          let html = escapeCodeHtml(text);
          html = html
            .replace(/(&quot;[^&]*(?:&quot;)|&#39;[^&]*(?:&#39;)|\`[^\`]*\`)/g, '<span class="syntax-string">$1</span>')
            .replace(/\\b(import|export|from|const|let|var|function|return|type|interface|class|extends|async|await|if|else|for|while|new|throw|try|catch|switch|case|default)\\b/g, '<span class="syntax-keyword">$1</span>')
            .replace(/\\b(true|false|null|undefined)\\b/g, '<span class="syntax-literal">$1</span>')
            .replace(/(^|\\n)(\\s*\\/\\/.*)/g, '$1<span class="syntax-comment">$2</span>');
          target.innerHTML = html;
        }
      }
      function setRuntimeAnnotateMode(value) {
        state.annotateMode = Boolean(value);
        root.classList.toggle("an-plan-annotating", state.annotateMode);
        if (state.annotateMode) {
          closeEditorMenus();
          hideCodePopover();
          hideSelectionToolbar();
        } else {
          hideSelectionToolbar();
        }
        postDocState();
      }
      function setRuntimeTheme(theme) {
        state.theme = theme === "light" ? "light" : "dark";
        root.dataset.agentNativeTheme = state.theme;
      }
      window.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type !== "agent-native-plan-runtime-state") return;
        if (typeof data.theme === "string") setRuntimeTheme(data.theme);
        if (typeof data.preferredEditor === "string") {
          setPreferredEditor(data.preferredEditor, false);
        }
        if (typeof data.annotateMode === "boolean") {
          setRuntimeAnnotateMode(data.annotateMode);
        }
      });
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
      removeEmptyPlanSections();
      upgradeImplementationFileMaps();
      initializePlanTabs();
      initializeEditorPickers();
      highlightPlainCodeBlocks();
      postDocState();
      window.addEventListener("scroll", postDocState, { passive: true });
      window.addEventListener("resize", () => {
        syncAnnotationMarkers();
        postDocState();
      });
      function pct(value, total) {
        return Math.max(0, Math.min(100, Number(((value / Math.max(total, 1)) * 100).toFixed(3))));
      }
      function closestSection(target) {
        if (!(target instanceof Element)) return null;
        return target.closest("[data-plan-section-id], section[id], article[id], [id]");
      }
      function normalizeText(value) {
        return String(value || "").replace(/\\s+/g, " ").trim();
      }
      function textSnippet(target) {
        if (!(target instanceof Element)) return "";
        const text = normalizeText(target.innerText || target.textContent || "");
        return text.slice(0, 90);
      }
      function closestTextContext(target) {
        if (!(target instanceof Element)) return "";
        const selector = [
          "p",
          "li",
          "h1",
          "h2",
          "h3",
          "h4",
          "td",
          "th",
          "blockquote",
          "figcaption",
          "summary",
          "button",
          "a",
          "label",
          "pre",
          "code",
          "[data-plan-text]"
        ].join(",");
        const direct = target.matches(selector) ? target : target.closest(selector);
        const candidates = [direct, target, target.parentElement, closestSection(target)].filter(Boolean);
        for (const candidate of candidates) {
          const text = normalizeText(candidate.innerText || candidate.textContent || "");
          if (text.length >= 8) return text.slice(0, 220);
        }
        return "";
      }
      function closestVisualContext(target) {
        if (!(target instanceof Element)) return null;
        return target.closest(".wireframe-shell,.mock-browser,.mock-plan,.mock-sidebar,.diagram-card,.flow-diagram,svg,canvas,img,figure,[data-plan-visual],[data-visual]");
      }
      function visualLabel(visual, section) {
        if (!(visual instanceof Element)) return "";
        return normalizeText(
          visual.getAttribute("aria-label") ||
            visual.getAttribute("data-label") ||
            visual.querySelector?.("strong,h3,h4")?.textContent ||
            sectionTitle(section) ||
            "Visual"
        );
      }
      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }
      function cssEscape(value) {
        if (window.CSS?.escape) return window.CSS.escape(String(value));
        return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => "\\\\" + char);
      }
      function cssAttr(value) {
        return String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\"');
      }
      function uniqueSelector(selector) {
        try {
          return document.querySelectorAll(selector).length === 1;
        } catch {
          return false;
        }
      }
      function selectorForElement(element) {
        if (!(element instanceof Element)) return "";
        if (element.id) {
          const selector = "#" + cssEscape(element.id);
          if (uniqueSelector(selector)) return selector;
        }
        for (const attr of ["data-plan-section-id", "data-tab-panel", "data-file-path"]) {
          const value = element.getAttribute(attr);
          if (!value) continue;
          const selector = element.tagName.toLowerCase() + "[" + attr + '="' + cssAttr(value) + '"]';
          if (uniqueSelector(selector)) return selector;
        }
        const parts = [];
        let current = element;
        while (current && current !== document.body && current !== document.documentElement) {
          let part = current.tagName.toLowerCase();
          const parent = current.parentElement;
          if (!parent) break;
          const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (sameTagSiblings.length > 1) {
            part += ":nth-of-type(" + (sameTagSiblings.indexOf(current) + 1) + ")";
          }
          parts.unshift(part);
          const selector = "body > " + parts.join(" > ");
          if (uniqueSelector(selector)) return selector;
          current = parent;
        }
        return parts.length ? "body > " + parts.join(" > ") : "";
      }
      function anchorTargetForElement(element) {
        if (!(element instanceof Element)) return null;
        const visual = closestVisualContext(element);
        if (visual) return visual;
        return closestTextElement(element) || element.closest("[data-tab-panel], [data-plan-section-id], section[id], article[id]") || element;
      }
      function withTargetAnchor(anchor, target, clientX, clientY) {
        const targetElement = anchorTargetForElement(target);
        const rect = targetElement?.getBoundingClientRect?.();
        if (!targetElement || !rect || (!rect.width && !rect.height)) return anchor;
        return {
          ...anchor,
          targetSelector: selectorForElement(targetElement) || undefined,
          targetX: pct(clamp(clientX, rect.left, rect.right) - rect.left, rect.width),
          targetY: pct(clamp(clientY, rect.top, rect.bottom) - rect.top, rect.height)
        };
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
      function tabContextForElement(element) {
        if (!(element instanceof Element)) return {};
        const panel = element.closest("[data-tab-panel]");
        const tabPanelId = panel?.getAttribute("data-tab-panel") || "";
        if (!tabPanelId) return {};
        const tabset = panel.closest("[data-plan-tabs]");
        const tabButton = Array.from(tabset?.querySelectorAll("[data-tab-target]") || []).find((button) => button.getAttribute("data-tab-target") === tabPanelId);
        const tabLabel = normalizeText(tabButton?.textContent || panel.getAttribute("aria-label") || "");
        return {
          tabPanelId,
          tabLabel: tabLabel || undefined
        };
      }
      function tabContextForPoint(anchor) {
        if (!anchor || anchor.tabPanelId) return {};
        const doc = document.documentElement;
        const clientX = (anchor.x / 100) * doc.scrollWidth - window.scrollX;
        const clientY = (anchor.y / 100) * Math.max(doc.scrollHeight, document.body.scrollHeight) - window.scrollY;
        const element = document.elementFromPoint(clientX, clientY);
        return tabContextForElement(element);
      }
      function isTabContextActive(tabPanelId) {
        if (!tabPanelId) return true;
        const panel = Array.from(document.querySelectorAll("[data-tab-panel]")).find((candidate) => candidate.getAttribute("data-tab-panel") === tabPanelId);
        return Boolean(panel?.classList.contains("is-active"));
      }
      function elementTabPanelId(element) {
        if (!(element instanceof Element)) return "";
        return element.closest("[data-tab-panel]")?.getAttribute("data-tab-panel") || "";
      }
      function isElementTabActive(element) {
        const tabPanelId = elementTabPanelId(element);
        return !tabPanelId || isTabContextActive(tabPanelId);
      }
      function resolveAnchorTarget(anchor) {
        if (!anchor) return null;
        if (anchor.targetSelector) {
          try {
            const target = document.querySelector(anchor.targetSelector);
            if (target) return target;
          } catch {
            // Ignore stale selectors and fall back to quote matching.
          }
        }
        const quote = normalizeText(anchor.textQuote || anchor.snippet || "");
        if (!quote) return null;
        const needle = quote.slice(0, 120);
        const scopes = [];
        if (anchor.sectionId) {
          const escapedSection = cssEscape(anchor.sectionId);
          scopes.push(
            document.querySelector('[data-plan-section-id="' + cssAttr(anchor.sectionId) + '"]'),
            document.getElementById(anchor.sectionId),
            document.querySelector("#" + escapedSection)
          );
        }
        scopes.push(document);
        for (const scope of scopes.filter(Boolean)) {
          const candidates = Array.from(scope.querySelectorAll?.([
            "p",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "td",
            "th",
            "blockquote",
            "figcaption",
            "summary",
            "button",
            "a",
            "label",
            "pre",
            "code",
            "[data-plan-text]"
          ].join(",")) || []);
          const match = candidates.find((candidate) => normalizeText(candidate.textContent || "").includes(needle));
          if (match) return anchorTargetForElement(match);
        }
        return null;
      }
      function pointForAnchor(anchor) {
        const doc = document.documentElement;
        const docHeight = Math.max(doc.scrollHeight, document.body.scrollHeight);
        const target = resolveAnchorTarget(anchor);
        if (target) {
          if (!isElementTabActive(target)) return null;
          const rect = target.getBoundingClientRect();
          if (rect && (rect.width || rect.height)) {
            return {
              left: rect.left + window.scrollX + ((anchor.targetX ?? anchor.visualX ?? 50) / 100) * rect.width,
              top: rect.top + window.scrollY + ((anchor.targetY ?? anchor.visualY ?? 50) / 100) * rect.height
            };
          }
        }
        const tabContext = anchor.tabPanelId ? { tabPanelId: anchor.tabPanelId } : tabContextForPoint(anchor);
        if (!isTabContextActive(tabContext.tabPanelId)) return null;
        return {
          left: (anchor.x / 100) * doc.scrollWidth,
          top: (anchor.y / 100) * docHeight
        };
      }
      function setMarkerVisibility(marker, visible) {
        marker.style.display = visible ? "inline-flex" : "none";
        marker.setAttribute("aria-hidden", String(!visible));
      }
      function positionMarker(marker, item) {
        const point = pointForAnchor(item.anchor);
        if (!point) {
          setMarkerVisibility(marker, false);
          return;
        }
        marker.style.left = point.left + "px";
        marker.style.top = point.top + "px";
        setMarkerVisibility(marker, true);
      }
      function anchorWithCurrentPoint(anchor) {
        const point = pointForAnchor(anchor);
        if (!point) return anchor;
        const doc = document.documentElement;
        return {
          ...anchor,
          x: pct(point.left, doc.scrollWidth),
          y: pct(point.top, Math.max(doc.scrollHeight, document.body.scrollHeight))
        };
      }
      function rangeFromPoint(clientX, clientY) {
        if (document.caretPositionFromPoint) {
          const position = document.caretPositionFromPoint(clientX, clientY);
          if (!position?.offsetNode) return null;
          const range = document.createRange();
          range.setStart(position.offsetNode, position.offset);
          range.collapse(true);
          return range;
        }
        if (document.caretRangeFromPoint) {
          return document.caretRangeFromPoint(clientX, clientY);
        }
        return null;
      }
      function expandRangeToWord(range) {
        if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
        const node = range.startContainer;
        const text = node.textContent || "";
        if (!text.trim()) return null;
        let index = Math.min(range.startOffset, Math.max(0, text.length - 1));
        if (/\\s/.test(text[index] || "")) {
          let left = index - 1;
          let right = index + 1;
          while (left >= 0 || right < text.length) {
            if (left >= 0 && !/\\s/.test(text[left])) {
              index = left;
              break;
            }
            if (right < text.length && !/\\s/.test(text[right])) {
              index = right;
              break;
            }
            left -= 1;
            right += 1;
          }
        }
        if (/\\s/.test(text[index] || "")) return null;
        let start = index;
        let end = index + 1;
        while (start > 0 && !/\\s/.test(text[start - 1])) start -= 1;
        while (end < text.length && !/\\s/.test(text[end])) end += 1;
        const selectedText = text.slice(start, end).trim();
        if (selectedText.length < 2) return null;
        const wordRange = document.createRange();
        wordRange.setStart(node, start);
        wordRange.setEnd(node, end);
        return { range: wordRange, selectedText };
      }
      function closestTextElement(target) {
        if (!(target instanceof Element)) return null;
        const selector = [
          "p",
          "li",
          "h1",
          "h2",
          "h3",
          "h4",
          "td",
          "th",
          "blockquote",
          "figcaption",
          "summary",
          "button",
          "a",
          "label",
          "pre",
          "code",
          "[data-plan-text]"
        ].join(",");
        return target.matches(selector) ? target : target.closest(selector);
      }
      function anchorFromPoint(clientX, clientY, target) {
        const word = expandRangeToWord(rangeFromPoint(clientX, clientY));
        if (word) {
          const anchor = anchorFromRange(word.range, word.selectedText);
          if (anchor) return anchor;
        }
        const textElement = closestTextElement(target);
        if (!(textElement instanceof Element)) return null;
        const rect = textElement.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        const doc = document.documentElement;
        const textQuote = closestTextContext(textElement);
        const section = closestSection(textElement);
        const anchor = {
          x: pct(clamp(clientX, rect.left, rect.right) + window.scrollX, doc.scrollWidth),
          y: pct(clamp(clientY, rect.top, rect.bottom) + window.scrollY, Math.max(doc.scrollHeight, document.body.scrollHeight)),
          sectionId: section?.getAttribute("data-plan-section-id") || section?.id || undefined,
          sectionTitle: sectionTitle(section) || undefined,
          ...tabContextForElement(textElement),
          snippet: textQuote || textSnippet(textElement),
          textQuote: textQuote || undefined,
          anchorKind: textQuote ? "text" : "point",
          tagName: textElement.tagName.toLowerCase()
        };
        return withTargetAnchor(anchor, textElement, clientX, clientY);
      }
      function anchorFromRange(range, selectedText) {
        const rect = range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        const doc = document.documentElement;
        const section = sectionForNode(range.commonAncestorContainer);
        const rangeElement = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        const anchor = {
          x: pct(rect.left + window.scrollX + rect.width / 2, doc.scrollWidth),
          y: pct(rect.top + window.scrollY + rect.height / 2, Math.max(doc.scrollHeight, document.body.scrollHeight)),
          sectionId: section?.getAttribute("data-plan-section-id") || section?.id || undefined,
          sectionTitle: sectionTitle(section) || undefined,
          ...tabContextForElement(rangeElement),
          snippet: selectedText.slice(0, 160),
          textQuote: selectedText.slice(0, 220),
          anchorKind: "text",
          tagName: "selection"
        };
        return withTargetAnchor(anchor, rangeElement, rect.left + rect.width / 2, rect.top + rect.height / 2);
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
      function hideCodePopover() {
        document.querySelector(".an-plan-code-popover")?.remove();
      }
      function showCodePopover(button, templateId) {
        const template = document.getElementById(templateId);
        if (!(template instanceof HTMLTemplateElement)) return;
        hideCodePopover();
        const popover = document.createElement("div");
        popover.className = "an-plan-code-popover";
        popover.innerHTML = '<div class="an-plan-code-popover-header"><span class="an-plan-code-popover-title"></span><div class="an-plan-code-popover-actions"></div><button type="button" class="an-plan-code-popover-close" aria-label="Close code preview">×</button></div><div class="an-plan-code-popover-body"></div>';
        const content = template.content.cloneNode(true);
        const codePreview = content.querySelector?.(".code-preview");
        const oldTitle = content.querySelector?.(".code-preview-title");
        const fileTitle = codePreview?.getAttribute?.("data-file-path") || oldTitle?.querySelector?.("strong")?.textContent?.trim() || button.getAttribute("data-file-path") || button.closest(".implementation-file")?.getAttribute("data-file-path") || "Snippet";
        const hrefs = {};
        const fileActions = button.closest(".implementation-file")?.querySelector(".file-actions");
        for (const openButton of Array.from(fileActions?.querySelectorAll("[data-agent-native-open-editor], [data-agent-native-open-selected-editor], [data-agent-native-open-file]") || [])) {
          const vscode = openButton.getAttribute("data-agent-native-open-vscode") || "";
          const cursor = openButton.getAttribute("data-agent-native-open-cursor") || "";
          const legacy = openButton.getAttribute("data-agent-native-open-editor") || "";
          if (vscode) hrefs.vscode = vscode;
          if (cursor) hrefs.cursor = cursor;
          if (legacy.startsWith("vscode://file/")) hrefs.vscode = legacy;
          if (legacy.startsWith("cursor://file/")) hrefs.cursor = legacy;
        }
        const openFile = button.getAttribute("data-agent-native-open-file") || codePreview?.getAttribute?.("data-agent-native-open-file") || openFileFromHref(hrefs.vscode || hrefs.cursor);
        const openLine = button.getAttribute("data-agent-native-open-line") || codePreview?.getAttribute?.("data-agent-native-open-line") || "";
        oldTitle?.remove?.();
        popover.querySelector(".an-plan-code-popover-title").textContent = fileTitle;
        if (openFile || hrefs.vscode || hrefs.cursor) {
          popover.querySelector(".an-plan-code-popover-actions")?.append(createEditorPicker(openFile, hrefs, openLine));
          setPreferredEditor(preferredEditor, false);
        }
        popover.querySelector(".an-plan-code-popover-body")?.append(content);
        popover.querySelector(".an-plan-code-popover-close")?.addEventListener("click", hideCodePopover);
        document.body.appendChild(popover);
        const rect = button.getBoundingClientRect();
        const width = popover.offsetWidth || 640;
        const height = popover.offsetHeight || 420;
        const minLeft = window.scrollX + 12;
        const maxLeft = window.scrollX + document.documentElement.clientWidth - width - 12;
        popover.style.left = clamp(rect.left + window.scrollX, minLeft, maxLeft) + "px";
        popover.style.top = clamp(rect.bottom + window.scrollY + 8, window.scrollY + 12, window.scrollY + document.documentElement.clientHeight - height - 12) + "px";
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
      function syncAnnotationMarkers() {
        for (const marker of document.querySelectorAll("[data-agent-native-plan-marker]")) {
          if (marker.__agentNativePlanAnnotation) {
            positionMarker(marker, marker.__agentNativePlanAnnotation);
            continue;
          }
          const tabPanelId = marker.getAttribute("data-tab-panel-id") || "";
          setMarkerVisibility(marker, isTabContextActive(tabPanelId));
        }
      }
      const layer = ensureLayer();
      for (const item of state.annotations) {
        if (!item.anchor) continue;
        const button = document.createElement("button");
        const tabContext = item.anchor.tabPanelId ? { tabPanelId: item.anchor.tabPanelId, tabLabel: item.anchor.tabLabel } : tabContextForPoint(item.anchor);
        button.type = "button";
        button.className = "an-plan-marker";
        button.dataset.status = item.status || "open";
        button.dataset.agentNativePlanMarker = "true";
        button.__agentNativePlanAnnotation = item;
        if (tabContext.tabPanelId) {
          button.dataset.tabPanelId = tabContext.tabPanelId;
        }
        if (tabContext.tabLabel) {
          button.dataset.tabLabel = tabContext.tabLabel;
        }
        positionMarker(button, item);
        button.textContent = String(item.index);
        button.title = item.message || "Plan comment";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.parent.postMessage({
            type: "agent-native-plan-open-comment",
            comment: {
              ...item,
              anchor: anchorWithCurrentPoint(item.anchor)
            }
          }, "*");
        });
        layer.appendChild(button);
      }
      document.addEventListener("selectionchange", () => requestAnimationFrame(updateSelectionToolbar));
      document.addEventListener("mouseup", () => setTimeout(updateSelectionToolbar, 0));
      document.addEventListener("keyup", updateSelectionToolbar);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeEditorMenus();
      });
      document.addEventListener("change", (event) => {
        const editorSelect = event.target instanceof Element ? event.target.closest("[data-agent-native-editor-select]") : null;
        if (!editorSelect) return;
        setPreferredEditor(editorSelect.value, true);
      });
      document.addEventListener("click", (event) => {
        const editorOption = event.target instanceof Element ? event.target.closest("[data-agent-native-editor-option]") : null;
        if (editorOption) {
          event.preventDefault();
          event.stopPropagation();
          setPreferredEditor(editorOption.getAttribute("data-agent-native-editor-option"), true);
          closeEditorMenus();
          return;
        }
        const editorTrigger = event.target instanceof Element ? event.target.closest("[data-agent-native-editor-trigger]") : null;
        if (editorTrigger) {
          event.preventDefault();
          event.stopPropagation();
          const picker = editorTrigger.closest("[data-agent-native-editor-picker]");
          const willOpen = picker?.getAttribute("data-open") !== "true";
          closeEditorMenus(picker);
          if (picker && willOpen) {
            picker.setAttribute("data-open", "true");
            editorTrigger.setAttribute("aria-expanded", "true");
          } else {
            picker?.removeAttribute("data-open");
            editorTrigger.setAttribute("aria-expanded", "false");
          }
          return;
        }
        const previewButton = event.target instanceof Element ? event.target.closest("[data-agent-native-code-preview]") : null;
        if (previewButton) {
          event.preventDefault();
          event.stopPropagation();
          showCodePopover(previewButton, previewButton.getAttribute("data-agent-native-code-preview") || "");
          return;
        }
        const editorButton = event.target instanceof Element ? event.target.closest("[data-agent-native-open-file], [data-agent-native-open-selected-editor]") : null;
        if (editorButton) {
          event.preventDefault();
          event.stopPropagation();
          const picker = editorButton.closest("[data-agent-native-editor-picker]");
          const select = picker?.querySelector?.("[data-agent-native-editor-select]");
          const editor = normalizeEditor(picker?.getAttribute("data-editor") || select?.value || preferredEditor);
          const directHref = editorButton.getAttribute("data-agent-native-open-" + editor) || "";
          const filePath = editorButton.getAttribute("data-agent-native-open-file") || "";
          const line = editorButton.getAttribute("data-agent-native-open-line") || "";
          const href = directHref || hrefForEditor(editor, filePath, line);
          closeEditorMenus();
          window.parent.postMessage({ type: "agent-native-plan-open-editor", href }, "*");
          return;
        }
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
          if (event.target instanceof Element && event.target.closest(".an-plan-code-popover")) return;
          closeEditorMenus();
          hideCodePopover();
          window.parent.postMessage({ type: "agent-native-plan-close-comment-popover" }, "*");
          return;
        }
        if (!state.annotateMode) return;
        if (event.target instanceof Element && event.target.closest("[data-agent-native-plan-marker]")) return;
        hideSelectionToolbar();
        event.preventDefault();
        event.stopPropagation();
        const doc = document.documentElement;
        const target = event.target instanceof Element ? event.target : null;
        const section = closestSection(target);
        const visual = closestVisualContext(target);
        const visualRect = visual?.getBoundingClientRect?.();
        const tabContext = tabContextForElement(visual || target || section);
        const textAnchor = visual ? null : anchorFromPoint(event.clientX, event.clientY, target);
        const textQuote = visual ? "" : closestTextContext(target);
        const visualX = visualRect ? pct(event.clientX - visualRect.left, visualRect.width) : undefined;
        const visualY = visualRect ? pct(event.clientY - visualRect.top, visualRect.height) : undefined;
        const fallbackAnchor = {
          x: pct(event.pageX, doc.scrollWidth),
          y: pct(event.pageY, Math.max(doc.scrollHeight, document.body.scrollHeight)),
          sectionId: section?.getAttribute("data-plan-section-id") || section?.id || undefined,
          sectionTitle: sectionTitle(section) || undefined,
          ...tabContext,
          snippet: textQuote || (target ? textSnippet(target) : ""),
          textQuote: textQuote || undefined,
          anchorKind: visual ? "visual" : textQuote ? "text" : "point",
          visualLabel: visual ? visualLabel(visual, section) : undefined,
          visualX,
          visualY,
          tagName: target ? target.tagName.toLowerCase() : undefined
        };
        const anchoredFallback = withTargetAnchor(fallbackAnchor, visual || target, event.clientX, event.clientY);
        window.parent.postMessage({
          type: "agent-native-plan-annotate",
          anchor: textAnchor ? { ...textAnchor, ...tabContext } : anchoredFallback
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
  :root{color-scheme:dark;--bg:#0a0a0b;--paper:#111113;--line:#28282c;--text:#f2f2f3;--muted:#a4a4aa;--accent:#00B5FF}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}main{width:min(1080px,calc(100vw - 48px));margin:0 auto;padding:96px 0 96px}h1{max-width:760px;margin:0;font-size:clamp(36px,5vw,58px);line-height:1.03;letter-spacing:-.04em}.lede{max-width:760px;margin:20px 0 0;color:#d7d7da;font-size:clamp(18px,2vw,23px);line-height:1.45}.meta{display:grid;gap:7px;margin:24px 0 0;padding-left:20px;color:var(--muted);font-size:13px}.meta li::marker{color:var(--accent)}.section{margin-top:70px;padding-top:46px;border-top:1px solid var(--line)}.type{margin:0 0 12px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.section h2{margin:0;font-size:clamp(26px,4vw,42px);letter-spacing:-.035em}.section p{max-width:760px;color:#d7d7da;font-size:17px}.visual{margin:24px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.visual i{display:block;height:120px;border:1px solid rgba(0,181,255,.25);border-radius:14px;background:rgba(0,181,255,.12)}@media(max-width:760px){.visual{grid-template-columns:1fr}main{width:min(100vw - 24px,980px);padding-top:72px}}
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
