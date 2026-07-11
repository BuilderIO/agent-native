import {
  SIDEBAR_STATE_CHANGE_EVENT,
  PromptComposer,
  BuilderSetupCard,
  ErrorReportActions,
  ShareButton,
  appPath,
  agentNativePath,
  sendToAgentChat,
  setAgentChatContextItem,
  useAgentEngineConfigured,
  useActionQuery,
  useT,
  useSession,
  track,
  emailToColor,
  emailToName,
  type AgentSidebarStateChangeDetail,
  type ErrorReportDebugItem,
  type RichMarkdownCollabUser,
} from "@agent-native/core/client";
import {
  useAcceptInvitation,
  useJoinByDomain,
  useOrg,
} from "@agent-native/core/client/org";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import {
  SOURCE_AUTHOR_COMMENT_MENTION_EMAIL,
  extractCommentMentions,
  formatPlanCommentAnchorForAgent,
  formatPlanCommentMentionToken,
  normalizePlanCommentResolutionTarget,
  parsePlanCommentAnchor,
  planCommentAnchorDetails,
  type PlanCommentMention,
  type PlanCommentResolutionTarget,
} from "@shared/comment-context";
import type {
  PlanAnnotation,
  PlanBlock,
  PlanContent,
  PlanContentPatch,
} from "@shared/plan-content";
import {
  diffPlanVersions,
  formatVersionDiffSummary,
} from "@shared/plan-version-diff";
import {
  PLAN_SHARE_SURFACE,
  readPlanShareAttribution,
  withPlanShareAttribution,
} from "@shared/share-attribution";
import {
  type PlanBundle,
  type PlanKind,
  type PlanReportReason,
  type PlanSource,
  type PlanStatus,
  type PlanSummary,
  type PlanVersionDetail,
  type PlanVersionSummary,
} from "@shared/types";
import {
  IconAt,
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconAlertTriangle,
  IconChevronDown,
  IconClipboardText,
  IconCopy,
  IconArchive,
  IconArchiveOff,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconFileZip,
  IconFlag,
  IconFolder,
  IconDotsVertical,
  IconHelpCircle,
  IconHistory,
  IconLayoutSidebarRight,
  IconLock,
  IconLogin2,
  IconMail,
  IconLoader2,
  IconPencil,
  IconCircleCheck,
  IconMessageCircle,
  IconMoon,
  IconPlus,
  IconShare3,
  IconLink,
  IconWorld,
  IconSun,
  IconX,
  IconSend,
  IconSearch,
  IconRefresh,
  IconRestore,
  IconUserPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import type {
  CanvasMarkupCreateContext,
  CanvasMarkupMode,
} from "@/components/plan/CanvasArea";
import { GuestModeBanner } from "@/components/plan/GuestModeBanner";
import { PlanContentRenderer } from "@/components/plan/PlanContentRenderer";
import type { PlanVisualSurfaceMode } from "@/components/plan/PlanVisualSurface";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "@/components/plan/wireframe/use-wireframe-style";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  planBundleQueryKey,
  localPlanBundleQueryKey,
  localPlanBundleQueryParams,
  ALL_PLANS_QUERY_ARGS,
  ALL_PLANS_QUERY_KEY,
  ACTIVE_PLANS_QUERY_KEY,
  usePlan,
  usePlanAccessStatus,
  usePlans,
  usePlanVersion,
  usePlanVersions,
  usePromoteLocalPlan,
  usePublishVisualPlan,
  useReportVisualPlan,
  useRestorePlanVersion,
  useUpdatePlan,
  useUpdateLocalPlan,
  useUpdateLocalPlanComments,
  useUpdatePlanComments,
  useUpdatePlanStatus,
  useDeletePlan,
  useDeletePlanComment,
  useExportPlan,
  useImportPlanSource,
  useRequestPlanAccess,
  type DeletePlanInput,
  type PlanCommentInput,
  type PlanAccessStatusResponse,
  type PublishVisualPlanResult,
} from "@/hooks/use-plans";
import {
  getDesktopPlanFiles,
  type DesktopPlanFilesFolder,
} from "@/lib/desktop-plan-files";
import { syncLocalControlResources } from "@/lib/local-control-resources";
import {
  resolvePlanOrgAccessPrompt,
  type PlanOrgAccessPrompt,
} from "@/lib/plan-access-prompt";
import {
  PREFERRED_EDITOR_VALUES,
  PREFERRED_EDITOR_STORAGE_KEY,
  DESKTOP_PLAN_SYNC_AUTO_KEY_PREFIX,
  injectAnnotationRuntime,
  type PreferredEditor,
  type RuntimeAnnotation,
  type RuntimeAnnotationComment,
  type RuntimeAnnotationParticipant,
} from "@/lib/plan-annotation-runtime";
import {
  appendMessageToEditor,
  canSubmitInlineCommentDraft,
  commentBodyText,
  createMentionChip,
  displayNameForMention,
  mentionQueryAtCaret,
  serializeCommentEditor,
  type CommentDraft,
} from "@/lib/plan-comment-editor-helpers";
import { planDocumentTitle } from "@/lib/plan-document-title";
import {
  fetchLocalPlanBridgeBundle,
  localNetworkAccessPermissionState,
  localPlanBridgeQueryKey,
  localPlanBridgeRetryDelay,
  localPlanRoutePath,
  localPlanRouteUrl,
  mergeLocalBridgeComments,
  shouldRetryLocalPlanBridgeBundle,
  shouldShowLocalPlanLoadError,
  shouldShowPlanLoadError,
  updateLocalPlanBridgeComments,
  LocalPlanBridgePermissionError,
  type LocalPlanBundle,
  type LocalNetworkAccessPermissionState,
  type PlanBundleWithHtml,
  type PlanCommentItem,
} from "@/lib/plan-local-bridge";
import {
  buildNativeAnchorFromElement,
  clamp,
  findPlanBlockById,
  nativeMarkerPlacementForAnchor,
  nativePointForAnchor,
  prototypeScreenIdForAnchor,
  resolveNativeAnchorTarget,
  selectorForElementWithin,
  textQuoteContextForBlock,
  type PlanAnnotationAnchor,
} from "@/lib/plan-native-anchors";
import { cn } from "@/lib/utils";

export {
  resolvePlanOrgAccessPrompt,
  buildNativeAnchorFromElement,
  nativeMarkerPlacementForAnchor,
  nativePointForAnchor,
  prototypeScreenIdForAnchor,
  resolveNativeAnchorTarget,
  selectorForElementWithin,
  localPlanBridgeRetryDelay,
  shouldRetryLocalPlanBridgeBundle,
  shouldShowPlanLoadError,
};
export type { NativeMarkerPlacement } from "@/lib/plan-native-anchors";
export type { PlanOrgAccessPrompt } from "@/lib/plan-access-prompt";
export { canSubmitInlineCommentDraft, mentionQueryAtCaret };
export type { CommentDraft } from "@/lib/plan-comment-editor-helpers";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function GoogleLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const SOURCE_OPTIONS: Array<{ value: PlanSource }> = [
  { value: "codex" },
  { value: "claude-code" },
  { value: "cursor" },
  { value: "pi" },
  { value: "manual" },
  { value: "imported" },
];

const REPORT_REASON_OPTIONS: Array<{
  value: PlanReportReason;
}> = [
  { value: "spam" },
  { value: "harassment" },
  { value: "hate" },
  { value: "sexual" },
  { value: "violence" },
  { value: "self-harm" },
  { value: "privacy" },
  { value: "illegal" },
  { value: "other" },
];

const PLAN_READER_VIEW_EVENT = "plans-reader-view-change";
const RECAP_SCREENSHOT_QUERY_PARAM = "recapScreenshot";
const RECAP_SCREENSHOT_THEME_QUERY_PARAM = "recapScreenshotTheme";
const ENABLE_PLAN_STATUS_FEATURE = false;
const GITHUB_LIGHT_CANVAS_BACKGROUND = "#ffffff";
const GITHUB_DARK_CANVAS_BACKGROUND = "#0d1117";
const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";
const PLAN_DOCS_URL = "https://www.agent-native.com/docs/template-plan";
const LOCAL_FILES_DOCS_URL = `${PLAN_DOCS_URL}#local-files`;
const AUTO_DEV_COMMENT_EMAILS = new Set(["dev@local.test", "dev@local"]);
const CURRENT_USER_FALLBACK_NAME = "You";
const CURRENT_USER_FALLBACK_INITIALS = "You";
const CURRENT_USER_FALLBACK_COLOR = "#2563eb";

function readPreferredEditor(): PreferredEditor {
  if (typeof window === "undefined") return "vscode";
  const stored = window.localStorage.getItem(PREFERRED_EDITOR_STORAGE_KEY);
  return PREFERRED_EDITOR_VALUES.includes(stored as PreferredEditor)
    ? (stored as PreferredEditor)
    : "vscode";
}

function desktopPlanAutoSyncKey(planId: string): string {
  return `${DESKTOP_PLAN_SYNC_AUTO_KEY_PREFIX}${planId}`;
}

function readDesktopPlanAutoSync(planId: string | undefined): boolean {
  if (typeof window === "undefined" || !planId) return false;
  return window.localStorage.getItem(desktopPlanAutoSyncKey(planId)) === "1";
}

type OrgMemberSuggestion = {
  email: string;
  role?: string;
};

type InlineCommentPosition = {
  left: number;
  top: number;
  pinLeft: number;
  pinTop: number;
  width: number;
};

type NativeSelectionComment = {
  anchor: PlanAnnotationAnchor;
  toolbarLeft: number;
  toolbarTop: number;
  position: InlineCommentPosition;
};

type PlanDocumentState = {
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
};

export function resetPlanReaderScrollPosition(reader: HTMLElement | null) {
  if (reader) {
    reader.scrollTo({ left: 0, top: 0, behavior: "auto" });
    reader.scrollLeft = 0;
    reader.scrollTop = 0;
  }
  if (typeof window !== "undefined") {
    window.scrollTo(0, 0);
  }
}

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

function newCommentId() {
  return `cmt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

type CommentIdentitySource = {
  createdBy?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
};

type CommentAuthorPresentation = {
  name: string;
  email: string | null;
  initials: string;
  color: string;
  avatarUrl: string | null;
};

type CurrentCommentAuthor = {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  color: string;
};

type CommentThread = {
  id: string;
  root: PlanCommentItem;
  replies: PlanCommentItem[];
  comments: PlanCommentItem[];
  anchor: PlanAnnotationAnchor | null;
};

export type CommentVisibility = "hidden" | "open" | "all";

type DeleteCommentRequest = {
  commentId: string;
  replyCount: number;
};

type DeletePlanTarget = Pick<
  PlanSummary,
  "id" | "title" | "kind" | "deletedAt" | "canDelete"
>;

type DeletePlanRequest = {
  plan: DeletePlanTarget;
  mode: "soft" | "hard";
};

function withPlanComments(
  bundle: PlanBundleWithHtml,
  comments: PlanCommentItem[],
): PlanBundleWithHtml {
  return {
    ...bundle,
    comments,
    summary: {
      ...bundle.summary,
      commentCount: comments.length,
      openCommentCount: comments.filter((comment) => comment.status === "open")
        .length,
    },
  };
}

export function addPlanCommentToBundle(
  bundle: PlanBundleWithHtml,
  comment: PlanCommentItem,
): PlanBundleWithHtml {
  const exists = bundle.comments.some((item) => item.id === comment.id);
  return withPlanComments(
    bundle,
    exists
      ? bundle.comments.map((item) => (item.id === comment.id ? comment : item))
      : [...bundle.comments, comment],
  );
}

export function removePlanCommentFromBundle(
  bundle: PlanBundleWithHtml,
  commentId: string,
): PlanBundleWithHtml {
  return withPlanComments(
    bundle,
    bundle.comments.filter((comment) => comment.id !== commentId),
  );
}

export function removePlanCommentThreadFromBundle(
  bundle: PlanBundleWithHtml,
  commentId: string,
): PlanBundleWithHtml {
  const childrenByParent = new Map<string, PlanCommentItem[]>();
  for (const comment of bundle.comments) {
    if (!comment.parentCommentId) continue;
    const children = childrenByParent.get(comment.parentCommentId) ?? [];
    children.push(comment);
    childrenByParent.set(comment.parentCommentId, children);
  }
  const removedIds = new Set<string>();
  const stack = [commentId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || removedIds.has(id)) continue;
    removedIds.add(id);
    stack.push(
      ...(childrenByParent.get(id) ?? []).map((comment) => comment.id),
    );
  }
  return withPlanComments(
    bundle,
    bundle.comments.filter((comment) => !removedIds.has(comment.id)),
  );
}

function commentDescendantCount(
  comments: Array<{ id: string; parentCommentId?: string | null }>,
  commentId: string,
) {
  const childrenByParent = new Map<string, string[]>();
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const children = childrenByParent.get(comment.parentCommentId) ?? [];
    children.push(comment.id);
    childrenByParent.set(comment.parentCommentId, children);
  }
  let count = 0;
  const seen = new Set<string>();
  const stack = [...(childrenByParent.get(commentId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    count += 1;
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return count;
}

function deleteCommentLabel(replyCount: number, t: ReturnType<typeof useT>) {
  return replyCount > 0
    ? t("plansPage.comments.deleteThread")
    : t("plansPage.comments.deleteComment");
}

export function shouldKeepCommentPopoverOpenForTarget(
  target: EventTarget | null,
  popover: HTMLElement | null,
) {
  if (!target) return false;
  if (target instanceof Node && popover?.contains(target)) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-comment-marker]")) return true;
  if (target.closest("[data-comment-popover-portal]")) return true;
  return false;
}

function normalizeCommentEmail(email: string | null | undefined) {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

function isLocalCurrentUserEmail(email: string | null) {
  return (
    email === LOCAL_PLAN_OWNER_EMAIL ||
    (email !== null && AUTO_DEV_COMMENT_EMAILS.has(email))
  );
}

function currentCommentAuthorPresentation(
  source: CommentIdentitySource,
  currentUser?: CurrentCommentAuthor | null,
): CommentAuthorPresentation | null {
  if (source.createdBy && source.createdBy !== "human") return null;
  const sourceEmail = normalizeCommentEmail(source.authorEmail);
  const rawCurrentEmail = normalizeCommentEmail(currentUser?.email);
  const currentIsSynthetic = isLocalCurrentUserEmail(rawCurrentEmail);
  const currentEmail = currentIsSynthetic ? null : rawCurrentEmail;
  const currentName = currentIsSynthetic ? null : currentUser?.name?.trim();
  const currentAvatarUrl = currentIsSynthetic ? null : currentUser?.avatarUrl;
  const isCurrentEmail = Boolean(
    sourceEmail && currentEmail && sourceEmail === currentEmail,
  );
  const isLocalIdentity = isLocalCurrentUserEmail(sourceEmail);
  const isAnonymousHuman =
    !sourceEmail && !source.authorName?.trim() && source.createdBy === "human";
  if (!isCurrentEmail && !isLocalIdentity && !isAnonymousHuman) return null;

  const name =
    currentName ||
    (currentEmail ? emailToName(currentEmail) : CURRENT_USER_FALLBACK_NAME);
  const hasPersonalIdentity = Boolean(currentEmail || currentName);
  return {
    name,
    email: currentEmail,
    initials: hasPersonalIdentity
      ? commentAuthorInitials(name)
      : CURRENT_USER_FALLBACK_INITIALS,
    color: currentUser?.color ?? CURRENT_USER_FALLBACK_COLOR,
    avatarUrl: currentAvatarUrl ?? null,
  };
}

function commentAuthorName(
  source: CommentIdentitySource,
  currentUser?: CurrentCommentAuthor | null,
) {
  const current = currentCommentAuthorPresentation(source, currentUser);
  if (current) return current.name;
  const explicitName = source.authorName?.trim();
  if (explicitName) return explicitName;
  const email = normalizeCommentEmail(source.authorEmail);
  if (email) return emailToName(email);
  if (source.createdBy === "agent") return "Agent"; // i18n-key-ignore stable actor id fallback
  if (source.createdBy === "import") return "Imported"; // i18n-key-ignore stable import actor fallback
  return "Reviewer"; // i18n-key-ignore stable anonymous reviewer fallback
}

function commentAuthorInitials(name: string) {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const raw =
    parts.length >= 2
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : (parts[0]?.slice(0, 2) ?? name.slice(0, 2));
  return raw.toUpperCase() || "?";
}

function commentAuthorColor(
  source: CommentIdentitySource,
  currentUser?: CurrentCommentAuthor | null,
) {
  const current = currentCommentAuthorPresentation(source, currentUser);
  if (current) return current.color;
  const email = normalizeCommentEmail(source.authorEmail);
  if (email) return emailToColor(email);
  if (source.createdBy === "agent") return "#0ea5e9";
  if (source.createdBy === "import") return "#737373";
  return "#525252";
}

function commentAuthorPresentation(
  source: CommentIdentitySource,
  avatarUrl?: string | null,
  currentUser?: CurrentCommentAuthor | null,
): CommentAuthorPresentation {
  const current = currentCommentAuthorPresentation(source, currentUser);
  if (current) return current;
  const name = commentAuthorName(source);
  return {
    name,
    email: normalizeCommentEmail(source.authorEmail),
    initials: commentAuthorInitials(name),
    color: commentAuthorColor(source),
    avatarUrl: avatarUrl ?? null,
  };
}

function commentAuthorLabel(source: CommentIdentitySource) {
  const author = commentAuthorPresentation(source);
  return author.email ? `${author.name} <${author.email}>` : author.name;
}

function commentAuthorAvatarUrl(
  source: CommentIdentitySource,
  avatarUrls: Record<string, string | null>,
) {
  const email = normalizeCommentEmail(source.authorEmail);
  return email ? (avatarUrls[email] ?? null) : null;
}

export function commentAuthorEmails(
  comments: Array<CommentIdentitySource>,
  currentEmail?: string | null,
) {
  const emails = new Set<string>();
  for (const comment of comments) {
    const email = normalizeCommentEmail(comment.authorEmail);
    if (email) emails.add(email);
  }
  const normalizedCurrent = normalizeCommentEmail(currentEmail);
  if (normalizedCurrent) emails.add(normalizedCurrent);
  return Array.from(emails).sort();
}

async function fetchCommentAvatar(email: string) {
  const response = await fetch(
    agentNativePath(`/_agent-native/avatar/${encodeURIComponent(email)}`),
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { image?: unknown };
  return typeof data.image === "string" ? data.image : null;
}

function useCommentAvatarUrls(emails: string[]) {
  const cacheRef = useRef<Record<string, string | null>>({});
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const emailKey = emails.join("|");

  useEffect(() => {
    let cancelled = false;
    const missing = emails.filter((email) => !(email in cacheRef.current));
    if (missing.length === 0) {
      setUrls({ ...cacheRef.current });
      return;
    }
    void Promise.all(
      missing.map(async (email) => {
        cacheRef.current[email] = await fetchCommentAvatar(email).catch(
          () => null,
        );
      }),
    ).then(() => {
      if (!cancelled) setUrls({ ...cacheRef.current });
    });
    return () => {
      cancelled = true;
    };
  }, [emailKey]);

  return urls;
}

function useOrgMemberMentionSearch(query: string | null) {
  const [members, setMembers] = useState<OrgMemberSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const search = query?.trim() ?? "";
    if (query === null) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setIsLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("limit", "8");
    fetch(`${agentNativePath("/_agent-native/org/members")}?${params}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load members");
        return response.json() as Promise<{ members?: unknown }>;
      })
      .then((data) => {
        if (controller.signal.aborted || requestId !== requestRef.current) {
          return;
        }
        const next = Array.isArray(data.members)
          ? data.members
              .map((member) => {
                if (!member || typeof member !== "object") return null;
                const value = member as { email?: unknown; role?: unknown };
                const email =
                  typeof value.email === "string"
                    ? normalizeCommentEmail(value.email)
                    : null;
                if (!email) return null;
                const suggestion: OrgMemberSuggestion = { email };
                if (typeof value.role === "string") {
                  suggestion.role = value.role;
                }
                return suggestion;
              })
              .filter((member): member is OrgMemberSuggestion =>
                Boolean(member),
              )
          : [];
        setMembers(next);
      })
      .catch(() => {
        if (!controller.signal.aborted && requestId === requestRef.current) {
          setMembers([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId === requestRef.current) {
          setIsLoading(false);
        }
      });
    return () => controller.abort();
  }, [query]);

  return { members, isLoading };
}

function elementForShortcutTarget(target: EventTarget | null) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function isPlanCommentShortcutEditableTarget(
  target: EventTarget | null,
) {
  const element = elementForShortcutTarget(target);
  if (!element) return false;
  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    ),
  );
}

