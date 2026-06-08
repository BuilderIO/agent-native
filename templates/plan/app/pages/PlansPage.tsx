import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  IconAt,
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconAlertTriangle,
  IconChevronDown,
  IconClipboardText,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconFileZip,
  IconDotsVertical,
  IconHistory,
  IconLayoutSidebarRight,
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
  IconRefresh,
  IconRestore,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import JSZip from "jszip";
import html2canvas from "html2canvas";
import {
  SIDEBAR_STATE_CHANGE_EVENT,
  PromptComposer,
  ShareButton,
  appPath,
  agentNativePath,
  sendToAgentChat,
  setAgentChatContextItem,
  useActionQuery,
  useSession,
  emailToColor,
  emailToName,
  type AgentSidebarStateChangeDetail,
  type RichMarkdownCollabUser,
} from "@agent-native/core/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import { PlanContentRenderer } from "@/components/plan/PlanContentRenderer";
import type { PlanVisualSurfaceMode } from "@/components/plan/PlanVisualSurface";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "@/components/plan/wireframe/use-wireframe-style";
import type {
  CanvasMarkupCreateContext,
  CanvasMarkupMode,
} from "@/components/plan/CanvasArea";
import {
  usePlan,
  usePlans,
  useConvertVisualPlanToPrototype,
  usePlanVersion,
  usePlanVersions,
  usePublishVisualPlan,
  useRestorePlanVersion,
  useUpdatePlan,
  useExportPlan,
  type PublishVisualPlanResult,
} from "@/hooks/use-plans";
import { cn } from "@/lib/utils";
import type { PlanBundle, PlanSource, PlanVersionSummary } from "@shared/types";
import {
  extractCommentMentions,
  formatPlanCommentAnchorForAgent,
  formatPlanCommentMentionToken,
  normalizePlanCommentResolutionTarget,
  parsePlanCommentAnchor,
  planCommentAnchorDetails,
  type PlanCommentAnchor,
  type PlanCommentMention,
  type PlanCommentResolutionTarget,
} from "@shared/comment-context";
import type {
  PlanAnnotation,
  PlanBlock,
  PlanContent,
  PlanContentPatch,
} from "@shared/plan-content";

const SOURCE_OPTIONS: Array<{ value: PlanSource; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "pi", label: "Pi" },
  { value: "manual", label: "Manual" },
  { value: "imported", label: "Imported" },
];

const PLAN_READER_VIEW_EVENT = "plans-reader-view-change";
const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";
const AUTO_DEV_COMMENT_EMAILS = new Set(["dev@local.test", "dev@local"]);
const CURRENT_USER_FALLBACK_NAME = "You";
const CURRENT_USER_FALLBACK_INITIALS = "You";
const CURRENT_USER_FALLBACK_COLOR = "#2563eb";

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

type PlanAnnotationAnchor = PlanCommentAnchor & { x: number; y: number };

type CommentDraft = {
  message: string;
  mentions: PlanCommentMention[];
  resolutionTarget: PlanCommentResolutionTarget;
};

type OrgMemberSuggestion = {
  email: string;
  role?: string;
};

type RuntimeAnnotation = {
  id: string;
  index: number;
  message: string;
  kind: string;
  status: string;
  createdBy: string;
  parentCommentId?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  authorColor?: string | null;
  authorInitials?: string | null;
  sectionId?: string | null;
  createdAt?: string;
  anchor: PlanAnnotationAnchor;
  replies: RuntimeAnnotationComment[];
  participants: RuntimeAnnotationParticipant[];
  commentCount: number;
};

type RuntimeAnnotationComment = {
  id: string;
  message: string;
  status: string;
  createdBy: string;
  parentCommentId?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  authorColor?: string | null;
  authorInitials?: string | null;
  createdAt?: string;
};

type RuntimeAnnotationParticipant = {
  id: string;
  authorEmail?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  authorColor?: string | null;
  authorInitials?: string | null;
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

type PlanCommentItem = PlanBundle["comments"][number];

type CommentThread = {
  id: string;
  root: PlanCommentItem;
  replies: PlanCommentItem[];
  comments: PlanCommentItem[];
  anchor: PlanAnnotationAnchor | null;
};

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
  if (source.createdBy === "agent") return "Agent";
  if (source.createdBy === "import") return "Imported";
  return "Reviewer";
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

function displayNameForMention(email: string) {
  return emailToName(email).replace(/\s+/g, " ").trim() || email;
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
    const email = decodeURIComponent(match[2] ?? "");
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percent(value: number, total: number) {
  return clamp((value / Math.max(total, 1)) * 100, 0, 100);
}

const PLAN_TEXT_TARGET_SELECTOR = [
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
  "[data-plan-text]",
].join(",");

const PLAN_VISUAL_TARGET_SELECTOR = [
  "img",
  "svg",
  "canvas",
  "video",
  "iframe",
  "table",
  "pre",
  "code",
  "[data-plan-prototype-viewer]",
  "[data-prototype-screen]",
  "[data-canvas-frame]",
  ".plan-artboard-frame",
  ".plan-block",
].join(",");

function normalizedElementText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function textSnippetFromElement(element: Element | null, max = 220) {
  if (!element) return "";
  return normalizedElementText(element.textContent).slice(0, max);
}

function textQuoteContextForBlock(input: {
  block: Element | null;
  quote: string;
  radius?: number;
}) {
  const quote = normalizedElementText(input.quote);
  const blockText = normalizedElementText(input.block?.textContent);
  if (!quote || !blockText) return {};
  const index = blockText.indexOf(quote);
  if (index < 0) return {};
  const radius = input.radius ?? 60;
  const contextBefore = blockText.slice(Math.max(0, index - radius), index);
  const contextAfter = blockText.slice(
    index + quote.length,
    index + quote.length + radius,
  );
  const secondIndex = blockText.indexOf(quote, index + quote.length);
  return {
    contextBefore: contextBefore || undefined,
    contextAfter: contextAfter || undefined,
    ambiguous: secondIndex >= 0 || undefined,
  };
}

function findPlanBlockById(blocks: PlanBlock[], id: string): PlanBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type !== "tabs") continue;
    for (const tab of block.data.tabs) {
      const match = findPlanBlockById(tab.blocks, id);
      if (match) return match;
    }
  }
  return null;
}

function cssAttr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function elementIndexAmongType(element: Element) {
  const parent = element.parentElement;
  if (!parent) return 1;
  const tag = element.tagName;
  return (
    Array.from(parent.children)
      .filter((child) => child.tagName === tag)
      .indexOf(element) + 1
  );
}

function selectorForElementWithin(root: HTMLElement, element: Element | null) {
  if (!element || !root.contains(element)) return undefined;
  const prototype = element.closest<HTMLElement>("[data-prototype-screen]");
  if (prototype?.dataset.prototypeScreen) {
    if (prototype === element) {
      return `[data-prototype-screen="${cssAttr(prototype.dataset.prototypeScreen)}"]`;
    }
    const tag = element.tagName.toLowerCase();
    return `[data-prototype-screen="${cssAttr(
      prototype.dataset.prototypeScreen,
    )}"] ${tag}:nth-of-type(${elementIndexAmongType(element)})`;
  }
  const block = element.closest<HTMLElement>("[data-block-id]");
  if (block?.dataset.blockId) {
    if (block === element) {
      return `[data-block-id="${cssAttr(block.dataset.blockId)}"]`;
    }
    const tag = element.tagName.toLowerCase();
    return `[data-block-id="${cssAttr(
      block.dataset.blockId,
    )}"] ${tag}:nth-of-type(${elementIndexAmongType(element)})`;
  }
  const frame = element.closest<HTMLElement>("[data-canvas-frame]");
  if (frame?.dataset.canvasFrame) {
    if (frame === element) {
      return `[data-canvas-frame="${cssAttr(frame.dataset.canvasFrame)}"]`;
    }
    const tag = element.tagName.toLowerCase();
    return `[data-canvas-frame="${cssAttr(
      frame.dataset.canvasFrame,
    )}"] ${tag}:nth-of-type(${elementIndexAmongType(element)})`;
  }
  if (element.id) return `#${cssAttr(element.id)}`;
  return undefined;
}

