import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import { AI_FILTER_LABEL, type AiFilterTarget } from "@shared/ai-filter";
import {
  AI_IMPORTANT_LABEL,
  AI_PRIORITY_MAX_EMAILS,
  aiPriorityEmailKey,
  type AiPriorityEmail,
  type MailSortMode,
} from "@shared/ai-priority";
import { type GmailReadState } from "@shared/gmail-freshness";
import { mailLabelsInclude } from "@shared/gmail-labels";
import { inboxFilterParam, withInboxFilter } from "@shared/inbox-filters";
import { mailSettingsRoute } from "@shared/settings-navigation";
import type { EmailMessage, Label } from "@shared/types";
import {
  IconAlertCircle,
  IconArchive,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconFilter,
  IconFolder,
  IconInbox,
  IconMail,
  IconMailOpened,
  IconPlus,
  IconTag,
  IconTrash,
  IconX,
  IconSettings,
} from "@tabler/icons-react";
import {
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { ActionTooltip } from "@/components/email/ActionTooltip";
import { AiFilterDialog } from "@/components/email/AiFilterDialog";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import {
  JevConnectionDialog,
  JevConnectionMenuItem,
} from "@/components/settings/JevConnectionPrompt";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { useAiPriority, type AiPriorityResult } from "@/hooks/use-ai-priority";
import {
  askAgentToDraftImportanceRules,
  useAiPriorityFeedback,
} from "@/hooks/use-ai-priority-feedback";
import { useAutomations } from "@/hooks/use-automations";
import {
  useEmails,
  useMarkRead,
  useMarkThreadRead,
  useToggleStar,
  useArchiveEmail,
  useUnarchiveEmail,
  useTrashEmail,
  useUntrashEmail,
  useBulkArchiveEmails,
  useBulkTrashEmails,
  useBulkToggleStar,
  useBulkMarkRead,
  useLabels,
  EMPTY_LABELS,
  releaseOwnedInboxRemoval,
  releaseSuppressionClaims,
  type AccountError,
} from "@/hooks/use-emails";
import {
  isKeyboardShortcutTarget,
  useKeyboardShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { useNewMailAbove } from "@/hooks/use-new-mail-above";
import {
  useConfirmUncertainScheduledEmail,
  useDeleteScheduledJob,
  useRetryUncertainScheduledEmail,
  useSendScheduledJobNow,
} from "@/hooks/use-scheduled-jobs";
import { setUndoAction, setUndoToastId, UNDO_DURATION } from "@/hooks/use-undo";
import { mailThreadHref } from "@/lib/mail-routes";
import { isMcpEmbedSurface } from "@/lib/mcp-embed";
import {
  ensureThread,
  THREAD_PREFETCH_INTENT_MS,
  warmThreads,
} from "@/lib/thread-cache";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";
import { cn, formatShortcut } from "@/lib/utils";

import { EmailListItem } from "./EmailListItem";
import { EmailListSectionHeading } from "./EmailListSectionHeading";
import { GmailCooldownNotice } from "./GmailCooldownNotice";
import {
  observeNextPage,
  retryNextPage as runPaginationRetry,
  shouldShowPaginationRetry,
} from "./infinite-pagination";
import {
  LabelPicker,
  useApplyLabel,
  type LabelChoice,
  type LabelPickerAction,
  type LabelPickerRequest,
} from "./LabelPicker";

type EmailsPage = { emails: EmailMessage[]; nextPageToken?: string };
type InfiniteEmails = InfiniteData<EmailsPage, string | undefined>;
type SnoozeTarget = {
  emailId: string;
  accountEmail?: string;
};

function toPriorityEmail(email: EmailMessage): AiPriorityEmail {
  return {
    id: email.id,
    threadId: email.threadId,
    accountEmail: email.accountEmail,
    from: email.from.email,
    to: email.to.map((recipient) => recipient.email).join(", "),
    subject: email.subject,
    snippet: email.snippet,
    labelIds: email.labelIds,
    date: email.date,
    isArchived: email.isArchived,
    isTrashed: email.isTrashed,
  };
}

function priorityEmailCacheKey(
  email: EmailMessage,
  ruleRevision: string,
  providerIdentity = "",
): string {
  const priorityEmail = toPriorityEmail(email);
  return JSON.stringify([
    ruleRevision,
    providerIdentity,
    priorityEmail.accountEmail,
    priorityEmail.id,
    priorityEmail.date,
    priorityEmail.from,
    priorityEmail.to,
    priorityEmail.subject,
    priorityEmail.snippet,
  ]);
}

type CachedPriorityScore = {
  inputKey: string;
  score: number;
  model?: AiPriorityResult["model"];
  providerIdentity?: string;
};
type FrozenPriorityOrder = {
  ruleRevision: string;
  providerIdentity: string;
  keys: string[];
  priorityKeys: string[];
  scores: Record<string, number>;
};

const priorityScoreCaches = new WeakMap<
  QueryClient,
  Map<string, CachedPriorityScore>
>();

function priorityScoreCache(queryClient: QueryClient) {
  let cache = priorityScoreCaches.get(queryClient);
  if (!cache) {
    cache = new Map();
    priorityScoreCaches.set(queryClient, cache);
  }
  return cache;
}

export function rememberPriorityScore(
  cache: Map<string, CachedPriorityScore>,
  key: string,
  score: CachedPriorityScore,
) {
  cache.delete(key);
  cache.set(key, score);
  while (cache.size > AI_PRIORITY_MAX_EMAILS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export interface EmailListSection {
  id: string;
  title: string;
  emails: EmailMessage[];
  soonestFirst?: boolean;
}

interface EmailListProps {
  emails?: EmailMessage[];
  sections?: EmailListSection[];
  topSection?: ReactNode;
  headerActions?: ReactNode;
  isLoading?: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean | undefined;
  emailsError?: Error | null;
  accountErrors?: AccountError[] | undefined;
  /** Set when the rows are not live from Gmail (cooldown); shown as a notice. */
  read?: GmailReadState | undefined;
  labels?: Label[] | undefined;
  refetchEmails?: () => unknown;
  hasNextPage?: boolean;
  /** Paging stopped at the server's offset cap; older mail is out of reach here. */
  reachedCap?: boolean;
  fetchNextPage?: () => Promise<unknown>;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCompose?: (
    email: EmailMessage,
    mode: "reply" | "replyAll" | "forward",
  ) => void;
  onArchived?: (id: string) => void;
  onDraftOpen?: (email: EmailMessage) => void;
  onNavigateThread?: (threadId: string, accountEmail?: string) => void;
  showPrioritySort?: boolean;
  jevConfigured?: boolean;
  priorityProviderIdentity?: string;
  jevAvailabilityLoading?: boolean;
  jevAvailabilityError?: boolean;
  onJevConnected?: () => void;
  onJevRetry?: () => void;
  sortMode?: MailSortMode;
  onSortModeChange?: (mode: MailSortMode) => void;
  filterControl?: ReactNode;
  emptyHintKey?: string | undefined;
  readingPane?: boolean;
  keyboardEnabled?: boolean;
  onThreadOrderChange?: (threadIds: string[]) => void;
}

const INBOX_ZERO_PHOTOS = [
  "photo-1506744038136-46273834b3fb", // Yosemite valley
  "photo-1470071459604-3b5ec3a7fe05", // Misty green mountains
  "photo-1441974231531-c6227db76b6e", // Forest sunlight
  "photo-1469474968028-56623f02e42e", // Golden sunset coast
  "photo-1472214103451-9374bd1c798e", // Green rolling hills
  "photo-1483347756197-71ef80e95f73", // Aurora borealis
  "photo-1507525428034-b723cf961d3e", // Tropical beach
  "photo-1505765050516-f72dcac9c60e", // Mountain reflection lake
  "photo-1464822759023-fed622ff2c3b", // Snow-capped mountain
  "photo-1433086966358-54859d0ed716", // Waterfall in forest
  "photo-1501854140801-50d01698950b", // Aerial forest
  "photo-1643840154819-6831d22f7621", // Pink sky desert
  "photo-1502082553048-f009c37129b9", // Sun through trees
  "photo-1536431311719-398b6704d4cc", // Dramatic clouds
  "photo-1475924156734-496f6cac6ec1", // Northern lights
  "photo-1540202404-a2f29016b523", // Lavender fields
  "photo-1494500764479-0c8f2919a3d8", // Redwood forest
  "photo-1509316975850-ff9c5deb0cd9", // Cherry blossoms
  "photo-1508739773434-c26b3d09e071", // Sunset over ocean
  "photo-1476610182048-b716b8518aae", // Lightning storm
  "photo-1490730141103-6cac27aaab94", // Sunrise mountains
  "photo-1527489377706-5bf97e608852", // Blue ice cave
  "photo-1542224566-6e85f2e6772f", // Autumn forest path
  "photo-1501785888041-af3ef285b470", // Italian coast
  "photo-1523712999610-f77fbcfc3843", // Foggy forest
  "photo-1419242902214-272b3f66ee7a", // Milky way
  "photo-1468276311594-df7cb65d8df6", // Tropical ocean
  "photo-1531366936337-7c912a4589a7", // Volcanic landscape
  "photo-1552083375-1447ce886485", // Japanese garden
];

function emptyStateHintKeyForView(view: string): string {
  switch (view) {
    case "snoozed":
      return "mail.empty.snoozed";
    case "drafts":
      return "mail.empty.drafts";
    case "sent":
      return "mail.empty.sent";
    case "scheduled":
      return "mail.empty.scheduled";
    case "archive":
      return "mail.empty.archive";
    case "trash":
      return "mail.empty.trash";
    case "spam":
      return "mail.empty.spam";
    case "all":
      return "mail.empty.all";
    default:
      return "mail.empty.default";
  }
}

export function InboxZero() {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const isEmbedded = isMcpEmbedSurface();

  useEffect(() => {
    document.documentElement.classList.add("inbox-zero");
    return () => document.documentElement.classList.remove("inbox-zero");
  }, []);

  const today = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
      86400000,
  );
  const photoId = INBOX_ZERO_PHOTOS[dayOfYear % INBOX_ZERO_PHOTOS.length];
  const imageUrl = `https://images.unsplash.com/${photoId}?w=1920&q=80&fit=crop`;

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {/* Background image — fixed so it extends behind header + agent sidebar for blur */}
      {isEmbedded ? (
        <div className="fixed inset-0 bg-[linear-gradient(135deg,hsl(220,18%,11%),hsl(203,22%,18%)_55%,hsl(168,24%,16%))]" />
      ) : (
        <img
          src={imageUrl}
          alt=""
          onLoad={() => setLoaded(true)}
          className={cn(
            "fixed inset-0 h-full w-full object-cover",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {/* Persistent scrims keep white chrome readable across bright photos. */}
      <div className="fixed inset-0 bg-black/20" />
      <div className="inbox-zero-top-scrim fixed inset-x-0 top-0" />

      {/* Bottom gradient — text legibility */}
      <div className="fixed inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Fallback bg while image loads */}
      <div className="absolute inset-0 bg-muted dark:bg-[var(--mail-sidebar-surface)] -z-10" />

      {/* Bottom text */}
      <div className="relative mt-auto px-6 pb-6">
        <p className="text-[15px] font-medium text-white/90 drop-shadow-lg">
          {t("mail.empty.inboxZeroTitle")}
        </p>
        <p className="text-[13px] text-white/60 drop-shadow-lg mt-0.5">
          {t("mail.empty.inboxZeroSubtitle")}
        </p>
      </div>
    </div>
  );
}

function MailLoadingState({
  containerRef,
  rich = false,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rich?: boolean;
}) {
  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      <div className="flex-1 overflow-y-auto">
        {rich ? (
          <MailLoadingRichRows count={8} />
        ) : (
          <MailLoadingRows count={12} />
        )}
      </div>
    </div>
  );
}

function MailLoadingRichRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="email-list-row flex items-start border-b border-border/30 py-2.5 ps-3 pe-3.5"
        >
          <div className="me-2 flex h-[18px] w-5 shrink-0 items-center justify-center">
            <div className="h-[7px] w-[7px] animate-pulse rounded-full bg-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex h-[18px] items-center gap-3">
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              <div className="ms-auto h-3 w-10 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-0.5 flex h-[19.5px] items-center">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-0.5 flex h-[34px] flex-col justify-center gap-1.5">
              <div className="h-2.5 w-full animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MailLoadingRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="email-list-row flex h-[48px] items-center px-3 sm:h-[38px]"
        >
          <div className="me-2 flex h-full w-5 shrink-0 items-center justify-center">
            <div className="h-[7px] w-[7px] animate-pulse rounded-full bg-muted" />
          </div>
          <div className="me-3 flex w-[100px] shrink-0 items-center sm:w-[160px]">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          </div>
          {index % 2 === 1 && (
            <div className="me-2 h-4 w-14 shrink-0 animate-pulse rounded bg-muted" />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <div className="h-3 w-36 shrink-0 animate-pulse rounded bg-muted" />
            <div className="h-3 min-w-0 flex-1 animate-pulse rounded bg-muted" />
          </div>
          <div className="ms-2 h-3 w-12 shrink-0 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

const RATE_LIMIT_RETRY_MS = 60_000;

const RICH_ROW_HEIGHT_ESTIMATE = 96;

function getRateLimitRetryMs(error: {
  message?: string;
  retryAfterMs?: number | undefined;
}): number {
  if (
    typeof error.retryAfterMs === "number" &&
    Number.isFinite(error.retryAfterMs) &&
    error.retryAfterMs > 0
  ) {
    return Math.min(Math.max(error.retryAfterMs, 15_000), 5 * 60_000);
  }
  const match = (error.message ?? "").match(/retry in\s+(\d+)s/i);
  if (!match) return RATE_LIMIT_RETRY_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return RATE_LIMIT_RETRY_MS;
  return Math.min(Math.max(seconds * 1000, 15_000), 5 * 60_000);
}

function EmailRetryButton({
  isQuotaError,
  message,
  retryAfterMs,
  isFetching,
  onRetry,
}: {
  isQuotaError: boolean;
  message: string;
  retryAfterMs?: number | undefined;
  isFetching: boolean;
  onRetry: () => unknown;
}) {
  const t = useT();
  const rateLimitRetryMs = isQuotaError
    ? getRateLimitRetryMs({ message, retryAfterMs })
    : 0;
  const [cooldownRemaining, setCooldownRemaining] = useState(rateLimitRetryMs);

  useEffect(() => {
    setCooldownRemaining(rateLimitRetryMs);
  }, [rateLimitRetryMs]);

  const isCoolingDown = cooldownRemaining > 0;
  useEffect(() => {
    if (!isCoolingDown) return;
    const handle = setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(handle);
  }, [isCoolingDown]);

  const handleClick = useCallback(() => {
    if (cooldownRemaining > 0 || isFetching) return;
    setCooldownRemaining(rateLimitRetryMs);
    void onRetry();
  }, [cooldownRemaining, isFetching, onRetry, rateLimitRetryMs]);

  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
  const buttonDisabled = isFetching || cooldownRemaining > 0;

  let buttonLabel: string;
  if (isFetching) {
    buttonLabel = t("mail.error.retrying");
  } else if (cooldownRemaining > 0) {
    buttonLabel = t("mail.error.tryAgainIn", { seconds: cooldownSeconds });
  } else {
    buttonLabel = t("mail.error.tryAgain");
  }

  return (
    <button
      onClick={handleClick}
      disabled={buttonDisabled}
      className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isFetching && <Spinner className="h-3 w-3" />}
      {buttonLabel}
    </button>
  );
}

function EmailErrorState({
  isQuotaError,
  message,
  retryAfterMs,
  isFetching,
  onRetry,
  containerRef,
}: {
  isQuotaError: boolean;
  message: string;
  retryAfterMs?: number;
  isFetching: boolean;
  onRetry: () => unknown;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="flex flex-col items-center gap-3 max-w-xs text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <IconAlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {isQuotaError
                ? t("mail.error.rateLimitTitle")
                : t("mail.error.loadTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {isQuotaError ? t("mail.error.rateLimitDescription") : message}
            </p>
          </div>
          <EmailRetryButton
            {...{ isQuotaError, message, retryAfterMs, isFetching, onRetry }}
          />
        </div>
      </div>
    </div>
  );
}

function AccountErrorsNotice({ errors }: { errors: AccountError[] }) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/30 bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
      <IconAlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {t("mail.error.someAccountsFailed", {
          accounts: errors.map((e) => e.email).join(", "),
        })}
      </span>
    </div>
  );
}

const LIST_NAVIGATION_KEYS = new Set([
  "j",
  "k",
  "J",
  "K",
  "ArrowDown",
  "ArrowUp",
  "Home",
]);

export function EmailList({
  emails: emailsProp,
  sections,
  topSection,
  headerActions: viewHeaderActions,
  isLoading: isLoadingProp,
  isFetching: isFetchingProp,
  isPlaceholderData: isPlaceholderDataProp,
  emailsError: emailsErrorProp,
  accountErrors: accountErrorsProp,
  read: readProp,
  labels: labelsProp,
  refetchEmails,
  hasNextPage: hasNextPageProp,
  reachedCap = false,
  fetchNextPage: fetchNextPageProp,
  isFetchingNextPage: isFetchingNextPageProp,
  isFetchNextPageError: isFetchNextPageErrorProp,
  focusedId,
  setFocusedId,
  selectedIds,
  setSelectedIds,
  onCompose,
  onArchived,
  onDraftOpen,
  onNavigateThread,
  showPrioritySort = false,
  jevConfigured = false,
  priorityProviderIdentity = "",
  jevAvailabilityLoading = false,
  jevAvailabilityError = false,
  onJevConnected,
  onJevRetry,
  sortMode = "newest",
  onSortModeChange,
  filterControl,
  emptyHintKey,
  readingPane = false,
  keyboardEnabled = true,
  onThreadOrderChange,
}: EmailListProps) {
  const t = useT();
  const { isPending: isPriorityPending, mutateAsync: requestPriority } =
    useAiPriority();
  const priorityFeedback = useAiPriorityFeedback();
  const navigate = useNavigate();
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const { data: automationRules = [], isFetching: areAutomationRulesFetching } =
    useAutomations({ enabled: view === "inbox" });
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") ?? undefined;
  const labelParam = searchParams.get("label");
  const currentSortMode: MailSortMode =
    showPrioritySort && view === "inbox" && !searchQuery && !labelParam
      ? sortMode
      : "newest";
  const [aiFilterDialog, setAiFilterDialog] = useState<{
    action: "filter" | "keep";
    targets: AiFilterTarget[];
  } | null>(null);
  const [jevDialog, setJevDialog] = useState<"unopened" | "open" | "closed">(
    "unopened",
  );

  const {
    data: fetchedEmails = [],
    isLoading: fetchedEmailsLoading,
    isFetching: fetchedEmailsFetching,
    isPlaceholderData: fetchedEmailsPlaceholder,
    error: fetchedEmailsError,
    refetch: refetchFetchedEmails,
    hasNextPage: fetchedEmailsHasNextPage,
    fetchNextPage: fetchFetchedNextPage,
    isFetchingNextPage: fetchedEmailsFetchingNextPage,
    isFetchNextPageError: fetchedEmailsFetchNextPageError,
    accountErrors: fetchedAccountErrors,
    read: fetchedRead,
  } = useEmails(view, searchQuery, labelParam ?? undefined, {
    enabled: emailsProp === undefined,
  });

  const emails = emailsProp ?? fetchedEmails;
  const isLoading = isLoadingProp ?? fetchedEmailsLoading;
  const isFetching = isFetchingProp ?? fetchedEmailsFetching;
  const listIsPlaceholder =
    isPlaceholderDataProp ??
    (emailsProp === undefined && fetchedEmailsPlaceholder);
  const emailsError = emailsErrorProp ?? fetchedEmailsError;
  const accountErrors = accountErrorsProp ?? fetchedAccountErrors;
  const read = readProp ?? fetchedRead;
  const refetch = refetchEmails ?? refetchFetchedEmails;
  const hasNextPage = hasNextPageProp ?? fetchedEmailsHasNextPage;
  const fetchNextPage = fetchNextPageProp ?? fetchFetchedNextPage;
  const isFetchingNextPage =
    isFetchingNextPageProp ?? fetchedEmailsFetchingNextPage;
  const isFetchNextPageError =
    isFetchNextPageErrorProp ?? fetchedEmailsFetchNextPageError;
  const paginationRetryInFlightRef = useRef(false);
  const retryNextPage = useCallback(
    () => runPaginationRetry(fetchNextPage, paginationRetryInFlightRef),
    [fetchNextPage],
  );
  const markRead = useMarkRead();
  const markThreadRead = useMarkThreadRead();
  const toggleStar = useToggleStar();
  const archiveEmail = useArchiveEmail();
  const unarchiveEmail = useUnarchiveEmail();
  const trashEmail = useTrashEmail();
  const untrashEmail = useUntrashEmail();
  const bulkArchiveEmails = useBulkArchiveEmails();
  const bulkTrashEmails = useBulkTrashEmails();
  const bulkToggleStar = useBulkToggleStar();
  const bulkMarkRead = useBulkMarkRead();
  const { activeAccounts } = useAccountFilter();
  const { data: labelsData } = useLabels(
    activeAccounts.size > 0 ? [...activeAccounts] : undefined,
  );
  const labels = labelsProp ?? labelsData ?? EMPTY_LABELS;
  const labelNames = useMemo(
    () => new Map(labels.map((label) => [label.id, label.name])),
    [labels],
  );
  const applyLabel = useApplyLabel(labelParam || undefined);
  const [labelPicker, setLabelPicker] = useState<LabelPickerRequest | null>(
    null,
  );
  const cancelScheduledJob = useDeleteScheduledJob();
  const sendScheduledJobNow = useSendScheduledJobNow();
  const confirmUncertainScheduled = useConfirmUncertainScheduledEmail();
  const retryUncertainScheduled = useRetryUncertainScheduledEmail();
  const [retryUncertainJobId, setRetryUncertainJobId] = useState<string | null>(
    null,
  );
  const queryClient = useQueryClient();
  const userLabels = useMemo(
    () => labels.filter((label) => label.type === "user"),
    [labels],
  );
  const movableLabels = useMemo(
    () => userLabels.filter((label) => label.id !== labelParam),
    [userLabels, labelParam],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const sectionedThreads = useMemo(() => {
    if (!sections) return null;
    const ordered: ThreadSummary[] = [];
    const headings = new Map<number, { title: string; count: number }>();
    for (const section of sections) {
      const grouped = groupIntoThreads(section.emails);
      if (grouped.length === 0) continue;
      headings.set(ordered.length, {
        title: section.title,
        count: grouped.length,
      });
      ordered.push(...(section.soonestFirst ? grouped.reverse() : grouped));
    }
    return { threads: ordered, headings };
  }, [sections]);
  const showSectionHeadings =
    !!sectionedThreads &&
    sectionedThreads.headings.size + (topSection ? 1 : 0) > 1;
  const chronologicalThreads = useMemo(
    () => sectionedThreads?.threads ?? groupIntoThreads(emails),
    [emails, sectionedThreads],
  );
  const priorityEmails = useMemo(
    () =>
      chronologicalThreads
        .map((thread) => thread.latestMessage)
        .filter(
          (email) =>
            !email.isArchived &&
            !email.isTrashed &&
            mailLabelsInclude(email.labelIds, "inbox"),
        ),
    [chronologicalThreads],
  );
  const priorityWindowEmails = useMemo(
    () => priorityEmails.slice(0, AI_PRIORITY_MAX_EMAILS),
    [priorityEmails],
  );
  const priorityWindowIds = useMemo(
    () =>
      new Set(
        priorityWindowEmails.map((email) =>
          aiPriorityEmailKey(email.accountEmail, email.id),
        ),
      ),
    [priorityWindowEmails],
  );
  const priorityRuleRevision = useMemo(
    () =>
      automationRules
        .filter(
          (rule) =>
            rule.kind === "ai-filter" &&
            rule.domain === "mail" &&
            rule.enabled &&
            rule.actions.some(
              (action) =>
                action.type === "label" &&
                action.labelName === AI_IMPORTANT_LABEL,
            ) &&
            !rule.actions.some((action) => action.type === "archive"),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(
          (rule) =>
            `${rule.id}:${rule.updatedAt}:${rule.condition}:${JSON.stringify(rule.actions)}`,
        )
        .join("\u001f"),
    [automationRules],
  );
  const chronologicalIndexes = useMemo(
    () =>
      new Map(
        chronologicalThreads.map((thread, index) => [
          aiPriorityEmailKey(
            thread.latestMessage.accountEmail,
            thread.latestMessage.id,
          ),
          index,
        ]),
      ),
    [chronologicalThreads],
  );
  const priorityInputKey = useMemo(
    () =>
      [priorityRuleRevision, priorityProviderIdentity]
        .concat(
          priorityWindowEmails.map(
            (email) =>
              `${email.accountEmail}:${email.id}:${email.date}:${email.from.email}:${JSON.stringify(email.to)}:${email.subject}:${email.snippet}`,
          ),
        )
        .join("\u001f"),
    [priorityRuleRevision, priorityProviderIdentity, priorityWindowEmails],
  );
  const [priorityScores, setPriorityScores] = useState(
    () => new Map(priorityScoreCache(queryClient)),
  );
  const [priorityOrder, setPriorityOrder] =
    useState<FrozenPriorityOrder | null>(null);
  const recordPriorityFeedback = useCallback(
    (email: EmailMessage, decision: "important" | "not-important") => {
      const key = aiPriorityEmailKey(email.accountEmail, email.id);
      const score = decision === "important" ? 1 : 0;
      const cache = priorityScoreCache(queryClient);
      const previousScore = cache.get(key) ?? priorityScores.get(key);
      const optimisticScore = {
        inputKey: priorityEmailCacheKey(email, priorityRuleRevision),
        score,
        model: null,
      };
      setPriorityOrder(null);
      rememberPriorityScore(cache, key, optimisticScore);
      setPriorityScores((current) => {
        const next = new Map(current);
        next.set(key, optimisticScore);
        return next;
      });
      void priorityFeedback
        .mutateAsync({
          emailId: email.id,
          accountEmail: email.accountEmail,
          decision,
          sender: email.from.name || email.from.email,
          subject: email.subject,
        })
        .then(({ totalVotes, recentVotes }) => {
          if (totalVotes % 5 !== 0) return;
          let showSuggestion = true;
          try {
            const key = "mail-priority-feedback-suggestion-count";
            const shownCount = Number(localStorage.getItem(key) ?? 0);
            showSuggestion = shownCount < totalVotes;
            if (showSuggestion) localStorage.setItem(key, String(totalVotes));
            // coercion-ok: feedback was saved server-side; this only tracks a local reminder.
          } catch {
            // Feedback is saved server-side even when browser storage is unavailable.
          }
          if (!showSuggestion) return;
          toast.info(t("mail.sort.priorityFeedbackSuggestion"), {
            duration: 8_000,
            action: {
              label: t("mail.sort.priorityFeedbackAskAgent"),
              onClick: () =>
                askAgentToDraftImportanceRules(
                  t("mail.sort.priorityFeedbackSuggestion"),
                  recentVotes,
                ),
            },
          });
        })
        .catch((error) => {
          setPriorityOrder(null);
          setPriorityScores((current) => {
            if (current.get(key) !== optimisticScore) return current;
            const next = new Map(current);
            if (previousScore) next.set(key, previousScore);
            else next.delete(key);
            return next;
          });
          if (cache.get(key) === optimisticScore) {
            if (previousScore) rememberPriorityScore(cache, key, previousScore);
            else cache.delete(key);
          }
          reportWriteFailure(error, { label: t("mail.aiFilter.actionFailed") });
        });
    },
    [
      navigate,
      priorityFeedback,
      priorityRuleRevision,
      priorityScores,
      queryClient,
      t,
    ],
  );
  const cachedPriorityScores = useMemo(() => {
    const cached = new Map<string, number>();
    for (const email of priorityWindowEmails) {
      const key = aiPriorityEmailKey(email.accountEmail, email.id);
      const score = priorityScores.get(key);
      if (
        (score?.providerIdentity === undefined ||
          score.providerIdentity === priorityProviderIdentity) &&
        score?.inputKey ===
          priorityEmailCacheKey(
            email,
            priorityRuleRevision,
            score?.providerIdentity,
          )
      ) {
        cached.set(key, score.score);
      }
    }
    return cached;
  }, [
    priorityProviderIdentity,
    priorityRuleRevision,
    priorityScores,
    priorityWindowEmails,
  ]);
  const priorityRequestKeyRef = useRef("");
  const priorityRequestGenerationRef = useRef(0);
  const previousSortModeRef = useRef(currentSortMode);
  const runPriority = useCallback(async () => {
    const uncachedPriorityEmails = priorityWindowEmails.filter(
      (email) =>
        !cachedPriorityScores.has(
          aiPriorityEmailKey(email.accountEmail, email.id),
        ),
    );
    if (
      areAutomationRulesFetching ||
      isPriorityPending ||
      priorityWindowEmails.length === 0 ||
      priorityRequestKeyRef.current === priorityInputKey
    ) {
      return;
    }
    if (uncachedPriorityEmails.length === 0) {
      priorityRequestKeyRef.current = priorityInputKey;
      return;
    }
    const requestKey = priorityInputKey;
    const requestGeneration = ++priorityRequestGenerationRef.current;
    priorityRequestKeyRef.current = requestKey;
    const pendingEmailsByKey = new Map(
      uncachedPriorityEmails.map((email) => [
        aiPriorityEmailKey(email.accountEmail, email.id),
        email,
      ]),
    );
    const uniquePendingEmailById = new Map<string, EmailMessage | null>();
    for (const email of uncachedPriorityEmails) {
      uniquePendingEmailById.set(
        email.id,
        uniquePendingEmailById.has(email.id) ? null : email,
      );
    }
    const pendingInputKeys = new Map(
      uncachedPriorityEmails.map((email) => [
        aiPriorityEmailKey(email.accountEmail, email.id),
        priorityEmailCacheKey(
          email,
          priorityRuleRevision,
          priorityProviderIdentity,
        ),
      ]),
    );
    try {
      const result = await requestPriority({
        emails: uncachedPriorityEmails.map(toPriorityEmail),
      });
      if (priorityRequestGenerationRef.current !== requestGeneration) return;
      const cache = priorityScoreCache(queryClient);
      const next = new Map(cache);
      const scoredKeys = new Set<string>();
      const failedKeys = new Set<string>();
      for (const failure of result.failures) {
        const email =
          failure.accountEmail === undefined
            ? uniquePendingEmailById.get(failure.emailId)
            : pendingEmailsByKey.get(
                aiPriorityEmailKey(failure.accountEmail, failure.emailId),
              );
        if (!email) throw new Error(t("mail.sort.priorityFailed"));
        const key = aiPriorityEmailKey(email.accountEmail, email.id);
        if (failedKeys.has(key)) {
          throw new Error(t("mail.sort.priorityFailed"));
        }
        failedKeys.add(key);
      }
      for (const score of result.scores) {
        const email =
          score.accountEmail === undefined
            ? uniquePendingEmailById.get(score.emailId)
            : pendingEmailsByKey.get(
                aiPriorityEmailKey(score.accountEmail, score.emailId),
              );
        if (!email) {
          throw new Error(t("mail.sort.priorityFailed"));
        }
        const key = aiPriorityEmailKey(email.accountEmail, email.id);
        if (scoredKeys.has(key) || failedKeys.has(key)) {
          throw new Error(t("mail.sort.priorityFailed"));
        }
        scoredKeys.add(key);
        const inputKey = pendingInputKeys.get(key);
        if (inputKey) {
          const cachedScore = {
            inputKey,
            score: score.score,
            model: result.model,
            providerIdentity: priorityProviderIdentity,
          };
          rememberPriorityScore(cache, key, cachedScore);
          rememberPriorityScore(next, key, cachedScore);
        }
      }
      if (scoredKeys.size + failedKeys.size !== uncachedPriorityEmails.length) {
        throw new Error(t("mail.sort.priorityFailed"));
      }
      setPriorityScores(next);
      if (result.failures.length > 0) {
        toast.error(
          t("mail.sort.priorityPartialFailed", {
            count: result.failures.length,
          }),
        );
      }
    } catch (error: unknown) {
      if (priorityRequestGenerationRef.current !== requestGeneration) return;
      priorityRequestKeyRef.current = "";
      onSortModeChange?.("newest");
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "errorCode" in error &&
        typeof error.errorCode === "string"
          ? error.errorCode
          : undefined;
      toast.error(
        errorCode === "jev_not_enabled"
          ? t("mail.sort.priorityProviderRequired")
          : t("mail.sort.priorityFailed"),
      );
    }
  }, [
    onSortModeChange,
    areAutomationRulesFetching,
    isPriorityPending,
    priorityInputKey,
    priorityProviderIdentity,
    priorityRuleRevision,
    cachedPriorityScores,
    priorityWindowEmails,
    queryClient,
    requestPriority,
    t,
  ]);
  useEffect(() => {
    if (currentSortMode !== "priority") {
      priorityRequestGenerationRef.current += 1;
      setPriorityOrder(null);
      previousSortModeRef.current = currentSortMode;
      return;
    }
    if (
      currentSortMode === "priority" &&
      previousSortModeRef.current !== "priority"
    ) {
      priorityRequestKeyRef.current = "";
      setPriorityOrder(null);
    }
    previousSortModeRef.current = currentSortMode;
    if (currentSortMode === "priority") void runPriority();
  }, [currentSortMode, isPriorityPending, runPriority]);
  const rankedPriorityThreads = useMemo(
    () =>
      currentSortMode === "priority"
        ? [...chronologicalThreads].sort((a, b) => {
            const aKey = aiPriorityEmailKey(
              a.latestMessage.accountEmail,
              a.latestMessage.id,
            );
            const bKey = aiPriorityEmailKey(
              b.latestMessage.accountEmail,
              b.latestMessage.id,
            );
            const aIsPriority = priorityWindowIds.has(aKey);
            const bIsPriority = priorityWindowIds.has(bKey);
            if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
            if (!aIsPriority) {
              return (
                (chronologicalIndexes.get(aKey) ?? 0) -
                (chronologicalIndexes.get(bKey) ?? 0)
              );
            }
            const aScore = cachedPriorityScores.get(aKey);
            const bScore = cachedPriorityScores.get(bKey);
            if (aScore === undefined && bScore !== undefined) return 1;
            if (aScore !== undefined && bScore === undefined) return -1;
            if (
              aScore !== undefined &&
              bScore !== undefined &&
              aScore !== bScore
            ) {
              return bScore - aScore;
            }
            return (
              new Date(b.latestMessage.date).getTime() -
                new Date(a.latestMessage.date).getTime() ||
              b.latestMessage.id.localeCompare(a.latestMessage.id)
            );
          })
        : chronologicalThreads,
    [
      chronologicalIndexes,
      chronologicalThreads,
      currentSortMode,
      cachedPriorityScores,
      priorityWindowIds,
    ],
  );
  useEffect(() => {
    if (
      currentSortMode !== "priority" ||
      priorityWindowEmails.length === 0 ||
      !priorityWindowEmails.every((email) =>
        cachedPriorityScores.has(
          aiPriorityEmailKey(email.accountEmail, email.id),
        ),
      )
    ) {
      return;
    }
    if (
      priorityOrder?.ruleRevision === priorityRuleRevision &&
      priorityOrder.providerIdentity === priorityProviderIdentity &&
      priorityOrder.keys.length > 0
    ) {
      return;
    }
    setPriorityOrder({
      ruleRevision: priorityRuleRevision,
      providerIdentity: priorityProviderIdentity,
      keys: rankedPriorityThreads
        .filter((thread) =>
          priorityWindowIds.has(
            aiPriorityEmailKey(
              thread.latestMessage.accountEmail,
              thread.latestMessage.id,
            ),
          ),
        )
        .map((thread) =>
          aiPriorityEmailKey(
            thread.latestMessage.accountEmail,
            thread.latestMessage.id,
          ),
        ),
      priorityKeys: [...priorityWindowIds],
      scores: Object.fromEntries(cachedPriorityScores),
    });
  }, [
    cachedPriorityScores,
    currentSortMode,
    priorityOrder,
    priorityWindowIds,
    priorityProviderIdentity,
    priorityRuleRevision,
    priorityWindowEmails,
    rankedPriorityThreads,
  ]);
  useEffect(() => {
    if (
      currentSortMode !== "priority" ||
      !priorityOrder ||
      priorityOrder.ruleRevision !== priorityRuleRevision ||
      priorityOrder.providerIdentity !== priorityProviderIdentity
    ) {
      return;
    }
    const priorityKeys = new Set(priorityOrder.priorityKeys);
    const scores = { ...priorityOrder.scores };
    let changed = false;
    for (const email of priorityWindowEmails) {
      const key = aiPriorityEmailKey(email.accountEmail, email.id);
      const score = cachedPriorityScores.get(key);
      if (priorityKeys.has(key) || score === undefined) continue;
      priorityKeys.add(key);
      scores[key] = score;
      changed = true;
    }
    if (!changed) return;
    setPriorityOrder((current) =>
      current === priorityOrder
        ? { ...current, priorityKeys: [...priorityKeys], scores }
        : current,
    );
  }, [
    cachedPriorityScores,
    currentSortMode,
    priorityOrder,
    priorityProviderIdentity,
    priorityRuleRevision,
    priorityWindowEmails,
  ]);
  const activePriorityOrder =
    priorityOrder?.ruleRevision === priorityRuleRevision &&
    priorityOrder.providerIdentity === priorityProviderIdentity
      ? priorityOrder
      : null;
  const threads = useMemo(() => {
    if (currentSortMode !== "priority") return chronologicalThreads;
    if (!activePriorityOrder) return rankedPriorityThreads;
    const order = new Map(
      activePriorityOrder.keys
        .filter((key) => priorityWindowIds.has(key))
        .map((key, index) => [key, index]),
    );
    const frozenPriorityKeys = new Set(
      activePriorityOrder.priorityKeys.filter((key) =>
        priorityWindowIds.has(key),
      ),
    );
    return [...rankedPriorityThreads].sort((a, b) => {
      const aKey = aiPriorityEmailKey(
        a.latestMessage.accountEmail,
        a.latestMessage.id,
      );
      const bKey = aiPriorityEmailKey(
        b.latestMessage.accountEmail,
        b.latestMessage.id,
      );
      const aIndex = order.get(aKey);
      const bIndex = order.get(bKey);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      const aIsPriority =
        aIndex !== undefined
          ? frozenPriorityKeys.has(aKey)
          : priorityWindowIds.has(aKey);
      const bIsPriority =
        bIndex !== undefined
          ? frozenPriorityKeys.has(bKey)
          : priorityWindowIds.has(bKey);
      if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
      if (aIsPriority) {
        const scoreDifference =
          (activePriorityOrder.scores[bKey] ??
            cachedPriorityScores.get(bKey) ??
            0.5) -
          (activePriorityOrder.scores[aKey] ??
            cachedPriorityScores.get(aKey) ??
            0.5);
        if (scoreDifference !== 0) return scoreDifference;
      }
      const chronologicalDifference =
        (chronologicalIndexes.get(aKey) ?? 0) -
        (chronologicalIndexes.get(bKey) ?? 0);
      if (chronologicalDifference !== 0) return chronologicalDifference;
      return b.latestMessage.id.localeCompare(a.latestMessage.id);
    });
  }, [
    cachedPriorityScores,
    chronologicalIndexes,
    chronologicalThreads,
    currentSortMode,
    activePriorityOrder,
    priorityWindowIds,
    rankedPriorityThreads,
  ]);
  const priorityLoading =
    currentSortMode === "priority" &&
    !activePriorityOrder &&
    priorityWindowEmails.length > cachedPriorityScores.size;
  const reportedThreadOrderRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!onThreadOrderChange) return;
    const threadIds = threads.map(
      (t) => t.latestMessage.threadId || t.latestMessage.id,
    );
    const reported = reportedThreadOrderRef.current;
    if (
      reported?.length === threadIds.length &&
      reported.every((id, index) => id === threadIds[index])
    ) {
      return;
    }
    reportedThreadOrderRef.current = threadIds;
    onThreadOrderChange(threadIds);
  }, [onThreadOrderChange, threads]);

  const focusedIndex = threads.findIndex(
    (t) => t.latestMessage.id === focusedId,
  );

  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const selectThreads = useCallback(
    (predicate: (thread: ThreadSummary) => boolean) => {
      const keys = threads
        .filter(predicate)
        .map(
          (thread) => thread.latestMessage.threadId || thread.latestMessage.id,
        );
      setSelectedIds(new Set(keys));
      if (keys.length > 0) {
        const first = threads.find(
          (thread) =>
            (thread.latestMessage.threadId || thread.latestMessage.id) ===
            keys[0],
        );
        if (first) setFocusedId(first.latestMessage.id);
      }
    },
    [setFocusedId, setSelectedIds, threads],
  );

  const selectAllThreads = useCallback(() => {
    selectThreads(() => true);
  }, [selectThreads]);

  const selectReadThreads = useCallback(() => {
    selectThreads((thread) => !thread.hasUnread);
  }, [selectThreads]);

  const selectUnreadThreads = useCallback(() => {
    selectThreads((thread) => thread.hasUnread);
  }, [selectThreads]);

  const selectStarredThreads = useCallback(() => {
    selectThreads((thread) => thread.hasStarred);
  }, [selectThreads]);

  const selectUnstarredThreads = useCallback(() => {
    selectThreads((thread) => !thread.hasStarred);
  }, [selectThreads]);

  // Hover is speculative, so it goes through warmThreads: that path skips work
  // during a rate-limit or auth cooldown. Opening a thread stays on ensureThread.
  const prefetchThread = useCallback((thread: ThreadSummary) => {
    const email = thread.latestMessage;
    if (email.isDraft) return;
    warmThreads([
      { id: email.threadId || email.id, accountEmail: email.accountEmail },
    ]);
  }, []);

  const previewThread = useCallback(
    (thread: ThreadSummary) => {
      const email = thread.latestMessage;
      if (email.isDraft) return;
      const targetThreadId = email.threadId || email.id;
      void ensureThread(targetThreadId, email.accountEmail).catch(() => {});
      onNavigateThread?.(targetThreadId, email.accountEmail);
      void navigate(
        mailThreadHref(view, targetThreadId, searchParams, email.accountEmail),
        { replace: Boolean(threadId) },
      );
    },
    [navigate, onNavigateThread, searchParams, threadId, view],
  );

  const syncedThreadIdRef = useRef<string | null>(null);
  const syncedMessageIdRef = useRef<string | null>(null);
  const closedThreadIdRef = useRef<string | null>(null);

  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!LIST_NAVIGATION_KEYS.has(event.key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isKeyboardShortcutTarget(event.target, event.key)) return;
      containerRef.current?.setAttribute("data-keyboard-nav", "");
    };
    const onMouseMove = (event: MouseEvent) => {
      const last = lastPointerRef.current;
      if (last && last.x === event.clientX && last.y === event.clientY) return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      containerRef.current?.removeAttribute("data-keyboard-nav");
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  const moveFocus = useCallback(
    (delta: number) => {
      setSelectedIds(new Set());
      if (threads.length === 0) return;
      let current = focusedIndexRef.current;
      if (current === -1 && focusedIdRef.current) {
        current = threads.findIndex(
          (t) => t.latestMessage.id === focusedIdRef.current,
        );
      }
      const base = current === -1 ? 0 : current;
      const baseEmail = (threads[base] as ThreadSummary | undefined)
        ?.latestMessage;
      const opensCurrent =
        readingPane &&
        !threadId &&
        Math.abs(delta) === 1 &&
        baseEmail !== undefined &&
        !baseEmail.isDraft &&
        (baseEmail.threadId || baseEmail.id) !== closedThreadIdRef.current;
      const next = Math.max(
        0,
        Math.min(threads.length - 1, base + (opensCurrent ? 0 : delta)),
      );
      const nextThread = threads[next] as ThreadSummary | undefined;
      if (!nextThread) return;
      setFocusedId(nextThread.latestMessage.id);
      focusedIndexRef.current = next;
      if (readingPane) previewThread(nextThread);
      // Scrolling the focused row into view is handled by the effect that
      // watches `focusedIndex` and calls `rowVirtualizer.scrollToIndex`.
    },
    [
      threads,
      setFocusedId,
      setSelectedIds,
      readingPane,
      threadId,
      previewThread,
    ],
  );

  const extendSelection = useCallback(
    (delta: number) => {
      if (threads.length === 0) return;
      const current = focusedIndexRef.current;
      const next = Math.max(
        0,
        Math.min(threads.length - 1, (current === -1 ? 0 : current) + delta),
      );
      const newFocusThread = threads[next];
      const newFocusId = newFocusThread.latestMessage.id;
      const newThreadKey = newFocusThread.latestMessage.threadId || newFocusId;

      setSelectedIds((prev) => {
        const updated = new Set(prev);
        if (prev.size === 0 && focusedIdRef.current) {
          const anchorThread = threads.find(
            (t) => t.latestMessage.id === focusedIdRef.current,
          );
          if (anchorThread) {
            updated.add(
              anchorThread.latestMessage.threadId ||
                anchorThread.latestMessage.id,
            );
          }
        }
        updated.add(newThreadKey);
        return updated;
      });

      setFocusedId(newFocusId);
      focusedIndexRef.current = next;
      // Scrolling into view is handled by the `focusedIndex` effect above.
    },
    [threads, setFocusedId, setSelectedIds],
  );

  const getActionThreadKeys = useCallback((): string[] => {
    if (selectedIdsRef.current.size > 0)
      return Array.from(selectedIdsRef.current);
    const fid = focusedIdRef.current;
    const thread = fid
      ? threads.find((t) => t.latestMessage.id === fid)
      : threads[0];
    if (!thread) return [];
    return [thread.latestMessage.threadId || thread.latestMessage.id];
  }, [threads]);

  const openFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (!thread) return;
    const targetThreadId = thread.latestMessage.threadId || id;
    setSelectedIds(new Set());
    void ensureThread(targetThreadId, thread.latestMessage.accountEmail).catch(
      () => {},
    );
    onNavigateThread?.(targetThreadId, thread.latestMessage.accountEmail);
    void navigate(
      mailThreadHref(
        view,
        targetThreadId,
        searchParams,
        thread.latestMessage.accountEmail,
      ),
      { replace: Boolean(threadId) },
    );
    if (thread.hasUnread) {
      setTimeout(
        () =>
          markThreadRead.mutate({
            threadId: targetThreadId,
            accountEmail: thread.latestMessage.accountEmail,
          }),
        0,
      );
    }
  }, [
    threads,
    view,
    navigate,
    markThreadRead,
    searchParams,
    threadId,
    queryClient,
    setSelectedIds,
  ]);

  const focusAfterRemoving = useCallback(
    (threadKeys: string[]) => {
      const removed = new Set(threadKeys);
      const lastIdx = threads.findIndex(
        (t) =>
          (t.latestMessage.threadId || t.latestMessage.id) ===
          threadKeys[threadKeys.length - 1],
      );
      const remaining = threads.filter(
        (t) => !removed.has(t.latestMessage.threadId || t.latestMessage.id),
      );
      const nextThread =
        remaining.length > 0
          ? remaining[Math.min(lastIdx, remaining.length - 1)]
          : undefined;
      setFocusedId(nextThread ? nextThread.latestMessage.id : null);
      return nextThread;
    },
    [threads, setFocusedId],
  );

  const archiveThreadKeys = useCallback(
    (threadKeys: string[]) => {
      if (threadKeys.length === 0) return;

      const targets = threadKeys
        .map((key) =>
          threads.find(
            (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
          ),
        )
        .filter((t): t is ThreadSummary => !!t);
      const emailIds = targets.map((t) => t.latestMessage.id);
      const emailRefs = targets.map((t) => ({
        id: t.latestMessage.id,
        accountEmail: t.latestMessage.accountEmail,
        threadId: t.latestMessage.threadId || t.latestMessage.id,
      }));

      const nextThread = focusAfterRemoving(threadKeys);
      if (nextThread) {
        const nextTid =
          nextThread.latestMessage.threadId || nextThread.latestMessage.id;
        void ensureThread(nextTid, nextThread.latestMessage.accountEmail).catch(
          () => {},
        );
      }

      const snapshots: EmailMessage[] = [];
      for (const key of threadKeys) {
        snapshots.push(...emails.filter((e) => (e.threadId || e.id) === key));
      }
      for (const id of emailIds) onArchived?.(id);

      const suppressionToken =
        targets.length > 1
          ? bulkArchiveEmails.createSuppressionToken()
          : archiveEmail.createSuppressionToken();
      const undo = () => {
        const getSuppressionIds =
          targets.length > 1
            ? bulkArchiveEmails.getSuppressionIds
            : archiveEmail.getSuppressionIds;
        const restorableThreadIds = new Set<string>();
        const inboxRemovalSnapshots = new Map<
          string,
          ReturnType<typeof releaseOwnedInboxRemoval>
        >();
        for (const key of threadKeys) {
          const inboxRemovalSnapshot = releaseOwnedInboxRemoval(
            queryClient,
            key,
            suppressionToken,
          );
          if (
            releaseSuppressionClaims(
              key,
              getSuppressionIds(suppressionToken, key),
            )
          ) {
            restorableThreadIds.add(key);
            inboxRemovalSnapshots.set(key, inboxRemovalSnapshot);
          }
        }
        const restorableSnapshots = snapshots.filter((email) =>
          restorableThreadIds.has(email.threadId || email.id),
        );
        if (restorableSnapshots.length > 0) {
          queryClient.setQueriesData<InfiniteEmails>(
            { queryKey: ["emails"] },
            (old) => {
              if (!old) return old;
              const firstPage = old.pages[0];
              const restored = [
                ...(firstPage?.emails ?? []),
                ...restorableSnapshots,
              ].sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime(),
              );
              return {
                ...old,
                pages: [
                  { ...firstPage, emails: restored },
                  ...old.pages.slice(1),
                ],
              };
            },
          );
        }
        for (const ref of emailRefs) {
          if (restorableThreadIds.has(ref.threadId || ref.id))
            unarchiveEmail.mutate({
              ...ref,
              suppressionToken,
              inboxRemovalSnapshot: inboxRemovalSnapshots.get(
                ref.threadId || ref.id,
              ),
            });
        }
      };
      const consumeUndo = setUndoAction(undo);
      const toastId = toast(
        threadKeys.length > 1
          ? t("mail.toasts.archivedMany", { count: threadKeys.length })
          : t("mail.toasts.archived"),
        {
          action: { label: t("mail.actions.undo"), onClick: consumeUndo },
          duration: UNDO_DURATION,
        },
      );
      setUndoToastId(toastId);
      if (targets.length > 1) {
        bulkArchiveEmails.mutate({
          targets: targets.map((t) => ({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          })),
          removeLabel: labelParam || undefined,
          suppressionToken,
        });
      } else {
        for (const t of targets) {
          archiveEmail.mutate({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            removeLabel: labelParam || undefined,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
            suppressionToken,
          });
        }
      }
      setSelectedIds(new Set());
    },
    [
      threads,
      emails,
      archiveEmail,
      bulkArchiveEmails,
      unarchiveEmail,
      onArchived,
      labelParam,
      focusAfterRemoving,
      setSelectedIds,
      queryClient,
    ],
  );

  const archiveFocused = useCallback(() => {
    archiveThreadKeys(getActionThreadKeys());
  }, [archiveThreadKeys, getActionThreadKeys]);

  const trashThreadKeys = useCallback(
    (threadKeys: string[]) => {
      if (threadKeys.length === 0) return;

      const targets = threadKeys
        .map((key) =>
          threads.find(
            (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
          ),
        )
        .filter((t): t is ThreadSummary => !!t);
      const emailRefs = targets.map((t) => ({
        id: t.latestMessage.id,
        accountEmail: t.latestMessage.accountEmail,
        threadId: t.latestMessage.threadId || t.latestMessage.id,
      }));

      focusAfterRemoving(threadKeys);

      const snapshots: EmailMessage[] = [];
      for (const key of threadKeys) {
        snapshots.push(...emails.filter((e) => (e.threadId || e.id) === key));
      }

      const suppressionToken =
        targets.length > 1
          ? bulkTrashEmails.createSuppressionToken()
          : trashEmail.createSuppressionToken();
      const undo = () => {
        const getSuppressionIds =
          targets.length > 1
            ? bulkTrashEmails.getSuppressionIds
            : trashEmail.getSuppressionIds;
        const restorableThreadIds = new Set<string>();
        const inboxRemovalSnapshots = new Map<
          string,
          ReturnType<typeof releaseOwnedInboxRemoval>
        >();
        for (const key of threadKeys) {
          const inboxRemovalSnapshot = releaseOwnedInboxRemoval(
            queryClient,
            key,
            suppressionToken,
          );
          if (
            releaseSuppressionClaims(
              key,
              getSuppressionIds(suppressionToken, key),
            )
          ) {
            restorableThreadIds.add(key);
            inboxRemovalSnapshots.set(key, inboxRemovalSnapshot);
          }
        }
        const restorableSnapshots = snapshots.filter((email) =>
          restorableThreadIds.has(email.threadId || email.id),
        );
        if (restorableSnapshots.length > 0) {
          queryClient.setQueriesData<InfiniteEmails>(
            { queryKey: ["emails"] },
            (old) => {
              if (!old) return old;
              const firstPage = old.pages[0];
              const restored = [
                ...(firstPage?.emails ?? []),
                ...restorableSnapshots,
              ].sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime(),
              );
              return {
                ...old,
                pages: [
                  { ...firstPage, emails: restored },
                  ...old.pages.slice(1),
                ],
              };
            },
          );
        }
        for (const ref of emailRefs) {
          if (restorableThreadIds.has(ref.threadId || ref.id))
            untrashEmail.mutate({
              ...ref,
              suppressionToken,
              inboxRemovalSnapshot: inboxRemovalSnapshots.get(
                ref.threadId || ref.id,
              ),
            });
        }
      };
      const consumeUndo = setUndoAction(undo);
      const toastId = toast(
        threadKeys.length > 1
          ? t("mail.toasts.trashedMany", { count: threadKeys.length })
          : t("mail.toasts.trashed"),
        {
          action: { label: t("mail.actions.undo"), onClick: consumeUndo },
          duration: UNDO_DURATION,
        },
      );
      setUndoToastId(toastId);
      if (targets.length > 1) {
        bulkTrashEmails.mutate({
          targets: targets.map((t) => ({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          })),
          suppressionToken,
        });
      } else {
        for (const ref of emailRefs)
          trashEmail.mutate({ ...ref, suppressionToken });
      }
      setSelectedIds(new Set());
    },
    [
      threads,
      emails,
      trashEmail,
      bulkTrashEmails,
      untrashEmail,
      focusAfterRemoving,
      setSelectedIds,
      queryClient,
    ],
  );

  const trashFocused = useCallback(() => {
    if (view === "trash") return;
    const threadKeys = getActionThreadKeys();
    if (threadKeys.length === 0) return;
    trashThreadKeys(threadKeys);
  }, [getActionThreadKeys, trashThreadKeys, view]);

  const resolveTargets = useCallback(
    (keys: string[]): ThreadSummary[] =>
      keys
        .map((key) =>
          threads.find(
            (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
          ),
        )
        .filter((t): t is ThreadSummary => !!t),
    [threads],
  );

  const openAiFilterDialog = useCallback(
    (action: "filter" | "keep") => {
      const targets = resolveTargets(getActionThreadKeys()).map(
        (thread): AiFilterTarget => {
          const email = thread.latestMessage;
          return {
            id: email.id,
            threadId: email.threadId || email.id,
            ...(email.accountEmail && email.accountEmail !== "local"
              ? { accountEmail: email.accountEmail }
              : {}),
            sender: email.from.name
              ? `${email.from.name} <${email.from.email}>`
              : email.from.email,
            subject: email.subject,
          };
        },
      );
      if (targets.length === 0) {
        toast.error(t("mail.toasts.noEmailSelected"));
        return;
      }
      setAiFilterDialog({ action, targets });
    },
    [getActionThreadKeys, resolveTargets, t],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      if (threadId) return;

      const targets: SnoozeTarget[] = resolveTargets(getActionThreadKeys()).map(
        (thread) => ({
          emailId: thread.latestMessage.id,
          accountEmail: thread.latestMessage.accountEmail,
        }),
      );
      if (targets.length === 0) return;

      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent("email:request-snooze", {
          detail: { targets },
        }),
      );
    };

    window.addEventListener("email:shortcut-snooze", handler);
    return () => window.removeEventListener("email:shortcut-snooze", handler);
  }, [getActionThreadKeys, resolveTargets, threadId]);

  const toggleFocusedRead = useCallback(() => {
    const keys = getActionThreadKeys();
    if (keys.length === 0) return;
    const targets = resolveTargets(keys);
    const toMarkRead = targets.filter((t) => t.hasUnread);
    const toMarkUnread = targets.filter((t) => !t.hasUnread);
    for (const t of toMarkRead) {
      markThreadRead.mutate({
        threadId: t.latestMessage.threadId || t.latestMessage.id,
        accountEmail: t.latestMessage.accountEmail,
      });
    }
    if (toMarkUnread.length > 1) {
      bulkMarkRead.mutate({
        targets: toMarkUnread.map((t) => ({
          id: t.latestMessage.id,
          accountEmail: t.latestMessage.accountEmail,
          threadId: t.latestMessage.threadId || t.latestMessage.id,
        })),
        isRead: false,
      });
    } else {
      for (const t of toMarkUnread) {
        markRead.mutate({
          id: t.latestMessage.id,
          isRead: false,
          accountEmail: t.latestMessage.accountEmail,
          threadId: t.latestMessage.threadId || t.latestMessage.id,
        });
      }
    }
    setSelectedIds(new Set());
  }, [
    markRead,
    markThreadRead,
    bulkMarkRead,
    getActionThreadKeys,
    resolveTargets,
    setSelectedIds,
  ]);

  const markFocusedRead = useCallback(() => {
    for (const t of resolveTargets(getActionThreadKeys())) {
      markThreadRead.mutate({
        threadId: t.latestMessage.threadId || t.latestMessage.id,
        accountEmail: t.latestMessage.accountEmail,
      });
    }
    setSelectedIds(new Set());
  }, [markThreadRead, getActionThreadKeys, resolveTargets, setSelectedIds]);

  const markFocusedUnread = useCallback(() => {
    const targets = resolveTargets(getActionThreadKeys());
    if (targets.length > 1) {
      bulkMarkRead.mutate({
        targets: targets.map((t) => ({
          id: t.latestMessage.id,
          accountEmail: t.latestMessage.accountEmail,
          threadId: t.latestMessage.threadId || t.latestMessage.id,
        })),
        isRead: false,
      });
    } else {
      for (const t of targets) {
        markRead.mutate({
          id: t.latestMessage.id,
          isRead: false,
          accountEmail: t.latestMessage.accountEmail,
          threadId: t.latestMessage.threadId || t.latestMessage.id,
        });
      }
    }
    setSelectedIds(new Set());
  }, [
    markRead,
    bulkMarkRead,
    getActionThreadKeys,
    resolveTargets,
    setSelectedIds,
  ]);

  const openLabelPicker = useCallback(
    (action: LabelPickerAction, createOnly = false) => {
      if (getActionThreadKeys().length === 0) return;
      setLabelPicker({ action, createOnly });
    },
    [getActionThreadKeys],
  );

  const labelFocused = useCallback(
    (action: LabelPickerAction, choice: LabelChoice) => {
      const keys = getActionThreadKeys();
      const targets = resolveTargets(keys).map(
        (target) => target.latestMessage,
      );
      if (targets.length === 0) return;
      if (action === "move") focusAfterRemoving(keys);
      setSelectedIds(new Set());
      void applyLabel(action, choice, targets);
    },
    [
      applyLabel,
      focusAfterRemoving,
      getActionThreadKeys,
      resolveTargets,
      setSelectedIds,
    ],
  );

  const getThreadMessagesForKey = useCallback(
    (key: string) => emails.filter((e) => (e.threadId || e.id) === key),
    [emails],
  );

  const setThreadStarred = useCallback(
    (thread: ThreadSummary, isStarred: boolean) => {
      const key = thread.latestMessage.threadId || thread.latestMessage.id;
      const messages = getThreadMessagesForKey(key);
      const targets = isStarred
        ? [thread.latestMessage]
        : messages.filter((message) => message.isStarred);
      const fallbackTargets =
        targets.length > 0 ? targets : [thread.latestMessage];

      for (const target of fallbackTargets) {
        toggleStar.mutate({
          id: target.id,
          isStarred,
          accountEmail: target.accountEmail,
          threadId: key,
        });
      }
    },
    [getThreadMessagesForKey, toggleStar],
  );

  const starFocused = useCallback(() => {
    const keys = getActionThreadKeys();
    if (keys.length === 0) return;
    const targets = resolveTargets(keys);
    if (targets.length > 1) {
      const toStar = targets.filter((t) => !t.hasStarred);
      const toUnstar = targets.filter((t) => t.hasStarred);
      if (toStar.length > 0) {
        bulkToggleStar.mutate({
          targets: toStar.map((t) => ({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          })),
          isStarred: true,
        });
      }
      if (toUnstar.length > 0) {
        for (const t of toUnstar) setThreadStarred(t, false);
      }
    } else {
      for (const t of targets) setThreadStarred(t, !t.hasStarred);
    }
    setSelectedIds(new Set());
  }, [
    getActionThreadKeys,
    resolveTargets,
    setSelectedIds,
    setThreadStarred,
    bulkToggleStar,
  ]);

  const replyFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (thread) onCompose(thread.latestMessage, "reply");
  }, [threads, onCompose]);

  const replyAllFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (thread) onCompose(thread.latestMessage, "replyAll");
  }, [threads, onCompose]);

  const forwardFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (thread) onCompose(thread.latestMessage, "forward");
  }, [threads, onCompose]);

  const clearSelection = useCallback(
    () => setSelectedIds(new Set()),
    [setSelectedIds],
  );

  const toggleFocusedSelection = useCallback(() => {
    const id = focusedIdRef.current;
    const thread = id
      ? threads.find((t) => t.latestMessage.id === id)
      : undefined;
    if (!thread) return;
    const key = thread.latestMessage.threadId || thread.latestMessage.id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [threads, setSelectedIds]);

  useKeyboardShortcuts(
    [
      { key: "a", meta: true, handler: selectAllThreads },
      { key: "j", handler: () => moveFocus(1) },
      { key: "ArrowDown", handler: () => moveFocus(1) },
      { key: "k", handler: () => moveFocus(-1) },
      { key: "ArrowUp", handler: () => moveFocus(-1) },
      { key: "j", shift: true, handler: () => extendSelection(1) },
      { key: "k", shift: true, handler: () => extendSelection(-1) },
      { key: "ArrowDown", shift: true, handler: () => extendSelection(1) },
      { key: "ArrowUp", shift: true, handler: () => extendSelection(-1) },
      { key: "Enter", handler: openFocused },
      { key: "o", handler: openFocused },
      { key: "e", handler: archiveFocused },
      { key: "d", handler: trashFocused },
      { key: "#", shift: "either", handler: trashFocused },
      { key: "u", handler: toggleFocusedRead },
      { key: "x", handler: toggleFocusedSelection },
      { key: "l", handler: () => openLabelPicker("label") },
      { key: "v", handler: () => openLabelPicker("move") },
      { key: "s", handler: starFocused },
      { key: "r", handler: replyFocused },
      { key: "f", handler: forwardFocused },
      { key: "a", handler: replyAllFocused },
      { key: "Escape", handler: clearSelection },
    ],
    keyboardEnabled,
  );

  const focusedThreadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (threads.length === 0 || priorityLoading) return;
    const focused = focusedId
      ? threads.find((t) => t.latestMessage.id === focusedId)
      : undefined;
    if (focused) {
      focusedThreadKeyRef.current =
        focused.latestMessage.threadId || focused.latestMessage.id;
      return;
    }
    const next =
      threads.find(
        (t) =>
          (t.latestMessage.threadId || t.latestMessage.id) ===
          focusedThreadKeyRef.current,
      ) ?? (threads[0] as ThreadSummary | undefined);
    if (next) setFocusedId(next.latestMessage.id);
  }, [threads, focusedId, setFocusedId, priorityLoading]);

  useEffect(() => {
    if (!threadId) {
      if (syncedThreadIdRef.current) {
        closedThreadIdRef.current = syncedThreadIdRef.current;
      }
      syncedThreadIdRef.current = null;
      return;
    }
    closedThreadIdRef.current = null;
    const open = threads.find(
      (t) => (t.latestMessage.threadId || t.latestMessage.id) === threadId,
    );
    if (!open) return;
    if (syncedThreadIdRef.current === threadId) {
      const rowChanged = open.latestMessage.id !== syncedMessageIdRef.current;
      if (!rowChanged || focusedId !== syncedMessageIdRef.current) return;
    }
    syncedThreadIdRef.current = threadId;
    syncedMessageIdRef.current = open.latestMessage.id;
    setFocusedId(open.latestMessage.id);
  }, [threadId, threads, focusedId, setFocusedId]);

  useEffect(() => {
    if (threads.length === 0) return;
    warmThreads(
      threads.slice(0, 3).map((t) => ({
        id: t.latestMessage.threadId || t.latestMessage.id,
        accountEmail: t.latestMessage.accountEmail,
      })),
    );
  }, [threads]);

  useEffect(() => {
    if (!focusedId || threads.length === 0) return;
    const idx = threads.findIndex((t) => t.latestMessage.id === focusedId);
    if (idx === -1) return;
    // Warm only once focus rests, so holding J/K does not fetch every row it
    // passes. Each focus change restarts the timer.
    const timer = setTimeout(() => {
      const windowIdx = [idx - 1, idx, idx + 1].filter(
        (i) => i >= 0 && i < threads.length,
      );
      warmThreads(
        windowIdx.map((i) => ({
          id: threads[i].latestMessage.threadId || threads[i].latestMessage.id,
          accountEmail: threads[i].latestMessage.accountEmail,
        })),
      );
    }, THREAD_PREFETCH_INTENT_MS);
    return () => clearTimeout(timer);
  }, [focusedId, threads]);

  const [rowHeightEstimate, setRowHeightEstimate] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 640 ? 38 : 48,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = () => setRowHeightEstimate(mql.matches ? 38 : 48);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const estimatedRowHeight = readingPane
    ? RICH_ROW_HEIGHT_ESTIMATE
    : rowHeightEstimate;

  const rowVirtualizerRef = useRef<{ scrollOffset: number | null } | null>(
    null,
  );
  const rowVirtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
    getItemKey: (index) => threads[index]?.latestMessage.id ?? index,
    anchorTo:
      (rowVirtualizerRef.current?.scrollOffset ?? 0) > 0 ? "end" : "start",
  });
  rowVirtualizerRef.current = rowVirtualizer;

  const listKey = listIsPlaceholder
    ? null
    : JSON.stringify([
        view,
        searchQuery ?? "",
        labelParam ?? "",
        searchParams.get("tab") ?? "",
        searchParams.get("filter") ?? "",
        [...activeAccounts].sort(),
      ]);
  const focusedThread = threads[focusedIndex] as ThreadSummary | undefined;
  const focusedThreadKey = focusedThread
    ? focusedThread.latestMessage.threadId || focusedThread.latestMessage.id
    : null;
  const scrolledToFocusRef = useRef<{
    listKey: string | null;
    threadKey: string;
  } | null>(null);
  useEffect(() => {
    if (
      !focusedThreadKey ||
      listKey === null ||
      priorityLoading ||
      !scrollParentRef.current
    ) {
      return;
    }
    const last = scrolledToFocusRef.current;
    if (last?.listKey === listKey && last.threadKey === focusedThreadKey) {
      return;
    }
    scrolledToFocusRef.current = { listKey, threadKey: focusedThreadKey };
    rowVirtualizer.scrollToIndex(focusedIndex, { align: "auto" });
  }, [
    focusedIndex,
    focusedThreadKey,
    listKey,
    priorityLoading,
    rowVirtualizer,
  ]);

  const listOffset = Math.min(
    rowVirtualizer.scrollOffset ?? 0,
    rowVirtualizer.getTotalSize() - (rowVirtualizer.scrollRect?.height ?? 0),
  );
  const newMailAbove = useNewMailAbove(
    listKey,
    threads,
    rowVirtualizer.getVirtualItemForOffset(Math.max(0, listOffset))?.index ?? 0,
  );
  const clearNewMailAbove = newMailAbove.clear;
  const goToRow = useCallback(
    (index: number) => {
      clearNewMailAbove();
      const target = threads[index] as ThreadSummary | undefined;
      if (!target) return;
      setSelectedIds(new Set());
      setFocusedId(target.latestMessage.id);
      focusedIndexRef.current = index;
      scrolledToFocusRef.current = {
        listKey,
        threadKey: target.latestMessage.threadId || target.latestMessage.id,
      };
      rowVirtualizer.scrollToIndex(index, { align: "start" });
      if (readingPane && threadId) previewThread(target);
    },
    [
      clearNewMailAbove,
      threads,
      setSelectedIds,
      setFocusedId,
      listKey,
      rowVirtualizer,
      readingPane,
      threadId,
      previewThread,
    ],
  );
  const goToNewMail = () => {
    const index = threads.findIndex((t) =>
      newMailAbove.arrived.has(t.latestMessage.id),
    );
    if (index < 0) clearNewMailAbove();
    else goToRow(index);
  };

  const pageFocus = useCallback(
    (direction: 1 | -1) => {
      const parent = scrollParentRef.current;
      if (!parent) return;
      const rowsPerPage = Math.floor(parent.clientHeight / estimatedRowHeight);
      moveFocus(direction * Math.max(1, rowsPerPage - 1));
    },
    [moveFocus, estimatedRowHeight],
  );

  useKeyboardShortcuts(
    [
      { key: " ", handler: () => pageFocus(1) },
      { key: " ", shift: true, handler: () => pageFocus(-1) },
      { key: "Home", handler: () => goToRow(0) },
    ],
    keyboardEnabled,
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    return observeNextPage({
      element: el,
      hasNextPage: Boolean(hasNextPage),
      isFetchingNextPage: Boolean(isFetchingNextPage),
      isFetchNextPageError: Boolean(isFetchNextPageError),
      fetchNextPage,
    });
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ emailId?: string; emailIds?: string[] }>
      ).detail;
      const emailIds =
        detail.emailIds && detail.emailIds.length > 0
          ? detail.emailIds
          : detail.emailId
            ? [detail.emailId]
            : [];
      if (emailIds.length === 0) return;

      const snoozedIds = new Set(emailIds);
      const idx = threads.findIndex((t) => snoozedIds.has(t.latestMessage.id));
      if (idx === -1) return;

      const remaining = threads.filter(
        (thread) => !snoozedIds.has(thread.latestMessage.id),
      );
      if (remaining.length > 0) {
        const nextIdx = Math.min(idx, remaining.length - 1);
        setFocusedId(remaining[nextIdx].latestMessage.id);
      } else {
        setFocusedId(null);
      }
      setSelectedIds(new Set());
    };
    window.addEventListener("email:snoozed", handler);
    return () => window.removeEventListener("email:snoozed", handler);
  }, [threads, setFocusedId, setSelectedIds]);

  const handleSelect = useCallback(
    (thread: ThreadSummary) => {
      const email = thread.latestMessage;
      const targetThreadId = email.threadId || email.id;
      trackEvent(email.isDraft ? "email_draft_opened" : "email_thread_opened", {
        app_name: "mail",
        template_name: "mail",
        view,
      });
      setFocusedId(email.id);
      setSelectedIds(new Set());
      if (email.isDraft && onDraftOpen) {
        onDraftOpen(email);
        return;
      }
      void ensureThread(targetThreadId, email.accountEmail).catch(() => {});
      onNavigateThread?.(targetThreadId, email.accountEmail);
      void navigate(
        mailThreadHref(view, targetThreadId, searchParams, email.accountEmail),
        { replace: Boolean(threadId) },
      );
      if (thread.hasUnread) {
        setTimeout(
          () =>
            markThreadRead.mutate({
              threadId: targetThreadId,
              accountEmail: email.accountEmail,
            }),
          0,
        );
      }
    },
    [
      setFocusedId,
      setSelectedIds,
      onDraftOpen,
      onNavigateThread,
      navigate,
      view,
      searchParams,
      threadId,
      markThreadRead,
    ],
  );

  const handleStar = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      setThreadStarred(thread, !thread.hasStarred);
    },
    [setThreadStarred],
  );

  const handleToggleReadThread = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const email = thread.latestMessage;
      if (thread.hasUnread) {
        markThreadRead.mutate({
          threadId: email.threadId || email.id,
          accountEmail: email.accountEmail,
        });
      } else {
        markRead.mutate({
          id: email.id,
          isRead: false,
          accountEmail: email.accountEmail,
          threadId: email.threadId || email.id,
        });
      }
    },
    [markThreadRead, markRead],
  );

  const handleToggleMultiSelect = useCallback(
    (e: React.SyntheticEvent, thread: ThreadSummary) => {
      e.preventDefault();
      e.stopPropagation();
      const key = thread.latestMessage.threadId || thread.latestMessage.id;
      setFocusedId(thread.latestMessage.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [setFocusedId, setSelectedIds],
  );

  const handleTrashThread = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      if (view === "trash") return;
      const key = thread.latestMessage.threadId || thread.latestMessage.id;
      trashThreadKeys([key]);
    },
    [view, trashThreadKeys],
  );

  const handleArchiveThread = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      archiveThreadKeys([
        thread.latestMessage.threadId || thread.latestMessage.id,
      ]);
    },
    [archiveThreadKeys],
  );

  const handleFocusRow = useCallback(
    (thread: ThreadSummary) => {
      setFocusedId(thread.latestMessage.id);
    },
    [setFocusedId],
  );

  const getScheduledJobId = useCallback(
    (email: EmailMessage): string | null =>
      (view === "scheduled" || view === "drafts") &&
      email.id.startsWith("scheduled-")
        ? email.id.slice("scheduled-".length)
        : null,
    [view],
  );

  const handleSendScheduledNow = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const jobId = getScheduledJobId(thread.latestMessage);
      if (!jobId) return;
      sendScheduledJobNow.mutate(jobId, {
        onSuccess: () => toast(t("mail.toasts.scheduledSent")),
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.toasts.scheduledSendFailed"),
          ),
      });
    },
    [getScheduledJobId, sendScheduledJobNow, t],
  );

  const handleCancelScheduled = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const jobId = getScheduledJobId(thread.latestMessage);
      if (!jobId) return;
      cancelScheduledJob.mutate(jobId, {
        onSuccess: () => toast(t("mail.toasts.scheduledCancelled")),
        onError: (error) =>
          reportWriteFailure(error, {
            label: t("mail.toasts.scheduledCancelFailed"),
          }),
      });
    },
    [getScheduledJobId, cancelScheduledJob, t],
  );

  const handleConfirmUncertainScheduled = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const jobId = getScheduledJobId(thread.latestMessage);
      if (!jobId) return;
      confirmUncertainScheduled.mutate(
        { id: jobId },
        {
          onSuccess: () => toast(t("mail.toasts.uncertainScheduledMarkedSent")),
          onError: (error) =>
            toast.error(
              error instanceof Error
                ? error.message
                : t("mail.toasts.uncertainScheduledResolveFailed"),
            ),
        },
      );
    },
    [getScheduledJobId, confirmUncertainScheduled, t],
  );

  const handleRetryUncertainScheduled = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const jobId = getScheduledJobId(thread.latestMessage);
      if (jobId) setRetryUncertainJobId(jobId);
    },
    [getScheduledJobId],
  );

  const handleConfirmRetryUncertainScheduled = useCallback(() => {
    if (!retryUncertainJobId) return;
    retryUncertainScheduled.mutate(
      { id: retryUncertainJobId },
      {
        onSuccess: () => {
          setRetryUncertainJobId(null);
          toast(t("mail.toasts.uncertainScheduledRetryStarted"));
        },
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.toasts.uncertainScheduledRetryFailed"),
          ),
      },
    );
  }, [retryUncertainJobId, retryUncertainScheduled, t]);

  const handleSwipeArchive = useCallback(
    (thread: ThreadSummary) => {
      const id = thread.latestMessage.id;
      const accountEmail = thread.latestMessage.accountEmail;
      const tid = thread.latestMessage.threadId || id;

      setSelectedIds(new Set());

      const idx = threads.findIndex((t) => t.latestMessage.id === id);
      if (threads.length > 1) {
        const nextIdx =
          idx < threads.length - 1 ? idx + 1 : Math.max(0, idx - 1);
        setFocusedId(threads[nextIdx].latestMessage.id);
      } else {
        setFocusedId(null);
      }

      const snapshots = emails.filter((e) => (e.threadId || e.id) === tid);
      onArchived?.(id);

      const suppressionToken = archiveEmail.createSuppressionToken();
      const undo = () => {
        const inboxRemovalSnapshot = releaseOwnedInboxRemoval(
          queryClient,
          tid,
          suppressionToken,
        );
        const shouldRestore = releaseSuppressionClaims(
          tid,
          archiveEmail.getSuppressionIds(suppressionToken, tid),
        );
        if (!shouldRestore) return;
        queryClient.setQueriesData<InfiniteEmails>(
          { queryKey: ["emails"] },
          (old) => {
            if (!old) return old;
            const firstPage = old.pages[0];
            const restored = [...(firstPage?.emails ?? []), ...snapshots].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );
            return {
              ...old,
              pages: [
                { ...firstPage, emails: restored },
                ...old.pages.slice(1),
              ],
            };
          },
        );
        unarchiveEmail.mutate({
          id,
          accountEmail,
          threadId: tid,
          suppressionToken,
          inboxRemovalSnapshot,
        });
      };
      const consumeUndo = setUndoAction(undo);
      const toastId = toast(t("mail.toasts.archived"), {
        action: { label: t("mail.actions.undo"), onClick: consumeUndo },
        duration: UNDO_DURATION,
      });
      setUndoToastId(toastId);
      archiveEmail.mutate({
        id,
        accountEmail: thread.latestMessage.accountEmail,
        removeLabel: labelParam || undefined,
        threadId: tid,
        suppressionToken,
      });
    },
    [
      threads,
      emails,
      archiveEmail,
      unarchiveEmail,
      onArchived,
      labelParam,
      setFocusedId,
      setSelectedIds,
      queryClient,
    ],
  );

  const handleSwipeSnooze = useCallback(
    (thread: ThreadSummary) => {
      setSelectedIds(new Set());
      window.dispatchEvent(
        new CustomEvent("email:request-snooze", {
          detail: {
            emailId: thread.latestMessage.id,
            accountEmail: thread.latestMessage.accountEmail,
          },
        }),
      );
    },
    [setSelectedIds],
  );

  const handleSnoozeButtonClick = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      handleSwipeSnooze(thread);
    },
    [handleSwipeSnooze],
  );

  const sortHeaderAction = useMemo(
    () =>
      view === "inbox" && !searchQuery && !labelParam && threads.length > 0 ? (
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <ActionTooltip
              label={t("mail.sort.label")}
              keys={[formatShortcut("cmd"), "I"]}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 w-[112px] items-center justify-between rounded-md border border-input bg-transparent px-2.5 text-[11px] text-foreground hover:bg-accent/40"
                  aria-label={`${t("mail.sort.label")} · ⌘I`}
                  aria-busy={isPriorityPending}
                >
                  <span>
                    {currentSortMode === "priority"
                      ? t("mail.sort.priority")
                      : t("mail.sort.newest")}
                  </span>
                  {isPriorityPending ? (
                    <Spinner className="size-3" />
                  ) : (
                    <IconChevronDown className="size-3.5 text-muted-foreground" />
                  )}
                </button>
              </DropdownMenuTrigger>
            </ActionTooltip>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                onSelect={() => onSortModeChange?.("newest")}
                className="justify-between"
              >
                {t("mail.sort.newest")}
                {currentSortMode === "newest" && (
                  <IconCheck className="size-3.5" />
                )}
              </DropdownMenuItem>
              {showPrioritySort && (
                <div className="flex items-center">
                  <DropdownMenuItem
                    onSelect={() => onSortModeChange?.("priority")}
                    className="flex-1 justify-between"
                  >
                    {t("mail.sort.priority")}
                    {currentSortMode === "priority" && (
                      <IconCheck className="size-3.5" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate(
                        `${mailSettingsRoute("ai-filter")}#importance-rules`,
                      )
                    }
                    aria-label={t("mail.sort.priorityEditRules")}
                    title={t("mail.sort.priorityEditRules")}
                    className="px-2"
                  >
                    <IconSettings className="size-3.5" />
                  </DropdownMenuItem>
                </div>
              )}
              {!showPrioritySort &&
                (jevAvailabilityError ? (
                  <DropdownMenuItem
                    onSelect={onJevRetry}
                    disabled={jevAvailabilityLoading}
                    className="justify-between gap-4"
                  >
                    {t("mail.sort.priority")}
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {t("mail.error.tryAgain")}
                    </span>
                  </DropdownMenuItem>
                ) : (
                  <JevConnectionMenuItem
                    disabled={jevAvailabilityLoading}
                    onSelect={() => setJevDialog("open")}
                  />
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null,
    [
      isPriorityPending,
      labelParam,
      navigate,
      showPrioritySort,
      jevConfigured,
      jevAvailabilityLoading,
      jevAvailabilityError,
      onJevRetry,
      currentSortMode,
      onSortModeChange,
      searchQuery,
      t,
      threads.length,
      view,
    ],
  );

  const bulkHeaderActions = useMemo(
    () =>
      selectedIds.size > 0 ? (
        <div className="flex h-7 max-w-[calc(100vw-11rem)] shrink-0 items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-1.5 text-muted-foreground shadow-sm">
          <ActionTooltip label={t("mail.selection.clear")} keys={["Esc"]}>
            <button
              type="button"
              onClick={clearSelection}
              className="flex size-5 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t("mail.selection.clear")}
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </ActionTooltip>
          <span className="whitespace-nowrap text-xs font-medium text-foreground/80">
            {t("mail.selection.selected", { count: selectedIds.size })}
          </span>
          <DropdownMenu>
            <ActionTooltip label={t("mail.selection.actions")}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-5 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={t("mail.selection.actions")}
                >
                  <IconDots className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
            </ActionTooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() =>
                  openAiFilterDialog(
                    labelParam?.toLowerCase() === AI_FILTER_LABEL
                      ? "keep"
                      : "filter",
                  )
                }
                className="gap-2 text-xs"
              >
                {labelParam?.toLowerCase() === AI_FILTER_LABEL ? (
                  <IconInbox className="h-3.5 w-3.5" />
                ) : (
                  <IconFilter className="h-3.5 w-3.5" />
                )}
                {labelParam?.toLowerCase() === AI_FILTER_LABEL
                  ? t("mail.aiFilter.keepButton")
                  : t("mail.aiFilter.filterButton")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={archiveFocused}>
                <IconArchive className="h-3.5 w-3.5" />
                {t("mail.actions.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={markFocusedRead}>
                <IconMailOpened className="h-3.5 w-3.5" />
                {t("mail.actions.markRead")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={markFocusedUnread}>
                <IconMail className="h-3.5 w-3.5" />
                {t("mail.actions.markUnread")}
              </DropdownMenuItem>
              {(
                [
                  ["label", userLabels, IconTag, "mail.actions.labelAs"],
                  ["move", movableLabels, IconFolder, "mail.actions.moveTo"],
                ] as const
              ).map(([action, choices, Icon, titleKey]) => (
                <DropdownMenuSub key={action}>
                  <DropdownMenuSubTrigger>
                    <Icon className="h-3.5 w-3.5" />
                    {t(titleKey)}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                    {choices.map((label) => (
                      <DropdownMenuItem
                        key={label.id}
                        onClick={() =>
                          labelFocused(action, {
                            id: label.id,
                            name: label.name,
                            isNew: false,
                          })
                        }
                        className="text-xs"
                      >
                        <span data-an-block className="truncate">
                          {label.name}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    {choices.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onClick={() => openLabelPicker(action, true)}
                      className="text-xs"
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                      {t("mail.actions.newLabel")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
              {view !== "trash" && (
                <DropdownMenuItem
                  onClick={trashFocused}
                  className="text-destructive focus:text-destructive"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  {t("mail.actions.moveToTrash")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("mail.selection.select")}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={selectAllThreads}>
                {t("mail.selection.all")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearSelection}>
                {t("mail.selection.none")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={selectReadThreads}>
                {t("mail.selection.read")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={selectUnreadThreads}>
                {t("mail.views.unread")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={selectStarredThreads}>
                {t("mail.views.starred")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={selectUnstarredThreads}>
                {t("mail.selection.unstarred")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null,
    [
      selectedIds.size,
      t,
      clearSelection,
      openAiFilterDialog,
      archiveFocused,
      markFocusedRead,
      markFocusedUnread,
      userLabels,
      movableLabels,
      labelFocused,
      openLabelPicker,
      view,
      trashFocused,
      selectAllThreads,
      selectReadThreads,
      selectUnreadThreads,
      selectStarredThreads,
      selectUnstarredThreads,
    ],
  );
  if (jevConfigured && jevDialog !== "unopened") setJevDialog("unopened");
  const jevConnectionDialog = useMemo(
    () =>
      jevDialog === "unopened" ? null : (
        <JevConnectionDialog
          open={jevDialog === "open"}
          onOpenChange={(open) => setJevDialog(open ? "open" : "closed")}
          onConnected={() => onJevConnected?.()}
        />
      ),
    [jevDialog, onJevConnected],
  );

  const headerActions = useMemo(
    () =>
      filterControl ||
      sortHeaderAction ||
      bulkHeaderActions ||
      jevConnectionDialog ||
      viewHeaderActions ? (
        <>
          {filterControl}
          {sortHeaderAction}
          {bulkHeaderActions ?? viewHeaderActions}
          {jevConnectionDialog}
        </>
      ) : null,
    [
      bulkHeaderActions,
      filterControl,
      jevConnectionDialog,
      sortHeaderAction,
      viewHeaderActions,
    ],
  );
  useSetHeaderActions(headerActions);

  const isQuotaError = emailsError
    ? (emailsError as { status?: number }).status === 429 ||
      /\((429|403)\)|quota|rate limit/i.test(emailsError.message)
    : false;
  const cooldownNotice =
    (emailsError || accountErrors?.length) && emails.length > 0 ? (
      <div
        role="status"
        className="shrink-0 border-b border-border/30 bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
      >
        {t("mail.error.staleSaved")}
        {emailsError && (
          <EmailRetryButton
            isQuotaError={isQuotaError}
            message={emailsError.message}
            retryAfterMs={
              (emailsError as { retryAfterMs?: number }).retryAfterMs
            }
            isFetching={isFetching}
            onRetry={refetch}
          />
        )}
      </div>
    ) : read && read.freshness !== "live" ? (
      <GmailCooldownNotice read={read} onRetry={refetch} />
    ) : null;

  if (emailsError && emails.length === 0) {
    const needsCredentials =
      emailsError.message?.includes("GOOGLE_CLIENT_ID") ||
      emailsError.message?.includes("GOOGLE_CLIENT_SECRET");

    if (needsCredentials) {
      return (
        <div className="flex h-full flex-col" ref={containerRef}>
          <GoogleConnectBanner variant="hero" />
        </div>
      );
    }

    return (
      <EmailErrorState
        isQuotaError={isQuotaError}
        message={emailsError.message ?? ""}
        retryAfterMs={(emailsError as { retryAfterMs?: number }).retryAfterMs}
        isFetching={isFetching}
        onRetry={refetch}
        containerRef={containerRef}
      />
    );
  }

  if (isLoading && emails.length === 0) {
    return <MailLoadingState containerRef={containerRef} rich={readingPane} />;
  }

  if (priorityLoading) {
    return <MailLoadingState containerRef={containerRef} rich={readingPane} />;
  }

  // Client-sliced inbox tabs can have no matches on the first page even when
  // later inbox pages contain matching threads. Keep the sentinel mounted so
  // the infinite query can continue before showing an empty state.
  if (threads.length === 0 && hasNextPage) {
    return (
      <div className="flex h-full flex-col" ref={containerRef}>
        {cooldownNotice}
        {!!accountErrors?.length && (
          <AccountErrorsNotice errors={accountErrors} />
        )}
        <div className="flex flex-1 items-center justify-center" />
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-3"
        >
          {isFetchingNextPage && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3 text-muted-foreground" />
              {t("mail.empty.loadingMore")}
            </div>
          )}
          {shouldShowPaginationRetry({
            hasNextPage: Boolean(hasNextPage),
            isFetchingNextPage: Boolean(isFetchingNextPage),
            isFetchNextPageError: Boolean(isFetchNextPageError),
          }) && (
            <button
              type="button"
              onClick={() => void retryNextPage()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              {t("mail.error.tryAgain")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  if (threads.length === 0) {
    if (searchQuery) {
      return (
        <div className="flex h-full flex-col" ref={containerRef}>
          {cooldownNotice}
          {!!accountErrors?.length && (
            <AccountErrorsNotice errors={accountErrors} />
          )}
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="text-center px-8">
              <div className="mb-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="h-12 w-12 text-muted-foreground/30 mx-auto"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground/80">
                {t("mail.empty.noSearchResults", { query: searchQuery })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("mail.empty.tryDifferentKeywords")}
              </p>
            </div>
          </div>
        </div>
      );
    }
    if (
      !emptyHintKey &&
      (view === "inbox" || view === "important" || labelParam) &&
      !accountErrors?.length &&
      !cooldownNotice
    ) {
      return <InboxZero />;
    }
    return (
      <div className="flex h-full flex-col" ref={containerRef}>
        {cooldownNotice}
        {!!accountErrors?.length && (
          <AccountErrorsNotice errors={accountErrors} />
        )}
        {topSection}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-center px-8">
            <p className="text-sm font-medium text-foreground/80">
              {t("mail.empty.nothingHere")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t(emptyHintKey ?? emptyStateHintKeyForView(view))}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const canArchiveInView =
    view !== "archive" &&
    view !== "trash" &&
    view !== "sent" &&
    view !== "drafts" &&
    view !== "scheduled" &&
    view !== "snoozed";
  const canSnoozeInView =
    view !== "snoozed" &&
    view !== "scheduled" &&
    view !== "sent" &&
    view !== "drafts" &&
    view !== "trash";
  const canTrashInView = view !== "inbox" && view !== "trash";
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      {cooldownNotice}
      {topSection}
      <div className="flex-1 overflow-y-auto" ref={scrollParentRef}>
        {newMailAbove.arrived.size > 0 && (
          <div className="pointer-events-none sticky top-2 z-10 flex h-0 justify-center overflow-visible">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={goToNewMail}
              className="pointer-events-auto rounded-full shadow-sm"
            >
              <IconArrowUp aria-hidden="true" />
              {t("mail.list.newMailAbove", {
                count: newMailAbove.arrived.size,
              })}
            </Button>
          </div>
        )}
        <AiFilterDialog
          open={!!aiFilterDialog}
          onOpenChange={(open) => !open && setAiFilterDialog(null)}
          action={aiFilterDialog?.action ?? "filter"}
          targets={aiFilterDialog?.targets ?? []}
          onComplete={() => setSelectedIds(new Set())}
        />
        <LabelPicker
          request={labelPicker}
          labels={labelPicker?.action === "move" ? movableLabels : userLabels}
          onClose={() => setLabelPicker(null)}
          onPick={(choice, action) => labelFocused(action, choice)}
        />
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const thread = threads[virtualRow.index];
            if (!thread) return null;
            const sectionHeading = showSectionHeadings
              ? sectionedThreads.headings.get(virtualRow.index)
              : undefined;
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {sectionHeading && (
                  <EmailListSectionHeading
                    title={sectionHeading.title}
                    count={sectionHeading.count}
                  />
                )}
                <EmailListItem
                  email={thread.latestMessage}
                  importanceScore={
                    view === "inbox" && currentSortMode === "priority"
                      ? cachedPriorityScores.get(
                          aiPriorityEmailKey(
                            thread.latestMessage.accountEmail,
                            thread.latestMessage.id,
                          ),
                        )
                      : undefined
                  }
                  labelNames={labelNames}
                  thread={thread}
                  isSelected={
                    (thread.latestMessage.threadId ||
                      thread.latestMessage.id) === threadId
                  }
                  isFocused={thread.latestMessage.id === focusedId}
                  isMultiSelected={selectedIds.has(
                    thread.latestMessage.threadId || thread.latestMessage.id,
                  )}
                  canArchive={canArchiveInView}
                  canSnooze={canSnoozeInView}
                  canTrash={canTrashInView}
                  scheduledJobId={getScheduledJobId(thread.latestMessage)}
                  onSelect={handleSelect}
                  onToggleMultiSelect={handleToggleMultiSelect}
                  onStar={handleStar}
                  onToggleRead={handleToggleReadThread}
                  onArchive={handleArchiveThread}
                  onSnooze={handleSnoozeButtonClick}
                  onTrash={handleTrashThread}
                  onImportanceFeedback={
                    view === "inbox"
                      ? (decision) =>
                          recordPriorityFeedback(thread.latestMessage, decision)
                      : undefined
                  }
                  onSendNow={handleSendScheduledNow}
                  onCancelSchedule={handleCancelScheduled}
                  onConfirmUncertainScheduled={handleConfirmUncertainScheduled}
                  onRetryUncertainScheduled={handleRetryUncertainScheduled}
                  onFocusRow={handleFocusRow}
                  onPrefetch={prefetchThread}
                  onSwipeArchive={handleSwipeArchive}
                  onSwipeSnooze={handleSwipeSnooze}
                  highlight={searchQuery}
                  layout={readingPane ? "rich" : "row"}
                />
              </div>
            );
          })}
        </div>
        <AlertDialog
          open={retryUncertainJobId !== null}
          onOpenChange={(open) => !open && setRetryUncertainJobId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("mail.sendLater.confirmSendNewCopyTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("mail.sendLater.confirmSendNewCopyDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("mail.compose.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmRetryUncertainScheduled}>
                {t("mail.sendLater.sendNewCopy")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* Sentinel for infinite scroll + loading indicator — lives after the
            virtualizer's sized inner container so it still sits at the true
            end of scrollable content and the IntersectionObserver above
            continues to fire as the user nears the bottom. */}
        {hasNextPage && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-3"
          >
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3 text-muted-foreground" />
                {t("mail.empty.loadingMore")}
              </div>
            )}
            {shouldShowPaginationRetry({
              hasNextPage: Boolean(hasNextPage),
              isFetchingNextPage: Boolean(isFetchingNextPage),
              isFetchNextPageError: Boolean(isFetchNextPageError),
            }) && (
              <button
                type="button"
                onClick={() => void retryNextPage()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                {t("mail.error.tryAgain")}
              </button>
            )}
          </div>
        )}
        {reachedCap && !hasNextPage && (
          <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() =>
                void navigate(
                  withInboxFilter("/all", inboxFilterParam(searchParams)),
                )
              }
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("mail.empty.openAllMailForOlder")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