export function shouldHandlePlanCommentShortcut(
  event: Pick<
    KeyboardEvent,
    | "altKey"
    | "ctrlKey"
    | "defaultPrevented"
    | "key"
    | "metaKey"
    | "shiftKey"
    | "target"
  >,
) {
  if (event.defaultPrevented) return false;
  const activeElement =
    typeof document === "undefined" ? null : document.activeElement;
  if (
    isPlanCommentShortcutEditableTarget(activeElement) ||
    isPlanCommentShortcutEditableTarget(event.target)
  ) {
    return false;
  }
  const key = event.key.toLowerCase();
  if (
    key === "c" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return true;
  }
  return (
    key === "m" &&
    event.metaKey &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

export function defaultInlineCommentDraftForPlanContext(input: {
  planKind?: PlanKind | null;
  ownerEmail?: string | null;
  sourceAuthorName?: string | null;
  sourceAuthorLogin?: string | null;
  accessRole?: NonNullable<PlanBundle["access"]>["role"] | null;
  currentEmail?: string | null;
}): CommentDraft {
  const currentEmail = normalizeCommentEmail(input.currentEmail);
  if (input.planKind === "recap") {
    const targetLabel =
      input.sourceAuthorName?.trim() || input.sourceAuthorLogin?.trim();
    if (!targetLabel || input.accessRole === "owner") {
      return { message: "", mentions: [], resolutionTarget: "agent" };
    }
    const mention: PlanCommentMention = {
      email: SOURCE_AUTHOR_COMMENT_MENTION_EMAIL,
      label: targetLabel,
      role: "source-author",
    };
    return {
      message: `${formatPlanCommentMentionToken(mention)} `,
      mentions: [mention],
      resolutionTarget: "human",
    };
  }

  const targetEmail = normalizeCommentEmail(input.ownerEmail);
  if (
    !targetEmail ||
    input.accessRole === "owner" ||
    targetEmail === currentEmail
  ) {
    return { message: "", mentions: [], resolutionTarget: "agent" };
  }
  const mention = {
    email: targetEmail,
    label: displayNameForMention(targetEmail),
  };
  return {
    message: `${formatPlanCommentMentionToken(mention)} `,
    mentions: [mention],
    resolutionTarget: "human",
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function renderCommentMessage(message: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const pattern = /@\[([^\]]+)\]\(mailto:([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    if (match.index > lastIndex) {
      parts.push(message.slice(lastIndex, match.index));
    }
    const label = match[1] ?? "";
    const email = safeDecodeURIComponent(match[2] ?? "");
    parts.push(
      <span
        key={`${email}-${match.index}`}
        className="mx-0.5 inline-flex max-w-[14rem] translate-y-[2px] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
        title={email}
      >
        <IconAt className="size-3" />
        <span className="truncate">{label || email}</span>
      </span>,
    );
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < message.length) parts.push(message.slice(lastIndex));
  return parts.length > 0 ? parts : message;
}

function CommentAvatar({
  author,
  size = "sm",
  className,
}: {
  author: CommentAuthorPresentation;
  size?: "pin" | "sm" | "md";
  className?: string;
}) {
  const sizeClass =
    size === "pin" ? "size-7" : size === "md" ? "size-8" : "size-7";
  return (
    <Avatar
      className={cn(
        sizeClass,
        "border-2 border-background shadow-sm ring-1 ring-border/60",
        className,
      )}
      title={author.email ? `${author.name} (${author.email})` : author.name}
    >
      {author.avatarUrl && (
        <AvatarImage src={author.avatarUrl} alt={author.name} />
      )}
      <AvatarFallback
        className="text-[10px] font-semibold text-white"
        style={{ backgroundColor: author.color }}
      >
        {author.initials}
      </AvatarFallback>
    </Avatar>
  );
}

function CommentThreadMarker({
  participants,
  count,
  title,
  className,
  style,
  onClick,
}: {
  participants: CommentAuthorPresentation[];
  count: number;
  title: string;
  className?: string;
  style?: CSSProperties;
  onClick: () => void;
}) {
  const visibleParticipants = participants.slice(0, 2);
  const single = visibleParticipants.length <= 1 && count <= 1;
  return (
    <button
      type="button"
      data-comment-marker
      className={cn(
        "pointer-events-auto inline-flex h-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-2xl shadow-black/35 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        single
          ? "w-8"
          : "gap-1 border border-white/15 bg-foreground/85 py-0.5 pl-0.5 pr-2 text-background",
        className,
      )}
      style={style}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <span
        className={cn(
          "inline-flex items-center",
          !single && visibleParticipants.length > 1 && "-space-x-2",
        )}
      >
        {visibleParticipants.map((author) => (
          <CommentAvatar
            key={author.email ?? author.name}
            author={author}
            size="pin"
            className={cn(single ? "size-8" : "size-7")}
          />
        ))}
      </span>
      {!single && (
        <span className="min-w-3 text-center text-[11px] font-semibold leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

function commentCreatedTime(comment: { createdAt?: string }) {
  const time = Date.parse(comment.createdAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function sortCommentsByCreatedAt<T extends { createdAt?: string; id: string }>(
  comments: T[],
) {
  return [...comments].sort((a, b) => {
    const delta = commentCreatedTime(a) - commentCreatedTime(b);
    return delta === 0 ? a.id.localeCompare(b.id) : delta;
  });
}

function findThreadRoot(
  comment: PlanCommentItem,
  byId: Map<string, PlanCommentItem>,
) {
  let current = comment;
  const seen = new Set<string>();
  while (current.parentCommentId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function buildCommentThreads(
  comments: PlanCommentItem[],
): CommentThread[] {
  const sorted = sortCommentsByCreatedAt(comments);
  const byId = new Map(sorted.map((comment) => [comment.id, comment]));
  const threads = new Map<string, CommentThread>();

  for (const comment of sorted) {
    const root = findThreadRoot(comment, byId);
    const thread =
      threads.get(root.id) ??
      ({
        id: root.id,
        root,
        replies: [],
        comments: [],
        anchor: parseAnchorForComment(root),
      } satisfies CommentThread);
    thread.comments.push(comment);
    threads.set(root.id, thread);
  }

  return Array.from(threads.values())
    .map((thread) => {
      const commentsInThread = sortCommentsByCreatedAt(thread.comments);
      const root =
        commentsInThread.find((comment) => comment.id === thread.id) ??
        thread.root;
      const anchor =
        parseAnchorForComment(root) ??
        commentsInThread
          .map((comment) => parseAnchorForComment(comment))
          .find(Boolean) ??
        null;
      return {
        ...thread,
        root,
        comments: commentsInThread,
        replies: commentsInThread.filter((comment) => comment.id !== root.id),
        anchor,
      };
    })
    .sort((a, b) => {
      const delta = commentCreatedTime(a.root) - commentCreatedTime(b.root);
      return delta === 0 ? a.id.localeCompare(b.id) : delta;
    });
}

function commentThreadStatus(thread: CommentThread) {
  return thread.comments.some((comment) => comment.status === "open")
    ? "open"
    : "resolved";
}

export function commentThreadsForVisibility(
  threads: CommentThread[],
  visibility: CommentVisibility,
) {
  if (visibility === "hidden") return [];
  if (visibility === "all") return threads;
  return threads.filter((thread) => commentThreadStatus(thread) === "open");
}

function visualSurfaceModeForAnchor(
  anchor: PlanAnnotationAnchor | null,
): PlanVisualSurfaceMode | null {
  if (!anchor) return null;
  const targetSelector = anchor.targetSelector ?? "";
  if (
    anchor.targetKind === "prototype" ||
    anchor.screenId ||
    prototypeScreenIdForAnchor(anchor)
  ) {
    return "prototype";
  }
  if (
    anchor.targetKind === "wireframe" ||
    anchor.targetKind === "canvas" ||
    anchor.planAnnotationId ||
    anchor.canvasX !== undefined ||
    anchor.canvasY !== undefined ||
    targetSelector.includes("data-plan-canvas-world") ||
    targetSelector.includes("plan-canvas-world") ||
    anchor.targetNodeId
  ) {
    return "wireframes";
  }
  return null;
}

export function commentThreadsForVisualSurfaceMode(
  threads: CommentThread[],
  visualSurfaceMode: PlanVisualSurfaceMode,
) {
  return threads.filter((thread) => {
    const threadSurfaceMode = visualSurfaceModeForAnchor(thread.anchor);
    return !threadSurfaceMode || threadSurfaceMode === visualSurfaceMode;
  });
}

function commentIdentityKey(source: CommentIdentitySource, fallbackId: string) {
  return (
    normalizeCommentEmail(source.authorEmail) ??
    `${source.createdBy ?? "human"}:${commentAuthorName(source)}:${fallbackId}`
  );
}

function commentThreadParticipants(
  thread: CommentThread,
  avatarUrls: Record<string, string | null>,
  currentUser?: CurrentCommentAuthor | null,
) {
  const seen = new Set<string>();
  const participants: CommentAuthorPresentation[] = [];
  for (const comment of thread.comments) {
    const author = commentAuthorPresentation(
      comment,
      commentAuthorAvatarUrl(comment, avatarUrls),
      currentUser,
    );
    const key =
      author.email ??
      (author.name === CURRENT_USER_FALLBACK_NAME
        ? "current-user"
        : commentIdentityKey(comment, comment.id));
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push(author);
  }
  return participants;
}

function runtimeCommentFromPlanComment(
  comment: PlanCommentItem,
  avatarUrls: Record<string, string | null>,
  currentUser?: CurrentCommentAuthor | null,
): RuntimeAnnotationComment {
  const author = commentAuthorPresentation(
    comment,
    commentAuthorAvatarUrl(comment, avatarUrls),
    currentUser,
  );
  return {
    id: comment.id,
    message: comment.message,
    status: comment.status,
    createdBy: comment.createdBy,
    parentCommentId: comment.parentCommentId,
    authorEmail: author.email,
    authorName: author.name,
    authorAvatarUrl: author.avatarUrl,
    authorColor: author.color,
    authorInitials: author.initials,
    createdAt: comment.createdAt,
  };
}

function runtimeParticipantFromAuthor(
  author: CommentAuthorPresentation,
): RuntimeAnnotationParticipant {
  return {
    id: author.email ?? author.name,
    authorEmail: author.email,
    authorName: author.name,
    authorAvatarUrl: author.avatarUrl,
    authorColor: author.color,
    authorInitials: author.initials,
  };
}

export function runtimeAnnotationFromThread(
  thread: CommentThread,
  index: number,
  avatarUrls: Record<string, string | null>,
  currentUser?: CurrentCommentAuthor | null,
): RuntimeAnnotation | null {
  if (!thread.anchor) return null;
  const root = runtimeCommentFromPlanComment(
    thread.root,
    avatarUrls,
    currentUser,
  );
  return {
    ...root,
    index: index + 1,
    kind: thread.root.kind,
    status: commentThreadStatus(thread),
    sectionId: thread.root.sectionId,
    anchor: thread.anchor,
    replies: thread.replies.map((reply) =>
      runtimeCommentFromPlanComment(reply, avatarUrls, currentUser),
    ),
    participants: commentThreadParticipants(
      thread,
      avatarUrls,
      currentUser,
    ).map(runtimeParticipantFromAuthor),
    commentCount: thread.comments.length,
  };
}

function runtimeCommentFromAuthor(
  comment: RuntimeAnnotationComment,
): CommentAuthorPresentation {
  const author = commentAuthorPresentation(
    {
      createdBy: comment.createdBy,
      authorEmail: comment.authorEmail,
      authorName: comment.authorName,
    },
    comment.authorAvatarUrl,
  );
  return {
    ...author,
    color: comment.authorColor ?? author.color,
    initials: comment.authorInitials ?? author.initials,
  };
}

function runtimeAnnotationRootComment(
  annotation: RuntimeAnnotation,
): RuntimeAnnotationComment {
  return {
    id: annotation.id,
    message: annotation.message,
    status: annotation.status,
    createdBy: annotation.createdBy,
    parentCommentId: annotation.parentCommentId,
    authorEmail: annotation.authorEmail,
    authorName: annotation.authorName,
    authorAvatarUrl: annotation.authorAvatarUrl,
    authorColor: annotation.authorColor,
    authorInitials: annotation.authorInitials,
    createdAt: annotation.createdAt,
  };
}

function runtimeAnnotationComments(annotation: RuntimeAnnotation) {
  return [
    runtimeAnnotationRootComment(annotation),
    ...(annotation.replies ?? []),
  ];
}

function runtimeParticipantPresentation(
  participant: RuntimeAnnotationParticipant,
) {
  const author = commentAuthorPresentation(
    {
      authorEmail: participant.authorEmail,
      authorName: participant.authorName,
    },
    participant.authorAvatarUrl,
  );
  return {
    ...author,
    color: participant.authorColor ?? author.color,
    initials: participant.authorInitials ?? author.initials,
  };
}

function runtimeAnnotationMarkerTitle(annotation: RuntimeAnnotation) {
  const names = annotation.participants
    .map((participant) => runtimeParticipantPresentation(participant).name)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  const countLabel = `${annotation.commentCount} comment${
    annotation.commentCount === 1 ? "" : "s"
  }`;
  return names
    ? `${countLabel} by ${names}: ${annotation.message}`
    : `${countLabel}: ${annotation.message}`;
}

function planExportFilename(
  title: string | undefined,
  extension: "html" | "md" | "zip",
) {
  const slug =
    (title || "visual-plan")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || "visual-plan";
  return `${slug}.${extension}`;
}

function downloadTextFile(
  filename: string,
  contents: string,
  type = "text/html;charset=utf-8",
) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  screenshotNote?: string;
}) {
  const isLocalPlan =
    "localOnly" in input.bundle && input.bundle.localOnly === true;
  const contentBlockCount = input.bundle.plan.content?.blocks.length ?? 0;
  const contentBlocks = input.bundle.plan.content?.blocks
    .slice(0, 12)
    .map(
      (block) =>
        `- ${block.id}: ${block.type}${block.title ? `, "${block.title}"` : ""}`,
    )
    .join("\n");
  const openThreads = buildCommentThreads(input.bundle.comments).filter(
    (thread) => commentThreadStatus(thread) === "open",
  );
  const actionableThreads = openThreads.filter(
    (thread) =>
      normalizePlanCommentResolutionTarget(thread.anchor?.resolutionTarget) ===
      "agent",
  );
  const humanReviewThreads = openThreads.filter(
    (thread) =>
      normalizePlanCommentResolutionTarget(thread.anchor?.resolutionTarget) ===
      "human",
  );
  const formatThreadGroup = (
    threads: CommentThread[],
    input: { offset?: number; limit?: number } = {},
  ) =>
    threads
      .slice(0, input.limit ?? 20)
      .map((thread, index) => {
        const commentNumber = (input.offset ?? 0) + index + 1;
        const anchorDetails = planCommentAnchorDetails(thread.anchor);
        const messages = thread.comments
          .map((comment, messageIndex) => {
            const prefix = messageIndex === 0 ? "" : "   Reply ";
            return `${prefix}${comment.id} / ${commentAuthorLabel(
              comment,
            )}: ${comment.message}`;
          })
          .join("\n");
        return [
          `${commentNumber}. Thread ${thread.id}`,
          messages,
          ...anchorDetails.map((detail) => `   ${detail}`),
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");
  const actionableComments = formatThreadGroup(actionableThreads, {
    limit: 16,
  });
  const humanReviewComments = formatThreadGroup(humanReviewThreads, {
    offset: actionableThreads.length,
    limit: 8,
  });
  const omittedComments =
    Math.max(0, actionableThreads.length - 16) +
    Math.max(0, humanReviewThreads.length - 8);
  const omittedCommentNote =
    omittedComments > 0
      ? isLocalPlan
        ? `\n${omittedComments} additional open thread(s) omitted from this composer context. Reopen the local plan or inspect comments.json for the full list before editing.`
        : `\n${omittedComments} additional open thread(s) omitted from this composer context. Call get-plan-feedback for the full list before editing.`
      : "";
  const legacyUnroutedThreads = openThreads.filter(
    (thread) => !thread.anchor?.resolutionTarget,
  );
  const legacyUnroutedComments = legacyUnroutedThreads
    .filter((thread) => !actionableThreads.includes(thread))
    .slice(0, 4)
    .map((thread, index) => {
      const anchorDetails = planCommentAnchorDetails(thread.anchor);
      const messages = thread.comments
        .map((comment, messageIndex) => {
          const prefix = messageIndex === 0 ? "" : "   Reply ";
          return `${prefix}${comment.id} / ${commentAuthorLabel(
            comment,
          )}: ${comment.message}`;
        })
        .join("\n");
      return [
        `${index + 1}. Thread ${thread.id}`,
        messages,
        ...anchorDetails.map((detail) => `   ${detail}`),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  const recentReviewEvents = input.bundle.events
    .filter((event) => event.type === "plan.updated")
    .slice(-6)
    .map((event) => {
      const payload = event.payload
        ? `\n   Payload: ${JSON.stringify(event.payload)}`
        : "";
      return `- ${event.createdAt} / ${event.createdBy}: ${event.message}${payload}`;
    })
    .join("\n");

  return [
    "Current Agent-Native Plan review context:",
    `Plan ID: ${input.bundle.plan.id}`,
    `Title: ${input.bundle.plan.title}`,
    ...(ENABLE_PLAN_STATUS_FEATURE
      ? [`Status: ${input.bundle.plan.status}`]
      : []),
    ...(isLocalPlan ? [`Local folder: ${input.bundle.plan.repoPath}`] : []),
    `URL: ${input.url}`,
    input.bundle.plan.content
      ? `Structured content blocks: ${contentBlockCount}`
      : `Legacy rendered HTML length: ${input.documentHtml.length} characters`,
    "",
    ...(isLocalPlan
      ? [
          "Local-files workflow:",
          "1. This is a local-only Agent-Native Plan or recap. Do not call hosted Plan tools such as get-visual-plan, get-plan-feedback, or update-visual-plan for this plan.",
          "2. Use the local MDX files and the feedback threads included below. If your host exposes local Plan tools, read the local folder and comments.json before editing.",
          "3. Preserve the user's existing annotation comments and intent unless the user asks to remove or resolve them.",
          "4. Keep the output as a refined document with rich text, tables, sketch diagrams, wireframes, implementation maps, code tabs, and bounded custom HTML fragments.",
          "5. After applying feedback, rerun the local Plan check/serve/verify path available in your environment and report the updated local URL or folder.",
          "6. Work the actionable agent comments first. Treat human-review comments as FYI/questions/approval items; do not silently resolve those unless the user explicitly asks.",
          "7. When visual screenshots are attached, each crop is centered near a comment marker and has a red ring on the exact commented point. Use the comment IDs and anchor details below to connect screenshots to threads.",
          "8. For text comments, use the quoted text plus Text before/Text after and Block type details. If a quote is marked ambiguous, ask instead of editing the wrong span.",
        ]
      : [
          "Fast iteration workflow:",
          "1. Call get-visual-plan with this plan ID to read structured content, exported HTML, sections, comments, and activity.",
          "2. Prefer update-visual-plan contentPatches for targeted edits. Examples: update-rich-text for copy, patch-prototype-html / update-prototype-screen for live prototype states, update-wireframe-node for one kit-tree node, update-canvas-frame for frame layout, append-canvas-annotation / update-canvas-annotation for canvas markup, append-block/remove-block for document changes, or replace-block for a single block. Use full content only for broad restructuring. Use html only when preserving or importing a legacy standalone HTML artifact.",
          "3. Preserve the user's existing annotation comments and intent unless the user asks to remove or resolve them.",
          "4. Keep the output as a refined document with rich text, tables, sketch diagrams, wireframes, implementation maps, code tabs, and bounded custom HTML fragments.",
          "5. After applying feedback, keep the plan scannable, editable, and serious instead of turning it into a marketing page.",
          "6. Work the actionable agent comments first. Treat human-review comments as FYI/questions/approval items; do not silently resolve those unless the user explicitly asks.",
          "7. When visual screenshots are attached, each crop is centered near a comment marker and has a red ring on the exact commented point. Use the comment IDs and anchor details below to connect screenshots to threads. If a visual comment is listed as overflow, rely on its anchorDetails/coordinates and call get-plan-feedback for the full manifest.",
          "8. For text comments, use the quoted text plus Text before/Text after and Block type details. If a quote is marked ambiguous, ask instead of editing the wrong span.",
        ]),
    contentBlocks ? `\nStructured content blocks:\n${contentBlocks}` : "",
    recentReviewEvents
      ? `\nRecent review/edit events:\n${recentReviewEvents}`
      : "",
    input.screenshotNote
      ? `\nScreenshot context:\n${input.screenshotNote}`
      : "",
    actionableComments
      ? `\nActionable agent comments:\n${actionableComments}`
      : "",
    humanReviewComments
      ? `\nHuman-review / FYI comments:\n${humanReviewComments}`
      : "",
    legacyUnroutedComments
      ? `\nLegacy unrouted comments:\n${legacyUnroutedComments}`
      : "",
    omittedCommentNote,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildApplyFeedbackMessage(
  openCommentCount: number,
  options: { local?: boolean } = {},
) {
  if (options.local) {
    return `Apply the ${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this local visual plan. Use the local files and feedback context in this handoff; do not call hosted Plan tools for this local-only plan. Use any attached focused screenshots to understand visual comments, then update the local MDX plan/recap files as needed.`;
  }
  return `Apply the ${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this visual plan. Read the plan with get-visual-plan, read feedback with get-plan-feedback, use any attached focused screenshots to understand visual comments, then update structured content blocks, prototype screens, and related implementation details as needed. Use HTML only for legacy imported artifacts.`;
}

function buildQuestionFormRevisionMessage(summary: string) {
  return [
    "Use these answered open questions to revise the existing Agent-Native Plan.",
    "Read the plan with get-visual-plan, then update the structured content with update-visual-plan contentPatches. Preserve the user's answers as direction, remove or update the answered question block if it is no longer useful, and keep any remaining unanswered decisions at the bottom as a question-form block.",
    "",
    summary,
  ].join("\n");
}

function newCanvasMarkupId() {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ann_${id.replace(/-/g, "").slice(0, 16)}`;
}

function buildCanvasMarkupFeedbackMessage(annotation: PlanAnnotation) {
  const prefix =
    annotation.type === "callout" ? "Canvas callout" : "Canvas note";
  return `${prefix}: ${annotation.text}`;
}

const MAX_FEEDBACK_SCREENSHOTS = 8;

function shouldCaptureAnchor(anchor: PlanAnnotationAnchor | null) {
  if (!anchor) return false;
  if (anchor.anchorKind === "text" && anchor.textQuote) return false;
  return (
    anchor.anchorKind === "visual" ||
    anchor.anchorKind === "point" ||
    anchor.targetKind === "image" ||
    anchor.targetKind === "prototype" ||
    anchor.targetKind === "wireframe" ||
    anchor.targetKind === "canvas" ||
    anchor.targetKind === "diagram" ||
    Boolean(anchor.planAnnotationId)
  );
}

function feedbackScreenshotPriority(thread: CommentThread) {
  const anchor = thread.anchor;
  const resolver =
    normalizePlanCommentResolutionTarget(anchor?.resolutionTarget) === "agent"
      ? 2
      : 0;
  const visualWeight =
    anchor?.targetKind === "canvas" ||
    anchor?.targetKind === "prototype" ||
    anchor?.targetKind === "wireframe" ||
    anchor?.targetKind === "diagram" ||
    anchor?.targetKind === "image" ||
    Boolean(anchor?.planAnnotationId)
      ? 1
      : 0;
  const replyWeight = Math.min(thread.replies.length, 3) * 0.2;
  const latestTime = Math.max(
    ...thread.comments.map((comment) => {
      const time = Date.parse(comment.createdAt ?? "");
      return Number.isFinite(time) ? time : 0;
    }),
  );
  return (
    resolver + visualWeight + replyWeight + latestTime / 10_000_000_000_000
  );
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function cropFeedbackScreenshot(input: {
  canvas: HTMLCanvasElement;
  surfaceWidth: number;
  surfaceHeight: number;
  pointX: number;
  pointY: number;
  label: string;
}) {
  const scaleX = input.canvas.width / Math.max(input.surfaceWidth, 1);
  const scaleY = input.canvas.height / Math.max(input.surfaceHeight, 1);
  const cropCssWidth = Math.min(760, input.surfaceWidth);
  const cropCssHeight = Math.min(520, input.surfaceHeight);
  const cropWidth = Math.round(cropCssWidth * scaleX);
  const cropHeight = Math.round(cropCssHeight * scaleY);
  const centerX = input.pointX * scaleX;
  const centerY = input.pointY * scaleY;
  const cropX = clamp(
    centerX - cropWidth / 2,
    0,
    input.canvas.width - cropWidth,
  );
  const cropY = clamp(
    centerY - cropHeight / 2,
    0,
    input.canvas.height - cropHeight,
  );
  const output = document.createElement("canvas");
  output.width = cropWidth;
  output.height = cropHeight;
  const ctx = output.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(
    input.canvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );
  const markerX = centerX - cropX;
  const markerY = centerY - cropY;
  ctx.save();
  ctx.lineWidth = Math.max(4, 2.5 * scaleX);
  ctx.strokeStyle = "#ff334e";
  ctx.fillStyle = "rgba(255, 51, 78, 0.14)";
  ctx.beginPath();
  ctx.arc(markerX, markerY, Math.max(22, 14 * scaleX), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(12, 12, 14, 0.88)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 1;
  const label = input.label.slice(0, 72);
  ctx.font = `${Math.max(13, 12 * scaleX)}px ui-sans-serif, system-ui`;
  const labelWidth = Math.min(
    cropWidth - 24,
    ctx.measureText(label).width + 24,
  );
  const labelX = clamp(markerX + 18, 12, cropWidth - labelWidth - 12);
  const labelY = clamp(markerY - 36, 12, cropHeight - 34);
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, labelWidth, 28, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, labelX + 12, labelY + 19);
  ctx.restore();
  return output.toDataURL("image/png");
}

type PlanAccessRole = "owner" | "viewer" | "editor" | "admin";

/**
 * Status options available in the reviewer approval workflow.
 * "archived" is intentionally omitted — it lives in the kebab menu.
 */
const APPROVAL_STATUSES: PlanStatus[] = [
  "draft",
  "review",
  "approved",
  "in_progress",
  "complete",
];

function statusBadgeClasses(status: PlanStatus): string {
  if (status === "approved") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (status === "complete") {
    return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400";
  }
  if (status === "in_progress") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
  // draft, review, archived — neutral
  return "";
}

/**
 * Compact status badge/chip for the plan detail toolbar.
 *
 * - Editors (owner/admin/editor): clicking the badge opens a DropdownMenu to
 *   transition the plan's status. The update is optimistic with rollback.
 * - Viewers / anonymous: the badge is inert (shows current status, no menu).
 * - Recaps: the parent must not render this component at all.
 */
function PlanStatusControl({
  planId,
  status,
  canEdit,
}: {
  planId: string;
  status: PlanStatus;
  canEdit: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const updateStatus = useUpdatePlanStatus();

  const handleSelect = useCallback(
    (newStatus: PlanStatus) => {
      if (newStatus === status) return;
      // Optimistic: patch both the bundle cache and the list cache.
      const bundleKey = planBundleQueryKey(planId);
      const prevBundle = qc.getQueryData<PlanBundleWithHtml>(bundleKey);
      const prevActiveList = qc.getQueryData<PlanSummary[]>(
        ACTIVE_PLANS_QUERY_KEY,
      );
      const prevAllList = qc.getQueryData<PlanSummary[]>(ALL_PLANS_QUERY_KEY);

      qc.setQueryData(bundleKey, (prev: PlanBundleWithHtml | undefined) =>
        prev ? { ...prev, plan: { ...prev.plan, status: newStatus } } : prev,
      );
      for (const listKey of [ACTIVE_PLANS_QUERY_KEY, ALL_PLANS_QUERY_KEY]) {
        qc.setQueryData(listKey, (prev: PlanSummary[] | undefined) =>
          prev?.map((p) => (p.id === planId ? { ...p, status: newStatus } : p)),
        );
      }

      updateStatus.mutate(
        { planId, status: newStatus },
        {
          onError: () => {
            // Roll back optimistic updates.
            if (prevBundle !== undefined)
              qc.setQueryData(bundleKey, prevBundle);
            if (prevActiveList !== undefined)
              qc.setQueryData(ACTIVE_PLANS_QUERY_KEY, prevActiveList);
            if (prevAllList !== undefined)
              qc.setQueryData(ALL_PLANS_QUERY_KEY, prevAllList);
            toast.error(t("plansPage.status.updateFailed"));
          },
        },
      );
    },
    [planId, qc, status, t, updateStatus],
  );

  const badgeClassName = cn(
    "pointer-events-auto flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
    statusBadgeClasses(status),
    canEdit && "cursor-pointer select-none hover:opacity-80",
  );
  const badgeInner = (
    <>
      {status === "approved" && (
        <IconCircleCheck className="size-3.5 shrink-0" />
      )}
      {t(`plansPage.status.labels.${status}`)}
      {canEdit && <IconChevronDown className="size-3 shrink-0 opacity-60" />}
    </>
  );

  if (!canEdit) {
    return <span className={badgeClassName}>{badgeInner}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("plansPage.status.setPlanStatus")}
          className={badgeClassName}
        >
          {badgeInner}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 rounded-xl">
        <DropdownMenuLabel>{t("plansPage.status.setStatus")}</DropdownMenuLabel>
        <DropdownMenuGroup>
          {APPROVAL_STATUSES.map((s) => (
            <DropdownMenuItem
              key={s}
              className={cn("gap-2", s === status && "font-medium")}
              onClick={() => handleSelect(s)}
            >
              {s === "approved" ? (
                <IconCircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <span className="size-4" />
              )}
              {t(`plansPage.status.labels.${s}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LocalModeBadge() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={LOCAL_FILES_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-700 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-emerald-300"
          aria-label={t("plansPage.localMode.privacyDetails")}
        >
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span>{t("plansPage.localMode.badge")}</span>
          <IconHelpCircle className="size-3.5 opacity-75" />
        </a>
      </TooltipTrigger>
      <TooltipContent align="end" side="bottom" className="max-w-xs p-3">
        <div className="grid gap-1.5">
          <p className="font-medium leading-5">
            {t("plansPage.localMode.title")}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("plansPage.localMode.description")}
          </p>
          <p className="text-xs font-medium leading-5 text-foreground">
            {t("plansPage.localMode.openDocs")}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function canEditPlanContentRole(role?: PlanAccessRole | null) {
  return role === "owner" || role === "admin" || role === "editor";
}

export function PlansPage({ localPlanSlug }: { localPlanSlug?: string } = {}) {
  const t = useT();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nativeReaderRef = useRef<HTMLDivElement>(null);
  const nativeCommentPointerRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const documentStateRef = useRef<PlanDocumentState | null>(null);
  const pendingDocumentRestoreRef = useRef<PlanDocumentState | null>(null);
  const pendingDocumentRestoreTimerRef = useRef<number | null>(null);
  const nativeScrollFrameRef = useRef<number | null>(null);
  const initialReaderScrollResetKeyRef = useRef<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [promoteLocalPlanOpen, setPromoteLocalPlanOpen] = useState(false);
  const [promoteLocalPlanTargetPath, setPromoteLocalPlanTargetPath] =
    useState("");
  const [promoteLocalPlanOverwrite, setPromoteLocalPlanOverwrite] =
    useState(false);
  const [planFullscreen, setPlanFullscreen] = useState(true);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [canvasMarkupMode, setCanvasMarkupMode] =
    useState<CanvasMarkupMode>("none");
  const [visualSurfaceMode, setVisualSurfaceMode] =
    useState<PlanVisualSurfaceMode>("none");
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>(() =>
    readPreferredEditor(),
  );
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [localBridgeCommentPending, setLocalBridgeCommentPending] =
    useState(false);
  const [pendingAnnotation, setPendingAnnotation] =
    useState<PlanAnnotationAnchor | null>(null);
  const [inlineCommentPosition, setInlineCommentPosition] =
    useState<InlineCommentPosition | null>(null);
  const [nativeSelectionComment, setNativeSelectionComment] =
    useState<NativeSelectionComment | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<{
    annotation: RuntimeAnnotation;
    position: InlineCommentPosition;
  } | null>(null);
  const [deleteCommentRequest, setDeleteCommentRequest] =
    useState<DeleteCommentRequest | null>(null);
  const [deletePlanRequest, setDeletePlanRequest] =
    useState<DeletePlanRequest | null>(null);
  const [nativeMarkerVersion, setNativeMarkerVersion] = useState(0);
  const [commentVisibility, setCommentVisibility] =
    useState<CommentVisibility>("open");
  // When a comment submit fails, stash the draft here so the popover can
  // re-open with the user's text pre-filled (Issue 2a).
  const [failedCommentDraft, setFailedCommentDraft] =
    useState<CommentDraft | null>(null);
  // Ref that signals the 3-second poll to pause while a comment mutation is
  // in-flight. Prevents poll-driven cache replacement from evicting optimistic
  // comments before the server write commits (Issue 4a).
  const { session, isLoading: sessionLoading } = useSession();
  const localPlanMode = Boolean(localPlanSlug);
  const routeSearchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const localPlanBridgeUrl = localPlanMode
    ? routeSearchParams.get("bridge")
    : null;
  const localPlanRepoPath = localPlanMode
    ? routeSearchParams.get("path")
    : null;
  const routeSelectedId = params.id;
  const [localNetworkPermission, setLocalNetworkPermission] =
    useState<LocalNetworkAccessPermissionState>(
      localPlanBridgeUrl ? "checking" : "unsupported",
    );
  const [localBridgeConnectionRequested, setLocalBridgeConnectionRequested] =
    useState(false);
  const checkLocalNetworkPermission = useCallback(async () => {
    if (!localPlanBridgeUrl) {
      setLocalNetworkPermission("unsupported");
      return;
    }
    setLocalNetworkPermission("checking");
    setLocalBridgeConnectionRequested(false);
    const state = await localNetworkAccessPermissionState();
    setLocalNetworkPermission(state);
  }, [localPlanBridgeUrl]);
  useEffect(() => {
    void checkLocalNetworkPermission();
  }, [checkLocalNetworkPermission]);
  const localBridgeFetchEnabled = Boolean(
    localPlanMode &&
    localPlanSlug &&
    localPlanBridgeUrl &&
    (localNetworkPermission === "granted" ||
      localNetworkPermission === "unsupported" ||
      localBridgeConnectionRequested),
  );
  const localPlanBridgeQuery = useQuery<LocalPlanBundle>({
    queryKey: localPlanBridgeQueryKey(
      localPlanSlug ?? "",
      localPlanBridgeUrl ?? "",
    ),
    enabled: localBridgeFetchEnabled,
    refetchOnWindowFocus: false,
    retry: shouldRetryLocalPlanBridgeBundle,
    retryDelay: localPlanBridgeRetryDelay,
    queryFn: () =>
      fetchLocalPlanBridgeBundle(localPlanBridgeUrl ?? "", localPlanSlug ?? ""),
  });
  const localPlanQuery = useActionQuery<LocalPlanBundle>(
    "get-local-plan-folder",
    localPlanBundleQueryParams(localPlanSlug ?? "", localPlanRepoPath),
    {
      enabled: localPlanMode && Boolean(localPlanSlug) && !localPlanBridgeUrl,
      refetchInterval: false,
    },
  );
  // Bridge bundles carry no comments; load comments.json from the colocated
  // folder so they render and survive refresh in bridge mode too.
  const localPlanBridgeCommentsQuery = useActionQuery<LocalPlanBundle>(
    "get-local-plan-folder",
    localPlanBundleQueryParams(localPlanSlug ?? "", localPlanRepoPath),
    {
      enabled: localPlanMode && Boolean(localPlanSlug && localPlanBridgeUrl),
      refetchInterval: false,
      retry: false,
    },
  );
  const localPlanData = localPlanBridgeUrl
    ? mergeLocalBridgeComments(
        localPlanBridgeQuery.data,
        localPlanBridgeCommentsQuery.data?.comments,
      )
    : localPlanQuery.data;
  const localPlanError = localPlanBridgeUrl
    ? localPlanBridgeQuery.error
    : localPlanQuery.error;
  useEffect(() => {
    if (!(localPlanError instanceof LocalPlanBridgePermissionError)) return;
    setLocalNetworkPermission(localPlanError.permissionState);
    setLocalBridgeConnectionRequested(false);
  }, [localPlanError]);
  const localPlanLoading = localPlanBridgeUrl
    ? localPlanBridgeQuery.isLoading
    : localPlanQuery.isLoading;
  const localPlanFetching = localPlanBridgeUrl
    ? localPlanBridgeQuery.isFetching
    : localPlanQuery.isFetching;
  const refetchLocalPlan = useCallback(() => {
    if (localPlanBridgeUrl) return localPlanBridgeQuery.refetch();
    return localPlanQuery.refetch();
  }, [localPlanBridgeQuery, localPlanBridgeUrl, localPlanQuery]);
  const selectedId = localPlanMode
    ? (localPlanData?.plan.id ??
      (localPlanSlug ? `local-${localPlanSlug}` : undefined))
    : routeSelectedId;
  const plansQuery = usePlans(ALL_PLANS_QUERY_ARGS, {
    enabled: Boolean(session && !selectedId && !localPlanMode),
  });
  const plans = plansQuery.data ?? [];
  // Identity for collaborative cursor labels. Only a signed-in user enables
  // real-time multi-user prose editing; guests/anonymous keep single-user editing.
  const collabUser = useMemo<RichMarkdownCollabUser | null>(
    () =>
      session?.email
        ? {
            name: session.name?.trim() || emailToName(session.email),
            email: session.email,
            color: emailToColor(session.email),
          }
        : null,
    [session?.email, session?.name],
  );
  // Redirect to sign-in, returning to wherever the guest currently is.
  const openSignIn = useCallback((returnOverride?: string) => {
    const returnPath =
      returnOverride ??
      window.location.pathname + window.location.search + window.location.hash;
    window.location.href = `${agentNativePath(
      "/_agent-native/sign-in",
    )}?return=${encodeURIComponent(returnPath)}`;
  }, []);
  const requestCreatePlan = useCallback(() => {
    if (sessionLoading) return;
    if (!session) {
      openSignIn("/plans?create=1");
      return;
    }
    setCreateOpen(true);
  }, [openSignIn, session, sessionLoading]);
  // Refetch once a session appears so account-scoped plans show up immediately.
  const wasSignedInRef = useRef(false);
  useEffect(() => {
    if (sessionLoading) return;
    const signedIn = Boolean(session);
    if (signedIn && !wasSignedInRef.current && !selectedId && !localPlanMode) {
      void plansQuery.refetch();
    }
    wasSignedInRef.current = signedIn;
  }, [localPlanMode, selectedId, session, sessionLoading, plansQuery]);
  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (search.get("create") !== "1" || sessionLoading) return;
    if (!session) {
      openSignIn("/plans?create=1");
      return;
    }
    setCreateOpen(true);
    search.delete("create");
    const nextSearch = search.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    openSignIn,
    session,
    sessionLoading,
  ]);
  const prototypeOnly = useMemo(() => {
    return routeSearchParams.get("prototype") === "1";
  }, [routeSearchParams]);
  const recapScreenshotMode = useMemo(() => {
    return routeSearchParams.get(RECAP_SCREENSHOT_QUERY_PARAM) === "1";
  }, [routeSearchParams]);
  const recapScreenshotTheme = useMemo<"light" | "dark" | null>(() => {
    if (!recapScreenshotMode) return null;
    return routeSearchParams.get(RECAP_SCREENSHOT_THEME_QUERY_PARAM) === "dark"
      ? "dark"
      : "light";
  }, [recapScreenshotMode, routeSearchParams]);
  const recapScreenshotBackground =
    recapScreenshotTheme === "dark"
      ? GITHUB_DARK_CANVAS_BACKGROUND
      : recapScreenshotTheme === "light"
        ? GITHUB_LIGHT_CANVAS_BACKGROUND
        : null;
  const recapScreenshotBackgroundStyle = useMemo<CSSProperties | undefined>(
    () =>
      recapScreenshotBackground
        ? { backgroundColor: recapScreenshotBackground }
        : undefined,
    [recapScreenshotBackground],
  );
  const immersiveReader = Boolean(
    selectedId && (planFullscreen || prototypeOnly),
  );
  const planQuery = usePlan(localPlanMode ? undefined : selectedId);
  const bundle = localPlanMode ? localPlanData : planQuery.data;
  const localPlanBundle =
    localPlanMode && bundle && "localOnly" in bundle
      ? (bundle as LocalPlanBundle)
      : null;
  const localPlanDisplayFolder =
    localPlanMode &&
    bundle &&
    "folder" in bundle &&
    typeof bundle.folder === "string" &&
    bundle.folder
      ? bundle.folder
      : (localPlanSlug ?? "local plan files");
  const localPlanSuggestedRepoPath =
    localPlanBundle?.suggestedRepoPath ??
    (localPlanSlug ? `plans/${localPlanSlug}` : "plans");
  const localPlanMenuPath =
    localPlanRepoPath ??
    localPlanBundle?.repoPath ??
    localPlanSuggestedRepoPath ??
    localPlanSlug ??
    "local plan files";
  const planAccessStatusQuery = usePlanAccessStatus(
    selectedId,
    Boolean(selectedId && !bundle && !localPlanMode),
  );
  const planAccessStatus = planAccessStatusQuery.data ?? null;
  const planQueryInitialPending = planQuery.isLoading;
  const planAccessStatusInitialPending = planAccessStatusQuery.isLoading;
  const showPlanLoadError = shouldShowPlanLoadError({
    hasSelectedId: Boolean(selectedId),
    localPlanMode,
    hasBundle: Boolean(bundle),
    planQueryInitialPending,
    planQueryError: planQuery.isError,
    planQueryPaused: planQuery.isPaused,
    accessStatusInitialPending: planAccessStatusInitialPending,
    accessStatusPaused: planAccessStatusQuery.isPaused,
    accessDenied: Boolean(planAccessStatus && !planAccessStatus.hasAccess),
  });
  const showLocalPlanLoadError = shouldShowLocalPlanLoadError({
    localPlanMode,
    hasBundle: Boolean(bundle),
    hasBridgeUrl: Boolean(localPlanBridgeUrl),
    bridgeFetchEnabled: localBridgeFetchEnabled,
    error: localPlanError,
    loading: localPlanLoading,
    fetching: localPlanFetching,
    permissionState: localNetworkPermission,
  });
  const showLocalPlanConnection = Boolean(
    localPlanMode &&
    localPlanBridgeUrl &&
    !bundle &&
    !localBridgeConnectionRequested &&
    (localNetworkPermission === "prompt" ||
      localNetworkPermission === "denied"),
  );
  const showInitialPlanSkeleton = Boolean(
    selectedId &&
    !bundle &&
    !showPlanLoadError &&
    !showLocalPlanLoadError &&
    !showLocalPlanConnection,
  );
  const requestPlanAccessMutation = useRequestPlanAccess();
  const [accessRequestSentPlanId, setAccessRequestSentPlanId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (accessRequestSentPlanId && accessRequestSentPlanId !== selectedId) {
      setAccessRequestSentPlanId(null);
    }
  }, [accessRequestSentPlanId, selectedId]);
  const startGoogleSignIn = useCallback(async () => {
    const returnPath =
      window.location.pathname + window.location.search + window.location.hash;
    try {
      const res = await fetch(
        `${agentNativePath("/_agent-native/google/auth-url")}?return=${encodeURIComponent(returnPath)}`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
        message?: string;
      } | null;
      if (res.ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      if (data?.error || data?.message) {
        toast.error(data.error ?? data.message);
      }
    } catch {
      // Fall through to the full sign-in page, which has the same auth options.
    }
    openSignIn(returnPath);
  }, [openSignIn]);
  const requestPlanAccess = useCallback(() => {
    if (!selectedId || localPlanMode) return;
    requestPlanAccessMutation.mutate(
      { planId: selectedId },
      {
        onSuccess: (result) => {
          setAccessRequestSentPlanId(selectedId);
          toast.success(result.message);
          if (result.alreadyHasAccess) void planQuery.refetch();
        },
      },
    );
  }, [localPlanMode, planQuery, requestPlanAccessMutation, selectedId]);
  const queryClient = useQueryClient();
  const selectedPlanQueryKey = useMemo(
    () =>
      selectedId && !localPlanMode
        ? planBundleQueryKey(selectedId)
        : localPlanMode && localPlanSlug
          ? localPlanBridgeUrl
            ? localPlanBridgeQueryKey(localPlanSlug, localPlanBridgeUrl)
            : localPlanBundleQueryKey(localPlanSlug, localPlanRepoPath)
          : null,
    [
      localPlanBridgeUrl,
      localPlanMode,
      localPlanRepoPath,
      localPlanSlug,
      selectedId,
    ],
  );
  // Reflect a structural block edit (drag-to-columns, reorder) into the
  // `get-visual-plan` cache IMMEDIATELY so the editor's authoritative content
  // tracks the new layout instead of lagging the debounced (600ms) save. This
  // keeps every reader of the plan content consistent with what the editor shows
  // the moment the drop lands. The reconcile's own non-collab stale-poll guard is
  // what actually stops a lagging refetch from reverting the layout, so this does
  // NOT bump `updatedAt` — leaving the server's timestamp intact so a genuinely
  // newer agent/external edit still wins.
  const writeBlocksOptimistically = useCallback(
    (blocks: PlanBlock[]) => {
      if (!selectedPlanQueryKey) return;
      queryClient.setQueryData(
        selectedPlanQueryKey,
        (prev: PlanBundleWithHtml | undefined) => {
          if (!prev?.plan?.content) return prev;
          return {
            ...prev,
            plan: {
              ...prev.plan,
              content: { ...prev.plan.content, blocks },
            },
          };
        },
      );
    },
    [queryClient, selectedPlanQueryKey],
  );
  // Recaps are read-only review surfaces: text can't be edited inline (the agent
  // owns the content), but highlighting + commenting stay available because those
  // affordances key off `bundle`/`session`, not `canEditPlanContent`.
  const isRecap = bundle?.plan.kind === "recap";
  const effectivePlanAccessRole = bundle?.access?.role ?? null;
  const canEditLocalPlanContent =
    localPlanMode &&
    !localPlanBridgeUrl &&
    !isRecap &&
    Boolean(localPlanSlug && bundle?.plan.content);
  const canEditPlanContent =
    canEditLocalPlanContent ||
    (!localPlanMode &&
      !isRecap &&
      canEditPlanContentRole(effectivePlanAccessRole));
  const canManagePlan =
    !localPlanMode && canEditPlanContentRole(effectivePlanAccessRole);
  const canDeleteCurrentPlan =
    !localPlanMode && effectivePlanAccessRole === "owner";
  const currentPlanDeleteTarget = useMemo<DeletePlanTarget | null>(() => {
    if (!bundle || !canDeleteCurrentPlan) return null;
    return {
      id: bundle.plan.id,
      title: bundle.plan.title,
      kind: bundle.plan.kind,
      deletedAt: bundle.plan.deletedAt,
      canDelete: true,
    };
  }, [
    bundle?.plan.deletedAt,
    bundle?.plan.id,
    bundle?.plan.kind,
    bundle?.plan.title,
    bundle,
    canDeleteCurrentPlan,
  ]);
  const effectivePlanVisibility = bundle?.access?.visibility ?? null;
  const canReportPlan =
    !localPlanMode &&
    Boolean(bundle) &&
    effectivePlanVisibility === "public" &&
    !canManagePlan;
  const canResolveCommentThreads = Boolean(
    bundle && (localPlanMode || session || canEditPlanContent),
  );
  const defaultInlineCommentDraft = useMemo<CommentDraft>(() => {
    return defaultInlineCommentDraftForPlanContext({
      planKind: bundle?.plan.kind,
      ownerEmail: bundle?.access?.ownerEmail,
      sourceAuthorName: bundle?.plan.sourceAuthorName,
      sourceAuthorLogin: bundle?.plan.sourceAuthorLogin,
      accessRole: effectivePlanAccessRole,
      currentEmail: collabUser?.email,
    });
  }, [
    bundle?.access?.ownerEmail,
    bundle?.plan.kind,
    bundle?.plan.sourceAuthorName,
    bundle?.plan.sourceAuthorLogin,
    collabUser?.email,
    effectivePlanAccessRole,
  ]);
  const commentThreads = useMemo(
    () => buildCommentThreads(bundle?.comments ?? []),
    [bundle?.comments],
  );
  const visibleCommentThreads = useMemo(
    () => commentThreadsForVisibility(commentThreads, commentVisibility),
    [commentThreads, commentVisibility],
  );
  const visibleMarkerCommentThreads = useMemo(
    () =>
      commentThreadsForVisualSurfaceMode(
        visibleCommentThreads,
        visualSurfaceMode,
      ),
    [visibleCommentThreads, visualSurfaceMode],
  );
  const visiblePlanComments = useMemo(() => {
    if (!bundle) return [] as PlanBundle["comments"];
    const visibleIds = new Set(
      visibleCommentThreads.flatMap((thread) =>
        thread.comments.map((comment) => comment.id),
      ),
    );
    return bundle.comments.filter((comment) => visibleIds.has(comment.id));
  }, [bundle, visibleCommentThreads]);
  const commentAvatarEmails = useMemo(
    () => commentAuthorEmails(bundle?.comments ?? [], collabUser?.email),
    [bundle?.comments, collabUser?.email],
  );
  const commentAvatarUrls = useCommentAvatarUrls(commentAvatarEmails);
  const sessionWithImage = session as
    | (typeof session & { image?: string | null })
    | null;
  const sessionImage = sessionWithImage?.image?.trim() || null;
  const currentCommentAuthor = useMemo<CurrentCommentAuthor | null>(() => {
    const email = normalizeCommentEmail(collabUser?.email);
    if (isLocalCurrentUserEmail(email)) {
      return {
        email: null,
        name: null,
        avatarUrl: null,
        color: CURRENT_USER_FALLBACK_COLOR,
      };
    }
    const storedAvatar = email ? (commentAvatarUrls[email] ?? null) : null;
    const avatarUrl = storedAvatar ?? sessionImage;
    const name = collabUser?.name?.trim() || null;
    if (!email && !name && !avatarUrl) return null;
    return {
      email,
      name,
      avatarUrl,
      color: email ? emailToColor(email) : CURRENT_USER_FALLBACK_COLOR,
    };
  }, [collabUser?.email, collabUser?.name, commentAvatarUrls, sessionImage]);
  const pendingCommentAuthor = useMemo(
    () =>
      commentAuthorPresentation(
        {
          createdBy: "human",
          authorEmail: collabUser?.email,
          authorName: collabUser?.name,
        },
        currentCommentAuthor?.avatarUrl ?? null,
        currentCommentAuthor,
      ),
    [collabUser?.email, collabUser?.name, currentCommentAuthor],
  );
  const runtimeCommentThreads = useMemo(
    () =>
      visibleMarkerCommentThreads
        .map((thread, index) =>
          runtimeAnnotationFromThread(
            thread,
            index,
            commentAvatarUrls,
            currentCommentAuthor,
          ),
        )
        .filter((annotation): annotation is RuntimeAnnotation =>
          Boolean(annotation),
        ),
    [commentAvatarUrls, currentCommentAuthor, visibleMarkerCommentThreads],
  );
  const canDeletePlanComment = useCallback(
    (comment: { authorEmail?: string | null }) => {
      if (canManagePlan) return true;
      const currentEmail = normalizeCommentEmail(collabUser?.email);
      const authorEmail = normalizeCommentEmail(comment.authorEmail);
      if (!authorEmail) return false;
      if (currentEmail && authorEmail === currentEmail) return true;
      return (
        isLocalCurrentUserEmail(authorEmail) &&
        (!currentEmail || isLocalCurrentUserEmail(currentEmail))
      );
    },
    [canManagePlan, collabUser?.email],
  );
  const canDeleteCommentThread = useCallback(
    (thread: CommentThread) => canDeletePlanComment(thread.root),
    [canDeletePlanComment],
  );
  const activeCommentThread = useMemo(
    () =>
      activeAnnotation
        ? (commentThreads.find(
            (item) => item.id === activeAnnotation.annotation.id,
          ) ?? null)
        : null,
    [activeAnnotation, commentThreads],
  );
  useEffect(() => {
    setActiveAnnotation((current) => {
      if (!current) return current;
      const fresh = runtimeCommentThreads.find(
        (annotation) => annotation.id === current.annotation.id,
      );
      return fresh ? { ...current, annotation: fresh } : null;
    });
  }, [runtimeCommentThreads]);
  const updatePlan = useUpdatePlan();
  const updateLocalPlan = useUpdateLocalPlan();
  const promoteLocalPlan = usePromoteLocalPlan();
  // Stable ref so closures (e.g. message-event handler) always call the latest
  // mutate without needing to be in a dependency array.
  const updatePlanMutateRef = useRef(updatePlan.mutate);
  updatePlanMutateRef.current = updatePlan.mutate;
  // Separate mutation instance for comment-only writes (reply / resolve /
  // reopen). Keeping it separate from the prose-autosave `updatePlan` instance
  // means the autosave `isPending` state cannot bleed into comment button
  // disabled states (Issue 3).
  const updateCommentMutation = useUpdatePlanComments();
  // Local-files plans write comments to comments.json (no DB) via this action.
  const updateLocalCommentMutation = useUpdateLocalPlanComments();
  const deleteCommentMutation = useDeletePlanComment();
  const deletePlanMutation = useDeletePlan();

  /**
   * Archive or unarchive a plan from the overview. Optimistically updates the
   * list-visual-plans cache so the card disappears/reappears immediately.
   * Rolls back on error with a toast.
   */
  const handleArchivePlan = useCallback(
    (planId: string, archive: boolean) => {
      const newStatus = archive ? "archived" : "draft";
      const prevActive = queryClient.getQueryData<PlanSummary[]>(
        ACTIVE_PLANS_QUERY_KEY,
      );
      const prevAll =
        queryClient.getQueryData<PlanSummary[]>(ALL_PLANS_QUERY_KEY);
      // Optimistic update
      for (const listKey of [ACTIVE_PLANS_QUERY_KEY, ALL_PLANS_QUERY_KEY]) {
        queryClient.setQueryData(listKey, (old: PlanSummary[] | undefined) =>
          old?.map((p) => (p.id === planId ? { ...p, status: newStatus } : p)),
        );
      }
      updatePlan.mutate(
        { planId, status: newStatus },
        {
          onError: () => {
            // Roll back
            if (prevActive !== undefined)
              queryClient.setQueryData(ACTIVE_PLANS_QUERY_KEY, prevActive);
            if (prevAll !== undefined)
              queryClient.setQueryData(ALL_PLANS_QUERY_KEY, prevAll);
            toast.error(
              archive
                ? t("plansPage.reader.archiveFailed")
                : t("plansPage.reader.unarchiveFailed"),
            );
          },
        },
      );
    },
    [queryClient, t, updatePlan],
  );

  const updatePlanListCaches = useCallback(
    (updater: (plans: PlanSummary[]) => PlanSummary[]) => {
      for (const listKey of [ACTIVE_PLANS_QUERY_KEY, ALL_PLANS_QUERY_KEY]) {
        queryClient.setQueryData(listKey, (old: PlanSummary[] | undefined) =>
          old ? updater(old) : old,
        );
      }
    },
    [queryClient],
  );

  const requestDeletePlan = useCallback(
    (plan: DeletePlanTarget, initialMode: "soft" | "hard" = "soft") => {
      setDeletePlanRequest({ plan, mode: initialMode });
    },
    [],
  );

  const confirmDeletePlan = useCallback(
    async (input: DeletePlanInput, targetOverride?: DeletePlanTarget) => {
      const target = targetOverride ?? deletePlanRequest?.plan;
      if (!target) return;
      try {
        const result = await deletePlanMutation.mutateAsync(input);
        if (result.mode === "soft") {
          queryClient.setQueryData(
            ACTIVE_PLANS_QUERY_KEY,
            (items: PlanSummary[] | undefined) =>
              items?.filter((plan) => plan.id !== target.id),
          );
          queryClient.setQueryData(
            ALL_PLANS_QUERY_KEY,
            (items: PlanSummary[] | undefined) =>
              items?.map((plan) =>
                plan.id === target.id
                  ? { ...plan, deletedAt: result.deletedAt }
                  : plan,
              ),
          );
          toast.success(
            target.kind === "recap"
              ? t("plansPage.reader.recapMovedToDeleted")
              : t("plansPage.reader.planMovedToDeleted"),
          );
          if (selectedId === target.id) navigate("/plans");
        } else if (result.mode === "restore") {
          updatePlanListCaches((items) =>
            items.map((plan) =>
              plan.id === target.id
                ? { ...plan, deletedAt: null, deletedBy: null }
                : plan,
            ),
          );
          toast.success(
            target.kind === "recap"
              ? t("plansPage.reader.recapRestored")
              : t("plansPage.reader.planRestored"),
          );
        } else {
          updatePlanListCaches((items) =>
            items.filter((plan) => plan.id !== target.id),
          );
          queryClient.removeQueries({
            queryKey: planBundleQueryKey(target.id),
          });
          toast.success(
            target.kind === "recap"
              ? t("plansPage.reader.recapPermanentlyDeleted")
              : t("plansPage.reader.planPermanentlyDeleted"),
          );
          if (selectedId === target.id) navigate("/plans");
        }
        if (!targetOverride) setDeletePlanRequest(null);
      } catch {
        // The hook already shows a normalized action error toast.
      }
    },
    [
      deletePlanMutation,
      deletePlanRequest?.plan,
      navigate,
      queryClient,
      selectedId,
      t,
      updatePlanListCaches,
    ],
  );

  /**
   * Persist question-form answers as an agent-targeted comment so
   * share-link reviewers' answers are visible to get-plan-feedback even when
   * no agent is attached on their machine.  Fire-and-forget: the existing
   * sendToAgentChat fast-path runs first, and this is a best-effort backup.
   */
  const persistQuestionFormAnswers = useCallback(
    (summary: string, planId: string | undefined) => {
      if (!planId) return;
      const comment: PlanCommentInput = {
        kind: "comment",
        status: "open",
        message: summary,
        createdBy: "human",
        authorEmail: collabUser?.email,
        authorName: collabUser?.name,
        resolutionTarget: "agent",
      };
      if (localPlanMode && localPlanSlug) {
        void (async () => {
          if (localPlanBridgeUrl) setLocalBridgeCommentPending(true);
          try {
            const updated = localPlanBridgeUrl
              ? await updateLocalPlanBridgeComments(
                  localPlanBridgeUrl,
                  localPlanSlug,
                  { comments: [comment] },
                )
              : await updateLocalCommentMutation.mutateAsync({
                  slug: localPlanSlug,
                  ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
                  comments: [comment],
                });
            if (selectedPlanQueryKey) {
              queryClient.setQueryData(selectedPlanQueryKey, updated);
            }
          } catch {
            toast.error(t("plansPage.reader.saveAnswersFailed"));
          } finally {
            if (localPlanBridgeUrl) setLocalBridgeCommentPending(false);
          }
        })();
        return;
      }
      updatePlanMutateRef.current(
        {
          planId,
          comments: [comment],
        },
        {
          onError: () => {
            toast.error(t("plansPage.reader.saveAnswersFailed"));
          },
        },
      );
    },
    [
      collabUser?.email,
      collabUser?.name,
      localPlanBridgeUrl,
      localPlanMode,
      localPlanRepoPath,
      localPlanSlug,
      queryClient,
      selectedPlanQueryKey,
      t,
      updateLocalCommentMutation,
    ],
  );

  const exportPlan = useExportPlan(localPlanMode ? undefined : selectedId);
  const importPlanSource = useImportPlanSource();
  const [desktopPlanFolder, setDesktopPlanFolder] =
    useState<DesktopPlanFilesFolder | null>(null);
  const [desktopPlanSyncing, setDesktopPlanSyncing] = useState(false);
  const [desktopPlanImporting, setDesktopPlanImporting] = useState(false);
  const [desktopPlanAutoSync, setDesktopPlanAutoSync] = useState(() =>
    readDesktopPlanAutoSync(selectedId),
  );
  const desktopAutoSyncedVersionRef = useRef<Record<string, string>>({});
  const desktopPlanFilesAvailable = Boolean(getDesktopPlanFiles());
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkTheme = recapScreenshotTheme
    ? recapScreenshotTheme === "dark"
    : resolvedTheme !== "light";
  const wireframeStyle = useWireframeStyle();
  const planTheme = isDarkTheme ? "dark" : "light";
  const iframeRuntimeDefaultsRef = useRef<{
    planTheme: "dark" | "light";
    preferredEditor: PreferredEditor;
  }>({ planTheme, preferredEditor });
  iframeRuntimeDefaultsRef.current = { planTheme, preferredEditor };
  const reviewMode: CanvasMarkupMode = annotateMode
    ? "comment"
    : canvasMarkupMode;
  const hasOpenThreads = (bundle?.summary.openCommentCount ?? 0) > 0;
  const resolvedCommentThreadCount = commentThreads.filter(
    (thread) => commentThreadStatus(thread) === "resolved",
  ).length;
  const visibleCommentThreadCount = visibleCommentThreads.length;
  const commentMarkersVisible =
    commentVisibility !== "hidden" &&
    (annotationsOpen ||
      annotateMode ||
      Boolean(activeAnnotation) ||
      visibleCommentThreadCount > 0);

  useEffect(() => {
    if (!recapScreenshotTheme || !recapScreenshotBackground) return;
    const root = document.documentElement;
    const body = document.body;
    const previousRootClass = root.className;
    const previousDataTheme = root.getAttribute("data-theme");
    const previousColorScheme = root.style.colorScheme;
    const previousRootBackground = root.style.backgroundColor;
    const previousBodyBackground = body.style.backgroundColor;

    root.classList.remove("light", "dark");
    root.classList.add(recapScreenshotTheme);
    root.setAttribute("data-theme", recapScreenshotTheme);
    root.style.colorScheme = recapScreenshotTheme;
    root.style.backgroundColor = recapScreenshotBackground;
    body.style.backgroundColor = recapScreenshotBackground;

    return () => {
      root.className = previousRootClass;
      if (previousDataTheme === null) {
        root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", previousDataTheme);
      }
      root.style.colorScheme = previousColorScheme;
      root.style.backgroundColor = previousRootBackground;
      body.style.backgroundColor = previousBodyBackground;
    };
  }, [recapScreenshotBackground, recapScreenshotTheme]);
  const showingPrototypeSurface =
    prototypeOnly || visualSurfaceMode === "prototype";

  useEffect(() => {
    if (visualSurfaceMode !== "wireframes" && canvasMarkupMode !== "none") {
      setCanvasMarkupMode("none");
    }
  }, [canvasMarkupMode, visualSurfaceMode]);

  useEffect(() => {
    const title = bundle?.plan.title;
    if (title) document.title = planDocumentTitle(title, document.title);
  }, [bundle?.plan.title]);

  useSetPageTitle(bundle?.plan.title || (isRecap ? "Recap" : "Plan"));
  useSetHeaderActions(
    !sessionLoading && !session && !selectedId ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => openSignIn()}
      >
        {t("plansPage.loadError.signIn")}
      </Button>
    ) : null,
  );

  useEffect(() => {
    setDesktopPlanFolder(null);
    setDesktopPlanAutoSync(readDesktopPlanAutoSync(selectedId));
    const planFiles = getDesktopPlanFiles();
    if (!planFiles || !selectedId || localPlanMode) return;

    let cancelled = false;
    void planFiles.getFolder({ planId: selectedId }).then((result) => {
      if (cancelled) return;
      setDesktopPlanFolder(result.ok ? result.folder : null);
      if (result.ok) {
        void syncLocalControlResources({
          folderName: result.folder.name,
          files: result.controlResources,
        })
          .then((synced) => {
            if (synced.count > 0) {
              queryClient.invalidateQueries({ queryKey: ["resources"] });
            }
          })
          .catch(() => {
            // Resource refresh is best-effort when restoring a remembered folder.
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [localPlanMode, queryClient, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const view = immersiveReader ? "immersive" : "app";
    document.documentElement.dataset.planReaderView = view;
    window.dispatchEvent(
      new CustomEvent(PLAN_READER_VIEW_EVENT, {
        detail: { view, immersive: immersiveReader },
      }),
    );
    return () => {
      delete document.documentElement.dataset.planReaderView;
      window.dispatchEvent(
        new CustomEvent(PLAN_READER_VIEW_EVENT, {
          detail: { view: "app", immersive: false },
        }),
      );
    };
  }, [immersiveReader, selectedId]);

  const documentHtml = useMemo(() => {
    if (!bundle) return "";
    return (
      bundle.html ||
      bundle.plan.html ||
      buildClientPlanHtml(bundle, {
        workingPlan: t("plansPage.reader.clientHtmlWorkingPlan"),
      })
    );
  }, [bundle, t]);

  const annotatedDocumentHtml = useMemo(() => {
    if (!bundle) return "";
    const defaults = iframeRuntimeDefaultsRef.current;
    const annotations = buildCommentThreads(visiblePlanComments)
      .map((thread, index) =>
        runtimeAnnotationFromThread(
          thread,
          index,
          commentAvatarUrls,
          currentCommentAuthor,
        ),
      )
      .filter((annotation): annotation is RuntimeAnnotation =>
        Boolean(annotation),
      );
    return injectAnnotationRuntime({
      html: documentHtml,
      annotations,
      annotateMode: false,
      theme: defaults.planTheme,
      preferredEditor: defaults.preferredEditor,
      labels: {
        closeCodePreview: t("plansPage.reader.runtimeCloseCodePreview"),
      },
    });
  }, [
    bundle,
    commentAvatarUrls,
    currentCommentAuthor,
    documentHtml,
    t,
    visiblePlanComments,
  ]);

  const planAgentContext = useMemo(() => {
    if (!bundle) return "";
    if (localPlanMode) {
      const url = localPlanRouteUrl(localPlanSlug ?? "", localPlanRepoPath);
      return buildPlanAgentContext({ bundle, documentHtml, url });
    }
    const base = bundle.plan.kind === "recap" ? "recaps" : "plans";
    const path = appPath(`/${base}/${selectedId ?? bundle.plan.id}`);
    const url =
      typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    return buildPlanAgentContext({ bundle, documentHtml, url });
  }, [
    bundle,
    documentHtml,
    localPlanMode,
    localPlanRepoPath,
    localPlanSlug,
    selectedId,
  ]);

  const planShareUrl = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    if (localPlanMode) {
      return localPlanRouteUrl(localPlanSlug ?? "", localPlanRepoPath);
    }
    if (!selectedId) return undefined;
    const base = bundle?.plan.kind === "recap" ? "recaps" : "plans";
    const url = `${window.location.origin}${appPath(`/${base}/${selectedId}`)}`;
    // Viral attribution: tag the shared/public plan link so signups arriving
    // from it can be attributed even when `document.referrer` is empty. `via`
    // is a non-PII owner id and is only set when the current viewer is the
    // owner (the only person whose session userId is the plan owner's id).
    const ownerViaId =
      effectivePlanAccessRole === "owner" ? (session?.userId ?? null) : null;
    return withPlanShareAttribution(url, ownerViaId);
  }, [
    bundle?.plan.kind,
    effectivePlanAccessRole,
    localPlanMode,
    localPlanRepoPath,
    localPlanSlug,
    selectedId,
    session?.userId,
  ]);

  // Viral attribution: read the `ref`/`via` the visitor arrived on (from a
  // tagged share link) so funnel events carry the same attribution the
  // framework first-touch cookie captured. Read once from the URL on mount.
  const shareAttribution = useMemo(
    () =>
      readPlanShareAttribution(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );

  // A logged-out visitor looking at a public plan/recap is the share funnel
  // audience. Their CTAs (comment, sign in) route through `openSignIn`.
  const isLoggedOutPublicPlanView =
    !sessionLoading &&
    !session &&
    !localPlanMode &&
    Boolean(selectedId) &&
    effectivePlanVisibility === "public";

  // share_cta_click — fire alongside (never instead of) the real navigation.
  // `track` is non-throwing, but guard anyway so analytics can never break a
  // CTA. Only fires for the logged-out public-plan funnel audience.
  const fireShareCtaClick = useCallback(
    (cta: string) => {
      if (!isLoggedOutPublicPlanView) return;
      try {
        void track("share_cta_click", {
          surface: PLAN_SHARE_SURFACE,
          plan_id: selectedId ?? "",
          cta,
          ref: shareAttribution.ref,
          via: shareAttribution.via,
        });
      } catch {
        // Never let analytics break a CTA.
      }
    },
    [
      isLoggedOutPublicPlanView,
      selectedId,
      shareAttribution.ref,
      shareAttribution.via,
    ],
  );

  // share_view — fire once when a logged-out visitor views a public plan. The
  // ref guard prevents double-fire across re-renders / StrictMode double-invoke.
  const shareViewFiredRef = useRef(false);
  useEffect(() => {
    if (!isLoggedOutPublicPlanView) return;
    if (shareViewFiredRef.current) return;
    shareViewFiredRef.current = true;
    try {
      void track("share_view", {
        surface: PLAN_SHARE_SURFACE,
        plan_id: selectedId ?? "",
        ref: shareAttribution.ref,
        via: shareAttribution.via,
      });
    } catch {
      // Never let analytics break the page render.
    }
  }, [
    isLoggedOutPublicPlanView,
    selectedId,
    shareAttribution.ref,
    shareAttribution.via,
  ]);

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

  const postRuntimeState = useCallback(
    (restoreScroll?: PlanDocumentState | null) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "agent-native-plan-runtime-state",
          annotateMode,
          theme: planTheme,
          preferredEditor,
          parentOrigin: window.location.origin,
          restoreScroll: restoreScroll ?? null,
        },
        "*",
      );
    },
    [annotateMode, planTheme, preferredEditor],
  );

  const clearPendingDocumentRestore = useCallback(() => {
    if (pendingDocumentRestoreTimerRef.current !== null) {
      window.clearTimeout(pendingDocumentRestoreTimerRef.current);
      pendingDocumentRestoreTimerRef.current = null;
    }
    pendingDocumentRestoreRef.current = null;
  }, []);

  const expirePendingDocumentRestore = useCallback(() => {
    if (pendingDocumentRestoreTimerRef.current !== null) {
      window.clearTimeout(pendingDocumentRestoreTimerRef.current);
    }
    pendingDocumentRestoreTimerRef.current = window.setTimeout(() => {
      pendingDocumentRestoreRef.current = null;
      pendingDocumentRestoreTimerRef.current = null;
    }, 5000);
  }, []);

  const readNativeDocumentState = useCallback((): PlanDocumentState | null => {
    const reader = nativeReaderRef.current;
    if (!reader) return null;
    return {
      scrollX: reader.scrollLeft,
      scrollY: reader.scrollTop,
      scrollWidth: reader.scrollWidth,
      scrollHeight: reader.scrollHeight,
      clientWidth: reader.clientWidth,
      clientHeight: reader.clientHeight,
    };
  }, []);

  const capturePlanDocumentState = useCallback(() => {
    const state = readNativeDocumentState() ?? documentStateRef.current;
    if (state) documentStateRef.current = state;
    return state;
  }, [readNativeDocumentState]);

  const restoreNativeDocumentScroll = useCallback(
    (state: PlanDocumentState | null) => {
      const reader = nativeReaderRef.current;
      if (!reader || !state) return false;
      const scrollWidth = Math.max(reader.scrollWidth, 1);
      const scrollHeight = Math.max(reader.scrollHeight, 1);
      reader.scrollLeft =
        state.scrollX *
        (scrollWidth / Math.max(state.scrollWidth || scrollWidth, 1));
      reader.scrollTop =
        state.scrollY *
        (scrollHeight / Math.max(state.scrollHeight || scrollHeight, 1));
      documentStateRef.current = readNativeDocumentState() ?? state;
      return true;
    },
    [readNativeDocumentState],
  );

  const schedulePlanDocumentRestore = useCallback(
    (state: PlanDocumentState | null) => {
      if (!state) return;
      const restore = () => {
        if (!restoreNativeDocumentScroll(state)) {
          postRuntimeState(state);
        }
      };
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    },
    [postRuntimeState, restoreNativeDocumentScroll],
  );

  const rememberPlanReaderScroll = useCallback(() => {
    const state = capturePlanDocumentState();
    if (state) {
      pendingDocumentRestoreRef.current = state;
      expirePendingDocumentRestore();
    }
    return state;
  }, [capturePlanDocumentState, expirePendingDocumentRestore]);

  const preservePlanReaderScrollAfterToolbarEvent = useCallback(() => {
    schedulePlanDocumentRestore(rememberPlanReaderScroll());
  }, [rememberPlanReaderScroll, schedulePlanDocumentRestore]);

  const preservePlanReaderScroll = useCallback(
    (action: () => void) => {
      const state = rememberPlanReaderScroll();
      action();
      schedulePlanDocumentRestore(state);
    },
    [rememberPlanReaderScroll, schedulePlanDocumentRestore],
  );

  const handleIframeLoad = useCallback(() => {
    const restoreScroll = pendingDocumentRestoreRef.current;
    postRuntimeState(restoreScroll);
    clearPendingDocumentRestore();
  }, [clearPendingDocumentRestore, postRuntimeState]);

  useEffect(() => clearPendingDocumentRestore, [clearPendingDocumentRestore]);

  useBrowserLayoutEffect(() => {
    if (!selectedId || !bundle?.plan.content || location.hash) return;
    const resetKey = `${bundle.plan.kind}:${selectedId}`;
    if (initialReaderScrollResetKeyRef.current === resetKey) return;
    initialReaderScrollResetKeyRef.current = resetKey;
    clearPendingDocumentRestore();
    documentStateRef.current = null;

    const reset = () => resetPlanReaderScrollPosition(nativeReaderRef.current);
    const frameIds: number[] = [];
    const timeoutIds: number[] = [];
    const scheduleFrame = () => {
      frameIds.push(window.requestAnimationFrame(reset));
    };
    const scheduleTimeout = (delay: number) => {
      timeoutIds.push(
        window.setTimeout(() => {
          reset();
          scheduleFrame();
        }, delay),
      );
    };

    reset();
    scheduleFrame();
    scheduleTimeout(0);
    scheduleTimeout(120);
    scheduleTimeout(500);

    return () => {
      frameIds.forEach((id) => window.cancelAnimationFrame(id));
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [
    bundle?.plan.content,
    bundle?.plan.kind,
    clearPendingDocumentRestore,
    location.hash,
    selectedId,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => postRuntimeState());
    return () => cancelAnimationFrame(frame);
  }, [annotatedDocumentHtml, postRuntimeState]);

  useEffect(() => {
    if (!bundle?.plan.content || !pendingDocumentRestoreRef.current) return;
    const restoreScroll = pendingDocumentRestoreRef.current;
    const frame = requestAnimationFrame(() => {
      if (restoreNativeDocumentScroll(restoreScroll)) {
        clearPendingDocumentRestore();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    bundle?.plan.content,
    bundle?.plan.updatedAt,
    clearPendingDocumentRestore,
    restoreNativeDocumentScroll,
  ]);

  useEffect(() => {
    if (!bundle?.plan.content) return;
    const bump = () => setNativeMarkerVersion((version) => version + 1);
    const frame = requestAnimationFrame(bump);
    window.addEventListener("resize", bump);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", bump);
    };
  }, [bundle?.comments, bundle?.plan.content]);

  const getPositionFromAnchor = useCallback((anchor: PlanAnnotationAnchor) => {
    const nativeReader = nativeReaderRef.current;
    if (nativeReader) {
      const rect = nativeReader.getBoundingClientRect();
      const point = nativePointForAnchor(anchor, nativeReader);
      if (!point) return null;
      return resolveInlineCommentPosition({
        pointX: point.left,
        pointY: point.top,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
      });
    }
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

  const closeInlineComment = useCallback(() => {
    setAnnotateMode(false);
    setCanvasMarkupMode("none");
    setPendingAnnotation(null);
    setInlineCommentPosition(null);
    setNativeSelectionComment(null);
    setFailedCommentDraft(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.origin !== "null" && event.origin !== window.location.origin) {
        return;
      }
      if (!event.data || typeof event.data !== "object") return;
      const data = event.data as
        | {
            type?: string;
            anchor?: PlanAnnotationAnchor;
            comment?: RuntimeAnnotation;
            editor?: PreferredEditor;
            href?: string;
            state?: PlanDocumentState;
            summary?: string;
            answers?: unknown;
            title?: string;
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
      if (data?.type === "agent-native-plan-exit-comment-mode") {
        closeInlineComment();
        setActiveAnnotation(null);
        setAnnotationsOpen(false);
      }
      if (data?.type === "agent-native-plan-open-editor" && data.href) {
        if (
          /^(vscode|cursor|xcode|terminal|ghostty):/i.test(data.href) ||
          /^file:\/\//i.test(data.href)
        ) {
          window.location.href = data.href;
          toast.info(t("plansPage.reader.openingFile"));
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
        toast.info(t("plansPage.reader.linksDisabled"));
      }
      if (data?.type === "agent-native-plan-doc-state" && data.state) {
        documentStateRef.current = data.state;
        setActiveAnnotation((current) => {
          if (!current) return current;
          const position = getPositionFromAnchor(current.annotation.anchor);
          return position ? { ...current, position } : current;
        });
      }
      if (
        data?.type === "agent-native-visual-questions-copy" &&
        typeof data.summary === "string"
      ) {
        void navigator.clipboard.writeText(data.summary).then(() => {
          toast.success(t("plansPage.reader.visualPromptCopied"));
        });
      }
      if (
        data?.type === "agent-native-visual-questions-send-to-agent" &&
        typeof data.summary === "string"
      ) {
        sendToAgentChat({
          type: "content",
          submit: true,
          context: planAgentContext,
          message: buildQuestionFormRevisionMessage(data.summary),
        });
        persistQuestionFormAnswers(data.summary, bundle?.plan.id);
        toast.success(t("plansPage.reader.sentAnswers"));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    bundle?.plan.id,
    closeInlineComment,
    getPositionFromAnchor,
    persistQuestionFormAnswers,
    planAgentContext,
  ]);

  const clearInlineCommentDraft = () => {
    setPendingAnnotation(null);
    setInlineCommentPosition(null);
    setNativeSelectionComment(null);
  };

  const copyPlanLink = async () => {
    if (!planShareUrl) return;
    await navigator.clipboard.writeText(planShareUrl);
    toast.success(
      isRecap
        ? t("plansPage.reader.recapLinkCopied")
        : t("plansPage.reader.planLinkCopied"),
    );
  };

  const copyLocalPlanFolder = async () => {
    await navigator.clipboard.writeText(localPlanDisplayFolder);
    toast.success(t("plansPage.reader.localPathCopied"));
  };

  const openPromoteLocalPlanDialog = () => {
    setPromoteLocalPlanTargetPath(
      localPlanBundle?.repoPath || localPlanSuggestedRepoPath,
    );
    setPromoteLocalPlanOverwrite(false);
    setPromoteLocalPlanOpen(true);
  };

  const submitPromoteLocalPlan = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!localPlanSlug || localPlanBridgeUrl) return;
    const targetPath = promoteLocalPlanTargetPath.trim();
    if (!targetPath) {
      toast.error(t("plansPage.reader.enterRepoFolder"));
      return;
    }

    const result = await promoteLocalPlan.mutateAsync({
      slug: localPlanSlug,
      ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
      targetPath,
      overwrite: promoteLocalPlanOverwrite,
    });
    setPromoteLocalPlanOpen(false);
    toast.success(
      result.alreadyPromoted
        ? t("plansPage.reader.localPlanAlreadySaved")
        : t("plansPage.reader.savedLocalFiles", {
            count: result.localFiles?.files.length ?? 0,
            path: result.targetPath ?? targetPath,
          }),
    );
    navigate(localPlanRoutePath(result.slug, result.repoPath ?? targetPath));
  };

  const openPrototypeWindow = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("prototype", "1");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  const leavePrototypeOnlyMode = () => {
    const search = new URLSearchParams(location.search);
    search.delete("prototype");
    const nextSearch = search.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  };

  const readPlanExport = useCallback(async () => {
    if (localPlanMode) {
      const localBundle = bundle as LocalPlanBundle | undefined;
      if (!localBundle) {
        throw new Error(t("plansPage.reader.localSourceUnavailable"));
      }
      const mdx =
        localBundle.mdx ??
        (localBundle.plan.markdown
          ? { "plan.mdx": localBundle.plan.markdown }
          : undefined);
      if (!mdx?.["plan.mdx"]) {
        throw new Error(t("plansPage.reader.localSourceFilesUnavailable"));
      }
      return {
        markdown: localBundle.plan.markdown ?? mdx["plan.mdx"],
        html: localBundle.html || localBundle.plan.html || documentHtml,
        json: localBundle,
        mdx,
        path:
          localBundle.path ??
          (localPlanSlug
            ? localPlanRoutePath(localPlanSlug, localPlanRepoPath)
            : window.location.pathname),
        url:
          localBundle.url ??
          (localPlanSlug
            ? localPlanRouteUrl(localPlanSlug, localPlanRepoPath)
            : planShareUrl),
      };
    }
    const result = await exportPlan.refetch();
    const data = result.data ?? exportPlan.data;
    if (!data) {
      throw new Error(t("plansPage.reader.exportUnavailable"));
    }
    return data;
  }, [
    bundle,
    documentHtml,
    exportPlan,
    localPlanMode,
    localPlanRepoPath,
    localPlanSlug,
    planShareUrl,
  ]);

  const syncPlanToDesktopFolder = useCallback(
    async (options: { choose?: boolean; quiet?: boolean } = {}) => {
      const plan = bundle?.plan;
      const planFiles = getDesktopPlanFiles();
      if (!plan || !planFiles) {
        throw new Error(t("plansPage.reader.desktopSyncUnavailable"));
      }

      setDesktopPlanSyncing(true);
      try {
        let folder = desktopPlanFolder;
        if (options.choose || !folder) {
          const chosen = await planFiles.chooseFolder({
            planId: plan.id,
            title: plan.title,
          });
          if (chosen.ok === false) {
            if (chosen.canceled) return null;
            throw new Error(chosen.error);
          }
          folder = chosen.folder;
          setDesktopPlanFolder(folder);
          const synced = await syncLocalControlResources({
            folderName: folder.name,
            files: chosen.controlResources,
          });
          if (synced.count > 0) {
            queryClient.invalidateQueries({ queryKey: ["resources"] });
          }
        }

        const data = await readPlanExport();
        if (!data.mdx || !data.mdx["plan.mdx"]) {
          throw new Error(t("plansPage.reader.sourceFilesUnavailable"));
        }
        const written = await planFiles.writePlan({
          planId: plan.id,
          title: plan.title,
          mdx: data.mdx,
        });
        if (written.ok === false) throw new Error(written.error);
        setDesktopPlanFolder(written.folder);
        const synced = await syncLocalControlResources({
          folderName: written.folder.name,
          files: written.controlResources,
        });
        if (synced.count > 0) {
          queryClient.invalidateQueries({ queryKey: ["resources"] });
        }
        desktopAutoSyncedVersionRef.current[plan.id] = plan.updatedAt;
        if (!options.quiet) {
          toast.success(
            t("plansPage.reader.syncedLocalFiles", {
              count: written.files?.length ?? 0,
            }),
          );
        }
        return written.folder;
      } finally {
        setDesktopPlanSyncing(false);
      }
    },
    [bundle?.plan, desktopPlanFolder, queryClient, readPlanExport],
  );

  const importPlanFromDesktopFolder = useCallback(async () => {
    const plan = bundle?.plan;
    const planFiles = getDesktopPlanFiles();
    if (!plan || !planFiles) {
      throw new Error(t("plansPage.reader.desktopSyncUnavailable"));
    }

    setDesktopPlanImporting(true);
    try {
      const result = await planFiles.readPlan({ planId: plan.id });
      if (result.ok === false) throw new Error(result.error);
      if (!result.mdx) throw new Error(t("plansPage.reader.noSourceFiles"));
      const synced = await syncLocalControlResources({
        folderName: result.folder.name,
        files: result.controlResources,
      });
      if (synced.count > 0) {
        queryClient.invalidateQueries({ queryKey: ["resources"] });
      }
      const imported = await importPlanSource.mutateAsync({
        planId: plan.id,
        expectedUpdatedAt: plan.updatedAt,
        mdx: result.mdx,
        currentFocus: "desktop local files sync",
      });
      setDesktopPlanFolder(result.folder);
      toast.success(t("plansPage.reader.importedLocalSource"));
      const updatedAt = imported.plan?.updatedAt;
      if (updatedAt) {
        desktopAutoSyncedVersionRef.current[plan.id] = updatedAt;
      }
    } finally {
      setDesktopPlanImporting(false);
    }
  }, [bundle?.plan, importPlanSource, queryClient]);

  const setDesktopPlanAutoSyncEnabled = useCallback(
    (enabled: boolean) => {
      if (!selectedId) return;
      setDesktopPlanAutoSync(enabled);
      if (enabled) {
        window.localStorage.setItem(desktopPlanAutoSyncKey(selectedId), "1");
        void syncPlanToDesktopFolder({ choose: !desktopPlanFolder }).catch(
          (error) => {
            setDesktopPlanAutoSync(false);
            window.localStorage.removeItem(desktopPlanAutoSyncKey(selectedId));
            toast.error(
              error instanceof Error
                ? error.message
                : t("plansPage.reader.enableLocalSyncFailed"),
            );
          },
        );
      } else {
        window.localStorage.removeItem(desktopPlanAutoSyncKey(selectedId));
      }
    },
    [desktopPlanFolder, selectedId, syncPlanToDesktopFolder],
  );

  useEffect(() => {
    const plan = bundle?.plan;
    if (!plan || !desktopPlanAutoSync || !desktopPlanFolder) return;
    if (desktopAutoSyncedVersionRef.current[plan.id] === plan.updatedAt) {
      return;
    }
    desktopAutoSyncedVersionRef.current[plan.id] = plan.updatedAt;
    void syncPlanToDesktopFolder({ quiet: true }).catch((error) => {
      setDesktopPlanAutoSync(false);
      window.localStorage.removeItem(desktopPlanAutoSyncKey(plan.id));
      toast.error(
        error instanceof Error
          ? error.message
          : t("plansPage.reader.syncLocalFailed"),
      );
    });
  }, [
    bundle?.plan,
    desktopPlanAutoSync,
    desktopPlanFolder,
    syncPlanToDesktopFolder,
  ]);

  const copyPlanHtml = async () => {
    const data = await readPlanExport();
    await navigator.clipboard.writeText(data.html);
    toast.success(t("plansPage.reader.planHtmlCopied"));
  };

  const copyPlanMarkdown = async () => {
    const data = await readPlanExport();
    await navigator.clipboard.writeText(data.markdown);
    toast.success(t("plansPage.reader.planMarkdownCopied"));
  };

  const downloadPlanHtml = async () => {
    const data = await readPlanExport();
    downloadTextFile(planExportFilename(bundle?.plan.title, "html"), data.html);
  };

  const downloadPlanMarkdown = async () => {
    const data = await readPlanExport();
    downloadTextFile(
      planExportFilename(bundle?.plan.title, "md"),
      data.markdown,
      "text/markdown;charset=utf-8",
    );
  };

  const downloadPlanSource = async () => {
    const data = await readPlanExport();
    const files = data.mdx;
    if (!files || Object.keys(files).length === 0) {
      throw new Error(t("plansPage.reader.sourceFilesUnavailable"));
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith("/")) {
        zip.folder(name.replace(/\/+$/, ""));
        continue;
      }
      if (typeof content === "string") {
        zip.file(name, content);
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(planExportFilename(bundle?.plan.title, "zip"), blob);
    toast.success(t("plansPage.reader.planSourceDownloaded"));
  };

  const runPlanExportAction = (action: () => Promise<void>) => {
    preservePlanReaderScroll(() => {
      void action().catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t("plansPage.reader.exportUnavailable"),
        );
      });
    });
  };

  const chooseCommentVisibility = (visibility: CommentVisibility) => {
    preservePlanReaderScroll(() => {
      setCommentVisibility(visibility);
      closeInlineComment();
      setActiveAnnotation(null);
      if (visibility === "hidden") {
        setAnnotationsOpen(false);
        setAnnotateMode(false);
        return;
      }
      setAnnotationsOpen(true);
    });
  };

  const startCommenting = useCallback(() => {
    setCanvasMarkupMode("none");
    setActiveAnnotation(null);
    setAnnotationsOpen(false);
    setCommentVisibility("open");
    setAnnotateMode(true);
  }, []);

  const selectReviewMode = (mode: CanvasMarkupMode) => {
    preservePlanReaderScroll(() => {
      if (mode !== "comment") {
        closeInlineComment();
        setCanvasMarkupMode("none");
        setAnnotateMode(false);
        return;
      }
      startCommenting();
    });
  };

  useEffect(() => {
    if (reviewMode === "none") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeInlineComment();
      setActiveAnnotation(null);
      setAnnotationsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeInlineComment, reviewMode]);

  const scheduleNativeMarkerUpdate = useCallback(() => {
    if (nativeScrollFrameRef.current !== null) return;
    nativeScrollFrameRef.current = requestAnimationFrame(() => {
      nativeScrollFrameRef.current = null;
      setNativeMarkerVersion((version) => version + 1);
      setActiveAnnotation((current) => {
        if (!current) return current;
        const position = getPositionFromAnchor(current.annotation.anchor);
        return position ? { ...current, position } : current;
      });
    });
  }, [getPositionFromAnchor]);

  useEffect(
    () => () => {
      if (nativeScrollFrameRef.current !== null) {
        cancelAnimationFrame(nativeScrollFrameRef.current);
        nativeScrollFrameRef.current = null;
      }
    },
    [],
  );

  const handleNativeReaderScroll = () => {
    documentStateRef.current = readNativeDocumentState();
    setNativeSelectionComment(null);
    scheduleNativeMarkerUpdate();
  };

  const readNativeSelectionComment =
    useCallback((): NativeSelectionComment | null => {
      const reader = nativeReaderRef.current;
      const selection = window.getSelection();
      if (!reader || !selection || selection.rangeCount === 0) return null;
      if (selection.isCollapsed) return null;
      const textQuote = selection.toString().replace(/\s+/g, " ").trim();
      if (!textQuote) return null;
      const range = selection.getRangeAt(0);
      if (!reader.contains(range.commonAncestorContainer)) return null;

      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      const selectionRect = rects[0] ?? range.getBoundingClientRect();
      if (selectionRect.width <= 0 || selectionRect.height <= 0) return null;

      const readerRect = reader.getBoundingClientRect();
      const pointX =
        selectionRect.left + selectionRect.width / 2 - readerRect.left;
      const pointY =
        selectionRect.top + selectionRect.height / 2 - readerRect.top;
      const startElement =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const blockElement =
        startElement?.closest<HTMLElement>("[data-block-id]");
      const blockType = blockElement?.dataset.blockId
        ? findPlanBlockById(
            bundle?.plan.content?.blocks ?? [],
            blockElement.dataset.blockId,
          )?.type
        : undefined;
      const quoteContext = textQuoteContextForBlock({
        block: blockElement,
        quote: textQuote,
      });
      const snippet = textQuote.slice(0, 220);
      const anchor = {
        ...buildNativeAnchorFromElement({
          reader,
          target: startElement instanceof HTMLElement ? startElement : reader,
          pointX,
          pointY,
          planTitle: bundle?.plan.title,
        }),
        snippet,
        textQuote: snippet,
        anchorKind: "text",
        tagName: "selection",
        blockType,
        ...quoteContext,
      } satisfies PlanAnnotationAnchor;
      const toolbarWidth = 132;
      const toolbarLeft = clamp(
        pointX - toolbarWidth / 2,
        12,
        Math.max(12, readerRect.width - toolbarWidth - 12),
      );
      const toolbarTop = clamp(
        selectionRect.top - readerRect.top - 48,
        12,
        Math.max(12, readerRect.height - 48),
      );
      return {
        anchor,
        toolbarLeft,
        toolbarTop,
        position:
          getPositionFromAnchor(anchor) ??
          resolveInlineCommentPosition({
            pointX,
            pointY,
            viewportWidth: readerRect.width,
            viewportHeight: readerRect.height,
          }),
      };
    }, [
      bundle?.plan.content?.blocks,
      bundle?.plan.title,
      getPositionFromAnchor,
    ]);

  const openNativeSelectionComment = useCallback(
    (selectionComment: NativeSelectionComment) => {
      documentStateRef.current = readNativeDocumentState();
      setCanvasMarkupMode("none");
      setActiveAnnotation(null);
      setAnnotationsOpen(false);
      setCommentVisibility("open");
      setAnnotateMode(true);
      setPendingAnnotation(selectionComment.anchor);
      setInlineCommentPosition(selectionComment.position);
      setNativeSelectionComment(null);
      window.getSelection()?.removeAllRanges();
    },
    [readNativeDocumentState],
  );

  const beginNativeSelectionComment = () => {
    if (!nativeSelectionComment) return;
    openNativeSelectionComment(nativeSelectionComment);
  };

  useEffect(() => {
    if (!bundle) return;
    const handleCommentShortcut = (event: KeyboardEvent) => {
      if (!shouldHandlePlanCommentShortcut(event)) return;
      event.preventDefault();
      preservePlanReaderScroll(() => {
        const selectionComment = readNativeSelectionComment();
        if (selectionComment) {
          openNativeSelectionComment(selectionComment);
          return;
        }
        startCommenting();
      });
    };
    window.addEventListener("keydown", handleCommentShortcut);
    return () => window.removeEventListener("keydown", handleCommentShortcut);
  }, [
    bundle,
    openNativeSelectionComment,
    preservePlanReaderScroll,
    readNativeSelectionComment,
    startCommenting,
  ]);

  const handleNativeReaderPointerDown = (
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-plan-interactive]")) return;
    // Clear any previous selection comment tooltip on pointer-down so it
    // doesn't linger while a new selection gesture starts.
    setNativeSelectionComment(null);
    if (!annotateMode) return;
    nativeCommentPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };

  const handleNativeReaderPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-plan-interactive]")) return;
    const reader = nativeReaderRef.current;
    if (!reader) return;
    // Text-selection "Comment" affordance: show the floating button whenever
    // the user finishes a selection inside the reader, even outside annotate
    // mode. Click-to-place annotations (the else branch) remain annotate-mode
    // only because they don't have a visible target without the full review UI.
    const selectionComment = readNativeSelectionComment();
    if (selectionComment) {
      event.preventDefault();
      setActiveAnnotation(null);
      setAnnotationsOpen(false);
      setNativeSelectionComment(selectionComment);
      return;
    }
    if (!annotateMode) return;
    const start = nativeCommentPointerRef.current;
    nativeCommentPointerRef.current = null;
    if (
      start &&
      Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >
        8
    ) {
      return;
    }
    const rect = reader.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    const anchor = buildNativeAnchorFromElement({
      reader,
      target,
      pointX,
      pointY,
      planTitle: bundle?.plan.title,
    });
    documentStateRef.current = readNativeDocumentState();
    const fallbackPosition = resolveInlineCommentPosition({
      pointX,
      pointY,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
    setActiveAnnotation(null);
    setPendingAnnotation(anchor);
    setInlineCommentPosition(getPositionFromAnchor(anchor) ?? fallbackPosition);
  };

  const updateStructuredContent = async (content: PlanContent) => {
    if (!bundle) return;
    if (localPlanMode) {
      if (!localPlanSlug || localPlanBridgeUrl) return;
      await updateLocalPlan.mutateAsync({
        slug: localPlanSlug,
        ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
        content,
        note: "Updated local structured visual plan content.",
      });
      return;
    }
    await updatePlan.mutateAsync({
      planId: bundle.plan.id,
      content,
      note: "Updated structured visual plan content.",
    });
  };

  const patchStructuredContent = async (patch: PlanContentPatch) => {
    if (!bundle) return;
    // For background autosave (replace-blocks) ops, suppress the global
    // onError toast so the autosave loop's backoff+pill handles error state
    // instead of spamming toast.error on every retry.
    const silentError = patch.op === "replace-blocks";
    try {
      if (localPlanMode) {
        if (!localPlanSlug || localPlanBridgeUrl) return;
        await updateLocalPlan.mutateAsync(
          {
            slug: localPlanSlug,
            ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
            contentPatches: [patch],
            note:
              patch.op === "update-rich-text"
                ? `Edited local markdown block ${patch.blockId}.`
                : "Patched local structured visual plan content.",
          },
          silentError ? { onError: () => {} } : undefined,
        );
        return;
      }
      await updatePlan.mutateAsync(
        {
          planId: bundle.plan.id,
          contentPatches: [patch],
          note:
            patch.op === "update-rich-text"
              ? `Edited markdown block ${patch.blockId}.`
              : "Patched structured visual plan content.",
        },
        silentError ? { onError: () => {} } : undefined,
      );
    } catch (error) {
      // Re-throw so the autosave backoff loop in PlanContentRenderer can handle
      // retries. The global onError toast was already suppressed above.
      throw error;
    }
  };

  const updatePlanMetadata = async (patch: {
    title?: string;
    brief?: string;
  }) => {
    if (!bundle) return;
    if (localPlanMode) {
      if (!localPlanSlug || localPlanBridgeUrl) return;
      await updateLocalPlan.mutateAsync({
        slug: localPlanSlug,
        ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
        contentPatches: [{ op: "set-metadata", ...patch }],
        note: "Updated local plan title and brief.",
      });
      return;
    }
    await updatePlan.mutateAsync({
      planId: bundle.plan.id,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
      contentPatches: [{ op: "set-metadata", ...patch }],
      note: "Updated plan title and brief.",
    });
  };

  const appendCanvasMarkup = async (
    annotation: Omit<PlanAnnotation, "id">,
    context: CanvasMarkupCreateContext,
  ) => {
    if (!bundle?.plan.content?.canvas) return;
    const nextAnnotation: PlanAnnotation = {
      id: newCanvasMarkupId(),
      ...annotation,
    };
    const anchor: PlanAnnotationAnchor = {
      ...context.anchor,
      planAnnotationId: nextAnnotation.id,
      markupType: context.anchor.markupType,
      resolutionTarget: "agent",
      targetKind: "canvas",
      targetSelector: "[data-plan-canvas-world]",
      targetX: context.anchor.x,
      targetY: context.anchor.y,
      targetLabel:
        nextAnnotation.type === "callout" ? "Canvas callout" : "Canvas note",
      targetText: nextAnnotation.text,
      visualContext:
        nextAnnotation.type === "callout"
          ? "Reviewer drew an arrow callout on the canvas."
          : "Reviewer placed a text note on the canvas.",
    };
    await updatePlan.mutateAsync({
      planId: bundle.plan.id,
      contentPatches: [
        {
          op: "append-canvas-annotation",
          annotation: nextAnnotation,
        },
      ],
      comments: [
        {
          kind: "annotation",
          status: "open",
          message: buildCanvasMarkupFeedbackMessage(nextAnnotation),
          anchor: JSON.stringify(anchor),
          createdBy: "human",
          authorEmail: collabUser?.email,
          authorName: collabUser?.name,
        },
      ],
      note: "Human added canvas review markup.",
    });
    toast.success(
      nextAnnotation.type === "callout" ? "Callout added" : "Note added",
    );
  };

  const togglePlansAgent = () => {
    preservePlanReaderScroll(() => {
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
    });
  };

  const captureFocusedFeedbackImages = async (threads: CommentThread[]) => {
    const reader = nativeReaderRef.current;
    const surface = reader?.parentElement;
    if (!reader || !surface) {
      return { images: [] as string[], note: "" };
    }
    const allEligible = threads
      .filter((thread) => shouldCaptureAnchor(thread.anchor))
      .sort(
        (a, b) => feedbackScreenshotPriority(b) - feedbackScreenshotPriority(a),
      );
    const eligible = allEligible.slice(0, MAX_FEEDBACK_SCREENSHOTS);
    const overflow = allEligible.slice(MAX_FEEDBACK_SCREENSHOTS);
    if (eligible.length === 0) {
      return { images: [] as string[], note: "" };
    }

    const restore = readNativeDocumentState();
    const images: string[] = [];
    const labels: string[] = [];
    try {
      for (const [index, thread] of eligible.entries()) {
        const anchor = thread.anchor;
        if (!anchor) continue;
        const target = resolveNativeAnchorTarget(anchor, reader);
        if (!target && prototypeScreenIdForAnchor(anchor)) continue;
        const readerRectBeforeScroll = reader.getBoundingClientRect();
        const targetRect = target?.getBoundingClientRect();
        const pointInReader = targetRect
          ? {
              left:
                targetRect.left -
                readerRectBeforeScroll.left +
                reader.scrollLeft +
                ((anchor.targetX ?? anchor.visualX ?? 50) / 100) *
                  targetRect.width,
              top:
                targetRect.top -
                readerRectBeforeScroll.top +
                reader.scrollTop +
                ((anchor.targetY ?? anchor.visualY ?? 50) / 100) *
                  targetRect.height,
            }
          : {
              left: (anchor.x / 100) * reader.scrollWidth,
              top: (anchor.y / 100) * reader.scrollHeight,
            };
        reader.scrollTo({
          left: clamp(
            pointInReader.left - reader.clientWidth / 2,
            0,
            Math.max(0, reader.scrollWidth - reader.clientWidth),
          ),
          top: clamp(
            pointInReader.top - reader.clientHeight / 2,
            0,
            Math.max(0, reader.scrollHeight - reader.clientHeight),
          ),
          behavior: "auto",
        });
        await nextFrame();
        await nextFrame();
        setNativeMarkerVersion((version) => version + 1);
        const point = nativePointForAnchor(anchor, reader);
        const surfaceRect = surface.getBoundingClientRect();
        const readerRect = reader.getBoundingClientRect();
        const pointX = readerRect.left - surfaceRect.left + point.left;
        const pointY = readerRect.top - surfaceRect.top + point.top;
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(surface, {
          backgroundColor: null,
          logging: false,
          scale: Math.min(2, window.devicePixelRatio || 1),
          useCORS: true,
          width: surface.clientWidth,
          height: surface.clientHeight,
          onclone: (clonedDocument) => {
            const clonedReader =
              clonedDocument.querySelector("[data-plan-reader]");
            const clonedSurface = clonedReader?.parentElement;
            if (!(clonedSurface instanceof HTMLElement)) return;
            clonedSurface.setAttribute("data-plan-feedback-capture", "true");
            const style = clonedDocument.createElement("style");
            style.textContent = `
              [data-plan-feedback-capture] {
                --background: #ffffff !important;
                --foreground: #18181b !important;
                --muted: #f4f4f5 !important;
                --muted-foreground: #71717a !important;
                --border: #d4d4d8 !important;
                --ring: #71717a !important;
                --plan-document: #ffffff !important;
                --plan-text: #18181b !important;
                --plan-muted: #71717a !important;
                --plan-line: #d4d4d8 !important;
                --plan-chrome: #ffffff !important;
                --plan-canvas: #f4f4f5 !important;
                --plan-grid-line: #e4e4e7 !important;
              }
              [data-plan-feedback-capture],
              [data-plan-feedback-capture] * {
                color: #18181b !important;
                border-color: #d4d4d8 !important;
                outline-color: #71717a !important;
                text-decoration-color: #18181b !important;
                caret-color: #18181b !important;
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
                box-shadow: none !important;
                text-shadow: none !important;
              }
              [data-plan-feedback-capture] {
                background: #ffffff !important;
              }
              [data-plan-feedback-capture] svg,
              [data-plan-feedback-capture] svg * {
                fill: currentColor !important;
                stroke: currentColor !important;
              }
            `;
            clonedDocument.head.appendChild(style);
          },
        });
        const label = `Comment ${index + 1}: ${thread.id}`;
        const dataUrl = cropFeedbackScreenshot({
          canvas,
          surfaceWidth: surface.clientWidth,
          surfaceHeight: surface.clientHeight,
          pointX,
          pointY,
          label,
        });
        if (dataUrl) {
          images.push(dataUrl);
          labels.push(`${label} — ${formatAnchorForAgent(anchor)}`);
        }
      }
    } finally {
      restoreNativeDocumentScroll(restore);
      schedulePlanDocumentRestore(restore);
    }

    const overflowLabels = overflow
      .slice(0, 12)
      .map(
        (thread) =>
          `- ${thread.id}: ${formatAnchorForAgent(thread.anchor)} (${planCommentAnchorDetails(
            thread.anchor,
          ).join("; ")})`,
      );
    const note = [
      images.length
        ? `Attached ${images.length} focused screenshot crop(s):`
        : "",
      ...labels.map((label) => `- ${label}`),
      overflow.length > 0
        ? localPlanMode
          ? `- ${overflow.length} additional visual comment(s) exceeded the screenshot budget. Use comments.json anchor details/coordinates for these overflow comments:`
          : `- ${overflow.length} additional visual comment(s) exceeded the screenshot budget. Use get-plan-feedback anchorDetails/coordinates for these overflow comments:`
        : "",
      ...overflowLabels,
    ]
      .filter(Boolean)
      .join("\n");
    return { images, note };
  };

  const sendPlanFeedbackToInlineAgent = async () => {
    if (!bundle) return;
    const openCommentCount = bundle.summary.openCommentCount;
    if (openCommentCount === 0) {
      startCommenting();
      return;
    }
    setSendingFeedback(true);
    try {
      const openThreads = commentThreads.filter(
        (thread) => commentThreadStatus(thread) === "open",
      );
      const capture = await captureFocusedFeedbackImages(openThreads);
      const recapBase = bundle.plan.kind === "recap" ? "recaps" : "plans";
      const reviewPath = `/${recapBase}/${selectedId ?? bundle.plan.id}`;
      const context = buildPlanAgentContext({
        bundle,
        documentHtml,
        url:
          typeof window === "undefined"
            ? appPath(reviewPath)
            : `${window.location.origin}${appPath(reviewPath)}`,
        screenshotNote: capture.note,
      });
      sendToAgentChat({
        type: "content",
        submit: true,
        chatTarget: "local",
        openSidebar: true,
        context,
        images: capture.images,
        message: buildApplyFeedbackMessage(openCommentCount, {
          local: localPlanMode,
        }),
      });
      toast.success(
        capture.images.length > 0
          ? t("plansPage.reader.sentCommentsWithScreenshots")
          : t("plansPage.reader.sentComments"),
      );
    } catch (error) {
      console.error(
        "[PlansPage] Failed to send plan feedback to inline agent:",
        error,
      );
      toast.error(t("plansPage.comments.sendFailed"));
    } finally {
      setSendingFeedback(false);
    }
  };

  const copyPlanFeedbackForAgent = async () => {
    if (!bundle) return;
    const openCommentCount = bundle.summary.openCommentCount;
    if (openCommentCount === 0) {
      startCommenting();
      return;
    }
    await navigator.clipboard.writeText(
      [
        buildApplyFeedbackMessage(openCommentCount, { local: localPlanMode }),
        "",
        planAgentContext,
      ].join("\n"),
    );
    toast.success(t("plansPage.reader.feedbackCopied"));
  };

  // Route comment writes to the DB (hosted) or comments.json (local); both
  // return the same bundle shape.
  const writeComments = async (
    comments: PlanCommentInput[],
    note: string,
  ): Promise<PlanBundleWithHtml> => {
    if (localPlanMode && localPlanBridgeUrl) {
      setLocalBridgeCommentPending(true);
      try {
        return await updateLocalPlanBridgeComments(
          localPlanBridgeUrl,
          localPlanSlug ?? "",
          { comments },
        );
      } finally {
        setLocalBridgeCommentPending(false);
      }
    }
    if (localPlanMode) {
      return updateLocalCommentMutation.mutateAsync({
        slug: localPlanSlug ?? "",
        ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
        comments,
      }) as Promise<PlanBundleWithHtml>;
    }
    if (!bundle) return Promise.reject(new Error("No plan loaded."));
    return updateCommentMutation.mutateAsync({
      planId: bundle.plan.id,
      comments,
      note,
    }) as Promise<PlanBundleWithHtml>;
  };
  const removeCommentById = async (commentId: string): Promise<void> => {
    if (localPlanMode && localPlanBridgeUrl) {
      setLocalBridgeCommentPending(true);
      try {
        const updated = await updateLocalPlanBridgeComments(
          localPlanBridgeUrl,
          localPlanSlug ?? "",
          { deletedCommentIds: [commentId] },
        );
        if (selectedPlanQueryKey) {
          queryClient.setQueryData(selectedPlanQueryKey, updated);
        }
      } finally {
        setLocalBridgeCommentPending(false);
      }
      return;
    }
    if (localPlanMode) {
      await updateLocalCommentMutation.mutateAsync({
        slug: localPlanSlug ?? "",
        ...(localPlanRepoPath ? { path: localPlanRepoPath } : {}),
        deletedCommentIds: [commentId],
      });
      return;
    }
    if (!bundle) return;
    await deleteCommentMutation.mutateAsync({
      planId: bundle.plan.id,
      commentId,
    });
  };
  const commentWritePending =
    updateCommentMutation.isPending ||
    updateLocalCommentMutation.isPending ||
    localBridgeCommentPending;
  const commentDeletePending =
    deleteCommentMutation.isPending ||
    updateLocalCommentMutation.isPending ||
    localBridgeCommentPending;

  const submitInlineComment = async (draft: CommentDraft) => {
    if (!bundle || !pendingAnnotation || !selectedPlanQueryKey) return;
    // Capture the current position before clearing (used to restore on failure).
    const capturedPosition = inlineCommentPosition;
    const anchor: PlanAnnotationAnchor = {
      ...pendingAnnotation,
      resolutionTarget: draft.resolutionTarget,
      mentions: draft.mentions,
    };
    const sectionId =
      anchor.sectionId &&
      bundle.sections.some((section) => section.id === anchor.sectionId)
        ? anchor.sectionId
        : undefined;
    const anchorJson = JSON.stringify(anchor);
    const commentId = newCommentId();
    const now = new Date().toISOString();
    const commentInput: PlanCommentInput = {
      id: commentId,
      kind: "annotation",
      status: "open",
      message: draft.message,
      sectionId,
      anchor: anchorJson,
      createdBy: "human",
      authorEmail: collabUser?.email,
      authorName: collabUser?.name,
      resolutionTarget: draft.resolutionTarget,
      mentions: draft.mentions,
    };
    const optimisticComment: PlanCommentItem = {
      id: commentId,
      planId: bundle.plan.id,
      parentCommentId: null,
      sectionId: sectionId ?? null,
      kind: "annotation",
      status: "open",
      anchor: anchorJson,
      message: draft.message,
      createdBy: "human",
      authorEmail: collabUser?.email ?? null,
      authorName: collabUser?.name ?? null,
      resolutionTarget: draft.resolutionTarget,
      mentions: draft.mentions,
      mentionsJson:
        draft.mentions.length > 0 ? JSON.stringify(draft.mentions) : null,
      resolvedBy: null,
      resolvedAt: null,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    clearPendingDocumentRestore();
    pendingDocumentRestoreRef.current = documentStateRef.current;
    // Await the cancel so an in-flight sync refresh can't resolve *after* our
    // optimistic write and revert it (the "comment lagged / didn't stick"
    // symptom). cancelQueries reverts outstanding fetches before we patch.
    await queryClient.cancelQueries({ queryKey: selectedPlanQueryKey });
    queryClient.setQueryData(
      selectedPlanQueryKey,
      (current: PlanBundleWithHtml | undefined) =>
        current ? addPlanCommentToBundle(current, optimisticComment) : current,
    );
    setFailedCommentDraft(null);
    clearInlineCommentDraft();
    setAnnotateMode(true);
    void writeComments(
      [commentInput],
      "Human added inline visual plan feedback.",
    )
      .then((updated) => {
        queryClient.setQueryData(selectedPlanQueryKey, updated);
        expirePendingDocumentRestore();
      })
      .catch(() => {
        queryClient.setQueryData(
          selectedPlanQueryKey,
          (current: PlanBundleWithHtml | undefined) =>
            current
              ? removePlanCommentFromBundle(current, optimisticComment.id)
              : current,
        );
        clearPendingDocumentRestore();
        // Restore the draft so the reviewer doesn't lose their typed text.
        // Re-open the composer at the same anchor with the original draft
        // pre-filled (Issue 2a).
        setFailedCommentDraft(draft);
        setPendingAnnotation(anchor);
        setInlineCommentPosition(
          getPositionFromAnchor(anchor) ?? capturedPosition,
        );
      });
  };

  const updateAnnotationComment = (
    annotation: RuntimeAnnotation,
    message: string,
  ) => {
    if (!bundle) return;
    const anchor: PlanAnnotationAnchor = {
      ...annotation.anchor,
      mentions: extractCommentMentions(message),
      resolutionTarget: normalizePlanCommentResolutionTarget(
        annotation.anchor.resolutionTarget,
      ),
    };
    void writeComments(
      [
        {
          id: annotation.id,
          kind: annotation.kind as PlanBundle["comments"][number]["kind"],
          status: annotation.status as PlanBundle["comments"][number]["status"],
          message,
          sectionId: annotation.sectionId ?? anchor.sectionId,
          anchor: JSON.stringify(anchor),
          createdBy: "human",
          authorEmail: collabUser?.email,
          authorName: collabUser?.name,
        },
      ],
      "Human edited visual plan feedback.",
    )
      .then(() => {
        setActiveAnnotation(null);
        toast.success(t("plansPage.comments.commentUpdated"));
      })
      .catch(() => {
        // The mutation hook surfaces the failure toast; just clear pending.
      });
  };

  const replyToCommentThread = async (
    threadRootId: string,
    message: string,
  ) => {
    if (!bundle || !selectedPlanQueryKey) return;
    const thread = commentThreads.find((item) => item.id === threadRootId);
    if (!thread) {
      throw new Error("Comment thread is no longer available.");
    }
    // Optimistic reply: insert into cache immediately so the UI updates
    // before the server round-trip completes (Issue 3).
    const replyId = newCommentId();
    const now = new Date().toISOString();
    const optimisticReply: PlanCommentItem = {
      id: replyId,
      planId: bundle.plan.id,
      parentCommentId: thread.root.id,
      sectionId: thread.root.sectionId ?? null,
      kind: thread.root.kind,
      status: "open",
      anchor: thread.root.anchor ?? null,
      message,
      createdBy: "human",
      authorEmail: collabUser?.email ?? null,
      authorName: collabUser?.name ?? null,
      resolutionTarget: thread.root.resolutionTarget ?? null,
      mentions: [],
      mentionsJson: null,
      resolvedBy: null,
      resolvedAt: null,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // Await the cancel so an in-flight sync refresh can't resolve *after* our
    // optimistic write and revert it (the "comment lagged / didn't stick"
    // symptom). cancelQueries reverts outstanding fetches before we patch.
    await queryClient.cancelQueries({ queryKey: selectedPlanQueryKey });
    queryClient.setQueryData(
      selectedPlanQueryKey,
      (current: PlanBundleWithHtml | undefined) =>
        current ? addPlanCommentToBundle(current, optimisticReply) : current,
    );
    try {
      const updated = await writeComments(
        [
          {
            parentCommentId: thread.root.id,
            kind: thread.root.kind,
            status: "open",
            message,
            sectionId: thread.root.sectionId ?? undefined,
            anchor: thread.root.anchor ?? undefined,
            createdBy: "human",
            authorEmail: collabUser?.email,
            authorName: collabUser?.name,
          },
        ],
        "Human replied to visual plan feedback.",
      );
      // Replace optimistic entry with the authoritative server response.
      if (selectedPlanQueryKey) {
        queryClient.setQueryData(selectedPlanQueryKey, updated);
      }
      toast.success(t("plansPage.comments.replyAdded"));
    } catch {
      // Roll back the optimistic reply on error.
      queryClient.setQueryData(
        selectedPlanQueryKey,
        (current: PlanBundleWithHtml | undefined) =>
          current ? removePlanCommentFromBundle(current, replyId) : current,
      );
      throw new Error("Could not send reply. Try again.");
    }
  };

  const setCommentThreadStatus = async (
    threadRootId: string,
    status: PlanBundle["comments"][number]["status"],
    fallbackAnchor?: PlanAnnotationAnchor | null,
  ) => {
    if (!bundle || !canResolveCommentThreads || !selectedPlanQueryKey) return;
    const thread = commentThreads.find((item) => item.id === threadRootId);
    if (!thread) return;
    const fallbackAnchorJson = fallbackAnchor
      ? JSON.stringify(fallbackAnchor)
      : undefined;
    // Optimistic status flip: update the cache immediately so the marker and
    // popover update without waiting for the server round-trip (Issue 3).
    const prevBundle =
      queryClient.getQueryData<PlanBundleWithHtml>(selectedPlanQueryKey);
    // Await the cancel so an in-flight sync refresh can't resolve *after* our
    // optimistic write and revert it (the "comment lagged / didn't stick"
    // symptom). cancelQueries reverts outstanding fetches before we patch.
    await queryClient.cancelQueries({ queryKey: selectedPlanQueryKey });
    queryClient.setQueryData(
      selectedPlanQueryKey,
      (current: PlanBundleWithHtml | undefined) => {
        if (!current) return current;
        return withPlanComments(
          current,
          current.comments.map((comment) =>
            thread.comments.some((tc) => tc.id === comment.id)
              ? { ...comment, status }
              : comment,
          ),
        );
      },
    );
    setActiveAnnotation(null);
    void writeComments(
      thread.comments.map((comment) => ({
        id: comment.id,
        kind: comment.kind,
        status,
        message: comment.message,
        sectionId: comment.sectionId ?? undefined,
        anchor: comment.anchor ?? fallbackAnchorJson,
        createdBy: "human",
        authorEmail: collabUser?.email,
        authorName: collabUser?.name,
      })),
      status === "resolved"
        ? "Human resolved visual plan feedback."
        : "Human reopened visual plan feedback.",
    )
      .then(() => {
        toast.success(
          status === "resolved"
            ? t("plansPage.comments.commentResolved")
            : t("plansPage.comments.commentReopened"),
        );
      })
      .catch(() => {
        // Roll back the optimistic status change.
        if (prevBundle !== undefined) {
          queryClient.setQueryData(selectedPlanQueryKey, prevBundle);
        }
      });
  };

  const requestDeleteComment = (thread: CommentThread, commentId: string) => {
    const target = thread.comments.find((comment) => comment.id === commentId);
    if (!target || !canDeletePlanComment(target)) return;
    setDeleteCommentRequest({
      commentId,
      replyCount: commentDescendantCount(thread.comments, commentId),
    });
  };

  const requestDeleteCommentThread = (thread: CommentThread) => {
    requestDeleteComment(thread, thread.root.id);
  };

  const confirmDeleteCommentThread = async () => {
    if (!bundle || !selectedPlanQueryKey || !deleteCommentRequest) return;
    const request = deleteCommentRequest;
    const prevBundle =
      queryClient.getQueryData<PlanBundleWithHtml>(selectedPlanQueryKey);
    const commentId = request.commentId;
    // Await the cancel so an in-flight sync refresh can't resolve *after* our
    // optimistic write and revert it (the "comment lagged / didn't stick"
    // symptom). cancelQueries reverts outstanding fetches before we patch.
    await queryClient.cancelQueries({ queryKey: selectedPlanQueryKey });
    queryClient.setQueryData(
      selectedPlanQueryKey,
      (current: PlanBundleWithHtml | undefined) =>
        current
          ? removePlanCommentThreadFromBundle(current, commentId)
          : current,
    );
    setActiveAnnotation((current) =>
      current?.annotation.id === commentId ? null : current,
    );
    setDeleteCommentRequest(null);
    try {
      await removeCommentById(commentId);
      toast.success(t("plansPage.comments.commentDeleted"));
    } catch (error) {
      if (prevBundle !== undefined) {
        queryClient.setQueryData(selectedPlanQueryKey, prevBundle);
      }
      setDeleteCommentRequest(request);
    }
  };

  const nativeMarkerPosition = (anchor: PlanAnnotationAnchor) => {
    void nativeMarkerVersion;
    const reader = nativeReaderRef.current;
    if (!reader) return null;
    const placement = nativeMarkerPlacementForAnchor(anchor, reader);
    if (!placement) return null;
    const { left, top } = placement.clip
      ? {
          left: placement.clip.left + placement.marker.left,
          top: placement.clip.top + placement.marker.top,
        }
      : placement.marker;
    if (
      left < -40 ||
      top < -40 ||
      left > reader.clientWidth + 40 ||
      top > reader.clientHeight + 40
    ) {
      return null;
    }
    return placement;
  };
  const pendingMarkerPlacement =
    pendingAnnotation && inlineCommentPosition
      ? nativeMarkerPosition(pendingAnnotation)
      : null;
  const pendingVisualSurfaceMode =
    visualSurfaceModeForAnchor(pendingAnnotation);
  const pendingCommentPin =
    pendingAnnotation && inlineCommentPosition ? (
      pendingMarkerPlacement || !pendingVisualSurfaceMode ? (
        <div
          className={cn(
            "pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center",
            !pendingMarkerPlacement?.clip && "z-20",
          )}
          style={
            pendingMarkerPlacement?.marker ?? {
              left: inlineCommentPosition.pinLeft,
              top: inlineCommentPosition.pinTop,
            }
          }
        >
          <CommentAvatar
            author={pendingCommentAuthor}
            size="pin"
            className="shadow-2xl shadow-black/35"
          />
        </div>
      ) : null
    ) : null;

  return (
    <div
      className="plans-workspace flex h-full min-h-0 flex-col overflow-hidden bg-background"
      style={recapScreenshotBackgroundStyle}
    >
      <div
        className="plans-grid flex min-h-0 flex-1"
        data-view={immersiveReader ? "immersive" : "app"}
      >
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!selectedId ? (
            <PlansOverview
              plans={plans}
              isLoading={sessionLoading || plansQuery.isLoading}
              isError={plansQuery.isError}
              onRetry={() => void plansQuery.refetch()}
              viewerEmail={session?.email ?? null}
              onCreate={requestCreatePlan}
              canCreate={Boolean(session)}
              onArchive={handleArchivePlan}
              onDelete={requestDeletePlan}
              onRestore={(plan) =>
                void confirmDeletePlan(
                  { planId: plan.id, mode: "restore" },
                  plan,
                )
              }
              onSignIn={() => openSignIn()}
            />
          ) : showLocalPlanConnection ? (
            <LocalPlanConnection
              permissionState={
                localNetworkPermission === "denied" ? "denied" : "prompt"
              }
              onConnect={() => setLocalBridgeConnectionRequested(true)}
              onRetry={() => void checkLocalNetworkPermission()}
            />
          ) : showLocalPlanLoadError ? (
            <LocalPlanLoadError
              error={localPlanError}
              slug={localPlanSlug ?? ""}
              onRetry={() => void refetchLocalPlan()}
            />
          ) : showPlanLoadError ? (
            <PlanLoadError
              error={planQuery.error}
              planId={selectedId}
              accessStatus={planAccessStatus}
              onRetry={() => void planQuery.refetch()}
              onSignIn={() => openSignIn()}
              onGoogleSignIn={startGoogleSignIn}
              onRequestAccess={requestPlanAccess}
              requestAccessPending={requestPlanAccessMutation.isPending}
              accessRequestSent={accessRequestSentPlanId === selectedId}
              viewerEmail={session?.email ?? null}
            />
          ) : showInitialPlanSkeleton ? (
            <PlanSkeleton isRecap={location.pathname.includes("/recaps/")} />
          ) : (
            <div
              className="relative min-h-0 flex-1 overflow-hidden bg-background"
              style={recapScreenshotBackgroundStyle}
            >
              {immersiveReader &&
                !recapScreenshotMode &&
                !showingPrototypeSurface && (
                  <div className="pointer-events-none absolute left-3 top-3 z-10">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="pointer-events-auto size-8 rounded-lg border border-border/70 bg-background/82 shadow-2xl backdrop-blur-xl"
                          onClick={() => {
                            if (session) {
                              navigate("/plans");
                            } else {
                              window.location.href = appPath("/plans");
                            }
                          }}
                          aria-label={t("plansPage.reader.backToPlans")}
                        >
                          <IconArrowLeft className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("plansPage.reader.backToPlans")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              <div
                hidden={recapScreenshotMode}
                className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/82 p-1 shadow-2xl backdrop-blur-xl"
                onPointerDownCapture={preservePlanReaderScrollAfterToolbarEvent}
                onKeyDownCapture={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    preservePlanReaderScrollAfterToolbarEvent();
                  }
                }}
              >
                {localPlanMode && <LocalModeBadge />}
                {!localPlanMode && (
                  <PlanShareControl
                    planId={bundle.plan.id}
                    planTitle={bundle.plan.title}
                    isRecap={isRecap}
                    localShareUrl={planShareUrl}
                    hostedPlanId={bundle.plan.hostedPlanId}
                    hostedPlanUrl={bundle.plan.hostedPlanUrl}
                    onOpenChange={(open) => {
                      if (open) closeInlineComment();
                    }}
                  />
                )}
                {canReportPlan && (
                  <PlanReportControl
                    planId={bundle.plan.id}
                    planTitle={bundle.plan.title}
                    isRecap={isRecap}
                    onOpenChange={(open) => {
                      if (open) closeInlineComment();
                    }}
                  />
                )}
                {!localPlanMode && (
                  <ReviewMarkupToolbar
                    mode={reviewMode}
                    onModeChange={selectReviewMode}
                  />
                )}
                {bundle.plan.content?.prototype && showingPrototypeSurface && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="pointer-events-auto size-8"
                        onClick={() =>
                          preservePlanReaderScroll(() => {
                            if (prototypeOnly) {
                              leavePrototypeOnlyMode();
                            } else {
                              openPrototypeWindow();
                            }
                          })
                        }
                        aria-label={
                          prototypeOnly
                            ? t("plansPage.reader.openFullPlan")
                            : t("plansPage.reader.openPrototypeWindow")
                        }
                      >
                        <IconExternalLink className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {prototypeOnly
                        ? t("plansPage.reader.openFullPlan")
                        : t("plansPage.reader.openPrototypeWindow")}
                    </TooltipContent>
                  </Tooltip>
                )}
                {bundle.summary.openCommentCount > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="pointer-events-auto gap-1.5"
                        disabled={sendingFeedback}
                      >
                        {sendingFeedback
                          ? t("plansPage.reader.sending")
                          : t("plansPage.reader.sendToAgent")}
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
                      <DropdownMenuLabel>
                        {t("plansPage.reader.sendFeedback")}
                      </DropdownMenuLabel>
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            preservePlanReaderScroll(() => {
                              void copyPlanFeedbackForAgent();
                            })
                          }
                          className="items-start gap-2"
                        >
                          <IconClipboardText className="mt-0.5 size-4" />
                          <span className="grid gap-0.5">
                            <span>{t("plansPage.reader.copyForAgent")}</span>
                            <span className="text-xs font-normal leading-4 text-muted-foreground">
                              {t("plansPage.reader.copyForAgentDescription")}
                            </span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            preservePlanReaderScroll(() => {
                              void sendPlanFeedbackToInlineAgent();
                            })
                          }
                          className="items-start gap-2"
                          disabled={sendingFeedback}
                        >
                          <IconSend className="mt-0.5 size-4" />
                          <span className="grid gap-0.5">
                            <span>
                              {t("plansPage.reader.sendToInlineAgent")}
                            </span>
                            <span className="text-xs font-normal leading-4 text-muted-foreground">
                              {t(
                                "plansPage.reader.sendToInlineAgentDescription",
                              )}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {ENABLE_PLAN_STATUS_FEATURE && !localPlanMode && !isRecap && (
                  <PlanStatusControl
                    planId={bundle.plan.id}
                    status={bundle.plan.status}
                    canEdit={canEditPlanContent}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="pointer-events-auto size-8"
                      data-plan-actions-trigger
                      aria-label={t("plansPage.overview.planActions")}
                    >
                      <IconDotsVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-xl">
                    {localPlanMode && (
                      <>
                        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                          {t("plansPage.reader.localFiles")}
                        </DropdownMenuLabel>
                        <div className="px-2 pb-1 text-xs leading-5 text-muted-foreground">
                          <div
                            className="truncate text-foreground"
                            title={localPlanDisplayFolder}
                          >
                            {localPlanMenuPath}
                          </div>
                          <div>{t("plansPage.reader.localFilesNoHosted")}</div>
                        </div>
                        <DropdownMenuItem
                          onClick={() =>
                            runPlanExportAction(copyLocalPlanFolder)
                          }
                          className="gap-2"
                        >
                          <IconFolder className="size-4" />
                          {t("plansPage.reader.copyLocalPath")}
                        </DropdownMenuItem>
                        {!localPlanBridgeUrl && (
                          <DropdownMenuItem
                            onClick={() =>
                              preservePlanReaderScroll(
                                openPromoteLocalPlanDialog,
                              )
                            }
                            disabled={promoteLocalPlan.isPending}
                            className="gap-2"
                          >
                            {promoteLocalPlan.isPending ? (
                              <IconLoader2 className="size-4 animate-spin" />
                            ) : (
                              <IconFolder className="size-4" />
                            )}
                            {t("plansPage.reader.saveToRepo")}
                          </DropdownMenuItem>
                        )}
                        {localPlanBridgeUrl && desktopPlanFilesAvailable && (
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(async () => {
                                await syncPlanToDesktopFolder({ choose: true });
                              })
                            }
                            disabled={desktopPlanSyncing}
                            className="gap-2"
                          >
                            {desktopPlanSyncing ? (
                              <IconLoader2 className="size-4 animate-spin" />
                            ) : (
                              <IconFolder className="size-4" />
                            )}
                            {t("plansPage.reader.saveSourceToFolder")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuGroup>
                      {!localPlanMode && (
                        <>
                          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                            {t("plansPage.comments.comments")}
                          </DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={commentVisibility}>
                            <DropdownMenuRadioItem
                              value="hidden"
                              onSelect={() => chooseCommentVisibility("hidden")}
                            >
                              {t("plansPage.reader.hideComments")}
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem
                              value="open"
                              onSelect={() => chooseCommentVisibility("open")}
                            >
                              <span className="flex-1">
                                {t("plansPage.reader.showComments")}
                              </span>
                              {hasOpenThreads && (
                                <span className="text-xs text-muted-foreground">
                                  {bundle.summary.openCommentCount}
                                </span>
                              )}
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem
                              value="all"
                              onSelect={() => chooseCommentVisibility("all")}
                            >
                              <span className="flex-1">
                                {t("plansPage.reader.showAllComments")}
                              </span>
                              {resolvedCommentThreadCount > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {commentThreads.length}
                                </span>
                              )}
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          {canEditPlanContent ? (
                            <DropdownMenuItem
                              onClick={() => {
                                preservePlanReaderScroll(() => {
                                  closeInlineComment();
                                  setHistoryOpen(true);
                                });
                              }}
                              className="gap-2"
                            >
                              <IconHistory className="size-4" />
                              {t("plansPage.history.title")}
                            </DropdownMenuItem>
                          ) : null}
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => {
                          preservePlanReaderScroll(() => {
                            if (prototypeOnly) {
                              closeInlineComment();
                              leavePrototypeOnlyMode();
                              return;
                            }
                            setPlanFullscreen((value) => {
                              if (value) closeInlineComment();
                              return !value;
                            });
                          });
                        }}
                        className="gap-2"
                      >
                        {immersiveReader ? (
                          <IconArrowsMinimize className="size-4" />
                        ) : (
                          <IconArrowsMaximize className="size-4" />
                        )}
                        {prototypeOnly
                          ? t("plansPage.reader.fullPlan")
                          : immersiveReader
                            ? t("plansPage.reader.appView")
                            : t("plansPage.reader.fullScreen")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          preservePlanReaderScroll(() =>
                            setTheme(isDarkTheme ? "light" : "dark"),
                          )
                        }
                        className="gap-2"
                      >
                        {isDarkTheme ? (
                          <IconSun className="size-4" />
                        ) : (
                          <IconMoon className="size-4" />
                        )}
                        {isDarkTheme
                          ? t("plansPage.reader.lightMode")
                          : t("plansPage.reader.darkMode")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          preservePlanReaderScroll(toggleWireframeStyle)
                        }
                        className="gap-2"
                      >
                        <IconPencil className="size-4" />
                        {wireframeStyle === "sketchy"
                          ? t("plansPage.reader.cleanWireframes")
                          : t("plansPage.reader.sketchyWireframes")}
                      </DropdownMenuItem>
                      {bundle.plan.content?.prototype ? (
                        <DropdownMenuItem
                          onClick={() => {
                            preservePlanReaderScroll(openPrototypeWindow);
                          }}
                          className="gap-2"
                        >
                          <IconExternalLink className="size-4" />
                          {t("plansPage.reader.openPrototypeWindow")}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() => runPlanExportAction(copyPlanLink)}
                        className="gap-2"
                      >
                        <IconCopy className="size-4" />
                        {t("plansPage.reader.copyLink")}
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="gap-2">
                        <a
                          href={PLAN_DOCS_URL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <IconHelpCircle className="size-4" />
                          {t("plansPage.reader.openDocs")}
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runPlanExportAction(downloadPlanSource)}
                        className="gap-2"
                      >
                        <IconFileZip className="size-4" />
                        {t("plansPage.reader.downloadSourceZip")}
                      </DropdownMenuItem>
                      {desktopPlanFilesAvailable && !localPlanMode && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                            {t("plansPage.reader.localFiles")}
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(async () => {
                                await syncPlanToDesktopFolder({
                                  choose: true,
                                });
                              })
                            }
                            disabled={desktopPlanSyncing}
                            className="gap-2"
                          >
                            {desktopPlanSyncing ? (
                              <IconLoader2 className="size-4 animate-spin" />
                            ) : (
                              <IconFolder className="size-4" />
                            )}
                            {desktopPlanFolder
                              ? t("plansPage.reader.changeLocalFolder")
                              : t("plansPage.reader.linkLocalFolder")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(async () => {
                                await syncPlanToDesktopFolder();
                              })
                            }
                            disabled={!desktopPlanFolder || desktopPlanSyncing}
                            className="gap-2"
                          >
                            {desktopPlanSyncing ? (
                              <IconLoader2 className="size-4 animate-spin" />
                            ) : (
                              <IconRefresh className="size-4" />
                            )}
                            {t("plansPage.reader.syncToLocalFolder")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(importPlanFromDesktopFolder)
                            }
                            disabled={
                              !desktopPlanFolder ||
                              desktopPlanImporting ||
                              !canEditPlanContent
                            }
                            className="gap-2"
                          >
                            {desktopPlanImporting ? (
                              <IconLoader2 className="size-4 animate-spin" />
                            ) : (
                              <IconDownload className="size-4" />
                            )}
                            {t("plansPage.reader.importLocalEdits")}
                          </DropdownMenuItem>
                          <DropdownMenuCheckboxItem
                            checked={desktopPlanAutoSync}
                            disabled={desktopPlanSyncing}
                            onCheckedChange={(checked) =>
                              setDesktopPlanAutoSyncEnabled(checked === true)
                            }
                          >
                            {t("plansPage.reader.autoSyncChanges")}
                          </DropdownMenuCheckboxItem>
                        </>
                      )}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2">
                          <IconDownload className="size-4" />
                          {t("plansPage.reader.export")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56 rounded-xl">
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(copyPlanMarkdown)
                            }
                            className="gap-2"
                          >
                            <IconClipboardText className="size-4" />
                            {t("plansPage.reader.copyMarkdown")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(downloadPlanMarkdown)
                            }
                            className="gap-2"
                          >
                            <IconDownload className="size-4" />
                            {t("plansPage.reader.downloadMarkdown")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => runPlanExportAction(copyPlanHtml)}
                            className="gap-2"
                          >
                            <IconCopy className="size-4" />
                            {t("plansPage.reader.copyHtml")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(downloadPlanHtml)
                            }
                            className="gap-2"
                          >
                            <IconDownload className="size-4" />
                            {t("plansPage.reader.downloadHtml")}
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      {!localPlanMode &&
                        bundle.summary.openCommentCount > 0 && (
                          <DropdownMenuItem
                            onClick={() =>
                              preservePlanReaderScroll(() => {
                                void copyPlanFeedbackForAgent();
                              })
                            }
                            className="gap-2"
                          >
                            <IconClipboardText className="size-4" />
                            {t("plansPage.reader.copyFeedback")}
                          </DropdownMenuItem>
                        )}
                    </DropdownMenuGroup>
                    {currentPlanDeleteTarget && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            preservePlanReaderScroll(() =>
                              requestDeletePlan(currentPlanDeleteTarget),
                            )
                          }
                          className="gap-2 text-destructive focus:text-destructive"
                        >
                          <IconTrash className="size-4" />
                          {t("plansPage.overview.delete")}
                        </DropdownMenuItem>
                      </>
                    )}
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
                      aria-label={t("plansPage.reader.toggleAgentSidebar")}
                    >
                      <IconLayoutSidebarRight className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("plansPage.reader.toggleSideChat")}
                  </TooltipContent>
                </Tooltip>
              </div>
              {reviewMode !== "none" && !recapScreenshotMode && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border/70 bg-background/82 px-3 py-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-xl">
                  {reviewMode === "comment"
                    ? t("plansPage.reader.clickToComment", {
                        noun: isRecap
                          ? t("plansPage.nouns.recap")
                          : t("plansPage.nouns.plan"),
                      })
                    : reviewMode === "text"
                      ? t("plansPage.reader.clickCanvasNote")
                      : t("plansPage.reader.dragCanvasCallout")}
                </div>
              )}
              {bundle.plan.content ? (
                <div className="relative h-full min-h-full w-full">
                  <div
                    ref={nativeReaderRef}
                    data-plan-reader
                    className={cn(
                      "h-full min-h-full w-full overflow-auto bg-background",
                      reviewMode !== "none" &&
                        "ring-1 ring-inset ring-primary/35",
                    )}
                    style={recapScreenshotBackgroundStyle}
                    onScroll={handleNativeReaderScroll}
                    onPointerDown={handleNativeReaderPointerDown}
                    onPointerUp={handleNativeReaderPointerUp}
                  >
                    <PlanContentRenderer
                      key={bundle.plan.id}
                      content={bundle.plan.content}
                      fallbackTitle={bundle.plan.title}
                      fallbackBrief={bundle.plan.brief}
                      onContentChange={
                        canEditPlanContent ? updateStructuredContent : undefined
                      }
                      onContentPatch={
                        canEditPlanContent ? patchStructuredContent : undefined
                      }
                      onOptimisticBlocks={
                        canEditPlanContent
                          ? writeBlocksOptimistically
                          : undefined
                      }
                      onMetadataChange={
                        canEditPlanContent ? updatePlanMetadata : undefined
                      }
                      contentUpdatedAt={bundle.plan.updatedAt}
                      editingDisabled={
                        !canEditPlanContent || reviewMode !== "none"
                      }
                      canvasMarkupMode={reviewMode}
                      onCanvasMarkupCreate={appendCanvasMarkup}
                      onCanvasViewportChange={scheduleNativeMarkerUpdate}
                      onCanvasCommentShortcut={() =>
                        preservePlanReaderScroll(startCommenting)
                      }
                      planId={bundle.plan.id}
                      collabUser={collabUser}
                      prototypeOnly={prototypeOnly}
                      isRecap={isRecap}
                      hideChangedFiles={recapScreenshotMode}
                      hideRecapChrome={recapScreenshotMode}
                      showCodeAnnotationOverlays={recapScreenshotMode}
                      recapScreenshotTheme={recapScreenshotTheme}
                      sourceUrl={bundle.plan.sourceUrl}
                      visualSurfaceMode={visualSurfaceMode}
                      onVisualSurfaceModeChange={setVisualSurfaceMode}
                      onVisualQuestionsSubmit={(summary) => {
                        sendToAgentChat({
                          type: "content",
                          submit: true,
                          context: planAgentContext,
                          message: buildQuestionFormRevisionMessage(summary),
                        });
                        persistQuestionFormAnswers(summary, bundle.plan.id);
                        toast.success(t("plansPage.reader.sentAnswers"));
                      }}
                    />
                  </div>
                  {nativeSelectionComment && (
                    <div
                      className="absolute z-30"
                      style={{
                        left: nativeSelectionComment.toolbarLeft,
                        top: nativeSelectionComment.toolbarTop,
                      }}
                    >
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 gap-2 rounded-xl border border-border/80 bg-background/95 px-3 text-foreground shadow-2xl backdrop-blur-xl hover:bg-muted"
                        onClick={beginNativeSelectionComment}
                      >
                        <IconMessageCircle className="size-4 text-primary" />
                        {t("plansPage.comments.comment")}
                      </Button>
                    </div>
                  )}
                  {commentMarkersVisible && (
                    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                      {runtimeCommentThreads.map((annotation) => {
                        const placement = nativeMarkerPosition(
                          annotation.anchor,
                        );
                        if (!placement) return null;
                        const participants = annotation.participants.map(
                          runtimeParticipantPresentation,
                        );
                        const marker = (
                          <CommentThreadMarker
                            participants={participants}
                            count={annotation.commentCount}
                            title={runtimeAnnotationMarkerTitle(annotation)}
                            className="absolute"
                            style={placement.marker}
                            onClick={() => {
                              const popoverPosition = getPositionFromAnchor(
                                annotation.anchor,
                              );
                              if (!popoverPosition) return;
                              closeInlineComment();
                              setAnnotationsOpen(false);
                              setActiveAnnotation({
                                annotation,
                                position: popoverPosition,
                              });
                            }}
                          />
                        );
                        if (!placement.clip) {
                          return <div key={annotation.id}>{marker}</div>;
                        }
                        return (
                          <div
                            key={annotation.id}
                            className="pointer-events-none absolute overflow-hidden"
                            style={placement.clip}
                          >
                            {marker}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  title={`${bundle.plan.title} plan`}
                  srcDoc={annotatedDocumentHtml}
                  onLoad={handleIframeLoad}
                  sandbox="allow-forms allow-scripts"
                  className={cn(
                    "h-full min-h-full w-full border-0 bg-background",
                    annotateMode && "ring-1 ring-inset ring-primary/35",
                  )}
                />
              )}
              {pendingAnnotation && inlineCommentPosition && (
                <>
                  {pendingMarkerPlacement?.clip ? (
                    <div
                      className="pointer-events-none absolute z-20 overflow-hidden"
                      style={pendingMarkerPlacement.clip}
                    >
                      {pendingCommentPin}
                    </div>
                  ) : (
                    pendingCommentPin
                  )}
                  {!session && !localPlanMode ? (
                    <GuestCommentCta
                      position={inlineCommentPosition}
                      onSignIn={() => {
                        // share funnel: logged-out viewer of a public plan
                        // clicking the "create account to comment" CTA.
                        fireShareCtaClick("comment_signin");
                        openSignIn(
                          window.location.pathname + window.location.search,
                        );
                      }}
                      onCancel={closeInlineComment}
                    />
                  ) : (
                    <InlineCommentPopover
                      key={failedCommentDraft ? "retry" : "new"}
                      position={inlineCommentPosition}
                      initialDraft={
                        failedCommentDraft ?? defaultInlineCommentDraft
                      }
                      onCancel={closeInlineComment}
                      onSubmit={submitInlineComment}
                      lockToAgent={localPlanMode}
                    />
                  )}
                </>
              )}
              {activeAnnotation && (
                <AnnotationPopover
                  annotation={activeAnnotation.annotation}
                  position={activeAnnotation.position}
                  isPending={commentWritePending}
                  pendingAuthor={pendingCommentAuthor}
                  canEditRootComment={canEditPlanContent}
                  onSave={(message) =>
                    updateAnnotationComment(
                      activeAnnotation.annotation,
                      message,
                    )
                  }
                  onReply={replyToCommentThread}
                  canResolve={canResolveCommentThreads}
                  onStatusChange={(status) =>
                    setCommentThreadStatus(
                      activeAnnotation.annotation.id,
                      status,
                      activeAnnotation.annotation.anchor,
                    )
                  }
                  canDelete={Boolean(
                    activeCommentThread &&
                    canDeleteCommentThread(activeCommentThread),
                  )}
                  onDelete={() => {
                    if (activeCommentThread) {
                      requestDeleteCommentThread(activeCommentThread);
                    }
                  }}
                  canDeleteComment={canDeletePlanComment}
                  onDeleteComment={(commentId) => {
                    if (activeCommentThread) {
                      requestDeleteComment(activeCommentThread, commentId);
                    }
                  }}
                  onClose={() => setActiveAnnotation(null)}
                />
              )}
              {annotationsOpen && (
                <AnnotationsPanel
                  threads={visibleCommentThreads}
                  showResolvedComments={commentVisibility === "all"}
                  avatarUrls={commentAvatarUrls}
                  currentUser={currentCommentAuthor}
                  pendingAuthor={pendingCommentAuthor}
                  isPending={commentWritePending}
                  onReply={replyToCommentThread}
                  canResolve={canResolveCommentThreads}
                  canDeleteThread={canDeleteCommentThread}
                  canDeleteComment={canDeletePlanComment}
                  onStatusChange={(thread, status) =>
                    setCommentThreadStatus(thread.id, status, thread.anchor)
                  }
                  onDeleteThread={requestDeleteCommentThread}
                  onDeleteComment={requestDeleteComment}
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
        canCreate={Boolean(session)}
        onRequireSignIn={() => openSignIn("/plans?create=1")}
      />

      <Dialog
        open={promoteLocalPlanOpen}
        onOpenChange={(open) => {
          if (promoteLocalPlan.isPending) return;
          if (open && !promoteLocalPlanTargetPath) {
            setPromoteLocalPlanTargetPath(localPlanSuggestedRepoPath);
          }
          setPromoteLocalPlanOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              void submitPromoteLocalPlan(event).catch(() => {});
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>
                {t("plansPage.reader.saveLocalPlanToRepo")}
              </DialogTitle>
              <DialogDescription>
                {t("plansPage.reader.chooseRepoFolder")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="local-plan-repo-path">
                {t("plansPage.reader.repoFolder")}
              </Label>
              <Input
                id="local-plan-repo-path"
                value={promoteLocalPlanTargetPath}
                onChange={(event) =>
                  setPromoteLocalPlanTargetPath(event.target.value)
                }
                placeholder={localPlanSuggestedRepoPath}
                autoFocus
              />
            </div>
            <label
              htmlFor="local-plan-overwrite"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="local-plan-overwrite"
                checked={promoteLocalPlanOverwrite}
                onCheckedChange={(checked) =>
                  setPromoteLocalPlanOverwrite(checked === true)
                }
              />
              {t("plansPage.reader.replaceExistingFolder")}
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPromoteLocalPlanOpen(false)}
                disabled={promoteLocalPlan.isPending}
              >
                {t("plansPage.common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  promoteLocalPlan.isPending ||
                  !promoteLocalPlanTargetPath.trim()
                }
              >
                {promoteLocalPlan.isPending && (
                  <IconLoader2 className="mr-2 size-4 animate-spin" />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {bundle && (
        <PlanHistorySheet
          planId={bundle.plan.id}
          open={historyOpen && canEditPlanContent}
          onOpenChange={setHistoryOpen}
          canRestore={canEditPlanContent}
        />
      )}

      <DeleteCommentDialog
        open={Boolean(deleteCommentRequest)}
        replyCount={deleteCommentRequest?.replyCount ?? 0}
        isDeleting={commentDeletePending}
        onOpenChange={(open) => {
          if (!open && !commentDeletePending) {
            setDeleteCommentRequest(null);
          }
        }}
        onConfirm={() => void confirmDeleteCommentThread()}
      />

      <DeletePlanDialog
        request={deletePlanRequest}
        isPending={deletePlanMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !deletePlanMutation.isPending) {
            setDeletePlanRequest(null);
          }
        }}
        onConfirm={(mode, confirmation) =>
          void confirmDeletePlan({
            planId: deletePlanRequest?.plan.id ?? "",
            mode,
            confirmation,
          })
        }
      />
    </div>
  );
}

// Shared copy for the rich access-management share popover. The public note
// makes clear that anyone-with-link can view, but commenting on a public
// plan/recap still needs an agent-native account (comments are attributed +
// scoped). `noun` is "plan" or "recap" so recaps read as recaps everywhere.
const buildShareVisibilityCopy = (
  t: ReturnType<typeof useT>,
  noun: string,
) => ({
  private: {
    label: t("plansPage.share.visibility.private.label"),
    description: t("plansPage.share.visibility.private.description", { noun }),
  },
  org: {
    label: t("plansPage.share.visibility.org.label"),
    description: t("plansPage.share.visibility.org.description"),
  },
  public: {
    label: t("plansPage.share.visibility.public.label"),
    description: t("plansPage.share.visibility.public.description"),
  },
});

const buildShareAccessNote = (t: ReturnType<typeof useT>, noun: string) =>
  t("plansPage.share.accessNote", { noun });

function PlanReportControl({
  planId,
  planTitle,
  isRecap = false,
  onOpenChange,
}: {
  planId: string;
  planTitle: string;
  isRecap?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const noun = isRecap ? "recap" : "plan";
  const reportPlan = useReportVisualPlan();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PlanReportReason>("spam");
  const [details, setDetails] = useState("");

  const setDialogOpen = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
      if (!nextOpen && !reportPlan.isPending) {
        setReason("spam");
        setDetails("");
      }
    },
    [onOpenChange, reportPlan.isPending],
  );

  const submitReport = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedDetails = details.trim();
      reportPlan.mutate(
        {
          planId,
          reason,
          details: trimmedDetails || undefined,
          pageUrl:
            typeof window === "undefined" ? undefined : window.location.href,
        },
        {
          onSuccess: (result) => {
            toast.success(result.message);
            setOpen(false);
            onOpenChange?.(false);
            setReason("spam");
            setDetails("");
          },
        },
      );
    },
    [details, onOpenChange, planId, reason, reportPlan],
  );

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="pointer-events-auto size-8"
            onClick={() => setDialogOpen(true)}
            aria-label={t("plansPage.report.reportAria", { noun })}
          >
            <IconFlag className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("plansPage.report.report", { noun })}
        </TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={submitReport} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("plansPage.report.report", { noun })}</DialogTitle>
            <DialogDescription>
              {t("plansPage.report.description", { noun })}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">{planTitle}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-report-reason">
              {t("plansPage.report.reason")}
            </Label>
            <Select
              value={reason}
              onValueChange={(value) => setReason(value as PlanReportReason)}
            >
              <SelectTrigger id="plan-report-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(`plansPage.report.reasons.${option.value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="plan-report-details">
                {t("plansPage.report.details")}
              </Label>
              <span className="text-xs text-muted-foreground">
                {details.length}/1000
              </span>
            </div>
            <Textarea
              id="plan-report-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={1000}
              placeholder={t("plansPage.report.detailsPlaceholder")}
              className="min-h-28 resize-none"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={reportPlan.isPending}
            >
              {t("plansPage.common.cancel")}
            </Button>
            <Button type="submit" disabled={reportPlan.isPending}>
              {reportPlan.isPending ? (
                <>
                  <IconLoader2 className="size-4 animate-spin" />
                  {t("plansPage.reader.sending")}
                </>
              ) : (
                <>
                  <IconFlag className="size-4" />
                  {t("plansPage.report.submit")}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Share affordance for a plan. People with a session (logged in, or local dev
 * identity) get the full access-management popover immediately. People in
 * local/no-account mode get a "Create shareable link" step first: clicking it
 * publishes the plan to a hosted, shareable URL — creating a lazy account /
 * signing in along the way when the server reports `needsAuth` — and then
 * swaps in the same rich sharing menu.
 */
function PlanShareControl({
  planId,
  planTitle,
  isRecap = false,
  localShareUrl,
  hostedPlanId,
  hostedPlanUrl,
  onOpenChange,
}: {
  planId: string;
  planTitle: string;
  isRecap?: boolean;
  localShareUrl?: string;
  hostedPlanId?: string | null;
  hostedPlanUrl?: string | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const noun = isRecap ? "recap" : "plan";
  const Noun = isRecap ? "Recap" : "Plan";
  const { session, isLoading: sessionLoading } = useSession();
  const publishPlan = usePublishVisualPlan();
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishedPlan, setPublishedPlan] = useState<{
    url: string;
    hostedPlanId: string;
  } | null>(null);
  const [authPrompt, setAuthPrompt] = useState<{
    authUrl?: string;
    connectCommand?: string;
  } | null>(null);

  const effectiveHostedPlanId =
    publishedPlan?.hostedPlanId ?? hostedPlanId ?? null;
  const effectivePublishedUrl =
    publishedPlan?.url ??
    (effectiveHostedPlanId ? hostedPlanUrl : null) ??
    null;
  const hostedPlanOnCurrentOrigin = useMemo(() => {
    if (!effectivePublishedUrl || typeof window === "undefined") return false;
    try {
      return (
        new URL(effectivePublishedUrl, window.location.origin).origin ===
        window.location.origin
      );
    } catch {
      return false;
    }
  }, [effectivePublishedUrl]);
  const canManageLocalShares =
    Boolean(session) && (!effectivePublishedUrl || hostedPlanOnCurrentOrigin);
  const managedShareResourceId =
    effectivePublishedUrl && hostedPlanOnCurrentOrigin && effectiveHostedPlanId
      ? effectiveHostedPlanId
      : planId;
  // Viral attribution: the owner is the one publishing/managing the share here,
  // so `via` is their non-PII session userId. `localShareUrl` is already tagged
  // upstream; tag the hosted/public URL too so both paths self-attribute.
  const managedShareUrl =
    effectivePublishedUrl && hostedPlanOnCurrentOrigin
      ? withPlanShareAttribution(effectivePublishedUrl, session?.userId ?? null)
      : localShareUrl;

  useEffect(() => {
    setPublishedPlan(null);
    setAuthPrompt(null);
    setPublishOpen(false);
  }, [planId]);

  const openAuthFlow = useCallback((authUrl?: string) => {
    const returnPath = `${window.location.pathname}${window.location.search}`;
    const target =
      authUrl ||
      `${agentNativePath("/_agent-native/sign-in")}?return=${encodeURIComponent(returnPath)}`;
    window.location.href = target;
  }, []);

  const copyPublishedUrl = useCallback(
    (url: string) => {
      void navigator.clipboard.writeText(url).then(
        () => toast.success(t("plansPage.share.linkCopied")),
        () => toast.error(t("plansPage.share.copyFailed")),
      );
    },
    [t],
  );

  const handlePublish = useCallback(() => {
    publishPlan.mutate(
      { planId },
      {
        onSuccess: (result: PublishVisualPlanResult) => {
          if (result.needsAuth) {
            setAuthPrompt({
              authUrl: result.authUrl,
              connectCommand: result.connectCommand,
            });
            toast.message(
              t("plansPage.share.createAccountToPublish", { noun }),
            );
            return;
          }
          setPublishedPlan({
            url: result.hostedPlanUrl ?? result.url,
            hostedPlanId: result.hostedPlanId,
          });
          setAuthPrompt(null);
          // Tag the freshly-minted public link so signups from it are
          // attributed. The publisher is the owner, so `via` is their userId.
          copyPublishedUrl(
            withPlanShareAttribution(
              result.hostedPlanUrl ?? result.url,
              session?.userId ?? null,
            ) ??
              result.hostedPlanUrl ??
              result.url,
          );
        },
      },
    );
  }, [copyPublishedUrl, planId, publishPlan, session?.userId]);

  // Logged-in / local-dev: manage shares for the plan in this app instance.
  if (canManageLocalShares) {
    if (!managedShareUrl) return null;
    return (
      <ShareButton
        resourceType="plan"
        resourceId={managedShareResourceId}
        resourceTitle={planTitle}
        shareUrl={managedShareUrl}
        shareUrlLabel={t("plansPage.share.linkLabel", { noun: Noun })}
        shareUrlDescription={t("plansPage.share.description")}
        shareUrlPlacement="top"
        peopleAccessLabel={t("plansPage.share.peopleAccess", { noun })}
        generalAccessLabel={t("plansPage.share.generalAccess", { noun })}
        accessNote={buildShareAccessNote(t, noun)}
        visibilityCopy={buildShareVisibilityCopy(t, noun)}
        trigger="icon"
        triggerClassName="pointer-events-auto size-8"
        onOpenChange={onOpenChange}
      />
    );
  }

  // No account yet: publish-to-share step, anchored to the Share button.
  return (
    <Popover
      open={publishOpen}
      onOpenChange={(open) => {
        setPublishOpen(open);
        onOpenChange?.(open);
        if (!open) setAuthPrompt(null);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pointer-events-auto size-8"
              aria-label={t("plansPage.share.shareAria", { noun })}
            >
              <IconShare3 className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("plansPage.share.share", { noun })}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="pointer-events-auto z-[2000] w-[min(360px,92vw)] rounded-lg p-4"
      >
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <IconWorld className="size-4 text-muted-foreground" />
          {t("plansPage.share.shareThis", { noun })}
        </div>
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          {effectivePublishedUrl
            ? t("plansPage.share.hostedCopy", { noun })
            : t("plansPage.share.publishDescription", { noun })}
        </p>

        {authPrompt ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
              {t("plansPage.share.finishAccount")}
            </div>
            {authPrompt.connectCommand ? (
              <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                {authPrompt.connectCommand}
              </code>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handlePublish}
                disabled={publishPlan.isPending}
              >
                {publishPlan.isPending ? (
                  <>
                    <IconLoader2 className="size-3.5 animate-spin" />
                    {t("plansPage.share.checking")}
                  </>
                ) : (
                  t("plansPage.share.signedInRetry")
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openAuthFlow(authPrompt.authUrl)}
              >
                {t("plansPage.loadError.createAccount")}
              </Button>
            </div>
          </div>
        ) : effectivePublishedUrl ? (
          <div className="space-y-3">
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/35 px-2.5 py-2">
              <IconLink className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {effectivePublishedUrl}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => copyPublishedUrl(effectivePublishedUrl)}
              >
                <IconCopy className="size-3.5" />
                {t("plansPage.loggedOut.copy")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handlePublish}
                disabled={publishPlan.isPending}
              >
                {publishPlan.isPending ? (
                  <>
                    <IconLoader2 className="size-3.5 animate-spin" />
                    {t("plansPage.share.updating")}
                  </>
                ) : (
                  <>
                    <IconRefresh className="size-3.5" />
                    {t("plansPage.share.updateLink")}
                  </>
                )}
              </Button>
              <Button type="button" size="sm" asChild>
                <a
                  href={effectivePublishedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconExternalLink className="size-3.5" />
                  {t("plansPage.share.openHostedPlan")}
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            className="w-full"
            onClick={handlePublish}
            disabled={publishPlan.isPending || sessionLoading}
          >
            {publishPlan.isPending ? (
              <>
                <IconLoader2 className="size-4 animate-spin" />
                {t("plansPage.share.creatingLink")}
              </>
            ) : (
              <>
                <IconLink className="size-4" />
                {t("plansPage.share.createShareableLink")}
              </>
            )}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PlanSkeleton({ isRecap = false }: { isRecap?: boolean }) {
  const t = useT();
  const loadingLabel = isRecap
    ? t("plansPage.skeleton.loadingRecap")
    : t("plansPage.skeleton.loadingPlan");
  // Recaps are document-only review surfaces that almost never use the top
  // canvas, so skip the canvas placeholder for them while keeping it for plans.
  return (
    <div
      className="plan-content-surface h-full min-h-0 overflow-auto bg-plan-document text-plan-text"
      role="status"
      aria-label={loadingLabel}
    >
      <span className="sr-only">{loadingLabel}</span>
      {!isRecap && <PlanCanvasSkeleton />}
      <PlanDocumentSkeleton />
    </div>
  );
}

const PLAN_SKELETON_FILL = {
  line: {
    backgroundColor:
      "color-mix(in srgb, var(--plan-placeholder-line) 26%, transparent)",
  },
  box: {
    backgroundColor:
      "color-mix(in srgb, var(--plan-placeholder-line) 26%, transparent)",
  },
  control: {
    backgroundColor:
      "color-mix(in srgb, var(--plan-placeholder-line) 26%, transparent)",
  },
  title: {
    backgroundColor:
      "color-mix(in srgb, var(--plan-placeholder-line) 26%, transparent)",
  },
  heading: {
    backgroundColor:
      "color-mix(in srgb, var(--plan-placeholder-line) 26%, transparent)",
  },
} satisfies Record<string, CSSProperties>;

function PlanCanvasSkeleton() {
  return (
    <section
      className="plan-canvas relative flex min-h-[65vh] flex-col overflow-hidden border-b border-plan-line"
      aria-hidden="true"
    >
      <div
        className="plan-canvas-grid absolute inset-0"
        style={{
          backgroundPosition: "96px 64px",
          backgroundSize: "20px 20px",
        }}
      />

      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-plan-line bg-plan-chrome p-1.5 shadow-md backdrop-blur">
        <PlanSkeletonIcon />
        <Skeleton
          className="h-9 w-32 rounded-md"
          style={PLAN_SKELETON_FILL.control}
        />
        <PlanSkeletonIcon />
      </div>

      {/* Normal flow + flex-1 so the canvas grows to contain the artboards on
          short viewports (the surface scrolls) instead of clipping them. */}
      <div className="relative z-0 flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-7">
          <div className="min-w-0 flex-[1_1_44rem]">
            <DesktopArtboardSkeleton />
          </div>

          <div className="hidden w-[15rem] shrink-0 lg:block">
            <PhoneArtboardSkeleton />
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-plan-line bg-plan-chrome p-1 shadow-md backdrop-blur">
        <Skeleton
          className="size-6 rounded-md"
          style={PLAN_SKELETON_FILL.control}
        />
        <Skeleton
          className="h-4 w-10 rounded-full"
          style={PLAN_SKELETON_FILL.line}
        />
        <Skeleton
          className="size-6 rounded-md"
          style={PLAN_SKELETON_FILL.control}
        />
      </div>
    </section>
  );
}

function PlanDocumentSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[900px] px-6 pb-12 pt-16 sm:px-10 sm:py-12 lg:py-14"
      aria-hidden="true"
    >
      <header className="border-b border-plan-line pb-8">
        <PlanSkeletonBar className="mb-4 h-4 w-20" />
        <Skeleton
          className="h-16 w-full max-w-[720px] rounded-lg sm:h-20"
          style={PLAN_SKELETON_FILL.title}
        />
        <div className="mt-5 max-w-2xl space-y-3">
          <PlanSkeletonBar className="h-6 w-full" />
          <PlanSkeletonBar className="h-6 w-5/6" />
        </div>
      </header>

      <div className="plan-document-flow pt-9">
        <section className="plan-block">
          <Skeleton
            className="mb-6 h-11 w-72 max-w-full rounded-lg"
            style={PLAN_SKELETON_FILL.heading}
          />
          <div className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-3">
              <PlanSkeletonBar className="h-4 w-32" />
              <PlanSkeletonBar className="h-4 w-full" />
              <PlanSkeletonBar className="h-4 w-10/12" />
            </div>
            <div className="space-y-3">
              <PlanSkeletonBar className="h-4 w-36" />
              <PlanSkeletonBar className="h-4 w-full" />
              <PlanSkeletonBar className="h-4 w-9/12" />
            </div>
          </div>
        </section>

        <section className="plan-block">
          <Skeleton
            className="mb-6 h-10 w-64 max-w-full rounded-lg"
            style={PLAN_SKELETON_FILL.heading}
          />
          <div className="space-y-3">
            <PlanSkeletonBar className="h-4 w-full" />
            <PlanSkeletonBar className="h-4 w-11/12" />
            <PlanSkeletonBar className="h-4 w-8/12" />
          </div>
        </section>
      </div>
    </div>
  );
}

function DesktopArtboardSkeleton() {
  return (
    <div className="h-[20rem] overflow-hidden rounded-[12px] border border-plan-line bg-muted p-6 shadow-[0_10px_34px_rgba(24,24,27,0.08)] sm:h-[23rem] sm:p-8">
      <Skeleton
        className="h-14 w-2/5 max-w-[20rem] rounded-lg"
        style={PLAN_SKELETON_FILL.heading}
      />
      <div className="mt-6 space-y-3">
        <PlanSkeletonBar className="h-4 w-4/5 max-w-[34rem]" />
        <PlanSkeletonBar className="h-4 w-3/5 max-w-[26rem]" />
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-[1fr_0.72fr]">
        <PlanSkeletonBox className="h-28 sm:h-36" />
        <PlanSkeletonBox className="hidden h-28 sm:block sm:h-36" />
      </div>
    </div>
  );
}

function PhoneArtboardSkeleton() {
  return (
    <div className="h-[22rem] overflow-hidden rounded-[26px] border border-plan-line bg-muted p-5 shadow-[0_10px_34px_rgba(24,24,27,0.08)]">
      <PlanSkeletonBox className="h-28" />
      <div className="mt-5 space-y-3">
        <PlanSkeletonBar className="h-3 w-full" />
        <PlanSkeletonBar className="h-3 w-3/4" />
      </div>
    </div>
  );
}

function PlanSkeletonBar({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("rounded-full", className)}
      style={PLAN_SKELETON_FILL.line}
    />
  );
}

function PlanSkeletonBox({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("rounded-md", className)}
      style={PLAN_SKELETON_FILL.box}
    />
  );
}

function PlanSkeletonIcon({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("size-8 rounded-md", className)}
      style={PLAN_SKELETON_FILL.control}
    />
  );
}

function ReviewMarkupToolbar({
  mode,
  onModeChange,
}: {
  mode: CanvasMarkupMode;
  onModeChange: (mode: CanvasMarkupMode) => void;
}) {
  const t = useT();
  const value = mode === "comment" ? "comment" : "";
  const setValue = (next: string) => {
    onModeChange(next === "comment" ? "comment" : "none");
  };
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={setValue}
      variant="default"
      size="sm"
      className="pointer-events-auto gap-0.5 rounded-md border border-border/60 bg-background/55 p-0.5"
      aria-label={t("plansPage.reader.reviewMarkupTools")}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="comment"
            className="size-7 px-0"
            aria-label={
              mode === "comment"
                ? t("plansPage.reader.stopCommenting")
                : t("plansPage.comments.comment")
            }
          >
            <IconMessageCircle className="size-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {mode === "comment"
            ? t("plansPage.reader.stopCommenting")
            : t("plansPage.reader.pinComment")}
        </TooltipContent>
      </Tooltip>
    </ToggleGroup>
  );
}

function PlanErrorFeedbackActions({
  title,
  message,
  status,
  extraDebug,
}: {
  title: string;
  message: string;
  status?: number;
  extraDebug?: ErrorReportDebugItem[];
}) {
  const t = useT();
  return (
    <ErrorReportActions
      appName="Plan"
      title={title}
      details={message}
      status={status}
      issueTitle={`Plan error: ${title}`}
      feedbackLabel={t("plansPage.loadError.sendFeedback")}
      feedbackPlaceholder={t("plansPage.loadError.feedbackPlaceholder")}
      githubLabel={t("plansPage.loadError.openGitHubIssue")}
      align="start"
      className="justify-start"
      extraDebug={extraDebug}
    />
  );
}

function LocalPlanLoadError({
  error,
  slug,
  onRetry,
}: {
  error?: unknown;
  slug: string;
  onRetry: () => void;
}) {
  const t = useT();
  const message =
    error instanceof Error && error.message
      ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
      : t("plansPage.localPlanLoadError.message", { slug });
  const title = t("plansPage.localPlanLoadError.title");

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <IconAlertTriangle className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onRetry}>
            <IconRefresh className="me-2 size-4" />
            {t("plansPage.loadError.retry")}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link to="/plans">
              <IconArrowLeft className="me-2 size-4 rtl:-scale-x-100" />
              {t("plansPage.overview.title")}
            </Link>
          </Button>
        </div>
        <div className="mt-4 border-t border-border/70 pt-3">
          <PlanErrorFeedbackActions
            title={title}
            message={message}
            extraDebug={[
              { label: "Local plan slug", value: slug }, // i18n-ignore debug label
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function LocalPlanConnection({
  permissionState,
  onConnect,
  onRetry,
}: {
  permissionState: "prompt" | "denied";
  onConnect: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  const denied = permissionState === "denied";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <IconLink className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {t(
                denied
                  ? "plansPage.localPlanConnection.deniedTitle"
                  : "plansPage.localPlanConnection.promptTitle",
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                denied
                  ? "plansPage.localPlanConnection.deniedMessage"
                  : "plansPage.localPlanConnection.promptMessage",
              )}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={denied ? "outline" : "default"}
            onClick={denied ? onRetry : onConnect}
          >
            {denied ? <IconRefresh /> : <IconLink />}
            {t(
              denied
                ? "plansPage.localPlanConnection.checkAgain"
                : "plansPage.localPlanConnection.connect",
            )}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link to="/plans">
              <IconArrowLeft className="rtl:-scale-x-100" />
              {t("plansPage.overview.title")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanLoadError({
  error,
  planId,
  accessStatus,
  onRetry,
  onSignIn,
  onGoogleSignIn,
  onRequestAccess,
  requestAccessPending,
  accessRequestSent,
  viewerEmail,
}: {
  error?: unknown;
  planId?: string | null;
  accessStatus?: PlanAccessStatusResponse | null;
  onRetry: () => void;
  onSignIn: () => void;
  onGoogleSignIn: () => Promise<void> | void;
  onRequestAccess: () => void;
  requestAccessPending?: boolean;
  accessRequestSent?: boolean;
  /** The signed-in identity for THIS origin, or null when anonymous. */
  viewerEmail?: string | null;
}) {
  const t = useT();
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<"sign-in" | "create">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailAuthError, setEmailAuthError] = useState<string | null>(null);
  const [emailAuthNotice, setEmailAuthNotice] = useState<string | null>(null);
  const [emailAuthPending, setEmailAuthPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  const message =
    error instanceof Error && error.message
      ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
      : t("plansPage.loadError.genericMessage");
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status
      : undefined;
  const signedInEmail = viewerEmail ?? accessStatus?.viewerEmail ?? null;
  const signedIn = Boolean(signedInEmail);
  const planExists = accessStatus?.exists === true;
  const planMissing = accessStatus?.exists === false;
  const hasNoAccess = planExists && accessStatus?.hasAccess === false;
  const likelyPrivatePlan =
    !planMissing &&
    status === 403 &&
    /not found|no access|forbidden/i.test(message);
  const showAccessHelp = hasNoAccess || likelyPrivatePlan;
  const orgName = accessStatus?.orgName?.trim() || null;
  const orgAccessBody =
    orgName && accessStatus?.visibility === "org"
      ? t("plansPage.loadError.orgBody", { orgName })
      : null;
  const orgAccessTitle =
    orgName && accessStatus?.visibility === "org"
      ? t("plansPage.loadError.orgTitle", { orgName })
      : null;

  const returnPath = () =>
    window.location.pathname + window.location.search + window.location.hash;

  const readAuthError = async (res: Response, fallback: string) => {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    return data?.error ?? data?.message ?? fallback;
  };

  const submitEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailAuthError(null);
    setEmailAuthNotice(null);
    setEmailAuthPending(true);
    const body = {
      email,
      password,
      callbackURL: returnPath(),
    };
    try {
      if (emailMode === "create") {
        const registerRes = await fetch(
          agentNativePath("/_agent-native/auth/register"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!registerRes.ok) {
          throw new Error(
            await readAuthError(
              registerRes,
              t("plansPage.loadError.createAccountFailed"),
            ),
          );
        }
      }
      const loginRes = await fetch(
        agentNativePath("/_agent-native/auth/login"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!loginRes.ok) {
        throw new Error(
          await readAuthError(
            loginRes,
            t("plansPage.loadError.emailSignInFailed"),
          ),
        );
      }
      window.location.assign(returnPath());
    } catch (authError) {
      const next =
        authError instanceof Error
          ? authError.message
          : t("plansPage.loadError.emailSignInFailed");
      if (/not verified|verification/i.test(next)) {
        setEmailAuthNotice(t("plansPage.loadError.verifyEmail"));
      } else {
        setEmailAuthError(next);
      }
    } finally {
      setEmailAuthPending(false);
    }
  };

  const startGoogle = async () => {
    setGooglePending(true);
    try {
      await onGoogleSignIn();
    } finally {
      setGooglePending(false);
    }
  };

  const title = planMissing
    ? t("plansPage.loadError.notFoundTitle")
    : showAccessHelp
      ? signedIn
        ? (orgAccessTitle ?? t("plansPage.loadError.requestAccessTitle"))
        : t("plansPage.loadError.signInTitle")
      : t("plansPage.loadError.didNotLoadTitle");
  const body = planMissing
    ? t("plansPage.loadError.notFoundBody")
    : showAccessHelp
      ? orgAccessBody
        ? orgAccessBody
        : signedIn
          ? planExists
            ? t("plansPage.loadError.noAccessBody")
            : t("plansPage.loadError.maybeOtherOrgBody")
          : t("plansPage.loadError.privateBody")
      : message;
  const reportMessage = `${body}${message && message !== body ? `\n${message}` : ""}`;

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 text-start shadow-sm">
        <div className={cn("flex items-start", !showAccessHelp && "gap-3")}>
          {!showAccessHelp && !planMissing && (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <IconAlertTriangle className="size-5" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {body}
            </p>
            {showAccessHelp && signedInEmail ? (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
                <IconAt className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-muted-foreground">
                  {t("plansPage.loadError.signedInAs")}{" "}
                  <span className="font-medium text-foreground">
                    {signedInEmail}
                  </span>
                </span>
              </div>
            ) : null}
            {accessRequestSent ? (
              <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                {t("plansPage.loadError.accessRequestSent")}
              </div>
            ) : null}
            {!showAccessHelp && !planMissing ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {t("plansPage.loadError.retryHelp")}
              </p>
            ) : null}
          </div>
        </div>

        {showAccessHelp || !planMissing ? (
          <div className="mt-5 flex flex-col gap-2">
            {showAccessHelp ? (
              <>
                {signedIn ? (
                  <SignedInPlanAccessActions
                    accessStatus={accessStatus}
                    onRequestAccess={onRequestAccess}
                    onAccessResolved={onRetry}
                    requestAccessPending={requestAccessPending}
                    accessRequestSent={accessRequestSent}
                  />
                ) : (
                  <Button
                    type="button"
                    onClick={() => void startGoogle()}
                    disabled={googlePending}
                    className="h-9 w-full gap-2.5 rounded-md bg-white px-2 text-sm font-medium text-black shadow-none hover:bg-[#e5e5e5] hover:text-black dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
                  >
                    {googlePending ? (
                      <IconLoader2 className="size-[18px] animate-spin" />
                    ) : (
                      <GoogleLogoIcon className="size-[18px]" />
                    )}
                    {t("plansPage.loadError.continueWithGoogle")}
                  </Button>
                )}
                {signedIn ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void startGoogle()}
                      disabled={googlePending}
                    >
                      <IconLogin2 className="size-4" />
                      {t("plansPage.loadError.switchAccount")}
                    </Button>
                  </div>
                ) : null}
                <Collapsible open={emailOpen} onOpenChange={setEmailOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-between px-2 text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-2">
                        <IconMail className="size-4" />
                        {t("plansPage.loadError.signInWithEmail")}
                      </span>
                      <IconChevronDown
                        className={cn(
                          "size-4 transition-transform",
                          emailOpen ? "rotate-180" : "",
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <form
                      className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
                      onSubmit={submitEmailAuth}
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="plan-access-email">
                          {t("plansPage.loadError.email")}
                        </Label>
                        <Input
                          id="plan-access-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="plan-access-password">
                          {t("plansPage.loadError.password")}
                        </Label>
                        <Input
                          id="plan-access-password"
                          type="password"
                          autoComplete={
                            emailMode === "create"
                              ? "new-password"
                              : "current-password"
                          }
                          minLength={emailMode === "create" ? 8 : undefined}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          required
                        />
                      </div>
                      {emailAuthError ? (
                        <p className="text-sm text-destructive">
                          {emailAuthError}
                        </p>
                      ) : null}
                      {emailAuthNotice ? (
                        <p className="text-sm text-muted-foreground">
                          {emailAuthNotice}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="submit" disabled={emailAuthPending}>
                          {emailAuthPending ? (
                            <IconLoader2 className="size-4 animate-spin" />
                          ) : (
                            <IconLock className="size-4" />
                          )}
                          {emailMode === "create"
                            ? t("plansPage.loadError.createAccount")
                            : t("plansPage.loadError.signIn")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setEmailMode(
                              emailMode === "create" ? "sign-in" : "create",
                            );
                            setEmailAuthError(null);
                            setEmailAuthNotice(null);
                          }}
                        >
                          {emailMode === "create"
                            ? t("plansPage.loadError.haveAccount")
                            : t("plansPage.loadError.createAccount")}
                        </Button>
                      </div>
                    </form>
                  </CollapsibleContent>
                </Collapsible>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onSignIn}>
                  <IconExternalLink className="size-4" />
                  {t("plansPage.loadError.signIn")}
                </Button>
              </div>
            )}
          </div>
        ) : null}
        <div className="mt-4 border-t border-border/70 pt-3">
          <PlanErrorFeedbackActions
            title={title}
            message={reportMessage}
            status={status}
            extraDebug={[
              { label: "Plan id", value: planId }, // i18n-ignore debug label
              accessStatus?.visibility
                ? {
                    label: "Plan visibility", // i18n-ignore debug label
                    value: accessStatus.visibility,
                  }
                : {
                    label: "Plan visibility", // i18n-ignore debug label
                    value: null,
                  },
              accessStatus?.hasAccess !== undefined
                ? {
                    label: "Has access", // i18n-ignore debug label
                    value: accessStatus.hasAccess,
                  }
                : {
                    label: "Has access", // i18n-ignore debug label
                    value: null,
                  },
            ]}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="mt-3 gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <IconRefresh className="size-3.5" />
        {t("plansPage.loadError.retry")}
      </Button>
    </div>
  );
}

function SignedInPlanAccessActions({
  accessStatus,
  onRequestAccess,
  onAccessResolved,
  requestAccessPending,
  accessRequestSent,
}: {
  accessStatus?: PlanAccessStatusResponse | null;
  onRequestAccess: () => void;
  onAccessResolved: () => void;
  requestAccessPending?: boolean;
  accessRequestSent?: boolean;
}) {
  const t = useT();
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();
  const joinByDomain = useJoinByDomain();
  const orgAccessPrompt = resolvePlanOrgAccessPrompt({ accessStatus, org });
  const orgAccessPending = acceptInvitation.isPending || joinByDomain.isPending;
  const orgAccessError = acceptInvitation.error || joinByDomain.error;

  const handleOrgAccess = () => {
    if (!orgAccessPrompt) {
      onRequestAccess();
      return;
    }

    const onSuccess = () => {
      toast.success(
        t("plansPage.loadError.joinedOrg", {
          orgName: orgAccessPrompt.organizationName,
        }),
      );
      onAccessResolved();
    };

    if (orgAccessPrompt.kind === "invitation") {
      acceptInvitation.mutate(orgAccessPrompt.invitationId, { onSuccess });
      return;
    }

    joinByDomain.mutate(orgAccessPrompt.organizationId, { onSuccess });
  };

  const pending = orgAccessPrompt ? orgAccessPending : requestAccessPending;
  const disabled = orgAccessPrompt
    ? orgAccessPending
    : requestAccessPending || accessRequestSent;
  const label = orgAccessPrompt
    ? orgAccessPending
      ? orgAccessPrompt.kind === "invitation"
        ? t("plansPage.loadError.acceptingInvite")
        : t("plansPage.loadError.joiningOrg")
      : orgAccessPrompt.kind === "invitation"
        ? t("plansPage.loadError.acceptInvite")
        : t("plansPage.loadError.joinOrg", {
            orgName: orgAccessPrompt.organizationName,
          })
    : accessRequestSent
      ? t("plansPage.loadError.requestSent")
      : t("plansPage.loadError.requestAccess");

  return (
    <>
      {orgAccessPrompt ? (
        <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm leading-5 text-muted-foreground">
          {orgAccessPrompt.kind === "invitation"
            ? t("plansPage.loadError.inviteMessage", {
                orgName: orgAccessPrompt.organizationName,
              })
            : orgAccessPrompt.domain
              ? t("plansPage.loadError.domainMessage", {
                  domain: orgAccessPrompt.domain,
                  orgName: orgAccessPrompt.organizationName,
                })
              : t("plansPage.loadError.joinMessage", {
                  orgName: orgAccessPrompt.organizationName,
                })}
        </div>
      ) : null}
      <Button type="button" onClick={handleOrgAccess} disabled={disabled}>
        {pending ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : orgAccessPrompt?.kind === "domain" ? (
          <IconAt className="size-4" />
        ) : (
          <IconUserPlus className="size-4" />
        )}
        {label}
      </Button>
      {orgAccessError ? (
        <p className="text-xs leading-5 text-destructive">
          {(orgAccessError as Error).message}
        </p>
      ) : null}
    </>
  );
}

const PLAN_SKILL_INSTALL_COMMAND =
  "npx @agent-native/core@latest skills add visual-plans";

type PlanSkillDemo = {
  command: string;
  videoUrl?: string;
};

const PLAN_SKILL_DEMOS: PlanSkillDemo[] = [
  {
    command: "/visual-plan",
    videoUrl: import.meta.env.VITE_VISUAL_PLAN_SKILL_DEMO_VIDEO_URL,
  },
  {
    command: "/visual-recap",
    videoUrl: import.meta.env.VITE_VISUAL_RECAP_SKILL_DEMO_VIDEO_URL,
  },
];

function EmptyPlan({
  onCreate,
  canCreate,
}: {
  onCreate: () => void;
  canCreate: boolean;
}) {
  const t = useT();
  if (!canCreate) {
    return <LoggedOutEmptyPlan />;
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-border bg-muted/30">
          <IconClipboardText className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          {t("plansPage.empty.title")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("plansPage.empty.description")}
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <IconPlus className="size-4" />
          {t("plansPage.empty.newPlan")}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground/70">
          {t("plansPage.empty.installPrefix")}{" "}
          <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px]">
            /visual-plan
          </code>{" "}
          {t("plansPage.empty.installSuffix")}
          <br />
          <code className="mt-1 inline-block rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px]">
            {PLAN_SKILL_INSTALL_COMMAND}
          </code>
        </p>
      </div>
    </div>
  );
}

function PlanSkillDemoVideo({ demo }: { demo: PlanSkillDemo }) {
  const t = useT();
  const [isLoaded, setIsLoaded] = useState(false);
  if (!demo.videoUrl) return null;

  const handleVideoReady = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      setIsLoaded(true);
      void event.currentTarget.play().catch(() => {
        // Muted autoplay can still be blocked by browser settings.
      });
    },
    [],
  );

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-left">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t(`plansPage.skillDemos.${demo.command.slice(1)}.label`)}
          </p>
          <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">
            {t(`plansPage.skillDemos.${demo.command.slice(1)}.description`)}
          </p>
        </div>
        <code className="shrink-0 rounded bg-muted/70 px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
          {demo.command}
        </code>
      </div>
      <div className="relative aspect-[1189/1080] overflow-hidden bg-muted">
        <video
          src={demo.videoUrl}
          aria-label={t(
            `plansPage.skillDemos.${demo.command.slice(1)}.videoAriaLabel`,
          )}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={handleVideoReady}
          onLoadedData={handleVideoReady}
          onPlaying={() => setIsLoaded(true)}
          className="block size-full object-cover"
        />
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-muted transition-opacity duration-300 ${
            isLoaded ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="flex size-full animate-pulse flex-col justify-between p-4">
            <div className="space-y-2">
              <div className="h-3 w-1/3 rounded-full bg-border" />
              <div className="h-2.5 w-2/3 rounded-full bg-border/80" />
            </div>
            <div className="grid gap-2">
              <div className="h-16 rounded-md bg-border/70 sm:h-20" />
              <div className="h-8 rounded-md bg-border/50 sm:h-10" />
            </div>
            <div className="h-7 w-1/4 rounded-full bg-border" />
          </div>
        </div>
      </div>
    </article>
  );
}

function LoggedOutEmptyPlan() {
  const t = useT();
  const [installCommandCopied, setInstallCommandCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const copyInstallCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PLAN_SKILL_INSTALL_COMMAND);
      setInstallCommandCopied(true);
      toast.success(t("plansPage.loggedOut.installCopied"));
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setInstallCommandCopied(false);
      }, 2200);
    } catch {
      toast.error(t("plansPage.loggedOut.installCopyFailed"));
    }
  }, []);

  return (
    <div className="flex min-h-full items-center justify-center overflow-auto p-4 sm:p-8">
      <div className="flex w-full max-w-4xl flex-col items-center gap-3 py-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("plansPage.loggedOut.title")}
        </h2>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          {t("plansPage.loggedOut.description")}
        </p>
        <div className="mt-1 flex w-full max-w-xl items-center gap-2 rounded-md bg-muted/40 p-1.5 text-left">
          <code className="min-w-0 flex-1 overflow-x-auto px-2 py-1 font-mono text-xs leading-5 text-foreground">
            {PLAN_SKILL_INSTALL_COMMAND}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={copyInstallCommand}
            className="h-8 min-w-20 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            aria-label={
              installCommandCopied
                ? t("plansPage.loggedOut.installCopied")
                : t("plansPage.loggedOut.copyInstallCommand")
            }
          >
            {installCommandCopied ? (
              <IconCircleCheck className="size-3.5 text-emerald-600" />
            ) : (
              <IconCopy className="size-3.5" />
            )}
            {installCommandCopied
              ? t("plansPage.loggedOut.copied")
              : t("plansPage.loggedOut.copy")}
          </Button>
        </div>
        <div className="grid w-full gap-3 pt-2 sm:grid-cols-2">
          {PLAN_SKILL_DEMOS.filter((demo) => demo.videoUrl).map((demo) => (
            <PlanSkillDemoVideo key={demo.command} demo={demo} />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="mt-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <a href={PLAN_DOCS_URL} target="_blank" rel="noreferrer">
            <IconExternalLink className="size-4" />
            {t("plansPage.loggedOut.viewDocs")}
          </a>
        </Button>
      </div>
    </div>
  );
}

type OverviewFilter = "all" | "plans" | "recaps" | "archived" | "deleted";

function PlansOverview({
  plans,
  isLoading,
  isError,
  onRetry,
  viewerEmail,
  onCreate,
  canCreate,
  onArchive,
  onDelete,
  onRestore,
  onSignIn,
}: {
  plans: PlanSummary[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  viewerEmail?: string | null;
  onCreate: () => void;
  canCreate: boolean;
  onArchive: (planId: string, archived: boolean) => void;
  onDelete: (plan: DeletePlanTarget, initialMode?: "soft" | "hard") => void;
  onRestore: (plan: DeletePlanTarget) => void;
  onSignIn?: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState<string>("all");

  if (isLoading) {
    return <PlansOverviewSkeleton />;
  }
  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <IconAlertTriangle className="size-7 text-destructive/70" />
          <div>
            <h1 className="font-medium">
              {t("plansPage.loadError.didNotLoadTitle")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("plansPage.loadError.genericMessage")}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onRetry}>
            <IconRefresh className="size-4" />
            {t("plansPage.loadError.retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (plans.length === 0) {
    return <EmptyPlan onCreate={onCreate} canCreate={canCreate} />;
  }

  const activePlans = plans.filter((p) => !p.deletedAt);
  const deletedPlans = plans.filter((p) => p.deletedAt);
  const ownedEmail = plans.find((p) => p.canDelete)?.ownerEmail?.trim() || null;
  const normalizedViewerEmail =
    (ownedEmail ?? viewerEmail)?.trim().toLowerCase() || null;
  const authorEmails = Array.from(
    new Set(
      plans
        .map((p) => p.ownerEmail?.trim())
        .filter((email): email is string => Boolean(email)),
    ),
  ).sort((a, b) => emailToName(a).localeCompare(emailToName(b)));
  const hasMine =
    normalizedViewerEmail !== null &&
    authorEmails.some((email) => email.toLowerCase() === normalizedViewerEmail);
  const visibleBeforeSearch = plans.filter((p) => {
    if (filter === "deleted") {
      if (!p.deletedAt) return false;
    } else {
      if (p.deletedAt) return false;
      if (filter === "archived") {
        if (p.status !== "archived") return false;
      } else {
        if (p.status === "archived") return false;
        if (filter === "plans" && p.kind !== "plan") return false;
        if (filter === "recaps" && p.kind !== "recap") return false;
      }
    }
    if (author === "me") {
      return Boolean(
        normalizedViewerEmail &&
        p.ownerEmail?.trim().toLowerCase() === normalizedViewerEmail,
      );
    }
    if (author !== "all") {
      return p.ownerEmail?.trim() === author;
    }
    return true;
  });

  const searchLower = search.trim().toLowerCase();
  const visiblePlans =
    searchLower.length > 0
      ? visibleBeforeSearch.filter(
          (p) =>
            p.title.toLowerCase().includes(searchLower) ||
            p.brief.toLowerCase().includes(searchLower),
        )
      : visibleBeforeSearch;

  const totalVisible = activePlans.filter(
    (p) => p.status !== "archived",
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!canCreate && onSignIn && <GuestModeBanner onSignIn={onSignIn} />}
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {t("plansPage.overview.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("plansPage.overview.documentCount", {
                  count: totalVisible,
                })}
              </p>
            </div>
            <Button type="button" onClick={onCreate}>
              <IconPlus className="size-4" />
              {canCreate
                ? t("plansPage.overview.newPlan")
                : t("plansPage.overview.signInToCreate")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filter}
              onValueChange={(v) => setFilter(v as OverviewFilter)}
            >
              <TabsList>
                <TabsTrigger value="all">
                  {t("plansPage.overview.tabs.all")}
                </TabsTrigger>
                <TabsTrigger value="plans">
                  {t("plansPage.overview.tabs.plans")}
                </TabsTrigger>
                <TabsTrigger value="recaps">
                  {t("plansPage.overview.tabs.recaps")}
                </TabsTrigger>
                <TabsTrigger value="archived">
                  {t("plansPage.overview.tabs.archived")}
                </TabsTrigger>
                <TabsTrigger value="deleted">
                  {t("plansPage.overview.tabs.deleted")}
                  {deletedPlans.length > 0 && (
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {deletedPlans.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {authorEmails.length > 1 && (
              <Select value={author} onValueChange={setAuthor}>
                <SelectTrigger className="h-9 w-[170px] text-sm">
                  <SelectValue
                    placeholder={t("plansPage.overview.createdBy")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("plansPage.overview.allAuthors")}
                  </SelectItem>
                  {hasMine && (
                    <SelectItem value="me">
                      {t("plansPage.overview.me")}
                    </SelectItem>
                  )}
                  {authorEmails
                    .filter(
                      (email) =>
                        !(
                          hasMine &&
                          email.toLowerCase() === normalizedViewerEmail
                        ),
                    )
                    .map((email) => (
                      <SelectItem key={email} value={email}>
                        {emailToName(email)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}

            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t("plansPage.overview.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>
          </div>

          {visiblePlans.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search.trim()
                ? t("plansPage.overview.empty.noMatch")
                : filter === "archived"
                  ? t("plansPage.overview.empty.noArchived")
                  : filter === "deleted"
                    ? t("plansPage.overview.empty.noDeleted")
                    : t("plansPage.overview.empty.noPlans")}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {visiblePlans.map((plan) => {
                const isDeleted = Boolean(plan.deletedAt);
                const cardContent = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <h2 className="truncate text-sm font-medium">
                            {plan.title}
                          </h2>
                          {plan.kind === "recap" && (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[10px]"
                            >
                              {t("plansPage.overview.recapBadge")}
                            </Badge>
                          )}
                          {isDeleted && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-destructive/30 text-[10px] text-destructive"
                            >
                              {t("plansPage.overview.deletedBadge")}
                            </Badge>
                          )}
                        </div>
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
                      {isDeleted ? (
                        <span>
                          {t("plansPage.overview.deletedAt", {
                            date: shortDate(plan.deletedAt ?? ""),
                          })}
                        </span>
                      ) : ENABLE_PLAN_STATUS_FEATURE ? (
                        <>
                          <span>{statusLabel(plan.status)}</span>
                          <span>·</span>
                        </>
                      ) : null}
                      {!isDeleted && <span>{shortDate(plan.updatedAt)}</span>}
                      {plan.ownerEmail && (
                        <>
                          <span>·</span>
                          <span
                            className="flex min-w-0 items-center gap-1.5"
                            title={plan.ownerEmail}
                          >
                            <Avatar className="size-5">
                              <AvatarFallback
                                className="text-[9px] font-semibold text-white"
                                style={{
                                  backgroundColor: emailToColor(
                                    plan.ownerEmail,
                                  ),
                                }}
                              >
                                {commentAuthorInitials(
                                  emailToName(plan.ownerEmail),
                                )}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate">
                              {emailToName(plan.ownerEmail)}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                  </>
                );
                return (
                  <div
                    key={plan.id}
                    className={cn(
                      "group relative rounded-lg border bg-background transition-colors",
                      isDeleted
                        ? "border-destructive/20"
                        : "border-border hover:bg-accent/35",
                    )}
                  >
                    {isDeleted ? (
                      <div className="block p-4">{cardContent}</div>
                    ) : (
                      <Link
                        to={
                          plan.kind === "recap"
                            ? `/recaps/${plan.id}`
                            : `/plans/${plan.id}`
                        }
                        className="block p-4"
                      >
                        {cardContent}
                      </Link>
                    )}

                    {/* Card-level archive dropdown — visible on hover/focus-within */}
                    <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-plan-actions-trigger
                            aria-label={t("plansPage.overview.planActions")}
                          >
                            <IconDots className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {isDeleted ? (
                            <>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.preventDefault();
                                  onRestore(plan);
                                }}
                                disabled={!plan.canDelete}
                              >
                                <IconRestore className="size-4" />
                                {t("plansPage.overview.restore")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.preventDefault();
                                  onDelete(plan, "hard");
                                }}
                                disabled={!plan.canDelete}
                                className="text-destructive focus:text-destructive"
                              >
                                <IconTrash className="size-4" />
                                {t("plansPage.overview.deletePermanently")}
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              {plan.status === "archived" ? (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.preventDefault();
                                    onArchive(plan.id, false);
                                  }}
                                >
                                  <IconArchiveOff className="size-4" />
                                  {t("plansPage.overview.unarchive")}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.preventDefault();
                                    onArchive(plan.id, true);
                                  }}
                                >
                                  <IconArchive className="size-4" />
                                  {t("plansPage.overview.archive")}
                                </DropdownMenuItem>
                              )}
                              {plan.canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.preventDefault();
                                      onDelete(plan);
                                    }}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <IconTrash className="size-4" />
                                    {t("plansPage.overview.delete")}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlansOverviewSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-6 w-24 rounded-md bg-muted/55" />
            <Skeleton className="h-4 w-36 rounded-full bg-muted/45" />
          </div>
          <Skeleton className="h-10 w-28 rounded-md bg-muted/45" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className="h-5 w-2/3 rounded-md bg-muted/55" />
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-full rounded-full bg-muted/45" />
                    <Skeleton className="h-3 w-4/5 rounded-full bg-muted/40" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16 rounded-full bg-muted/40" />
              </div>
              <div className="mt-5 flex items-center justify-between">
                <Skeleton className="h-3 w-24 rounded-full bg-muted/40" />
                <Skeleton className="h-3 w-20 rounded-full bg-muted/35" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function planVersionSurfaceLabel(
  version: PlanVersionSummary,
  t: ReturnType<typeof useT>,
) {
  if (version.hasPrototype) return t("plansPage.history.surface.prototype");
  if (version.hasCanvas) return t("plansPage.history.surface.canvas");
  if (version.blockCount > 0) {
    return t("plansPage.history.surface.blocks", { count: version.blockCount });
  }
  return t("plansPage.history.surface.sections", {
    count: version.sectionCount,
  });
}

function PlanHistorySheet({
  planId,
  open,
  onOpenChange,
  canRestore,
}: {
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
}) {
  const t = useT();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  // Version id pending a confirm before restore. Set from the per-row "Restore
  // this version" action in the list so restore is reachable without first
  // opening the detail preview.
  const [restoreCandidateId, setRestoreCandidateId] = useState<string | null>(
    null,
  );
  const versionsQuery = usePlanVersions(planId, open && canRestore);
  const versionQuery = usePlanVersion(
    open && canRestore ? planId : null,
    selectedVersionId,
  );
  const restoreVersion = useRestorePlanVersion();
  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = versionQuery.data;

  // Cache of fully-loaded version details by version id. Populated as the
  // user browses individual versions; used to compute block-level diff
  // summaries on the list view without any extra network calls.
  const versionDetailCache = useRef<Map<string, PlanVersionDetail>>(new Map());

  useEffect(() => {
    if (!open) setSelectedVersionId(null);
  }, [open]);

  useEffect(() => {
    setSelectedVersionId(null);
    versionDetailCache.current = new Map();
  }, [planId]);

  // Store the freshly loaded version detail in the cache whenever it arrives.
  useEffect(() => {
    if (versionQuery.data) {
      versionDetailCache.current.set(versionQuery.data.id, versionQuery.data);
    }
  }, [versionQuery.data]);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedVersionId(null);
    onOpenChange(nextOpen);
  };

  const restoreVersionById = async (versionId: string | null) => {
    if (!versionId) return;
    try {
      await restoreVersion.mutateAsync({ planId, versionId });
      toast.success(t("plansPage.history.restoreSuccess"));
      setRestoreCandidateId(null);
      close(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
          : t("plansPage.history.restoreFailed"),
      );
    }
  };
  const restoreCandidate =
    versions.find((version) => version.id === restoreCandidateId) ?? null;

  return (
    <>
      <Sheet open={open} onOpenChange={close}>
        <SheetContent side="right" className="w-[92vw] max-w-[720px] p-0">
          <SheetHeader className="px-4 pt-4 pb-0">
            <SheetTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
              {selectedVersionId ? (
                <button
                  type="button"
                  onClick={() => setSelectedVersionId(null)}
                  className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <IconArrowLeft className="size-4" />
                  <span>{t("plansPage.history.back")}</span>
                </button>
              ) : (
                <>
                  <IconHistory className="size-4 text-primary" />
                  <span>{t("plansPage.history.title")}</span>
                </>
              )}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("plansPage.history.description")}
            </SheetDescription>
          </SheetHeader>
          <Separator className="mt-3" />

          {selectedVersionId ? (
            <div className="flex h-[calc(100%-60px)] min-h-0 flex-col">
              <div className="border-b border-border px-4 py-3">
                {versionQuery.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium">
                      {selectedVersion?.title ||
                        t("plansPage.history.untitled")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {selectedVersion
                        ? `${shortDate(selectedVersion.createdAt)} · ${planVersionSurfaceLabel(selectedVersion, t)}`
                        : t("plansPage.history.snapshotUnavailable")}
                    </p>
                  </>
                )}
              </div>
              <ScrollArea className="min-h-0 flex-1 bg-plan-document">
                {versionQuery.isLoading ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-48 w-full rounded-lg" />
                    <Skeleton className="h-28 w-full rounded-lg" />
                    <Skeleton className="h-28 w-full rounded-lg" />
                  </div>
                ) : selectedVersion?.plan.content ? (
                  <PlanContentRenderer
                    content={selectedVersion.plan.content}
                    fallbackTitle={selectedVersion.plan.title}
                    fallbackBrief={selectedVersion.plan.brief}
                    contentUpdatedAt={selectedVersion.plan.updatedAt}
                    editingDisabled
                    isRecap={selectedVersion.plan.kind === "recap"}
                    planId={null}
                  />
                ) : selectedVersion?.html ? (
                  <iframe
                    title={t("plansPage.history.previewTitle")}
                    srcDoc={selectedVersion.html}
                    // Stored plan HTML is agent-authored and may carry
                    // prompt-injected markup. Match the main document iframe
                    // (search "allow-forms allow-scripts"): run scripts only in
                    // an opaque origin — never allow-same-origin — so a malicious
                    // snapshot cannot reach the app origin's cookies, DOM, or
                    // actions.
                    sandbox="allow-forms allow-scripts"
                    className="h-[calc(100vh-142px)] w-full border-0 bg-background"
                  />
                ) : (
                  <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                    {t("plansPage.history.noPreview")}
                  </div>
                )}
              </ScrollArea>
              {canRestore ? (
                <div className="border-t border-border p-3">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => void restoreVersionById(selectedVersionId)}
                    disabled={
                      restoreVersion.isPending || versionQuery.isLoading
                    }
                  >
                    {restoreVersion.isPending ? (
                      <IconLoader2 className="size-4 animate-spin" />
                    ) : (
                      <IconRestore className="size-4" />
                    )}
                    {t("plansPage.history.restoreThisVersion")}
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    {t("plansPage.history.savedFirst")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <ScrollArea className="h-[calc(100%-60px)]">
              {versionsQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
              ) : versions.length ? (
                <div className="p-2">
                  {versions.map((version, index) => {
                    // Compute a diff summary when both this version and its
                    // predecessor have been loaded into the cache. Versions are
                    // ordered newest-first, so index+1 is the older snapshot.
                    // The oldest entry (no predecessor) shows "Initial version".
                    const cache = versionDetailCache.current;
                    const thisDetail = cache.get(version.id);
                    const olderVersion = versions[index + 1];
                    const olderDetail = olderVersion
                      ? cache.get(olderVersion.id)
                      : undefined;
                    // Show a diff when: this version's detail is loaded AND
                    // (it's the oldest OR the older neighbour's detail is loaded).
                    const isOldest = index === versions.length - 1;
                    const diffSummary =
                      thisDetail && (isOldest || olderDetail)
                        ? formatVersionDiffSummary(
                            diffPlanVersions(
                              {
                                content: thisDetail.plan.content,
                                sections: thisDetail.sections,
                                html: thisDetail.html,
                              },
                              isOldest
                                ? null
                                : {
                                    content: olderDetail!.plan.content,
                                    sections: olderDetail!.sections,
                                    html: olderDetail!.html,
                                  },
                            ),
                          )
                        : null;

                    return (
                      <div
                        key={version.id}
                        className="group relative rounded-lg transition-colors hover:bg-accent"
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedVersionId(version.id)}
                          className="w-full rounded-lg px-3 py-2.5 text-left"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/45">
                              <IconHistory className="size-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2 pr-7">
                                <p className="truncate text-sm font-medium">
                                  {version.title ||
                                    t("plansPage.history.untitled")}
                                </p>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {planVersionSurfaceLabel(version, t)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {shortDate(version.createdAt)}
                                {version.label ? ` · ${version.label}` : ""}
                              </p>
                              {diffSummary ? (
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                                  {diffSummary}
                                </p>
                              ) : version.preview ? (
                                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">
                                  {version.preview}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </button>
                        {canRestore ? (
                          <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={t(
                                    "plansPage.history.versionActions",
                                  )}
                                >
                                  <IconDots className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuItem
                                  onClick={(event) => {
                                    event.preventDefault();
                                    setRestoreCandidateId(version.id);
                                  }}
                                >
                                  <IconRestore className="size-4" />
                                  {t("plansPage.history.restoreThisVersion")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-6 py-14 text-center">
                  <IconHistory className="mx-auto mb-3 size-6 text-muted-foreground/60" />
                  <p className="text-sm font-medium">
                    {t("plansPage.history.noVersions")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("plansPage.history.noVersionsDescription")}
                  </p>
                </div>
              )}
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={Boolean(restoreCandidateId)}
        onOpenChange={(next) => {
          if (!next) setRestoreCandidateId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("plansPage.history.restoreConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("plansPage.history.restoreConfirmDescription", {
                date: restoreCandidate
                  ? shortDate(restoreCandidate.createdAt)
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreVersion.isPending}>
              {t("plansPage.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void restoreVersionById(restoreCandidateId);
              }}
              disabled={restoreVersion.isPending}
            >
              {restoreVersion.isPending
                ? t("plansPage.history.restoring")
                : t("plansPage.history.restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const CREATE_PLAN_PROMPTS = [
  {
    id: "checkout",
  },
  {
    id: "settings",
  },
  {
    id: "imported",
  },
] as const;

type CreatePlanKind = "auto" | "ui" | "questions" | "visual";
type ResolvedPlanKind = Exclude<CreatePlanKind, "auto">;
type AutoPlanKind = Exclude<ResolvedPlanKind, "questions">;

function isProbablyImportedPlan(prompt: string) {
  const trimmed = prompt.trim();
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (trimmed.length > 900 && lines.length > 8) return true;
  const hasHeading = lines.some((line) => /^#{1,4}\s+\S/.test(line.trim()));
  const checklistCount = lines.filter((line) =>
    /^[-*]\s+\[[ x]\]\s+\S/i.test(line.trim()),
  ).length;
  const taskCount = lines.filter((line) =>
    /^([-*]|\d+[.)])\s+\S/.test(line.trim()),
  ).length;
  const hasPlanLanguage =
    /\b(implementation plan|acceptance criteria|milestones?|phases?|risks?|open questions?|test plan)\b/i.test(
      trimmed,
    );
  return (
    trimmed.includes("```") ||
    (hasHeading && (taskCount >= 3 || hasPlanLanguage)) ||
    (checklistCount >= 2 && trimmed.length > 220)
  );
}

function assessPlanPrompt(prompt: string): {
  kind: AutoPlanKind;
} {
  let score = 0;
  let ambiguitySignals = 0;

  const wantsExploration =
    /\b(ask questions|questions first|intake first|show me options|explore options|help me choose|not sure|unsure|which direction|compare)\b/i.test(
      prompt,
    );
  const exactOrTrivial =
    /\b(typo|copy tweak|one line|single file|exactly|no questions|don't ask|dont ask|just implement)\b/i.test(
      prompt,
    );
  const uiDirection =
    /\b(ui|screen|screens|layout|wireframe|mockup|form factor|mobile|desktop|responsive|nav|sidebar|flow|redesign|empty state|loading state|error state)\b/i.test(
      prompt,
    );
  const multipleApproaches =
    /\b(option|variant|alternative|tradeoff|approach|architecture|data model|permission|auth|integration|migration|state machine)\b/i.test(
      prompt,
    );
  const newSurface =
    /\b(new surface|multi-screen|workflow|journey|end-to-end|dashboard|settings|checkout|onboarding|review flow)\b/i.test(
      prompt,
    );
  const risky =
    /\b(auth|permission|billing|migration|schema|integration|oauth|webhook|security|role|privacy|external)\b/i.test(
      prompt,
    );

  if (uiDirection) {
    score += 2;
    ambiguitySignals += 1;
  }
  if (multipleApproaches) {
    score += 2;
    ambiguitySignals += 1;
  }
  if (newSurface) score += 1;
  if (risky) score += 1;
  if (
    wantsExploration ||
    /\b(best|better|improve|explore|direction|choose)\b/i.test(prompt)
  ) {
    score += 1;
    ambiguitySignals += 1;
  }
  if (exactOrTrivial) score -= 3;

  if (uiDirection) {
    return {
      kind: "ui",
    };
  }

  return {
    kind: "visual",
  };
}

function sourceOptionDisplayLabel(
  source: PlanSource,
  t: ReturnType<typeof useT>,
) {
  return t(`plansPage.create.sourceOptions.${source}`);
}

function planKindDisplayLabel(
  kind: CreatePlanKind,
  t: ReturnType<typeof useT>,
) {
  return t(`plansPage.create.kindOptions.${kind}.label`);
}

function buildCreatePlanAgentMessage({
  prompt,
  source,
  planKind,
  t,
}: {
  prompt: string;
  source: PlanSource;
  planKind: CreatePlanKind;
  t: ReturnType<typeof useT>;
}) {
  const imported = isProbablyImportedPlan(prompt);
  const resolvedPlanKind =
    planKind === "auto" ? assessPlanPrompt(prompt).kind : planKind;
  const routing = imported
    ? "Build from this existing plan while preserving its intent."
    : resolvedPlanKind === "ui"
      ? "Create a UI-first plan with AI-authored wireframes and state coverage."
      : resolvedPlanKind === "questions"
        ? "Create visual intake questions before generating the final plan."
        : "Create a general visual plan with diagrams and implementation detail.";

  return [
    "Create an Agent-Native Plan from this request.",
    "",
    routing,
    `Source/provenance: ${sourceOptionDisplayLabel(source, t)}.`,
    "",
    "Use the Plan actions after you have enough substance. Generate the wireframes, diagrams, implementation map, review prompts, and concrete file/symbol notes yourself. Do not use placeholder file names, generic scaffold text, or browser-generated fallback sections as the final plan content.",
    "After creating the plan, open the plan link for review.",
    "",
    "Request:",
    prompt,
  ].join("\n");
}

function CreatePlanDialog({
  open,
  onOpenChange,
  canCreate,
  onRequireSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreate: boolean;
  onRequireSignIn: () => void;
}) {
  const t = useT();
  const [source, setSource] = useState<PlanSource>("codex");
  const [planKind, setPlanKind] = useState<CreatePlanKind>("auto");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptSeed, setPromptSeed] = useState("");
  const [promptSeedKey, setPromptSeedKey] = useState(0);
  // Gate the composer when signed in but nothing can run the agent (guests get
  // the sign-in path instead). Clears live when a key is added.
  const agentMissing = useAgentEngineConfigured(canCreate).missing;
  const composerLocked = !canCreate || agentMissing;

  useEffect(() => {
    if (open) return;
    setAdvancedOpen(false);
    setPromptText("");
    setPromptSeed("");
  }, [open]);

  const promptAssessment = promptText.trim()
    ? assessPlanPrompt(promptText)
    : null;
  const submit = (value: string) => {
    if (!canCreate) {
      onOpenChange(false);
      onRequireSignIn();
      return;
    }
    if (agentMissing) {
      toast.message(t("plansPage.create.agentMissing"));
      return;
    }
    const prompt = value.trim();
    if (!prompt) {
      toast.message(t("plansPage.create.describeFirst"));
      return;
    }
    sendToAgentChat({
      type: "content",
      submit: true,
      message: buildCreatePlanAgentMessage({ prompt, source, planKind, t }),
    });
    onOpenChange(false);
    toast.success(t("plansPage.create.sent"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{t("plansPage.create.title")}</DialogTitle>
          <DialogDescription>
            {t("plansPage.create.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {canCreate && agentMissing ? (
            <BuilderSetupCard
              fullWidth
              onConnected={() =>
                window.dispatchEvent(
                  new Event("agent-engine:configured-changed"),
                )
              }
            />
          ) : null}
          <div className="rounded-xl border border-border bg-background p-2 shadow-sm">
            <PromptComposer
              autoFocus
              disabled={composerLocked}
              attachmentsEnabled={false}
              showModelSelector={false}
              modelStatusChecksEnabled={false}
              placeholder={t("plansPage.create.placeholder")}
              draftScope="plans:create-plan"
              initialText={promptSeed}
              initialTextKey={promptSeedKey}
              onTextChange={setPromptText}
              onSubmit={submit}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {CREATE_PLAN_PROMPTS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full border-border/80 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                disabled={composerLocked}
                onClick={() => {
                  const presetPrompt = t(
                    `plansPage.create.presetPrompts.${preset.id}`,
                  );
                  setPromptSeed(presetPrompt);
                  setPromptSeedKey((key) => key + 1);
                  setPromptText(presetPrompt);
                }}
              >
                {t(`plansPage.create.presets.${preset.id}`)}
              </Button>
            ))}
          </div>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="font-medium">
                  {t("plansPage.create.advanced")}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">
                    {sourceOptionDisplayLabel(source, t)} ·{" "}
                    {planKind === "auto"
                      ? promptAssessment
                        ? t("plansPage.create.autoWithLabel", {
                            label: planKindDisplayLabel(
                              promptAssessment.kind,
                              t,
                            ),
                          })
                        : planKindDisplayLabel("auto", t)
                      : planKind === "ui"
                        ? planKindDisplayLabel("ui", t)
                        : planKind === "questions"
                          ? planKindDisplayLabel("questions", t)
                          : planKindDisplayLabel("visual", t)}
                  </span>
                  <IconChevronDown
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      advancedOpen && "rotate-180",
                    )}
                  />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">
                    {t("plansPage.create.source")}
                  </span>
                  <Select
                    value={source}
                    onValueChange={(value) => setSource(value as PlanSource)}
                  >
                    <SelectTrigger aria-label={t("plansPage.create.source")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {sourceOptionDisplayLabel(option.value, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("plansPage.create.sourceHelp")}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">
                    {t("plansPage.create.planningStyle")}
                  </span>
                  <Select
                    value={planKind}
                    onValueChange={(value) =>
                      setPlanKind(
                        value === "auto"
                          ? "auto"
                          : value === "visual"
                            ? "visual"
                            : value === "questions"
                              ? "questions"
                              : "ui",
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={t("plansPage.create.planningStyle")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t("plansPage.create.kindOptions.auto.description")}
                      </SelectItem>
                      <SelectItem value="ui">
                        {t("plansPage.create.kindOptions.ui.description")}
                      </SelectItem>
                      <SelectItem value="questions">
                        {t(
                          "plansPage.create.kindOptions.questions.description",
                        )}
                      </SelectItem>
                      <SelectItem value="visual">
                        {t("plansPage.create.kindOptions.visual.description")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("plansPage.create.planningHelp")}
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
          {promptAssessment && planKind === "auto" ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t(`plansPage.create.assessment.${promptAssessment.kind}`)}
            </p>
          ) : null}
          {promptText.trim() && isProbablyImportedPlan(promptText) ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t("plansPage.create.importDetected")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommentMentionEditor({
  initialMessage,
  resetKey,
  placeholder,
  className,
  autoFocus,
  onChange,
  onSubmitShortcut,
}: {
  initialMessage?: string;
  resetKey?: string;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
  onChange: (draft: Pick<CommentDraft, "message" | "mentions">) => void;
  onSubmitShortcut?: () => void;
}) {
  const t = useT();
  const editorRef = useRef<HTMLDivElement>(null);
  const activeQueryRef = useRef<ReturnType<typeof mentionQueryAtCaret>>(null);
  const onChangeRef = useRef(onChange);
  const [query, setQuery] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [empty, setEmpty] = useState(true);
  const { members, isLoading } = useOrgMemberMentionSearch(query);
  onChangeRef.current = onChange;

  const emitChange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const message = serializeCommentEditor(root);
    setEmpty(message.length === 0);
    onChangeRef.current({
      message,
      mentions: extractCommentMentions(message),
    });
    const nextQuery = mentionQueryAtCaret(root);
    activeQueryRef.current = nextQuery;
    setQuery(nextQuery?.query ?? null);
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    appendMessageToEditor(root, initialMessage ?? "");
    emitChange();
    if (autoFocus) {
      root.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [autoFocus, emitChange, initialMessage, resetKey]);

  const selectMember = (member: OrgMemberSuggestion) => {
    const root = editorRef.current;
    const active = activeQueryRef.current;
    if (!root || !active) return;
    const label = displayNameForMention(member.email);
    const range = active.range.cloneRange();
    range.deleteContents();
    const chip = createMentionChip({
      email: member.email,
      label,
      role: member.role,
    });
    const trailing = document.createTextNode(" ");
    range.insertNode(trailing);
    range.insertNode(chip);
    range.setStartAfter(trailing);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setQuery(null);
    activeQueryRef.current = null;
    emitChange();
  };

  const suggestionsOpen = query !== null;

  return (
    <div className="relative min-w-0 flex-1">
      {empty && (
        <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">
          {placeholder}
        </span>
      )}
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-plan-interactive
        className={cn(
          "min-h-11 max-h-36 overflow-y-auto rounded-md border border-border/80 bg-background px-3 py-2.5 text-sm leading-6 shadow-none outline-none focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
        onInput={emitChange}
        onKeyUp={emitChange}
        onMouseUp={emitChange}
        onKeyDown={(event) => {
          if (suggestionsOpen && event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((index) =>
              members.length === 0 ? 0 : (index + 1) % members.length,
            );
            return;
          }
          if (suggestionsOpen && event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((index) =>
              members.length === 0
                ? 0
                : (index - 1 + members.length) % members.length,
            );
            return;
          }
          if (suggestionsOpen && event.key === "Enter" && members[0]) {
            event.preventDefault();
            selectMember(members[selectedIndex] ?? members[0]);
            return;
          }
          if (suggestionsOpen && event.key === "Escape") {
            event.preventDefault();
            setQuery(null);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmitShortcut?.();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmitShortcut?.();
          }
        }}
      />
      {suggestionsOpen && (
        <div
          role="listbox"
          aria-label={t("plansPage.comments.mentionMember")}
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(320px,calc(100vw-48px))] overflow-hidden rounded-xl border border-border/80 bg-background/98 p-1 shadow-2xl backdrop-blur-xl"
        >
          {isLoading && members.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("plansPage.comments.searchingPeople")}
            </div>
          ) : members.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("plansPage.comments.noMatchingMembers")}
            </div>
          ) : (
            members.map((member, index) => {
              const name = displayNameForMention(member.email);
              return (
                <button
                  key={member.email}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  data-plan-interactive
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                    index === selectedIndex
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground hover:bg-muted",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMember(member)}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <IconAt className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ResolutionTargetToggle({
  value,
  onChange,
}: {
  value: PlanCommentResolutionTarget;
  onChange: (value: PlanCommentResolutionTarget) => void;
}) {
  const t = useT();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "agent" || next === "human") onChange(next);
      }}
      variant="default"
      size="sm"
      className="w-fit gap-0.5 rounded-md border border-border/70 bg-muted/35 p-0.5"
      aria-label={t("plansPage.comments.expectedResolver")}
    >
      <ToggleGroupItem value="agent" className="h-7 gap-1.5 px-2 text-xs">
        <IconSend className="size-3.5" />
        {t("plansPage.comments.agent")}
      </ToggleGroupItem>
      <ToggleGroupItem value="human" className="h-7 gap-1.5 px-2 text-xs">
        <IconMessageCircle className="size-3.5" />
        {t("plansPage.comments.human")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function InlineCommentPopover({
  position,
  initialDraft,
  onCancel,
  onSubmit,
  lockToAgent = false,
}: {
  position: InlineCommentPosition;
  initialDraft: CommentDraft;
  onCancel: () => void;
  onSubmit: (draft: CommentDraft) => Promise<void>;
  lockToAgent?: boolean;
}) {
  const t = useT();
  const initialMessageRef = useRef(initialDraft.message);
  const [draft, setDraft] = useState<CommentDraft>(initialDraft);
  const [resolverTouched, setResolverTouched] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const canSubmit = canSubmitInlineCommentDraft({
    draft,
    isSubmitting,
    lockToAgent,
  });
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitError(false);
    setIsSubmitting(true);
    try {
      await onSubmit({
        ...draft,
        message: draft.message.trim(),
        resolutionTarget: lockToAgent
          ? "agent"
          : !resolverTouched && draft.mentions.length > 0
            ? "human"
            : draft.resolutionTarget,
      });
    } catch {
      if (mountedRef.current) {
        setSubmitError(true);
      }
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };
  return (
    <div
      data-plan-interactive
      className="absolute z-30 rounded-xl border border-border/80 bg-background/96 p-2 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        {lockToAgent ? (
          <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
            <IconSend className="size-3.5" />
            {t("plansPage.comments.toAgent")}
          </span>
        ) : (
          <ResolutionTargetToggle
            value={draft.resolutionTarget}
            onChange={(resolutionTarget) => {
              setResolverTouched(true);
              setDraft((current) => ({ ...current, resolutionTarget }));
            }}
          />
        )}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            onClick={onCancel}
            aria-label={t("plansPage.comments.cancelComment")}
          >
            <IconX className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <CommentMentionEditor
          initialMessage={initialMessageRef.current}
          placeholder={t("plansPage.comments.addPlaceholder")}
          autoFocus
          onSubmitShortcut={submit}
          onChange={(value) =>
            setDraft((current) => {
              const addedMention =
                value.mentions.length > current.mentions.length;
              return {
                ...current,
                ...value,
                resolutionTarget: resolverTouched
                  ? current.resolutionTarget
                  : addedMention
                    ? "human"
                    : current.resolutionTarget,
              };
            })
          }
        />
        <Button
          type="button"
          size="sm"
          className="h-11 w-[60px] shrink-0 px-0"
          onClick={submit}
          disabled={!canSubmit}
        >
          {isSubmitting
            ? t("plansPage.comments.saving")
            : t("plansPage.common.save")}
        </Button>
      </div>
      {submitError && (
        <p className="mt-2 px-1 text-xs text-destructive">
          {t("plansPage.comments.saveFailed")}
        </p>
      )}
    </div>
  );
}

function GuestCommentCta({
  position,
  onSignIn,
  onCancel,
}: {
  position: InlineCommentPosition;
  onSignIn: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div
      data-plan-interactive
      className="absolute z-30 rounded-xl border border-border/80 bg-background/96 p-4 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {t("plansPage.comments.signInTitle")}
        </p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          onClick={onCancel}
          aria-label={t("plansPage.common.cancel")}
        >
          <IconX className="size-3.5" />
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("plansPage.comments.signInDescription")}
      </p>
      <Button type="button" size="sm" className="w-full" onClick={onSignIn}>
        {t("plansPage.loadError.signIn")}
      </Button>
    </div>
  );
}

function CommentThreadMessage({
  comment,
  action,
}: {
  comment: RuntimeAnnotationComment;
  action?: ReactNode;
}) {
  const author = runtimeCommentFromAuthor(comment);
  return (
    <div className="flex items-start gap-3">
      <CommentAvatar author={author} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="truncate text-sm font-semibold">{author.name}</p>
          {comment.createdAt && (
            <p className="shrink-0 text-[11px] text-muted-foreground">
              {shortDate(comment.createdAt)}
            </p>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
          {renderCommentMessage(comment.message)}
        </p>
      </div>
      {action}
    </div>
  );
}

function CommentDeleteButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          aria-label={label}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ReplyComposer({
  author,
  isPending,
  placeholder,
  onSubmit,
}: {
  author: CommentAuthorPresentation;
  isPending: boolean;
  placeholder?: string;
  onSubmit: (message: string) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<
    Pick<CommentDraft, "message" | "mentions">
  >({
    message: "",
    mentions: [],
  });
  const [submitError, setSubmitError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const canSubmit =
    commentBodyText(draft.message).length > 0 && !isSubmitting && !isPending;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitError(false);
    setIsSubmitting(true);
    try {
      await onSubmit(draft.message.trim());
      setDraft({ message: "", mentions: [] });
      setResetKey((key) => key + 1);
    } catch {
      setSubmitError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-end gap-2">
        <CommentAvatar author={author} size="md" className="mb-1" />
        <div className="flex min-w-0 flex-1 items-end gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 py-2 focus-within:border-primary/60 focus-within:bg-background">
          <CommentMentionEditor
            placeholder={
              placeholder ?? t("plansPage.comments.replyPlaceholder")
            }
            resetKey={`reply-${resetKey}`}
            className="min-h-10 border-0 bg-transparent px-0 py-2 shadow-none focus-visible:ring-0"
            onChange={setDraft}
            onSubmitShortcut={() => void submit()}
          />
          <Button
            type="button"
            size="icon"
            className="mb-0.5 size-8 shrink-0 rounded-full"
            onClick={() => void submit()}
            disabled={!canSubmit}
            aria-label={t("plansPage.comments.sendReply")}
          >
            {isSubmitting ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconSend className="size-4" />
            )}
          </Button>
        </div>
      </div>
      {submitError && (
        <p className="ml-11 text-xs text-destructive">
          {t("plansPage.comments.sendFailed")}
        </p>
      )}
    </div>
  );
}

function AnnotationPopover({
  annotation,
  position,
  isPending,
  pendingAuthor,
  canEditRootComment,
  onSave,
  onReply,
  canResolve,
  onStatusChange,
  canDelete,
  onDelete,
  canDeleteComment,
  onDeleteComment,
  onClose,
}: {
  annotation: RuntimeAnnotation;
  position: InlineCommentPosition;
  isPending: boolean;
  pendingAuthor: CommentAuthorPresentation;
  canEditRootComment: boolean;
  onSave: (message: string) => void;
  onReply: (threadRootId: string, message: string) => Promise<void>;
  canResolve: boolean;
  onStatusChange: (status: PlanBundle["comments"][number]["status"]) => void;
  canDelete: boolean;
  onDelete: () => void;
  canDeleteComment: (comment: RuntimeAnnotationComment) => boolean;
  onDeleteComment: (commentId: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [messageDraft, setMessageDraft] = useState<
    Pick<CommentDraft, "message" | "mentions">
  >({
    message: annotation.message,
    mentions: extractCommentMentions(annotation.message),
  });
  // Reset edit state when the user opens a different comment pin.
  useEffect(() => {
    setEditing(false);
  }, [annotation.id]);
  useEffect(() => {
    // Don't clobber in-progress edits when poll-driven annotation refreshes
    // arrive (Issue 4b). Only sync the display message while NOT editing.
    // When editing ends (editing flips false), this effect re-runs and picks
    // up any fresh server state that arrived during the edit session.
    if (editing) return;
    setMessageDraft({
      message: annotation.message,
      mentions: extractCommentMentions(annotation.message),
    });
  }, [annotation.id, annotation.message, annotation.commentCount, editing]);
  const rootComment = runtimeAnnotationRootComment(annotation);
  const replies = annotation.replies ?? [];
  const annotationComments = [rootComment, ...replies];
  const rootDeleteLabel = deleteCommentLabel(
    commentDescendantCount(annotationComments, rootComment.id),
    t,
  );
  const canSave =
    canEditRootComment && messageDraft.message.trim().length > 0 && !isPending;
  const hasOptions = canResolve || canEditRootComment || canDelete;
  const resolver = normalizePlanCommentResolutionTarget(
    annotation.anchor.resolutionTarget,
  );
  const isResolved = annotation.status === "resolved";
  const save = () => {
    if (!canSave) return;
    onSave(messageDraft.message.trim());
  };

  // Escape key closes the popover.
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  // Pointer-down outside the popover closes it. Clicks on comment marker
  // buttons (data-comment-marker) are intentionally allowed through so switching
  // to another pin still works without double-clicking.
  useEffect(() => {
    if (!onClose) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        shouldKeepCommentPopoverOpenForTarget(event.target, popoverRef.current)
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      data-plan-interactive
      className="pointer-events-auto absolute z-30 flex max-h-[min(520px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/96 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">
            {t("plansPage.comments.comment")}
          </h2>
          {annotation.commentCount > 1 && (
            <Badge variant="secondary" className="h-5 rounded-md px-1.5">
              {annotation.commentCount}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="h-5 rounded-md px-1.5 text-[11px]"
          >
            {resolver === "human"
              ? t("plansPage.comments.humanReview")
              : t("plansPage.comments.agentAction")}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasOptions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={t("plansPage.comments.options")}
                >
                  <IconDotsVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 rounded-xl"
                data-comment-popover-portal
              >
                {canResolve && (
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() =>
                      onStatusChange(isResolved ? "open" : "resolved")
                    }
                  >
                    <IconCircleCheck className="size-4" />
                    {isResolved
                      ? t("plansPage.comments.reopenThread")
                      : t("plansPage.comments.markResolved")}
                  </DropdownMenuItem>
                )}
                {canEditRootComment && (
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => setEditing(true)}
                  >
                    <IconPencil className="size-4" />
                    {t("plansPage.comments.editFirstComment")}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 text-destructive focus:text-destructive"
                      onClick={onDelete}
                    >
                      <IconTrash className="size-4" />
                      {rootDeleteLabel}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canResolve && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant={isResolved ? "secondary" : "ghost"}
                  className="size-8 shrink-0 rounded-full"
                  onClick={() =>
                    onStatusChange(isResolved ? "open" : "resolved")
                  }
                  aria-label={
                    isResolved
                      ? t("plansPage.comments.reopenThread")
                      : t("plansPage.comments.markResolved")
                  }
                >
                  <IconCircleCheck className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isResolved
                  ? t("plansPage.comments.reopenThread")
                  : t("plansPage.comments.markResolved")}
              </TooltipContent>
            </Tooltip>
          )}
          {onClose && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              onClick={onClose}
              aria-label={t("plansPage.comments.closeComment")}
            >
              <IconX className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="max-h-[min(360px,calc(100vh-180px))] overflow-y-auto">
        <div className="grid gap-4 p-4">
          {editing ? (
            <div className="grid gap-2">
              <CommentMentionEditor
                initialMessage={annotation.message}
                resetKey={`edit-${annotation.id}-${editing ? "on" : "off"}`}
                placeholder={t("plansPage.comments.editPlaceholder")}
                autoFocus
                className="min-h-24"
                onChange={setMessageDraft}
                onSubmitShortcut={save}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setMessageDraft({
                      message: annotation.message,
                      mentions: extractCommentMentions(annotation.message),
                    });
                  }}
                >
                  {t("plansPage.common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={save}
                  disabled={!canSave}
                >
                  {t("plansPage.common.save")}
                </Button>
              </div>
            </div>
          ) : (
            <CommentThreadMessage comment={rootComment} />
          )}
          {replies.map((reply) => {
            const replyDeleteLabel = deleteCommentLabel(
              commentDescendantCount(annotationComments, reply.id),
              t,
            );
            return (
              <CommentThreadMessage
                key={reply.id}
                comment={reply}
                action={
                  canDeleteComment(reply) ? (
                    <CommentDeleteButton
                      label={replyDeleteLabel}
                      onClick={() => onDeleteComment(reply.id)}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-border/70 p-3">
        <ReplyComposer
          author={pendingAuthor}
          isPending={isPending}
          onSubmit={(reply) => onReply(annotation.id, reply)}
        />
      </div>
    </div>
  );
}

function AnnotationsPanel({
  threads,
  showResolvedComments,
  avatarUrls,
  currentUser,
  pendingAuthor,
  isPending,
  onReply,
  canResolve,
  canDeleteThread,
  canDeleteComment,
  onStatusChange,
  onDeleteThread,
  onDeleteComment,
  onClose,
}: {
  threads: CommentThread[];
  showResolvedComments: boolean;
  avatarUrls: Record<string, string | null>;
  currentUser?: CurrentCommentAuthor | null;
  pendingAuthor: CommentAuthorPresentation;
  isPending: boolean;
  onReply: (threadRootId: string, message: string) => Promise<void>;
  canResolve: boolean;
  canDeleteThread: (thread: CommentThread) => boolean;
  canDeleteComment: (comment: PlanCommentItem) => boolean;
  onStatusChange: (
    thread: CommentThread,
    status: PlanBundle["comments"][number]["status"],
  ) => void;
  onDeleteThread: (thread: CommentThread) => void;
  onDeleteComment: (thread: CommentThread, commentId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLElement>(null);
  const [filterTab, setFilterTab] = useState<"open" | "resolved">("open");

  useEffect(() => {
    if (!showResolvedComments && filterTab === "resolved") {
      setFilterTab("open");
    }
  }, [filterTab, showResolvedComments]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, []);

  // Escape closes the panel and attempts to return focus to the toolbar
  // trigger that opened it (the "Plan actions" dots button).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only handle Escape if focus is inside this panel.
      if (!panelRef.current?.contains(document.activeElement)) return;
      onClose();
      // Return focus to the toolbar dots-menu trigger if reachable.
      const trigger = document.querySelector<HTMLElement>(
        "[data-plan-actions-trigger]",
      );
      trigger?.focus();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);
  const openThreads = threads.filter(
    (thread) => commentThreadStatus(thread) === "open",
  );
  const resolvedThreads = showResolvedComments
    ? threads.filter((thread) => commentThreadStatus(thread) === "resolved")
    : [];
  const visibleThreads =
    showResolvedComments && filterTab === "resolved"
      ? resolvedThreads
      : openThreads;
  return (
    <aside
      ref={panelRef}
      data-plan-interactive
      className="absolute right-3 top-16 z-20 flex h-[min(640px,calc(100%-5rem))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/96 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">
            {t("plansPage.comments.comments")}
          </h2>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onClose}
          aria-label={t("plansPage.comments.closeComments")}
        >
          <IconX className="size-4" />
        </Button>
      </div>
      {showResolvedComments && (
        <div className="shrink-0 border-b border-border/60 px-3 py-2">
          <Tabs
            value={filterTab}
            onValueChange={(v) =>
              setFilterTab(v === "resolved" ? "resolved" : "open")
            }
          >
            <TabsList className="h-7 gap-0.5 rounded-lg p-0.5">
              <TabsTrigger value="open" className="h-6 gap-1.5 px-2 text-xs">
                {t("plansPage.comments.open")}
                {openThreads.length > 0 && (
                  <span className="rounded-md bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                    {openThreads.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="resolved"
                className="h-6 gap-1.5 px-2 text-xs"
              >
                {t("plansPage.comments.resolved")}
                {resolvedThreads.length > 0 && (
                  <span className="rounded-md bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                    {resolvedThreads.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {visibleThreads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
              {showResolvedComments && filterTab === "resolved"
                ? t("plansPage.comments.noResolved")
                : t("plansPage.comments.noOpen")}
            </p>
          ) : (
            visibleThreads.map((thread) => {
              const isResolved = commentThreadStatus(thread) === "resolved";
              const canDelete = canDeleteThread(thread);
              const rootDeleteLabel = deleteCommentLabel(
                commentDescendantCount(thread.comments, thread.root.id),
                t,
              );
              return (
                <article
                  key={thread.id}
                  className={cn(
                    "grid gap-3 rounded-lg border border-border/80 bg-muted/20 p-3",
                    isResolved && "opacity-70",
                  )}
                >
                  {(thread.anchor || canResolve || canDelete) && (
                    <div className="flex items-start gap-2">
                      {thread.anchor && (
                        <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {normalizePlanCommentResolutionTarget(
                              thread.anchor.resolutionTarget,
                            ) === "human"
                              ? t("plansPage.comments.humanReview")
                              : t("plansPage.comments.agentAction")}
                          </span>
                          {" · "}
                          {formatAnchorForAgent(thread.anchor)}
                        </div>
                      )}
                      {canResolve && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant={isResolved ? "secondary" : "ghost"}
                                className="size-8 rounded-full"
                                onClick={() =>
                                  onStatusChange(
                                    thread,
                                    isResolved ? "open" : "resolved",
                                  )
                                }
                                aria-label={
                                  isResolved
                                    ? t("plansPage.comments.reopenThread")
                                    : t("plansPage.comments.markResolved")
                                }
                              >
                                <IconCircleCheck className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isResolved
                                ? t("plansPage.comments.reopenThread")
                                : t("plansPage.comments.markResolved")}
                            </TooltipContent>
                          </Tooltip>
                          {canDelete && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => onDeleteThread(thread)}
                                  aria-label={rootDeleteLabel}
                                >
                                  <IconTrash className="size-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{rootDeleteLabel}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                      {!canResolve && canDelete && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => onDeleteThread(thread)}
                              aria-label={rootDeleteLabel}
                            >
                              <IconTrash className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{rootDeleteLabel}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}
                  {thread.comments.map((comment) => {
                    const runtimeComment = runtimeCommentFromPlanComment(
                      comment,
                      avatarUrls,
                      currentUser,
                    );
                    const commentDeleteLabel = deleteCommentLabel(
                      commentDescendantCount(thread.comments, comment.id),
                      t,
                    );
                    return (
                      <CommentThreadMessage
                        key={comment.id}
                        comment={runtimeComment}
                        action={
                          comment.id !== thread.root.id &&
                          canDeleteComment(comment) ? (
                            <CommentDeleteButton
                              label={commentDeleteLabel}
                              onClick={() =>
                                onDeleteComment(thread, comment.id)
                              }
                            />
                          ) : undefined
                        }
                      />
                    );
                  })}
                  <ReplyComposer
                    author={pendingAuthor}
                    isPending={isPending}
                    onSubmit={(reply) => onReply(thread.id, reply)}
                  />
                </article>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function DeleteCommentDialog({
  open,
  replyCount,
  isDeleting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  replyCount: number;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {replyCount > 0
              ? t("plansPage.comments.deleteThreadTitle")
              : t("plansPage.comments.deleteCommentTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {replyCount > 0
              ? t("plansPage.comments.deleteThreadDescription", {
                  count: replyCount,
                })
              : t("plansPage.comments.deleteCommentDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("plansPage.common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isDeleting}
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting
              ? t("plansPage.common.deleting")
              : t("plansPage.common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function hardDeletePlanPhrase(planId: string) {
  return `DELETE ${planId}`;
}

function DeletePlanDialog({
  request,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  request: DeletePlanRequest | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: "soft" | "hard", confirmation?: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [confirmation, setConfirmation] = useState("");
  const plan = request?.plan ?? null;
  const hardOnly = Boolean(plan?.deletedAt);
  const effectiveMode = hardOnly ? "hard" : mode;
  const phrase = plan ? hardDeletePlanPhrase(plan.id) : "";
  const noun = plan?.kind === "recap" ? "recap" : "plan";
  const nounLabel =
    plan?.kind === "recap"
      ? t("plansPage.nouns.recap")
      : t("plansPage.nouns.plan");
  const canSubmit =
    Boolean(plan) &&
    !isPending &&
    (effectiveMode === "soft" || confirmation.trim() === phrase);

  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    setConfirmation("");
  }, [request?.mode, request?.plan.id, request]);

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {effectiveMode === "hard"
              ? t("plansPage.deletePlan.hardTitle", { noun: nounLabel })
              : t("plansPage.deletePlan.softTitle", { noun: nounLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("plansPage.deletePlan.description", {
              title: plan?.title ?? t("plansPage.deletePlan.fallbackTitle"),
            })}
          </DialogDescription>
        </DialogHeader>

        {!hardOnly && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setMode("soft");
                setConfirmation("");
              }}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors",
                effectiveMode === "soft"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent/40",
              )}
            >
              <span className="font-medium">
                {t("plansPage.deletePlan.moveToDeleted")}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t("plansPage.deletePlan.softOptionDescription")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("hard")}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors",
                effectiveMode === "hard"
                  ? "border-destructive bg-destructive/5"
                  : "border-border hover:bg-accent/40",
              )}
            >
              <span className="font-medium text-destructive">
                {t("plansPage.deletePlan.deletePermanently")}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t("plansPage.deletePlan.hardOptionDescription")}
              </span>
            </button>
          </div>
        )}

        {effectiveMode === "soft" ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
            {t("plansPage.deletePlan.softDescription", { noun: nounLabel })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-destructive">
                    {t("plansPage.deletePlan.permanentWarning")}
                  </p>
                  <p className="leading-6 text-muted-foreground">
                    {t("plansPage.deletePlan.permanentDescription", {
                      noun: nounLabel,
                    })}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hard-delete-plan-confirmation">
                {t("plansPage.deletePlan.typePrefix")}{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {phrase}
                </code>{" "}
                {t("plansPage.deletePlan.typeSuffix")}
              </Label>
              <Input
                id="hard-delete-plan-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                placeholder={phrase}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("plansPage.common.cancel")}
          </Button>
          <Button
            type="button"
            variant={effectiveMode === "hard" ? "destructive" : "default"}
            disabled={!canSubmit}
            onClick={() =>
              onConfirm(
                effectiveMode,
                effectiveMode === "hard" ? confirmation.trim() : undefined,
              )
            }
          >
            {isPending
              ? t("plansPage.common.deleting")
              : effectiveMode === "hard"
                ? t("plansPage.deletePlan.deletePermanently")
                : t("plansPage.deletePlan.moveToDeleted")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseAnchor(anchor: string | PlanAnnotationAnchor | null | undefined) {
  const parsed = parsePlanCommentAnchor(anchor);
  if (typeof parsed?.x === "number" && typeof parsed.y === "number") {
    return parsed as PlanAnnotationAnchor;
  }
  return null;
}

function parseAnchorForComment(comment: PlanCommentItem) {
  const parsed = parseAnchor(comment.anchor);
  if (!parsed) return null;
  return {
    ...parsed,
    resolutionTarget: normalizePlanCommentResolutionTarget(
      comment.resolutionTarget ?? parsed.resolutionTarget,
    ),
    mentions:
      comment.mentions && comment.mentions.length > 0
        ? comment.mentions
        : parsed.mentions,
  } satisfies PlanAnnotationAnchor;
}

function formatAnchorForAgent(anchor: PlanAnnotationAnchor | null) {
  return formatPlanCommentAnchorForAgent(anchor);
}

function buildClientPlanHtml(
  bundle: PlanBundle,
  labels: {
    workingPlan: string;
  },
) {
  const escape = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const metaHtml = [
    bundle.plan.source,
    ...(ENABLE_PLAN_STATUS_FEATURE ? [statusLabel(bundle.plan.status)] : []),
  ]
    .map((item) => `<li>${escape(item)}</li>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escape(
    bundle.plan.title,
  )}</title><style>
  :root{color-scheme:dark;--bg:#0a0a0b;--paper:#111113;--line:#28282c;--text:#f2f2f3;--muted:#a4a4aa;--accent:#00B5FF}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}main{width:min(1080px,calc(100vw - 48px));margin:0 auto;padding:96px 0 96px}h1{max-width:760px;margin:0;font-size:clamp(36px,5vw,58px);line-height:1.03;letter-spacing:-.04em}.lede{max-width:760px;margin:20px 0 0;color:#d7d7da;font-size:clamp(18px,2vw,23px);line-height:1.45}.meta{display:grid;gap:7px;margin:24px 0 0;padding-left:20px;color:var(--muted);font-size:13px}.meta li::marker{color:var(--accent)}.section{margin-top:70px;padding-top:46px;border-top:1px solid var(--line)}.type{margin:0 0 12px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.section h2{margin:0;font-size:clamp(26px,4vw,42px);letter-spacing:-.035em}.section p{max-width:760px;color:#d7d7da;font-size:17px}.visual{margin:24px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.visual i{display:block;height:120px;border:1px solid rgba(0,181,255,.25);border-radius:14px;background:rgba(0,181,255,.12)}@media(max-width:760px){.visual{grid-template-columns:1fr}main{width:min(100vw - 24px,980px);padding-top:72px}}
  </style></head><body><main><p class="type">${escape(labels.workingPlan)}</p><h1>${escape(
    bundle.plan.title,
  )}</h1><p class="lede">${escape(
    bundle.plan.brief,
  )}</p><ul class="meta">${metaHtml}</ul>${bundle.sections
    .map(
      (section) =>
        `<section class="section"><p class="type">${escape(section.type)}</p><h2>${escape(section.title)}</h2>${["diagram", "wireframe", "prototype"].includes(section.type) ? '<div class="visual"><i></i><i></i><i></i></div>' : ""}<p>${escape(section.body)}</p></section>`,
    )
    .join("")}</main></body></html>`;
}