function prototypeScreenIdFromSelector(selector: string | undefined) {
  if (!selector) return undefined;
  const match = selector.match(/\[data-prototype-screen="([^"]+)"\]/);
  return match?.[1]?.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function prototypeScreenIdForAnchor(anchor: PlanAnnotationAnchor) {
  return (
    anchor.screenId ??
    prototypeScreenIdFromSelector(anchor.targetSelector) ??
    (anchor.targetKind === "prototype" ? anchor.sectionId : undefined)
  );
}

function prototypeScopeForAnchor(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
) {
  const screenId = prototypeScreenIdForAnchor(anchor);
  if (!screenId) return undefined;
  return (
    reader.querySelector<HTMLElement>(
      `[data-prototype-screen="${cssAttr(screenId)}"]`,
    ) ?? null
  );
}

function sectionTitleForElement(element: Element | null, fallback?: string) {
  const block = element?.closest<HTMLElement>("[data-block-id]");
  const prototype = element?.closest<HTMLElement>("[data-prototype-screen]");
  const frame = element?.closest<HTMLElement>("[data-canvas-frame]");
  const title =
    prototype
      ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    block
      ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    frame
      ?.querySelector<HTMLElement>(".plan-artboard-label")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    element
      ?.closest<HTMLElement>(".plan-block,.plan-canvas")
      ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ||
    fallback;
  return title || undefined;
}

function targetKindForElement(
  element: Element | null,
): PlanCommentAnchor["targetKind"] {
  if (!element) return undefined;
  const tag = element.tagName.toLowerCase();
  if (tag === "img") return "image";
  if (tag === "table") return "table";
  if (tag === "pre" || tag === "code") return "code";
  if (tag === "svg") return "diagram";
  if (element.closest("[data-plan-prototype-viewer]")) return "prototype";
  if (tag === "canvas" || element.closest(".plan-canvas")) return "canvas";
  if (element.closest("[data-canvas-frame],.plan-artboard-frame")) {
    return "wireframe";
  }
  if (element.matches("button,a,input,textarea,select,label")) return "control";
  if (element.closest("[data-block-id]")) return "block";
  return "unknown";
}

function buildNativeAnchorFromElement(input: {
  reader: HTMLElement;
  target: HTMLElement;
  pointX: number;
  pointY: number;
  planTitle?: string;
}): PlanAnnotationAnchor {
  const { reader, target, pointX, pointY } = input;
  const scrollWidth = Math.max(reader.scrollWidth, 1);
  const scrollHeight = Math.max(reader.scrollHeight, 1);
  const base: PlanAnnotationAnchor = {
    x: percent(pointX + reader.scrollLeft, scrollWidth),
    y: percent(pointY + reader.scrollTop, scrollHeight),
    anchorKind: "point",
    visualLabel: input.planTitle,
    resolutionTarget: "agent",
  };

  const textElement = target.closest<HTMLElement>(PLAN_TEXT_TARGET_SELECTOR);
  const visualElement = target.closest<HTMLElement>(
    PLAN_VISUAL_TARGET_SELECTOR,
  );
  const anchorElement =
    textElement && textSnippetFromElement(textElement)
      ? textElement
      : (visualElement ?? target);
  const rect = anchorElement.getBoundingClientRect();
  const readerRect = reader.getBoundingClientRect();
  const localX = pointX + readerRect.left;
  const localY = pointY + readerRect.top;
  const targetX = percent(
    clamp(localX, rect.left, rect.right) - rect.left,
    rect.width,
  );
  const targetY = percent(
    clamp(localY, rect.top, rect.bottom) - rect.top,
    rect.height,
  );
  const sectionTitle = sectionTitleForElement(anchorElement, input.planTitle);
  const prototype = anchorElement.closest<HTMLElement>(
    "[data-prototype-screen]",
  );
  const block = anchorElement.closest<HTMLElement>("[data-block-id]");
  const frame = anchorElement.closest<HTMLElement>("[data-canvas-frame]");
  const targetText = textSnippetFromElement(anchorElement);
  const targetKind = targetKindForElement(anchorElement);
  const image =
    anchorElement.tagName.toLowerCase() === "img"
      ? (anchorElement as HTMLImageElement)
      : anchorElement.querySelector<HTMLImageElement>("img");
  const visualContext =
    prototype?.dataset.prototypeScreen && sectionTitle
      ? `Inside prototype screen ${prototype.dataset.prototypeScreen} (${sectionTitle})`
      : prototype?.dataset.prototypeScreen
        ? `Inside prototype screen ${prototype.dataset.prototypeScreen}`
        : frame?.dataset.canvasFrame && sectionTitle
          ? `Inside canvas frame ${frame.dataset.canvasFrame} (${sectionTitle})`
          : frame?.dataset.canvasFrame
            ? `Inside canvas frame ${frame.dataset.canvasFrame}`
            : undefined;

  return {
    ...base,
    sectionId:
      block?.dataset.blockId ??
      prototype?.dataset.prototypeScreen ??
      frame?.dataset.canvasFrame,
    screenId: prototype?.dataset.prototypeScreen,
    sectionTitle,
    targetSelector: selectorForElementWithin(reader, anchorElement),
    targetX,
    targetY,
    tagName: anchorElement.tagName.toLowerCase(),
    anchorKind:
      textElement && targetText ? "text" : targetKind ? "visual" : "point",
    textQuote: textElement && targetText ? targetText.slice(0, 220) : undefined,
    snippet: targetText || sectionTitle,
    visualLabel: sectionTitle ?? input.planTitle,
    visualX: targetX,
    visualY: targetY,
    targetKind,
    targetLabel:
      image?.alt?.trim() ||
      anchorElement.getAttribute("aria-label") ||
      sectionTitle ||
      targetText.slice(0, 80) ||
      input.planTitle,
    targetText: targetText || undefined,
    targetAlt: image?.alt?.trim() || undefined,
    targetSrc: image?.currentSrc || image?.src || undefined,
    visualContext,
  };
}

export function resolveNativeAnchorTarget(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
) {
  const prototypeScope = prototypeScopeForAnchor(anchor, reader);
  if (prototypeScope === null) return null;
  const queryRoot = prototypeScope ?? reader;
  if (anchor.targetSelector) {
    try {
      const target = queryRoot.matches(anchor.targetSelector)
        ? queryRoot
        : queryRoot.querySelector<HTMLElement>(anchor.targetSelector);
      if (target) return target;
    } catch {
      // Fall back to quote matching below.
    }
  }
  if (
    anchor.planAnnotationId ||
    anchor.canvasX !== undefined ||
    anchor.targetKind === "canvas"
  ) {
    const canvasWorld = reader.querySelector<HTMLElement>(
      "[data-plan-canvas-world], .plan-canvas-world",
    );
    if (canvasWorld) return canvasWorld;
  }
  const quote = normalizedElementText(anchor.textQuote || anchor.snippet);
  if (!quote) return null;
  const needle = quote.slice(0, 120);
  const scopes: Element[] = [];
  if (prototypeScope) {
    scopes.push(prototypeScope);
  } else if (anchor.sectionId) {
    const byBlock = reader.querySelector<HTMLElement>(
      `[data-block-id="${cssAttr(anchor.sectionId)}"]`,
    );
    const byFrame = reader.querySelector<HTMLElement>(
      `[data-canvas-frame="${cssAttr(anchor.sectionId)}"]`,
    );
    if (byBlock) scopes.push(byBlock);
    if (byFrame) scopes.push(byFrame);
  }
  if (!prototypeScope) scopes.push(reader);
  for (const scope of scopes) {
    const candidates = Array.from(
      scope.querySelectorAll<HTMLElement>(PLAN_TEXT_TARGET_SELECTOR),
    );
    const match = candidates.find((candidate) =>
      normalizedElementText(candidate.textContent).includes(needle),
    );
    if (match) return match;
  }
  return null;
}

export function nativePointForAnchor(
  anchor: PlanAnnotationAnchor,
  reader: HTMLElement,
) {
  const target = resolveNativeAnchorTarget(anchor, reader);
  if (!target && prototypeScreenIdForAnchor(anchor)) return null;
  const readerRect = reader.getBoundingClientRect();
  if (target) {
    const rect = target.getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        left:
          rect.left -
          readerRect.left +
          ((anchor.targetX ?? anchor.visualX ?? 50) / 100) * rect.width,
        top:
          rect.top -
          readerRect.top +
          ((anchor.targetY ?? anchor.visualY ?? 50) / 100) * rect.height,
      };
    }
  }
  return {
    left: (anchor.x / 100) * reader.scrollWidth - reader.scrollLeft,
    top: (anchor.y / 100) * reader.scrollHeight - reader.scrollTop,
  };
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
        const anchorContext = formatAnchorForAgent(thread.anchor);
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
          anchorContext ? `   Context: ${anchorContext}` : "",
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
      ? `\n${omittedComments} additional open thread(s) omitted from this composer context. Call get-plan-feedback for the full list before editing.`
      : "";
  const legacyUnroutedThreads = openThreads.filter(
    (thread) => !thread.anchor?.resolutionTarget,
  );
  const legacyUnroutedComments = legacyUnroutedThreads
    .filter((thread) => !actionableThreads.includes(thread))
    .slice(0, 4)
    .map((thread, index) => {
      const anchorContext = formatAnchorForAgent(thread.anchor);
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
        anchorContext ? `   Context: ${anchorContext}` : "",
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
    `Status: ${input.bundle.plan.status}`,
    `URL: ${input.url}`,
    input.bundle.plan.content
      ? `Structured content blocks: ${contentBlockCount}`
      : `Legacy rendered HTML length: ${input.documentHtml.length} characters`,
    "",
    "Fast iteration workflow:",
    "1. Call get-visual-plan with this plan ID to read structured content, exported HTML, sections, comments, and activity.",
    "2. Prefer update-visual-plan contentPatches for targeted edits. Examples: update-rich-text for copy, patch-prototype-html / update-prototype-screen for live prototype states, update-wireframe-node for one kit-tree node, update-canvas-frame for frame layout, append-canvas-annotation / update-canvas-annotation for canvas markup, append-block/remove-block for document changes, or replace-block for a single block. Use full content only for broad restructuring. Use html only when preserving or importing a legacy standalone HTML artifact.",
    "3. Preserve the user's existing annotation comments and intent unless the user asks to remove or resolve them.",
    "4. Keep the output as a refined document with rich text, tables, sketch diagrams, wireframes, implementation maps, code tabs, and bounded custom HTML fragments.",
    "5. After applying feedback, keep the plan scannable, editable, and serious instead of turning it into a marketing page.",
    "6. Work the actionable agent comments first. Treat human-review comments as FYI/questions/approval items; do not silently resolve those unless the user explicitly asks.",
    "7. When visual screenshots are attached, each crop is centered near a comment marker and has a red ring on the exact commented point. Use the comment IDs and anchor details below to connect screenshots to threads. If a visual comment is listed as overflow, rely on its anchorDetails/coordinates and call get-plan-feedback for the full manifest.",
    "8. For text comments, use the quoted text plus Text before/Text after and Block type details. If a quote is marked ambiguous, ask instead of editing the wrong span.",
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

function buildApplyFeedbackMessage(openCommentCount: number) {
  return `Apply the ${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this visual or prototype plan. Read the plan with get-visual-plan, read feedback with get-plan-feedback, use any attached focused screenshots to understand visual comments, then update structured content blocks, prototype screens, and related implementation details as needed. Use HTML only for legacy imported artifacts.`;
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

type PlanAccessResponse = {
  ownerEmail?: string | null;
  role?: PlanAccessRole | null;
};

export function canEditPlanContentRole(role?: PlanAccessRole | null) {
  return role === "owner" || role === "admin" || role === "editor";
}

export function PlansPage() {
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
  const [createOpen, setCreateOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const [nativeMarkerVersion, setNativeMarkerVersion] = useState(0);
  const { session, isLoading: sessionLoading } = useSession();
  const plansQuery = usePlans({
    enabled: Boolean(session),
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
    if (signedIn && !wasSignedInRef.current) {
      void plansQuery.refetch();
    }
    wasSignedInRef.current = signedIn;
  }, [session, sessionLoading, plansQuery]);
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
  const selectedId = params.id;
  const prototypeOnly = useMemo(() => {
    const search = new URLSearchParams(location.search);
    return search.get("prototype") === "1";
  }, [location.search]);
  const immersiveReader = Boolean(
    selectedId && (planFullscreen || prototypeOnly),
  );
  const planQuery = usePlan(selectedId);
  const bundle = planQuery.data;
  const accessResourceId = bundle?.plan.id ?? selectedId ?? "";
  const planAccessQuery = useActionQuery<PlanAccessResponse>(
    "list-resource-shares",
    { resourceType: "plan", resourceId: accessResourceId },
    { enabled: Boolean(accessResourceId) },
  );
  const effectivePlanAccessRole =
    planAccessQuery.data?.role ?? bundle?.access?.role ?? null;
  const canEditPlanContent = canEditPlanContentRole(effectivePlanAccessRole);
  const canResolveCommentThreads = Boolean(
    bundle && (session || canEditPlanContent),
  );
  const defaultInlineCommentDraft = useMemo<CommentDraft>(() => {
    const ownerEmail = normalizeCommentEmail(
      planAccessQuery.data?.ownerEmail ?? bundle?.access?.ownerEmail,
    );
    const currentEmail = normalizeCommentEmail(collabUser?.email);
    if (
      !ownerEmail ||
      effectivePlanAccessRole === "owner" ||
      ownerEmail === currentEmail
    ) {
      return { message: "", mentions: [], resolutionTarget: "agent" };
    }
    const mention = {
      email: ownerEmail,
      label: displayNameForMention(ownerEmail),
    };
    return {
      message: `${formatPlanCommentMentionToken(mention)} `,
      mentions: [mention],
      resolutionTarget: "human",
    };
  }, [
    bundle?.access?.ownerEmail,
    collabUser?.email,
    effectivePlanAccessRole,
    planAccessQuery.data?.ownerEmail,
  ]);
  const commentThreads = useMemo(
    () => buildCommentThreads(bundle?.comments ?? []),
    [bundle?.comments],
  );
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
      commentThreads
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
    [commentAvatarUrls, commentThreads, currentCommentAuthor],
  );
  useEffect(() => {
    setActiveAnnotation((current) => {
      if (!current) return current;
      const fresh = runtimeCommentThreads.find(
        (annotation) => annotation.id === current.annotation.id,
      );
      return fresh ? { ...current, annotation: fresh } : current;
    });
  }, [runtimeCommentThreads]);
  const convertPlanToPrototype = useConvertVisualPlanToPrototype();
  const updatePlan = useUpdatePlan();
  const exportPlan = useExportPlan(selectedId);
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkTheme = resolvedTheme !== "light";
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
  const commentMarkersVisible =
    annotationsOpen || annotateMode || Boolean(activeAnnotation);
  const showingPrototypeSurface =
    prototypeOnly || visualSurfaceMode === "prototype";

  useEffect(() => {
    if (visualSurfaceMode !== "wireframes" && canvasMarkupMode !== "none") {
      setCanvasMarkupMode("none");
    }
  }, [canvasMarkupMode, visualSurfaceMode]);

  useSetPageTitle(bundle?.plan.title || "Plan");
  useSetHeaderActions(
    !sessionLoading && !session && !selectedId ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => openSignIn()}
      >
        Sign in
      </Button>
    ) : null,
  );

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
    return bundle.html || bundle.plan.html || buildClientPlanHtml(bundle);
  }, [bundle]);

  const annotatedDocumentHtml = useMemo(() => {
    if (!bundle) return "";
    const defaults = iframeRuntimeDefaultsRef.current;
    return injectAnnotationRuntime(
      documentHtml,
      bundle.comments,
      false,
      defaults.planTheme,
      defaults.preferredEditor,
      commentAvatarUrls,
      currentCommentAuthor,
    );
  }, [bundle, commentAvatarUrls, currentCommentAuthor, documentHtml]);

  const planAgentContext = useMemo(() => {
    if (!bundle) return "";
    const path = appPath(`/plans/${selectedId ?? bundle.plan.id}`);
    const url =
      typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    return buildPlanAgentContext({ bundle, documentHtml, url });
  }, [bundle, documentHtml, selectedId]);

  const planShareUrl = useMemo(() => {
    if (!selectedId || typeof window === "undefined") return undefined;
    return `${window.location.origin}${appPath(`/plans/${selectedId}`)}`;
  }, [selectedId]);

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
      if (
        data?.type === "agent-native-visual-questions-copy" &&
        typeof data.summary === "string"
      ) {
        void navigator.clipboard.writeText(data.summary).then(() => {
          toast.success("Visual intake prompt copied");
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
        toast.success("Sent answers to the agent");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [getPositionFromAnchor, planAgentContext]);

  const closeInlineComment = () => {
    setAnnotateMode(false);
    setCanvasMarkupMode("none");
    setPendingAnnotation(null);
    setInlineCommentPosition(null);
    setNativeSelectionComment(null);
    window.getSelection()?.removeAllRanges();
  };

  const clearInlineCommentDraft = () => {
    setPendingAnnotation(null);
    setInlineCommentPosition(null);
    setNativeSelectionComment(null);
  };

  const copyPlanLink = async () => {
    if (!planShareUrl) return;
    await navigator.clipboard.writeText(planShareUrl);
    toast.success("Plan link copied");
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

  const convertCurrentPlanToPrototype = async () => {
    if (!bundle?.plan.content) return;
    await convertPlanToPrototype.mutateAsync({
      planId: bundle.plan.id,
    });
    toast.success("Prototype plan ready");
  };

  const readPlanExport = async () => {
    const result = await exportPlan.refetch();
    const data = result.data ?? exportPlan.data;
    if (!data) {
      throw new Error("Plan export was not available yet.");
    }
    return data;
  };

  const copyPlanHtml = async () => {
    const data = await readPlanExport();
    await navigator.clipboard.writeText(data.html);
    toast.success("Plan HTML copied");
  };

  const copyPlanMarkdown = async () => {
    const data = await readPlanExport();
    await navigator.clipboard.writeText(data.markdown);
    toast.success("Plan Markdown copied");
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
    const files = (data as { mdx?: Record<string, unknown> }).mdx;
    if (!files || Object.keys(files).length === 0) {
      throw new Error("Plan source files were not available yet.");
    }
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
    toast.success("Plan source downloaded");
  };

  const runPlanExportAction = (action: () => Promise<void>) => {
    preservePlanReaderScroll(() => {
      void action().catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Plan export was not available.",
        );
      });
    });
  };

  const startCommenting = () => {
    setCanvasMarkupMode("none");
    setActiveAnnotation(null);
    setAnnotationsOpen(false);
    setAnnotateMode(true);
  };

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

  const handleNativeReaderScroll = () => {
    documentStateRef.current = readNativeDocumentState();
    setNativeSelectionComment(null);
    setNativeMarkerVersion((version) => version + 1);
    setActiveAnnotation((current) => {
      if (!current) return current;
      const position = getPositionFromAnchor(current.annotation.anchor);
      return position ? { ...current, position } : current;
    });
  };

  const readNativeSelectionComment = (): NativeSelectionComment | null => {
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
    const blockElement = startElement?.closest<HTMLElement>("[data-block-id]");
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
      position: resolveInlineCommentPosition({
        pointX,
        pointY,
        viewportWidth: readerRect.width,
        viewportHeight: readerRect.height,
      }),
    };
  };

  const beginNativeSelectionComment = () => {
    if (!nativeSelectionComment) return;
    documentStateRef.current = readNativeDocumentState();
    setPendingAnnotation(nativeSelectionComment.anchor);
    setInlineCommentPosition(nativeSelectionComment.position);
    setNativeSelectionComment(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleNativeReaderPointerDown = (
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (!annotateMode || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-plan-interactive]")) return;
    nativeCommentPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    setNativeSelectionComment(null);
  };

  const handleNativeReaderPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!annotateMode || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-plan-interactive]")) return;
    const reader = nativeReaderRef.current;
    if (!reader) return;
    event.preventDefault();
    const selectionComment = readNativeSelectionComment();
    if (selectionComment) {
      setActiveAnnotation(null);
      setAnnotationsOpen(false);
      setNativeSelectionComment(selectionComment);
      return;
    }
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
    setActiveAnnotation(null);
    setPendingAnnotation(anchor);
    setInlineCommentPosition(
      resolveInlineCommentPosition({
        pointX,
        pointY,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
      }),
    );
  };

  const updateStructuredContent = async (content: PlanContent) => {
    if (!bundle) return;
    await updatePlan.mutateAsync({
      planId: bundle.plan.id,
      content,
      note: "Updated structured visual plan content.",
    });
  };

  const patchStructuredContent = async (patch: PlanContentPatch) => {
    if (!bundle) return;
    await updatePlan.mutateAsync({
      planId: bundle.plan.id,
      contentPatches: [patch],
      note:
        patch.op === "update-rich-text"
          ? `Edited markdown block ${patch.blockId}.`
          : "Patched structured visual plan content.",
    });
  };

  const updatePlanMetadata = async (patch: {
    title?: string;
    brief?: string;
  }) => {
    if (!bundle) return;
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
        const canvas = await html2canvas(surface, {
          backgroundColor: null,
          logging: false,
          scale: Math.min(2, window.devicePixelRatio || 1),
          useCORS: true,
          width: surface.clientWidth,
          height: surface.clientHeight,
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
        ? `- ${overflow.length} additional visual comment(s) exceeded the screenshot budget. Use get-plan-feedback anchorDetails/coordinates for these overflow comments:`
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
      const context = buildPlanAgentContext({
        bundle,
        documentHtml,
        url:
          typeof window === "undefined"
            ? appPath(`/plans/${selectedId ?? bundle.plan.id}`)
            : `${window.location.origin}${appPath(
                `/plans/${selectedId ?? bundle.plan.id}`,
              )}`,
        screenshotNote: capture.note,
      });
      sendToAgentChat({
        type: "content",
        submit: true,
        context,
        images: capture.images,
        message: buildApplyFeedbackMessage(openCommentCount),
      });
      toast.success(
        capture.images.length > 0
          ? "Sent comments and focused screenshots to the agent"
          : "Sent comments to the agent",
      );
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
      [buildApplyFeedbackMessage(openCommentCount), "", planAgentContext].join(
        "\n",
      ),
    );
    toast.success("Feedback instructions copied");
  };

  const submitInlineComment = async (draft: CommentDraft) => {
    if (!bundle || !pendingAnnotation) return;
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
    clearPendingDocumentRestore();
    pendingDocumentRestoreRef.current = documentStateRef.current;
    try {
      await updatePlan.mutateAsync({
        planId: bundle.plan.id,
        comments: [
          {
            kind: "annotation",
            status: "open",
            message: draft.message,
            sectionId,
            anchor: JSON.stringify(anchor),
            createdBy: "human",
            authorEmail: collabUser?.email,
            authorName: collabUser?.name,
          },
        ],
        note: "Human added inline visual plan feedback.",
      });
      expirePendingDocumentRestore();
    } catch (error) {
      clearPendingDocumentRestore();
      throw error;
    }
    clearInlineCommentDraft();
    setAnnotateMode(true);
    toast.success("Comment added");
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
            sectionId: annotation.sectionId ?? anchor.sectionId,
            anchor: JSON.stringify(anchor),
            createdBy: "human",
            authorEmail: collabUser?.email,
            authorName: collabUser?.name,
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

  const replyToCommentThread = async (
    threadRootId: string,
    message: string,
  ) => {
    if (!bundle) return;
    const thread = commentThreads.find((item) => item.id === threadRootId);
    if (!thread) {
      throw new Error("Comment thread is no longer available.");
    }
    const updated = await updatePlan.mutateAsync({
      planId: bundle.plan.id,
      comments: [
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
      note: "Human replied to visual plan feedback.",
    });
    const updatedThread = buildCommentThreads(updated.comments).find(
      (item) => item.id === threadRootId,
    );
    const updatedAnnotation =
      updatedThread &&
      runtimeAnnotationFromThread(
        updatedThread,
        commentThreads.findIndex((item) => item.id === threadRootId),
        commentAvatarUrls,
        currentCommentAuthor,
      );
    if (updatedAnnotation) {
      setActiveAnnotation((current) =>
        current?.annotation.id === threadRootId
          ? { ...current, annotation: updatedAnnotation }
          : current,
      );
    }
    toast.success("Reply added");
  };

  const setCommentThreadStatus = (
    threadRootId: string,
    status: PlanBundle["comments"][number]["status"],
    fallbackAnchor?: PlanAnnotationAnchor | null,
  ) => {
    if (!bundle || !canResolveCommentThreads) return;
    const thread = commentThreads.find((item) => item.id === threadRootId);
    if (!thread) return;
    const fallbackAnchorJson = fallbackAnchor
      ? JSON.stringify(fallbackAnchor)
      : undefined;
    updatePlan.mutate(
      {
        planId: bundle.plan.id,
        comments: thread.comments.map((comment) => ({
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
        note:
          status === "resolved"
            ? "Human resolved visual plan feedback."
            : "Human reopened visual plan feedback.",
      },
      {
        onSuccess: () => {
          setActiveAnnotation(null);
          toast.success(
            status === "resolved" ? "Comment resolved" : "Comment reopened",
          );
        },
      },
    );
  };

  const nativeMarkerPosition = (anchor: PlanAnnotationAnchor) => {
    void nativeMarkerVersion;
    const reader = nativeReaderRef.current;
    if (!reader) return null;
    const point = nativePointForAnchor(anchor, reader);
    if (!point) return null;
    const { left, top } = point;
    if (
      left < -40 ||
      top < -40 ||
      left > reader.clientWidth + 40 ||
      top > reader.clientHeight + 40
    ) {
      return null;
    }
    return { left, top };
  };

  return (
    <div className="plans-workspace flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div
        className="plans-grid flex min-h-0 flex-1"
        data-view={immersiveReader ? "immersive" : "app"}
      >
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!params.id ? (
            <PlansOverview
              plans={plans}
              isLoading={sessionLoading || plansQuery.isLoading}
              onCreate={requestCreatePlan}
              canCreate={Boolean(session)}
            />
          ) : !bundle && planQuery.isError ? (
            <PlanLoadError
              planId={params.id}
              error={planQuery.error}
              onRetry={() => void planQuery.refetch()}
              onCreate={requestCreatePlan}
              canCreate={Boolean(session)}
            />
          ) : !bundle && planQuery.isLoading ? (
            <PlanSkeleton />
          ) : !bundle ? (
            <PlanLoadError
              planId={params.id}
              onRetry={() => void planQuery.refetch()}
              onCreate={requestCreatePlan}
              canCreate={Boolean(session)}
            />
          ) : (
            <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
              <div
                className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/82 p-1 shadow-2xl backdrop-blur-xl"
                onPointerDownCapture={preservePlanReaderScrollAfterToolbarEvent}
                onKeyDownCapture={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    preservePlanReaderScrollAfterToolbarEvent();
                  }
                }}
              >
                <PlanShareControl
                  planId={bundle.plan.id}
                  planTitle={bundle.plan.title}
                  localShareUrl={planShareUrl}
                  hostedPlanId={bundle.plan.hostedPlanId}
                  hostedPlanUrl={bundle.plan.hostedPlanUrl}
                  onOpenChange={(open) => {
                    if (open) closeInlineComment();
                  }}
                />
                <ReviewMarkupToolbar
                  mode={reviewMode}
                  onModeChange={selectReviewMode}
                />
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
                            ? "Open full plan"
                            : "Open prototype window"
                        }
                      >
                        <IconExternalLink className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {prototypeOnly
                        ? "Open full plan"
                        : "Open prototype window"}
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
                        {sendingFeedback ? "Sending" : "Send to agent"}
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
                            <span>Send to inline agent</span>
                            <span className="text-xs font-normal leading-4 text-muted-foreground">
                              Posts open comments into the app side agent.
                            </span>
                          </span>
                        </DropdownMenuItem>
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
                            <span>Copy for your agent</span>
                            <span className="text-xs font-normal leading-4 text-muted-foreground">
                              Copies a prompt you can paste into chat.
                            </span>
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                        onClick={() => {
                          preservePlanReaderScroll(() => {
                            setAnnotationsOpen((value) => {
                              const next = !value;
                              if (!next) {
                                closeInlineComment();
                                setActiveAnnotation(null);
                              }
                              return next;
                            });
                          });
                        }}
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
                        onClick={() => {
                          preservePlanReaderScroll(() => {
                            closeInlineComment();
                            setHistoryOpen(true);
                          });
                        }}
                        className="gap-2"
                      >
                        <IconHistory className="size-4" />
                        History
                      </DropdownMenuItem>
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
                          ? "Full plan"
                          : immersiveReader
                            ? "App view"
                            : "Full screen"}
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
                        {isDarkTheme ? "Light mode" : "Dark mode"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          preservePlanReaderScroll(toggleWireframeStyle)
                        }
                        className="gap-2"
                      >
                        <IconPencil className="size-4" />
                        {wireframeStyle === "sketchy"
                          ? "Clean wireframes"
                          : "Sketchy wireframes"}
                      </DropdownMenuItem>
                      {bundle.plan.content?.prototype ? (
                        <DropdownMenuItem
                          onClick={() => {
                            preservePlanReaderScroll(openPrototypeWindow);
                          }}
                          className="gap-2"
                        >
                          <IconExternalLink className="size-4" />
                          Open prototype window
                        </DropdownMenuItem>
                      ) : bundle.plan.content?.canvas && canEditPlanContent ? (
                        <DropdownMenuItem
                          onClick={() =>
                            preservePlanReaderScroll(() => {
                              void convertCurrentPlanToPrototype();
                            })
                          }
                          className="gap-2"
                          disabled={convertPlanToPrototype.isPending}
                        >
                          {convertPlanToPrototype.isPending ? (
                            <IconLoader2 className="size-4 animate-spin" />
                          ) : (
                            <IconArrowRight className="size-4" />
                          )}
                          Convert to prototype
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
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => runPlanExportAction(downloadPlanSource)}
                        className="gap-2"
                      >
                        <IconFileZip className="size-4" />
                        Download source (.zip)
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2">
                          <IconDownload className="size-4" />
                          Export
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56 rounded-xl">
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(copyPlanMarkdown)
                            }
                            className="gap-2"
                          >
                            <IconClipboardText className="size-4" />
                            Copy Markdown
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(downloadPlanMarkdown)
                            }
                            className="gap-2"
                          >
                            <IconDownload className="size-4" />
                            Download Markdown
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => runPlanExportAction(copyPlanHtml)}
                            className="gap-2"
                          >
                            <IconCopy className="size-4" />
                            Copy HTML
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runPlanExportAction(downloadPlanHtml)
                            }
                            className="gap-2"
                          >
                            <IconDownload className="size-4" />
                            Download HTML
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      {bundle.summary.openCommentCount > 0 && (
                        <DropdownMenuItem
                          onClick={() =>
                            preservePlanReaderScroll(() => {
                              void copyPlanFeedbackForAgent();
                            })
                          }
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
              {reviewMode !== "none" && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border/70 bg-background/82 px-3 py-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-xl">
                  {reviewMode === "comment"
                    ? "Click the plan or select text to comment"
                    : reviewMode === "text"
                      ? "Click the canvas to place a note"
                      : "Drag on the canvas to draw a callout"}
                </div>
              )}
              {bundle.plan.content ? (
                <div className="relative h-full min-h-full w-full">
                  <div
                    ref={nativeReaderRef}
                    className={cn(
                      "h-full min-h-full w-full overflow-auto bg-background",
                      reviewMode !== "none" &&
                        "ring-1 ring-inset ring-primary/35",
                    )}
                    onScroll={handleNativeReaderScroll}
                    onPointerDown={handleNativeReaderPointerDown}
                    onPointerUp={handleNativeReaderPointerUp}
                  >
                    <PlanContentRenderer
                      content={bundle.plan.content}
                      fallbackTitle={bundle.plan.title}
                      fallbackBrief={bundle.plan.brief}
                      onContentChange={
                        canEditPlanContent ? updateStructuredContent : undefined
                      }
                      onContentPatch={
                        canEditPlanContent ? patchStructuredContent : undefined
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
                      planId={bundle.plan.id}
                      collabUser={collabUser}
                      prototypeOnly={prototypeOnly}
                      visualSurfaceMode={visualSurfaceMode}
                      onVisualSurfaceModeChange={setVisualSurfaceMode}
                      onVisualQuestionsSubmit={(summary) => {
                        sendToAgentChat({
                          type: "content",
                          submit: true,
                          context: planAgentContext,
                          message: buildQuestionFormRevisionMessage(summary),
                        });
                        toast.success("Sent answers to the agent");
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
                        Comment
                      </Button>
                    </div>
                  )}
                  {commentMarkersVisible && (
                    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                      {runtimeCommentThreads.map((annotation) => {
                        const position = nativeMarkerPosition(
                          annotation.anchor,
                        );
                        if (!position) return null;
                        const participants = annotation.participants.map(
                          runtimeParticipantPresentation,
                        );
                        return (
                          <CommentThreadMarker
                            key={annotation.id}
                            participants={participants}
                            count={annotation.commentCount}
                            title={runtimeAnnotationMarkerTitle(annotation)}
                            className="absolute"
                            style={position}
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
                  <div
                    className="pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                    style={{
                      left: inlineCommentPosition.pinLeft,
                      top: inlineCommentPosition.pinTop,
                    }}
                  >
                    <CommentAvatar
                      author={pendingCommentAuthor}
                      size="pin"
                      className="shadow-2xl shadow-black/35"
                    />
                  </div>
                  <InlineCommentPopover
                    position={inlineCommentPosition}
                    initialDraft={defaultInlineCommentDraft}
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
                  pendingAuthor={pendingCommentAuthor}
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
                />
              )}
              {annotationsOpen && (
                <AnnotationsPanel
                  threads={commentThreads}
                  avatarUrls={commentAvatarUrls}
                  currentUser={currentCommentAuthor}
                  pendingAuthor={pendingCommentAuthor}
                  isPending={updatePlan.isPending}
                  onReply={replyToCommentThread}
                  canResolve={canResolveCommentThreads}
                  onStatusChange={(thread, status) =>
                    setCommentThreadStatus(thread.id, status, thread.anchor)
                  }
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

      {bundle && (
        <PlanHistorySheet
          planId={bundle.plan.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={canEditPlanContent}
        />
      )}
    </div>
  );
}

// Shared copy for the rich access-management share popover. The public note
// makes clear that anyone-with-link can view, but commenting on a public plan
// still needs an agent-native account (comments are attributed + scoped).
const PLAN_SHARE_VISIBILITY_COPY = {
  private: {
    label: "Private",
    description: "Only invited people can open this plan",
  },
  org: {
    label: "Organization",
    description: "Anyone in your organization with the link can view",
  },
  public: {
    label: "Public",
    description: "Anyone with the link can view",
  },
} as const;

const PLAN_SHARE_ACCESS_NOTE =
  "Anyone with edit access can change the plan. Viewing a public plan needs no account, but commenting on it requires an agent-native account.";

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
  localShareUrl,
  hostedPlanId,
  hostedPlanUrl,
  onOpenChange,
}: {
  planId: string;
  planTitle: string;
  localShareUrl?: string;
  hostedPlanId?: string | null;
  hostedPlanUrl?: string | null;
  onOpenChange?: (open: boolean) => void;
}) {
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
  const managedShareUrl =
    effectivePublishedUrl && hostedPlanOnCurrentOrigin
      ? effectivePublishedUrl
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

  const copyPublishedUrl = useCallback((url: string) => {
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Shareable link copied"),
      () => toast.error("Could not copy link"),
    );
  }, []);

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
            toast.message("Create a free account to publish this plan");
            return;
          }
          setPublishedPlan({
            url: result.hostedPlanUrl ?? result.url,
            hostedPlanId: result.hostedPlanId,
          });
          setAuthPrompt(null);
          copyPublishedUrl(result.hostedPlanUrl ?? result.url);
        },
      },
    );
  }, [copyPublishedUrl, planId, publishPlan]);

  // Logged-in / local-dev: manage shares for the plan in this app instance.
  if (canManageLocalShares) {
    if (!managedShareUrl) return null;
    return (
      <ShareButton
        resourceType="plan"
        resourceId={managedShareResourceId}
        resourceTitle={planTitle}
        shareUrl={managedShareUrl}
        shareUrlLabel="Plan link"
        shareUrlDescription="Private by default. Invite people, share with your org, or set Public for anyone-with-link review."
        shareUrlPlacement="top"
        peopleAccessLabel="People with plan access"
        generalAccessLabel="General plan access"
        accessNote={PLAN_SHARE_ACCESS_NOTE}
        visibilityCopy={PLAN_SHARE_VISIBILITY_COPY}
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
              aria-label="Share plan"
            >
              <IconShare3 className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Share plan</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="pointer-events-auto z-[2000] w-[min(360px,92vw)] rounded-lg p-4"
      >
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <IconWorld className="size-4 text-muted-foreground" />
          Share this plan
        </div>
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          {effectivePublishedUrl
            ? "This local plan has a hosted copy for sharing. Open the hosted plan to manage access."
            : "Create a free account to publish this plan to a shareable link. You can keep editing locally with your coding agent until you do."}
        </p>

        {authPrompt ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
              Finish creating your account, then come back and we will generate
              the link.
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
                    Checking
                  </>
                ) : (
                  "I'm signed in — retry"
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openAuthFlow(authPrompt.authUrl)}
              >
                Create account
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
                Copy
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
                    Updating
                  </>
                ) : (
                  <>
                    <IconRefresh className="size-3.5" />
                    Update link
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
                  Open hosted plan
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
                Creating link
              </>
            ) : (
              <>
                <IconLink className="size-4" />
                Create shareable link
              </>
            )}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PlanSkeleton() {
  return (
    <div
      className="plan-content-surface h-full min-h-0 overflow-auto bg-plan-document text-plan-text"
      role="status"
      aria-label="Loading plan"
    >
      <span className="sr-only">Loading plan</span>
      <PlanCanvasSkeleton />
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
      className="plan-canvas relative h-[65vh] overflow-hidden border-b border-plan-line"
      aria-hidden="true"
    >
      <div
        className="plan-canvas-viewport absolute inset-0"
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

      <div className="absolute inset-x-4 bottom-20 top-24 mx-auto flex max-w-5xl items-center gap-7 overflow-hidden px-1 sm:px-6">
        <div className="min-w-0 flex-[1_1_44rem]">
          <DesktopArtboardSkeleton />
        </div>

        <div className="hidden w-[15rem] shrink-0 lg:block">
          <PhoneArtboardSkeleton />
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
      className="mx-auto w-full max-w-[900px] px-6 py-12 sm:px-10 lg:py-14"
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
    <div className="h-[20rem] overflow-hidden rounded-[12px] border border-plan-line bg-plan-wireframe p-6 shadow-[0_10px_34px_rgba(24,24,27,0.08)] sm:h-[23rem] sm:p-8">
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
    <div className="h-[22rem] overflow-hidden rounded-[26px] border border-plan-line bg-plan-wireframe p-5 shadow-[0_10px_34px_rgba(24,24,27,0.08)]">
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
      aria-label="Review markup tools"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="comment"
            className="size-7 px-0"
            aria-label={mode === "comment" ? "Stop commenting" : "Comment"}
          >
            <IconMessageCircle className="size-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {mode === "comment" ? "Stop commenting" : "Pin a comment"}
        </TooltipContent>
      </Tooltip>
    </ToggleGroup>
  );
}

