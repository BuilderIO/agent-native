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
  IconLayoutSidebarRight,
  IconLoader2,
  IconPencil,
  IconMessageCircle,
  IconMoon,
  IconPlus,
  IconShare3,
  IconLink,
  IconWorld,
  IconSparkles,
  IconSun,
  IconX,
  IconSend,
  IconRefresh,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  SIDEBAR_STATE_CHANGE_EVENT,
  PromptComposer,
  ShareButton,
  appPath,
  agentNativePath,
  sendToAgentChat,
  setAgentChatContextItem,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSetPageTitle } from "@/components/layout/HeaderActions";
import { PlanContentRenderer } from "@/components/plan/PlanContentRenderer";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "@/components/plan/wireframe/use-wireframe-style";
import { GuestModeBanner } from "@/components/plan/GuestModeBanner";
import type {
  CanvasMarkupCreateContext,
  CanvasMarkupMode,
} from "@/components/plan/CanvasArea";
import {
  usePlan,
  usePlans,
  usePublishVisualPlan,
  useUpdatePlan,
  useExportPlan,
  type PublishVisualPlanResult,
} from "@/hooks/use-plans";
import { cn } from "@/lib/utils";
import type { PlanBundle, PlanSource } from "@shared/types";
import type {
  PlanAnnotation,
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
  canvasX?: number;
  canvasY?: number;
  markupType?: "text" | "callout";
  planAnnotationId?: string;
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

function commentAuthorName(source: CommentIdentitySource) {
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

function commentAuthorColor(source: CommentIdentitySource) {
  const email = normalizeCommentEmail(source.authorEmail);
  if (email) return emailToColor(email);
  if (source.createdBy === "agent") return "#0ea5e9";
  if (source.createdBy === "import") return "#737373";
  return "#525252";
}

function commentAuthorPresentation(
  source: CommentIdentitySource,
  avatarUrl?: string | null,
): CommentAuthorPresentation {
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
        anchor: parseAnchor(root.anchor),
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
        parseAnchor(root.anchor) ??
        commentsInThread
          .map((comment) => parseAnchor(comment.anchor))
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
) {
  const seen = new Set<string>();
  const participants: CommentAuthorPresentation[] = [];
  for (const comment of thread.comments) {
    const key = commentIdentityKey(comment, comment.id);
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push(
      commentAuthorPresentation(
        comment,
        commentAuthorAvatarUrl(comment, avatarUrls),
      ),
    );
  }
  return participants;
}

function runtimeCommentFromPlanComment(
  comment: PlanCommentItem,
  avatarUrls: Record<string, string | null>,
): RuntimeAnnotationComment {
  const author = commentAuthorPresentation(
    comment,
    commentAuthorAvatarUrl(comment, avatarUrls),
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
): RuntimeAnnotation | null {
  if (!thread.anchor) return null;
  const root = runtimeCommentFromPlanComment(thread.root, avatarUrls);
  return {
    ...root,
    index: index + 1,
    kind: thread.root.kind,
    status: commentThreadStatus(thread),
    sectionId: thread.root.sectionId,
    anchor: thread.anchor,
    replies: thread.replies.map((reply) =>
      runtimeCommentFromPlanComment(reply, avatarUrls),
    ),
    participants: commentThreadParticipants(thread, avatarUrls).map(
      runtimeParticipantFromAuthor,
    ),
    commentCount: thread.comments.length,
  };
}

function runtimeCommentFromAuthor(
  comment: RuntimeAnnotationComment,
): CommentAuthorPresentation {
  return commentAuthorPresentation(
    {
      createdBy: comment.createdBy,
      authorEmail: comment.authorEmail,
      authorName: comment.authorName,
    },
    comment.authorAvatarUrl,
  );
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
  return commentAuthorPresentation(
    {
      authorEmail: participant.authorEmail,
      authorName: participant.authorName,
    },
    participant.authorAvatarUrl,
  );
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
  const contentBlockCount = input.bundle.plan.content?.blocks.length ?? 0;
  const contentBlocks = input.bundle.plan.content?.blocks
    .slice(0, 12)
    .map(
      (block) =>
        `- ${block.id}: ${block.type}${block.title ? `, "${block.title}"` : ""}`,
    )
    .join("\n");
  const openComments = buildCommentThreads(input.bundle.comments)
    .filter((thread) => commentThreadStatus(thread) === "open")
    .slice(0, 6)
    .map((thread, index) => {
      const anchorContext = formatAnchorForAgent(thread.anchor);
      const messages = thread.comments
        .map((comment, messageIndex) => {
          const prefix = messageIndex === 0 ? "" : "   Reply ";
          return `${prefix}${commentAuthorLabel(comment)}: ${comment.message}`;
        })
        .join("\n");
      return `${index + 1}. ${messages}${anchorContext ? `\n   Context: ${anchorContext}` : ""}`;
    })
    .join("\n");

  return [
    "Current Agent-Native Plans review context:",
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
    "2. Prefer update-visual-plan contentPatches for targeted edits. Examples: update-rich-text for copy, update-wireframe-node for one kit-tree node, update-canvas-frame for frame layout, append-canvas-annotation / update-canvas-annotation for canvas markup, append-block/remove-block for document changes, or replace-block for a single block. Use full content only for broad restructuring. Use html only when preserving or importing a legacy standalone HTML artifact.",
    "3. Preserve the user's existing annotation comments and intent unless the user asks to remove or resolve them.",
    "4. Keep the output as a refined document with rich text, tables, sketch diagrams, wireframes, implementation maps, code tabs, and bounded custom HTML fragments.",
    "5. After applying feedback, keep the plan scannable, editable, and serious instead of turning it into a marketing page.",
    contentBlocks ? `\nStructured content blocks:\n${contentBlocks}` : "",
    openComments ? `\nOpen comments:\n${openComments}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildApplyFeedbackMessage(openCommentCount: number) {
  return `Apply the ${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this visual plan. Read the plan with get-visual-plan, read feedback with get-plan-feedback, then update structured content blocks and any related implementation details as needed. Use HTML only for legacy imported artifacts.`;
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
  const [planFullscreen, setPlanFullscreen] = useState(true);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [canvasMarkupMode, setCanvasMarkupMode] =
    useState<CanvasMarkupMode>("none");
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>(() =>
    readPreferredEditor(),
  );
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(false);
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
  const immersiveReader = Boolean(selectedId && planFullscreen);
  const planQuery = usePlan(selectedId);
  const bundle = planQuery.data;
  const commentThreads = useMemo(
    () => buildCommentThreads(bundle?.comments ?? []),
    [bundle?.comments],
  );
  const commentAvatarEmails = useMemo(
    () => commentAuthorEmails(bundle?.comments ?? [], collabUser?.email),
    [bundle?.comments, collabUser?.email],
  );
  const commentAvatarUrls = useCommentAvatarUrls(commentAvatarEmails);
  const pendingCommentAuthor = useMemo(
    () =>
      commentAuthorPresentation(
        {
          createdBy: "human",
          authorEmail: collabUser?.email,
          authorName: collabUser?.name,
        },
        collabUser?.email
          ? commentAvatarUrls[normalizeCommentEmail(collabUser.email) ?? ""]
          : null,
      ),
    [collabUser?.email, collabUser?.name, commentAvatarUrls],
  );
  const runtimeCommentThreads = useMemo(
    () =>
      commentThreads
        .map((thread, index) =>
          runtimeAnnotationFromThread(thread, index, commentAvatarUrls),
        )
        .filter((annotation): annotation is RuntimeAnnotation =>
          Boolean(annotation),
        ),
    [commentAvatarUrls, commentThreads],
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

  useSetPageTitle(bundle?.plan.title || "Plans");

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
    );
  }, [bundle, commentAvatarUrls, documentHtml]);

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
      const pointX =
        (anchor.x / 100) * nativeReader.scrollWidth - nativeReader.scrollLeft;
      const pointY =
        (anchor.y / 100) * nativeReader.scrollHeight - nativeReader.scrollTop;
      return resolveInlineCommentPosition({
        pointX,
        pointY,
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
          submit: false,
          context: planAgentContext,
          message: data.summary,
        });
        toast.success("Visual answers added to the agent draft");
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
      if (mode === "none") {
        closeInlineComment();
        return;
      }
      if (mode === "comment") {
        startCommenting();
        return;
      }
      setActiveAnnotation(null);
      setAnnotationsOpen(false);
      clearInlineCommentDraft();
      setAnnotateMode(false);
      setCanvasMarkupMode(mode);
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
    const sectionTitle =
      blockElement
        ?.querySelector<HTMLElement>("h1,h2,h3,[data-plan-section-title]")
        ?.textContent?.replace(/\s+/g, " ")
        .trim() ||
      blockElement?.getAttribute("aria-label") ||
      bundle?.plan.title;
    const snippet = textQuote.slice(0, 220);
    const anchor: PlanAnnotationAnchor = {
      x: ((pointX + reader.scrollLeft) / Math.max(reader.scrollWidth, 1)) * 100,
      y: ((pointY + reader.scrollTop) / Math.max(reader.scrollHeight, 1)) * 100,
      sectionId: blockElement?.dataset.blockId,
      sectionTitle,
      snippet,
      textQuote: snippet,
      anchorKind: "text",
      tagName: "selection",
      visualLabel: sectionTitle,
    };
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
    const anchor: PlanAnnotationAnchor = {
      x: ((pointX + reader.scrollLeft) / Math.max(reader.scrollWidth, 1)) * 100,
      y: ((pointY + reader.scrollTop) / Math.max(reader.scrollHeight, 1)) * 100,
      anchorKind: "point",
      visualLabel: bundle?.plan.title,
    };
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

  const submitInlineComment = async (message: string) => {
    if (!bundle || !pendingAnnotation) return;
    const sectionId =
      pendingAnnotation.sectionId &&
      bundle.sections.some(
        (section) => section.id === pendingAnnotation.sectionId,
      )
        ? pendingAnnotation.sectionId
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
            message,
            sectionId,
            anchor: JSON.stringify(pendingAnnotation),
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

  const nativeMarkerPosition = (anchor: PlanAnnotationAnchor) => {
    void nativeMarkerVersion;
    const reader = nativeReaderRef.current;
    if (!reader) return null;
    const left = (anchor.x / 100) * reader.scrollWidth - reader.scrollLeft;
    const top = (anchor.y / 100) * reader.scrollHeight - reader.scrollTop;
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
      {!selectedId && !sessionLoading && !session && (
        <GuestModeBanner onSignIn={() => openSignIn()} />
      )}
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
                  hasCanvas={Boolean(bundle.plan.content?.canvas)}
                  onModeChange={selectReviewMode}
                />
                {bundle.summary.openCommentCount > 0 && (
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
                          onClick={() =>
                            preservePlanReaderScroll(
                              sendPlanFeedbackToInlineAgent,
                            )
                          }
                          className="items-start gap-2"
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
                              if (!value) closeInlineComment();
                              return !value;
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
                        {immersiveReader ? "App view" : "Full screen"}
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
                      onContentChange={updateStructuredContent}
                      onContentPatch={patchStructuredContent}
                      contentUpdatedAt={bundle.plan.updatedAt}
                      editingDisabled={reviewMode !== "none"}
                      canvasMarkupMode={reviewMode}
                      onCanvasMarkupCreate={appendCanvasMarkup}
                      planId={bundle.plan.id}
                      collabUser={collabUser}
                      onVisualQuestionsSubmit={(summary) => {
                        sendToAgentChat({
                          type: "content",
                          submit: false,
                          context: planAgentContext,
                          message: summary,
                        });
                        toast.success(
                          "Visual answers added to the agent draft",
                        );
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
                  <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                    {runtimeCommentThreads.map((annotation) => {
                      const position = nativeMarkerPosition(annotation.anchor);
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
                />
              )}
              {annotationsOpen && (
                <AnnotationsPanel
                  threads={commentThreads}
                  avatarUrls={commentAvatarUrls}
                  pendingAuthor={pendingCommentAuthor}
                  isPending={updatePlan.isPending}
                  onReply={replyToCommentThread}
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

function PlanCanvasSkeleton() {
  return (
    <section
      className="plan-canvas relative h-[70vh] min-h-[520px] overflow-hidden border-b border-plan-line"
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
        <PlanSkeletonIcon />
        <Skeleton className="h-9 w-36 rounded-md bg-[var(--plan-text)]/90" />
        <PlanSkeletonIcon />
        <PlanSkeletonIcon />
      </div>

      <div className="absolute left-[8%] top-[17%] w-[min(48rem,58vw)] min-w-[34rem]">
        <PlanSkeletonBar className="mb-2 h-4 w-24" />
        <DesktopArtboardSkeleton />
        <div className="mt-7 max-w-[26rem]">
          <PlanSkeletonBar className="mb-3 h-5 w-36" />
          <div className="space-y-2">
            <PlanSkeletonBar className="h-3 w-full" />
            <PlanSkeletonBar className="h-3 w-4/5" />
          </div>
        </div>
      </div>

      <div className="absolute left-[62%] top-[18%] hidden w-[17rem] xl:block">
        <PlanSkeletonBar className="mb-2 h-4 w-20" />
        <PhoneArtboardSkeleton />
        <div className="mt-7 max-w-[16rem]">
          <PlanSkeletonBar className="mb-3 h-5 w-28" />
          <div className="space-y-2">
            <PlanSkeletonBar className="h-3 w-full" />
            <PlanSkeletonBar className="h-3 w-3/4" />
          </div>
        </div>
      </div>

      <div className="absolute left-[86%] top-[18%] hidden w-[17rem] 2xl:block">
        <PlanSkeletonBar className="mb-2 h-4 w-20" />
        <PhoneArtboardSkeleton />
      </div>

      <div className="absolute left-[52%] top-[40%] hidden h-px w-[12%] border-t border-dashed border-[hsl(var(--ring)/0.55)] xl:block" />
      <Skeleton className="absolute left-[54%] top-[38%] hidden h-6 w-16 rounded-full border border-[hsl(var(--ring)/0.45)] bg-plan-chrome xl:block" />
      <div className="absolute left-[79%] top-[41%] hidden h-px w-[8%] border-t border-dashed border-[hsl(var(--ring)/0.55)] 2xl:block" />
      <Skeleton className="absolute left-[80%] top-[39%] hidden h-6 w-16 rounded-full border border-[hsl(var(--ring)/0.45)] bg-plan-chrome 2xl:block" />

      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-plan-line bg-plan-chrome p-1 shadow-md backdrop-blur">
        <Skeleton className="size-6 rounded-md bg-[var(--plan-placeholder-line)]" />
        <Skeleton className="h-4 w-10 rounded-full bg-[var(--plan-placeholder-line)]" />
        <Skeleton className="size-6 rounded-md bg-[var(--plan-placeholder-line)]" />
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
        <Skeleton className="h-16 w-full max-w-[720px] rounded-lg bg-[var(--plan-text)]/18 sm:h-20" />
        <div className="mt-5 max-w-2xl space-y-3">
          <PlanSkeletonBar className="h-6 w-full" />
          <PlanSkeletonBar className="h-6 w-5/6" />
        </div>
      </header>

      <div className="plan-document-flow">
        <section className="plan-block">
          <Skeleton className="mb-6 h-11 w-72 max-w-full rounded-lg bg-[var(--plan-text)]/16" />
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
          <Skeleton className="mb-6 h-10 w-64 max-w-full rounded-lg bg-[var(--plan-text)]/14" />
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
    <div className="overflow-hidden rounded-[10px] border border-plan-line bg-plan-wireframe shadow-[0_10px_34px_rgba(24,24,27,0.08)]">
      <div className="flex h-8 items-center gap-2 border-b border-plan-line px-3">
        <Skeleton className="size-1.5 rounded-full bg-[var(--plan-placeholder-line)]" />
        <Skeleton className="size-1.5 rounded-full bg-[var(--plan-placeholder-line)]" />
        <Skeleton className="size-1.5 rounded-full bg-[var(--plan-placeholder-line)]" />
        <PlanSkeletonBar className="ml-2 h-3 w-24" />
      </div>
      <div className="grid min-h-[18rem] grid-cols-[8.5rem_minmax(0,1fr)]">
        <aside className="border-r border-plan-line p-4">
          <PlanSkeletonBar className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            <Skeleton className="h-7 rounded-md border border-[hsl(var(--ring)/0.4)] bg-[hsl(var(--ring)/0.08)]" />
            <PlanSkeletonBox className="h-7" />
            <PlanSkeletonBox className="h-7" />
            <PlanSkeletonBox className="h-7" />
          </div>
        </aside>
        <main className="p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="mb-3 h-8 w-48 rounded-lg bg-[var(--plan-text)]/16" />
              <div className="space-y-2">
                <PlanSkeletonBar className="h-3 w-11/12" />
                <PlanSkeletonBar className="h-3 w-2/3" />
              </div>
            </div>
            <PlanSkeletonBox className="h-9 w-20" />
          </div>
          <div className="mb-4 flex gap-2">
            <PlanSkeletonPill className="w-12" />
            <PlanSkeletonPill className="w-16" />
            <PlanSkeletonPill className="w-14" />
          </div>
          <div className="divide-y divide-plan-line">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex items-center gap-4 py-3">
                <Skeleton className="size-4 rounded border border-plan-line bg-transparent" />
                <div className="min-w-0 flex-1 space-y-2">
                  <PlanSkeletonBar
                    className={cn(
                      "h-3",
                      item === 1 ? "w-4/5" : item === 2 ? "w-3/4" : "w-11/12",
                    )}
                  />
                  <PlanSkeletonBar className="h-3 w-1/2" />
                </div>
                <PlanSkeletonPill className="w-12" />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function PhoneArtboardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-plan-line bg-plan-wireframe shadow-[0_10px_34px_rgba(24,24,27,0.08)]">
      <div className="flex h-9 items-center justify-between border-b border-plan-line px-4">
        <PlanSkeletonBar className="h-2.5 w-8" />
        <div className="flex gap-1">
          <Skeleton className="h-1.5 w-5 rounded-full bg-[var(--plan-placeholder-line)]" />
          <Skeleton className="h-1.5 w-3 rounded-full bg-[var(--plan-placeholder-line)]" />
          <Skeleton className="h-1.5 w-3 rounded-full bg-[var(--plan-placeholder-line)]" />
        </div>
      </div>
      <div className="border-b border-plan-line px-4 py-3">
        <div className="mb-4 flex items-center justify-between">
          <PlanSkeletonBar className="h-3 w-10" />
          <PlanSkeletonBar className="h-4 w-20" />
          <PlanSkeletonIcon className="size-5" />
        </div>
        <div className="flex gap-2">
          <PlanSkeletonPill className="w-9" />
          <PlanSkeletonPill className="w-14" />
          <PlanSkeletonPill className="w-12" />
        </div>
      </div>
      <div className="divide-y divide-plan-line px-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="flex items-center gap-3 py-3">
            <Skeleton className="size-3.5 rounded border border-plan-line bg-transparent" />
            <div className="min-w-0 flex-1 space-y-2">
              <PlanSkeletonBar
                className={cn(
                  "h-3",
                  item === 0 ? "w-5/6" : item === 2 ? "w-2/3" : "w-3/4",
                )}
              />
              <PlanSkeletonBar className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-24" />
    </div>
  );
}

function PlanSkeletonBar({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "rounded-full bg-[var(--plan-placeholder-line)]",
        className,
      )}
    />
  );
}

function PlanSkeletonBox({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "rounded-md bg-[var(--plan-placeholder-line)]/55",
        className,
      )}
    />
  );
}

function PlanSkeletonPill({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "h-6 rounded-full border border-plan-line bg-[var(--plan-placeholder-line)]/35",
        className,
      )}
    />
  );
}

function PlanSkeletonIcon({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "size-8 rounded-md bg-[var(--plan-placeholder-line)]",
        className,
      )}
    />
  );
}

function ReviewMarkupToolbar({
  mode,
  hasCanvas,
  onModeChange,
}: {
  mode: CanvasMarkupMode;
  hasCanvas: boolean;
  onModeChange: (mode: CanvasMarkupMode) => void;
}) {
  const value = mode === "none" ? "" : mode;
  const setValue = (next: string) => {
    onModeChange((next || "none") as CanvasMarkupMode);
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
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="text"
            className="size-7 px-0"
            disabled={!hasCanvas}
            aria-label="Text note"
          >
            <IconPencil className="size-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {hasCanvas ? "Place a text note" : "Canvas required"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="callout"
            className="size-7 px-0"
            disabled={!hasCanvas}
            aria-label="Arrow callout"
          >
            <IconArrowRight className="size-4" />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {hasCanvas ? "Draw an arrow callout" : "Canvas required"}
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
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-border bg-muted/30">
          <IconSparkles className="size-5 text-muted-foreground" />
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
          {canCreate ? "New Plan" : "Sign in to create"}
        </Button>
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
              Plans
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
    ? "Visualize this existing plan while preserving its intent."
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
    "Use the Plans actions after you have enough substance. Generate the wireframes, diagrams, implementation map, review prompts, and concrete file/symbol notes yourself. Do not use placeholder file names, generic scaffold text, or browser-generated fallback sections as the final plan content.",
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
    toast.success("Sent to the Plans agent");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Ask agent to create plan</DialogTitle>
          <DialogDescription>
            Describe the plan you want, or paste an existing Codex/Claude plan.
            The Plans agent will generate the wireframes and review structure.
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

function InlineCommentPopover({
  position,
  onCancel,
  onSubmit,
}: {
  position: InlineCommentPosition;
  onCancel: () => void;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "44px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 44), 144);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > nextHeight ? "auto" : "hidden";
  }, [message]);
  const canSubmit = message.trim().length > 0 && !isSubmitting;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitError(false);
    setIsSubmitting(true);
    try {
      await onSubmit(message.trim());
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
      className="absolute z-30 rounded-xl border border-border/80 bg-background/96 p-2 shadow-2xl backdrop-blur-xl"
      style={{ left: position.left, top: position.top, width: position.width }}
    >
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
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
          rows={1}
          autoFocus
          placeholder="Add a comment..."
          className="h-11 min-h-11 max-h-36 resize-none overflow-hidden border-border/80 bg-background py-2.5 text-sm leading-5 shadow-none focus-visible:ring-1"
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
          {comment.message}
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
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "40px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 128);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > nextHeight ? "auto" : "hidden";
  }, [message]);

  const canSubmit = message.trim().length > 0 && !isSubmitting && !isPending;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitError(false);
    setIsSubmitting(true);
    try {
      await onSubmit(message.trim());
      setMessage("");
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
        <div className="flex min-w-0 flex-1 items-end gap-2 rounded-full border border-border/80 bg-muted/40 px-3 py-1.5 focus-within:border-primary/60 focus-within:bg-background">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="h-10 min-h-10 resize-none overflow-hidden border-0 bg-transparent px-0 py-2 text-sm leading-5 shadow-none focus-visible:ring-0"
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
}: {
  annotation: RuntimeAnnotation;
  position: InlineCommentPosition;
  isPending: boolean;
  pendingAuthor: CommentAuthorPresentation;
  onSave: (message: string) => void;
  onReply: (threadRootId: string, message: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(annotation.message);
  useEffect(() => {
    setMessage(annotation.message);
    setEditing(false);
  }, [annotation.id, annotation.message, annotation.commentCount]);
  const rootComment = runtimeAnnotationRootComment(annotation);
  const replies = annotation.replies ?? [];
  const canSave = message.trim().length > 0 && !isPending;
  const save = () => {
    if (!canSave) return;
    onSave(message.trim());
  };
  return (
    <div
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
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              onClick={() => setEditing(true)}
              aria-label="Edit first comment"
            >
              <IconPencil className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit first comment</TooltipContent>
        </Tooltip>
      </div>
      <div className="max-h-[min(360px,calc(100vh-180px))] overflow-y-auto">
        <div className="grid gap-4 p-4">
          {editing ? (
            <div className="grid gap-2">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    save();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                    setMessage(annotation.message);
                  }
                }}
                rows={4}
                autoFocus
                className="min-h-24 resize-none border-border/80 bg-background text-sm shadow-none focus-visible:ring-1"
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
  pendingAuthor,
  isPending,
  onReply,
  onClose,
}: {
  threads: CommentThread[];
  avatarUrls: Record<string, string | null>;
  pendingAuthor: CommentAuthorPresentation;
  isPending: boolean;
  onReply: (threadRootId: string, message: string) => Promise<void>;
  onClose: () => void;
}) {
  const openThreads = threads.filter(
    (thread) => commentThreadStatus(thread) === "open",
  );
  const visibleThreads = openThreads.length > 0 ? openThreads : threads;
  return (
    <aside className="absolute right-3 top-16 z-20 flex h-[min(640px,calc(100%-5rem))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/96 shadow-2xl backdrop-blur-xl">
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
              return (
                <article
                  key={thread.id}
                  className="grid gap-3 rounded-lg border border-border/80 bg-muted/20 p-3"
                >
                  {thread.comments.map((comment) => (
                    <CommentThreadMessage
                      key={comment.id}
                      comment={runtimeCommentFromPlanComment(
                        comment,
                        avatarUrls,
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
  if (anchor.planAnnotationId || anchor.canvasX !== undefined) {
    const label = anchor.visualLabel || "canvas";
    const kind =
      anchor.markupType === "callout"
        ? "callout"
        : anchor.markupType === "text"
          ? "note"
          : "markup";
    const canvasPoint =
      anchor.canvasX !== undefined && anchor.canvasY !== undefined
        ? ` at canvas ${Math.round(anchor.canvasX)}, ${Math.round(anchor.canvasY)}`
        : "";
    return `${tab}${section}${label} ${kind}${canvasPoint}`;
  }
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
  avatarUrls: Record<string, string | null> = {},
) {
  const annotations = buildCommentThreads(comments)
    .map((thread, index) =>
      runtimeAnnotationFromThread(thread, index, avatarUrls),
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