function PlanLoadError({
  planId,
  error,
  onRetry,
  onCreate,
  canCreate,
}: {
  planId?: string;
  error?: unknown;
  onRetry: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const message =
    error instanceof Error && error.message
      ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
      : "This plan could not be loaded from the current session.";

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 text-left shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <IconAlertTriangle className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              Plan did not load
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {message}
            </p>
            {planId && (
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                {planId}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={onRetry}>
            <IconRefresh className="size-4" />
            Retry
          </Button>
          <Button type="button" variant="outline" onClick={onCreate}>
            <IconPlus className="size-4" />
            {canCreate ? "New Plan" : "Sign in to create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyPlan({
  onCreate,
  canCreate,
}: {
  onCreate: () => void;
  canCreate: boolean;
}) {
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
          Start with a visual plan
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Create a polished plan with editable document blocks, diagrams,
          wireframes, and comments before implementation starts.
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <IconPlus className="size-4" />
          New Plan
        </Button>
      </div>
    </div>
  );
}

const PLAN_SKILL_INSTALL_COMMAND =
  "npx @agent-native/core@latest skills add visual-plan";

function LoggedOutEmptyPlan() {
  return (
    <div className="flex h-full items-center justify-center p-6 sm:p-8">
      <div className="flex w-full max-w-lg -translate-y-10 flex-col items-center gap-3 text-center sm:-translate-y-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Start with /visual-plan
        </h2>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Install the Plan skill in your coding agent, then use the slash
          command to create your first review plan.
        </p>
        <div className="mt-1 w-full rounded-lg border border-border bg-card p-4 text-left shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">
            Install once
          </p>
          <code className="mt-2 block rounded-md bg-muted/40 px-3 py-2 font-mono text-xs leading-5 text-foreground">
            {PLAN_SKILL_INSTALL_COMMAND}
          </code>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Then ask for <code>/visual-plan</code>, <code>/ui-plan</code>, or{" "}
            <code>/prototype-plan</code> from Codex, Claude Code, or Cursor.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlansOverview({
  plans,
  isLoading,
  onCreate,
  canCreate,
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
  canCreate: boolean;
}) {
  if (isLoading) {
    return <PlansOverviewSkeleton />;
  }
  if (plans.length === 0) {
    return <EmptyPlan onCreate={onCreate} canCreate={canCreate} />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              Plan
            </h1>
            <p className="text-sm text-muted-foreground">
              {plans.length} document{plans.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button type="button" onClick={onCreate}>
            <IconPlus className="size-4" />
            {canCreate ? "New Plan" : "Sign in to create"}
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

function planVersionSurfaceLabel(version: PlanVersionSummary) {
  if (version.hasPrototype) return "Prototype";
  if (version.hasCanvas) return "Canvas";
  if (version.blockCount > 0) return `${version.blockCount} blocks`;
  return `${version.sectionCount} sections`;
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
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const versionsQuery = usePlanVersions(planId, open);
  const versionQuery = usePlanVersion(open ? planId : null, selectedVersionId);
  const restoreVersion = useRestorePlanVersion();
  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = versionQuery.data;

  useEffect(() => {
    if (!open) setSelectedVersionId(null);
  }, [open]);

  useEffect(() => {
    setSelectedVersionId(null);
  }, [planId]);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) setSelectedVersionId(null);
    onOpenChange(nextOpen);
  };

  const restoreSelectedVersion = async () => {
    if (!selectedVersionId) return;
    try {
      await restoreVersion.mutateAsync({
        planId,
        versionId: selectedVersionId,
      });
      toast.success("Plan version restored.");
      close(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
          : "Failed to restore plan version.",
      );
    }
  };

  return (
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
                <span>Back to history</span>
              </button>
            ) : (
              <>
                <IconHistory className="size-4 text-primary" />
                <span>Plan history</span>
              </>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Browse saved plan versions and restore a previous snapshot.
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
                    {selectedVersion?.title || "Untitled plan"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {selectedVersion
                      ? `${shortDate(selectedVersion.createdAt)} · ${planVersionSurfaceLabel(selectedVersion)}`
                      : "Snapshot unavailable"}
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
                  planId={null}
                />
              ) : selectedVersion?.html ? (
                <iframe
                  title="Plan version preview"
                  srcDoc={selectedVersion.html}
                  className="h-[calc(100vh-142px)] w-full border-0 bg-background"
                />
              ) : (
                <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                  This snapshot has no previewable content.
                </div>
              )}
            </ScrollArea>
            {canRestore ? (
              <div className="border-t border-border p-3">
                <Button
                  type="button"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => void restoreSelectedVersion()}
                  disabled={restoreVersion.isPending || versionQuery.isLoading}
                >
                  {restoreVersion.isPending ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconRestore className="size-4" />
                  )}
                  Restore this version
                </Button>
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
                {versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedVersionId(version.id)}
                    className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/45">
                        <IconHistory className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {version.title || "Untitled plan"}
                          </p>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {planVersionSurfaceLabel(version)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {shortDate(version.createdAt)}
                          {version.label ? ` · ${version.label}` : ""}
                        </p>
                        {version.preview ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">
                            {version.preview}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-6 py-14 text-center">
                <IconHistory className="mx-auto mb-3 size-6 text-muted-foreground/60" />
                <p className="text-sm font-medium">No saved versions yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Versions are saved automatically before future plan edits.
                </p>
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

const CREATE_PLAN_PROMPTS = [
  {
    label: "Checkout flow",
    prompt:
      "Plan a checkout review flow with desktop and mobile wireframes, key empty/loading/error states, comment prompts, and implementation notes.",
  },
  {
    label: "Settings redesign",
    prompt:
      "Create a UI flow plan for a settings redesign, including navigation states, risky interactions, review annotations, and code handoff notes.",
  },
  {
    label: "Imported plan",
    prompt:
      "# Implementation plan\n\nPaste the existing Codex or Claude Code plan here and turn it into a visual review document.",
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
  label: string;
  reason: string;
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
      label: "UI flow",
      reason:
        "Auto detected UI states or flows; the agent will make a wireframe-first plan.",
    };
  }

  return {
    kind: "visual",
    label: "General visual",
    reason:
      "Auto will ask the agent for a rich technical plan with diagrams and implementation detail.",
  };
}

function sourceOptionLabel(source: PlanSource) {
  return (
    SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source
  );
}

function buildCreatePlanAgentMessage({
  prompt,
  source,
  planKind,
}: {
  prompt: string;
  source: PlanSource;
  planKind: CreatePlanKind;
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
    `Source/provenance: ${sourceOptionLabel(source)}.`,
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
  const [source, setSource] = useState<PlanSource>("codex");
  const [planKind, setPlanKind] = useState<CreatePlanKind>("auto");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptSeed, setPromptSeed] = useState("");
  const [promptSeedKey, setPromptSeedKey] = useState(0);

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
    const prompt = value.trim();
    if (!prompt) {
      toast.message("Describe the plan first.");
      return;
    }
    sendToAgentChat({
      type: "content",
      submit: true,
      message: buildCreatePlanAgentMessage({ prompt, source, planKind }),
    });
    onOpenChange(false);
    toast.success("Sent to the Plan agent");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Ask agent to create plan</DialogTitle>
          <DialogDescription>
            Describe the plan you want, or paste an existing Codex/Claude plan.
            The Plan agent will generate the wireframes and review structure.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-background p-2 shadow-sm">
            <PromptComposer
              autoFocus
              disabled={!canCreate}
              attachmentsEnabled={false}
              showModelSelector={false}
              placeholder="Ask the agent for a UI flow, implementation map, review notes..."
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
                key={preset.label}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full border-border/80 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                disabled={!canCreate}
                onClick={() => {
                  setPromptSeed(preset.prompt);
                  setPromptSeedKey((key) => key + 1);
                  setPromptText(preset.prompt);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="font-medium">Advanced</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">
                    {sourceOptionLabel(source)} ·{" "}
                    {planKind === "auto"
                      ? promptAssessment
                        ? `Auto: ${promptAssessment.label}`
                        : "Auto"
                      : planKind === "ui"
                        ? "UI flow"
                        : planKind === "questions"
                          ? "Visual questions"
                          : "General visual"}
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
                    Source
                  </span>
                  <Select
                    value={source}
                    onValueChange={(value) => setSource(value as PlanSource)}
                  >
                    <SelectTrigger aria-label="Plan source">
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
                  <p className="text-xs leading-5 text-muted-foreground">
                    Provenance only. It helps explain where the plan started.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">
                    Agent planning style
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
                    <SelectTrigger aria-label="Fresh prompt style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto - choose the right planning path
                      </SelectItem>
                      <SelectItem value="ui">
                        UI flow - wireframes and states
                      </SelectItem>
                      <SelectItem value="questions">
                        Visual questions - explicit intake
                      </SelectItem>
                      <SelectItem value="visual">
                        General visual - diagrams and notes
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Pasted plans are detected and sent to the agent with import
                    context. Auto keeps the normal plan flow; choose Visual
                    questions when you want intake first.
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
          {promptAssessment && planKind === "auto" ? (
            <p className="px-1 text-xs text-muted-foreground">
              {promptAssessment.reason}
            </p>
          ) : null}
          {promptText.trim() && isProbablyImportedPlan(promptText) ? (
            <p className="px-1 text-xs text-muted-foreground">
              Looks like an existing plan. The agent will preserve it and add
              visual review structure.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function createMentionChip(mention: PlanCommentMention) {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mentionEmail = mention.email;
  chip.dataset.mentionLabel = mention.label;
  chip.className =
    "inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary";
  chip.textContent = `@${mention.label}`;
  return chip;
}

function appendMessageToEditor(root: HTMLElement, message: string) {
  root.replaceChildren();
  const pattern = /@\[([^\]]+)\]\(mailto:([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    if (match.index > lastIndex) {
      root.append(
        document.createTextNode(message.slice(lastIndex, match.index)),
      );
    }
    const label = match[1]?.trim();
    const email = decodeURIComponent(match[2] ?? "")
      .trim()
      .toLowerCase();
    if (label && email) {
      root.append(createMentionChip({ label, email }));
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < message.length) {
    root.append(document.createTextNode(message.slice(lastIndex)));
  }
}

function serializeCommentEditor(root: HTMLElement) {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const mentionEmail = node.dataset.mentionEmail;
    if (mentionEmail) {
      return formatPlanCommentMentionToken({
        email: mentionEmail,
        label: node.dataset.mentionLabel || displayNameForMention(mentionEmail),
      });
    }
    if (node.tagName === "BR") return "\n";
    return Array.from(node.childNodes).map(serialize).join("");
  };
  return Array.from(root.childNodes)
    .map(serialize)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function commentBodyText(message: string) {
  return message
    .replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mentionQueryAtCaret(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return null;
  const textBeforeCaretRange = range.cloneRange();
  textBeforeCaretRange.selectNodeContents(root);
  textBeforeCaretRange.setEnd(range.startContainer, range.startOffset);
  const text = textBeforeCaretRange.toString();
  const match = /(?:^|\s)@([a-zA-Z0-9._+-]{0,64})$/.exec(text);
  if (!match) return null;
  const start = text.lastIndexOf("@");
  const end = text.length;
  const startPosition = textPositionInRoot(root, start);
  const endPosition = textPositionInRoot(root, end);
  if (!startPosition || !endPosition) return null;
  const queryRange = document.createRange();
  queryRange.setStart(startPosition.node, startPosition.offset);
  queryRange.setEnd(endPosition.node, endPosition.offset);
  return {
    query: match[1] ?? "",
    range: queryRange,
  };
}

function textPositionInRoot(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= seen + length) {
      return { node, offset: Math.max(0, offset - seen) };
    }
    seen += length;
    lastText = node;
    node = walker.nextNode() as Text | null;
  }
  if (lastText && offset === seen) {
    return { node: lastText, offset: lastText.textContent?.length ?? 0 };
  }
  return null;
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
          aria-label="Mention organization member"
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(320px,calc(100vw-48px))] overflow-hidden rounded-xl border border-border/80 bg-background/98 p-1 shadow-2xl backdrop-blur-xl"
        >
          {isLoading && members.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Searching people...
            </div>
          ) : members.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matching organization members.
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
      aria-label="Expected resolver"
    >
      <ToggleGroupItem value="agent" className="h-7 gap-1.5 px-2 text-xs">
        <IconSend className="size-3.5" />
        Agent
      </ToggleGroupItem>
      <ToggleGroupItem value="human" className="h-7 gap-1.5 px-2 text-xs">
        <IconMessageCircle className="size-3.5" />
        Human
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function InlineCommentPopover({
  position,
  initialDraft,
  onCancel,
  onSubmit,
}: {
  position: InlineCommentPosition;
  initialDraft: CommentDraft;
  onCancel: () => void;
  onSubmit: (draft: CommentDraft) => Promise<void>;
}) {
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
  const canSubmit = commentBodyText(draft.message).length > 0 && !isSubmitting;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitError(false);
    setIsSubmitting(true);
    try {
      await onSubmit({
        ...draft,
        message: draft.message.trim(),
        resolutionTarget:
          !resolverTouched && draft.mentions.length > 0
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
        <ResolutionTargetToggle
          value={draft.resolutionTarget}
          onChange={(resolutionTarget) => {
            setResolverTouched(true);
            setDraft((current) => ({ ...current, resolutionTarget }));
          }}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            onClick={onCancel}
            aria-label="Cancel comment"
          >
            <IconX className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <CommentMentionEditor
          initialMessage={initialMessageRef.current}
          placeholder="Add a comment..."
          autoFocus
          onSubmitShortcut={submit}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              ...value,
              resolutionTarget: resolverTouched
                ? current.resolutionTarget
                : value.mentions.length > 0
                  ? "human"
                  : "agent",
            }))
          }
        />
        <Button
          type="button"
          size="sm"
          className="h-11 w-[60px] shrink-0 px-0"
          onClick={submit}
          disabled={!canSubmit}
        >
          {isSubmitting ? "Saving" : "Save"}
        </Button>
      </div>
      {submitError && (
        <p className="mt-2 px-1 text-xs text-destructive">
          Couldn't save. Try again.
        </p>
      )}
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

function ReplyComposer({
  author,
  isPending,
  placeholder = "Reply",
  onSubmit,
}: {
  author: CommentAuthorPresentation;
  isPending: boolean;
  placeholder?: string;
  onSubmit: (message: string) => Promise<void>;
}) {
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
            placeholder={placeholder}
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
            aria-label="Send reply"
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
          Couldn't send. Try again.
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
  onSave,
  onReply,
  canResolve,
  onStatusChange,
}: {
  annotation: RuntimeAnnotation;
  position: InlineCommentPosition;
  isPending: boolean;
  pendingAuthor: CommentAuthorPresentation;
  onSave: (message: string) => void;
  onReply: (threadRootId: string, message: string) => Promise<void>;
  canResolve: boolean;
  onStatusChange: (status: PlanBundle["comments"][number]["status"]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [messageDraft, setMessageDraft] = useState<
    Pick<CommentDraft, "message" | "mentions">
  >({
    message: annotation.message,
    mentions: extractCommentMentions(annotation.message),
  });
  useEffect(() => {
    setMessageDraft({
      message: annotation.message,
      mentions: extractCommentMentions(annotation.message),
    });
    setEditing(false);
  }, [annotation.id, annotation.message, annotation.commentCount]);
  const rootComment = runtimeAnnotationRootComment(annotation);
  const replies = annotation.replies ?? [];
  const canSave = messageDraft.message.trim().length > 0 && !isPending;
  const resolver = normalizePlanCommentResolutionTarget(
    annotation.anchor.resolutionTarget,
  );
  const isResolved = annotation.status === "resolved";
  const save = () => {
    if (!canSave) return;
    onSave(messageDraft.message.trim());
  };
  return (
    <div
      data-plan-interactive
      className="pointer-events-auto absolute z-30 flex max-h-[min(520px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/96 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">Comment</h2>
          {annotation.commentCount > 1 && (
            <Badge variant="secondary" className="h-5 rounded-md px-1.5">
              {annotation.commentCount}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="h-5 rounded-md px-1.5 text-[11px]"
          >
            {resolver === "human" ? "Human review" : "Agent action"}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label="Comment options"
              >
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl">
              {canResolve && (
                <DropdownMenuItem
                  className="gap-2"
                  disabled={isPending}
                  onClick={() =>
                    onStatusChange(isResolved ? "open" : "resolved")
                  }
                >
                  <IconCircleCheck className="size-4" />
                  {isResolved ? "Reopen thread" : "Mark as resolved"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="gap-2"
                onClick={() => setEditing(true)}
              >
                <IconPencil className="size-4" />
                Edit first comment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                  disabled={isPending}
                  aria-label={isResolved ? "Reopen thread" : "Mark as resolved"}
                >
                  <IconCircleCheck className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isResolved ? "Reopen thread" : "Mark as resolved"}
              </TooltipContent>
            </Tooltip>
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
                placeholder="Edit comment..."
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
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={save}
                  disabled={!canSave}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <CommentThreadMessage comment={rootComment} />
          )}
          {replies.map((reply) => (
            <CommentThreadMessage key={reply.id} comment={reply} />
          ))}
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
  avatarUrls,
  currentUser,
  pendingAuthor,
  isPending,
  onReply,
  canResolve,
  onStatusChange,
  onClose,
}: {
  threads: CommentThread[];
  avatarUrls: Record<string, string | null>;
  currentUser?: CurrentCommentAuthor | null;
  pendingAuthor: CommentAuthorPresentation;
  isPending: boolean;
  onReply: (threadRootId: string, message: string) => Promise<void>;
  canResolve: boolean;
  onStatusChange: (
    thread: CommentThread,
    status: PlanBundle["comments"][number]["status"],
  ) => void;
  onClose: () => void;
}) {
  const openThreads = threads.filter(
    (thread) => commentThreadStatus(thread) === "open",
  );
  const visibleThreads = openThreads.length > 0 ? openThreads : threads;
  return (
    <aside
      data-plan-interactive
      className="absolute right-3 top-16 z-20 flex h-[min(640px,calc(100%-5rem))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/96 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">Comments</h2>
          <Badge variant="secondary" className="h-5 rounded-md px-1.5">
            {visibleThreads.length}
          </Badge>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onClose}
          aria-label="Close comments"
        >
          <IconX className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {visibleThreads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
              No annotations yet. Click Comment, then click the plan.
            </p>
          ) : (
            visibleThreads.map((thread) => {
              const isResolved = commentThreadStatus(thread) === "resolved";
              return (
                <article
                  key={thread.id}
                  className="grid gap-3 rounded-lg border border-border/80 bg-muted/20 p-3"
                >
                  {(thread.anchor || canResolve) && (
                    <div className="flex items-start gap-2">
                      {thread.anchor && (
                        <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {normalizePlanCommentResolutionTarget(
                              thread.anchor.resolutionTarget,
                            ) === "human"
                              ? "Human review"
                              : "Agent action"}
                          </span>
                          {" · "}
                          {formatAnchorForAgent(thread.anchor)}
                        </div>
                      )}
                      {canResolve && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant={isResolved ? "secondary" : "ghost"}
                              className="size-8 shrink-0 rounded-full"
                              disabled={isPending}
                              onClick={() =>
                                onStatusChange(
                                  thread,
                                  isResolved ? "open" : "resolved",
                                )
                              }
                              aria-label={
                                isResolved
                                  ? "Reopen thread"
                                  : "Mark as resolved"
                              }
                            >
                              <IconCircleCheck className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isResolved ? "Reopen thread" : "Mark as resolved"}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}
                  {thread.comments.map((comment) => (
                    <CommentThreadMessage
                      key={comment.id}
                      comment={runtimeCommentFromPlanComment(
                        comment,
                        avatarUrls,
                        currentUser,
                      )}
                    />
                  ))}
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

function injectAnnotationRuntime(
  html: string,
  comments: PlanBundle["comments"],
  annotateMode: boolean,
  theme: "dark" | "light",
  preferredEditor: PreferredEditor,
  avatarUrls: Record<string, string | null> = {},
  currentUser?: CurrentCommentAuthor | null,
) {
  const annotations = buildCommentThreads(comments)
    .map((thread, index) =>
      runtimeAnnotationFromThread(thread, index, avatarUrls, currentUser),
    )
    .filter((annotation): annotation is RuntimeAnnotation =>
      Boolean(annotation),
    );
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
    :root[data-agent-native-theme] pre code,
    :root[data-agent-native-theme] pre code * { background: transparent !important; background-image: none !important; box-shadow: none !important; }
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
    .an-plan-marker { position: absolute; transform: translate(-50%, -50%); min-width: 30px; height: 30px; overflow: visible; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; background: rgba(23,23,25,.86); color: #fff; font: 800 10px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: inline-flex; align-items: center; justify-content: center; gap: 3px; box-shadow: 0 10px 28px rgba(0,0,0,.36); pointer-events: auto; padding: 2px 6px 2px 2px; }
    .an-plan-marker[data-single="true"] { width: 30px; min-width: 30px; padding: 0; border: 2px solid var(--paper, #111113); background: var(--author-color, #00B5FF); overflow: hidden; }
    .an-plan-marker-stack { display: inline-flex; align-items: center; flex: 0 0 auto; }
    .an-plan-marker-face { width: 26px; height: 26px; margin-left: -7px; overflow: hidden; border: 2px solid var(--paper, #111113); border-radius: 999px; background: var(--author-color, #00B5FF); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
    .an-plan-marker-face:first-child { margin-left: 0; }
    .an-plan-marker[data-single="true"] .an-plan-marker-face { width: 28px; height: 28px; margin-left: 0; border: 0; }
    .an-plan-marker-avatar { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; display: block; }
    .an-plan-marker-initials { width: 100%; height: 100%; border-radius: inherit; background: var(--author-color, #00B5FF); color: #fff; display: inline-flex; align-items: center; justify-content: center; letter-spacing: 0; }
    .an-plan-marker-count { min-width: 13px; padding: 0 2px; color: rgba(255,255,255,.94); font-size: 11px; line-height: 1; }
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
    .visual-tabs[data-plan-tabs] .tab-list { display: inline-flex; width: fit-content; max-width: 100%; gap: 8px; border: 0; border-radius: 0; background: transparent; padding: 0; overflow-x: auto; }
    .visual-tabs[data-plan-tabs] .tab-button { min-height: 30px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted, #a4a4aa); padding: 0 11px; font: 650 12px/30px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; cursor: pointer; }
    .visual-tabs[data-plan-tabs] .tab-button:hover { color: var(--text, #f4f4f5); background: rgba(255,255,255,.05); }
    .visual-tabs[data-plan-tabs] .tab-button.is-active { border-color: var(--text, #f4f4f5); background: transparent; color: var(--text, #f4f4f5); }
    .visual-tabs[data-plan-tabs] .tab-button.is-active:hover { background: transparent; color: var(--text, #f4f4f5); }
    :root[data-agent-native-theme="light"] .visual-tabs[data-plan-tabs] .tab-button:hover { background: rgba(0,0,0,.06); }
    :root[data-agent-native-theme="light"] .visual-tabs[data-plan-tabs] .tab-button.is-active:hover { background: transparent; color: var(--text, #171717); }
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
      function restoreDocumentScroll(savedState) {
        if (!savedState) return;
        const doc = document.documentElement;
        const scrollWidth = Math.max(doc.scrollWidth, document.body?.scrollWidth || 0);
        const scrollHeight = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
        const x =
          typeof savedState.scrollX === "number"
            ? savedState.scrollX * (scrollWidth / Math.max(savedState.scrollWidth || scrollWidth, 1))
            : 0;
        const y =
          typeof savedState.scrollY === "number"
            ? savedState.scrollY * (scrollHeight / Math.max(savedState.scrollHeight || scrollHeight, 1))
            : 0;
        requestAnimationFrame(() => {
          window.scrollTo(x, y);
          syncAnnotationMarkers();
          postDocState();
          requestAnimationFrame(postDocState);
        });
      }
      window.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type !== "agent-native-plan-runtime-state") return;
        if (typeof data.parentOrigin === "string" && data.parentOrigin && data.parentOrigin !== "null") {
          window.__agentNativePlanParentOrigin = data.parentOrigin;
        }
        if (typeof data.theme === "string") setRuntimeTheme(data.theme);
        if (typeof data.preferredEditor === "string") {
          setPreferredEditor(data.preferredEditor, false);
        }
        if (typeof data.annotateMode === "boolean") {
          setRuntimeAnnotateMode(data.annotateMode);
        }
        if (data.restoreScroll) restoreDocumentScroll(data.restoreScroll);
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
      let annotationMarkerSyncFrame = 0;
      function scheduleAnnotationMarkerSync() {
        if (annotationMarkerSyncFrame) return;
        annotationMarkerSyncFrame = requestAnimationFrame(() => {
          annotationMarkerSyncFrame = 0;
          syncAnnotationMarkers();
        });
      }
      function markerAuthorFromItem(item) {
        return {
          authorName: item.authorName,
          authorEmail: item.authorEmail,
          authorAvatarUrl: item.authorAvatarUrl,
          authorColor: item.authorColor,
          authorInitials: item.authorInitials
        };
      }
      function createMarkerFace(author) {
        const face = document.createElement("span");
        face.className = "an-plan-marker-face";
        face.style.setProperty("--author-color", author.authorColor || "#00B5FF");
        const fallback = document.createElement("span");
        fallback.className = "an-plan-marker-initials";
        fallback.textContent = author.authorInitials || "?";
        if (author.authorAvatarUrl) {
          const image = document.createElement("img");
          image.className = "an-plan-marker-avatar";
          image.src = author.authorAvatarUrl;
          image.alt = author.authorName || "Comment author";
          image.addEventListener("error", () => {
            image.replaceWith(fallback);
          });
          face.appendChild(image);
        } else {
          face.appendChild(fallback);
        }
        return face;
      }
      function setMarkerThreadFaces(marker, item) {
        const participants = Array.isArray(item.participants) && item.participants.length
          ? item.participants
          : [markerAuthorFromItem(item)];
        const count = Math.max(1, Number(item.commentCount || 1));
        const single = participants.length <= 1 && count <= 1;
        marker.dataset.single = String(single);
        marker.style.setProperty("--author-color", participants[0]?.authorColor || item.authorColor || "#00B5FF");
        const stack = document.createElement("span");
        stack.className = "an-plan-marker-stack";
        for (const author of participants.slice(0, 2)) {
          stack.appendChild(createMarkerFace(author));
        }
        marker.replaceChildren(stack);
        if (!single) {
          const countLabel = document.createElement("span");
          countLabel.className = "an-plan-marker-count";
          countLabel.textContent = count > 99 ? "99+" : String(count);
          marker.appendChild(countLabel);
        }
      }
      removeEmptyPlanSections();
      upgradeImplementationFileMaps();
      initializePlanTabs();
      initializeEditorPickers();
      highlightPlainCodeBlocks();
      postDocState();
      window.addEventListener("scroll", postDocState, { passive: true });
      window.addEventListener("resize", () => {
        scheduleAnnotationMarkerSync();
        postDocState();
      });
      window.addEventListener("agent-native-plan-board-layout-change", () => {
        scheduleAnnotationMarkerSync();
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
        setMarkerThreadFaces(button, item);
        const participantNames = Array.isArray(item.participants)
          ? item.participants.map((participant) => participant.authorName).filter(Boolean).slice(0, 3).join(", ")
          : "";
        const countLabel = (item.commentCount || 1) + " comment" + ((item.commentCount || 1) === 1 ? "" : "s");
        button.title = participantNames
          ? countLabel + " by " + participantNames + ": " + (item.message || "Plan comment")
          : countLabel + ": " + (item.message || "Plan comment");
        button.setAttribute("aria-label", button.title);
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
          if (href === "#" || href.trim() === "") {
            event.preventDefault();
            event.stopPropagation();
            window.parent.postMessage({ type: "agent-native-plan-link-blocked", href }, "*");
            return;
          }
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
