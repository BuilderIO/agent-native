import { AgentPanel } from "@agent-native/core/client/agent-chat";
import { trackEvent } from "@agent-native/core/client/analytics";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useSession,
  getBrowserTabId,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  AgentNativeIcon,
  buildSignInReturnHref,
  DefaultSpinner,
  EnvironmentBadge,
} from "@agent-native/core/client/ui";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDeviceDesktop,
  IconDownload,
  IconLock,
  IconLogin2,
  IconMoodSmile,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  type HeadersArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import {
  Link,
  useLoaderData,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { CaptureInstallButton } from "@/components/capture-install-options";
import { ClipsAvatar } from "@/components/clips-avatar";
import { AccessPasswordPrompt } from "@/components/player/access-password-prompt";
import { ClipAgentWebMcp } from "@/components/player/clip-agent-webmcp";
import { ClipsShareTrigger } from "@/components/player/clips-share-trigger";
import { CommentsPanel } from "@/components/player/comments-panel";
import {
  AccountGateDialog,
  type AccountGateIntent,
} from "@/components/player/create-account-dialog";
import { RecordingOptionsMenu } from "@/components/player/delete-recording-menu";
import {
  REACTION_EMOJIS,
  REACTION_NAMES,
} from "@/components/player/reaction-emojis";
import { RecordingSidePanel } from "@/components/player/recording-side-panel";
import { RecordingViewsBadge } from "@/components/player/recording-views-badge";
import { RequestAccessDialog } from "@/components/player/request-access-dialog";
import { ShareRecordingPopover } from "@/components/player/share-dialog";
import { SignedOutShareActions } from "@/components/player/signed-out-share-actions";
import { TimestampedCommentBar } from "@/components/player/timestamped-comment-button";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import {
  ViewerTabsList,
  ViewerTabsTrigger,
} from "@/components/player/viewer-controls";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { isDefaultTitle } from "@/hooks/use-auto-title";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useSonnerLifecycleToast } from "@/hooks/use-sonner-lifecycle-toast";
import { useViewTracking } from "@/hooks/use-view-tracking";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";
import { parseTimeParam, resolveStartMs } from "@/lib/time-param";
import { cn } from "@/lib/utils";

import { getDb, schema } from "../../server/db";
import { resolvePlayerThumbnailUrl } from "../../server/lib/player-thumbnail-url";
import {
  buildAgentApiUrls,
  buildAgentDiscoveryPayload,
  CLIPS_AGENT_ACCESS_PARAM,
  CLIP_AGENT_ACCESS_TOKEN_PREFIX,
  safeJsonForHtml,
} from "../../shared/agent-context";
import {
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "../../shared/loom";
import {
  CLIPS_ACCESS_REQUEST_TOKEN_PREFIX,
  CLIPS_ACCESS_REQUEST_TOKEN_TTL_SECONDS,
} from "../../shared/recording-link";
import {
  buildShareContinuationQuery,
  buildSignupAttributionQuery,
  readShareAttribution,
} from "../../shared/share-attribution";
import { resolveDashboardRedirect } from "../../shared/share-dashboard-redirect";
import { privateShareLoaderData } from "../../shared/share-loader-response";
import {
  buildClipsShareMeta,
  clipsSharePageTitle,
  displayRecordingTitle,
} from "../../shared/share-meta";

type SharePageMetaRecording = {
  id: string;
  title: string;
  description: string;
  ownerEmail: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  visibility: "private" | "org" | "public";
  status: "uploading" | "processing" | "ready" | "failed";
  hasPassword: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
};

type SharePageLoaderData = {
  recording: SharePageMetaRecording | null;
  agentContextUrl: string | null;
  origin: string | null;
  shareUrl: string | null;
  accessDeniedStatus?: 401 | 403;
  accessRequestToken?: string;
};

type SharePanel = "transcript" | "agent";

type PendingAccountAction =
  | { intent: "comment"; atMs: number }
  | { intent: "react"; emoji: string };

function emptyLoaderData(
  url: URL,
  accessDeniedStatus?: 401 | 403,
): SharePageLoaderData {
  return {
    recording: null,
    agentContextUrl: null,
    origin: url.origin,
    shareUrl: null,
    accessDeniedStatus,
  };
}

function shareLoaderData(
  payload: SharePageLoaderData,
  privateAgentAccess = false,
) {
  if (!privateAgentAccess) return payload;
  return privateShareLoaderData(payload);
}

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

function failureDetail(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
}

function shouldShowGeneratedTitleSkeleton(
  recording: { title: string | null | undefined; createdAt?: string | null },
  transcriptStatus?: string,
): boolean {
  if (!isDefaultTitle(recording.title)) return false;
  if (transcriptStatus === "failed") return false;

  const createdAtMs = Date.parse(recording.createdAt ?? "");
  if (
    Number.isFinite(createdAtMs) &&
    Date.now() - createdAtMs > 2 * 60 * 1000 &&
    transcriptStatus !== "pending"
  ) {
    return false;
  }

  return true;
}

export async function loader({ params, url }: LoaderFunctionArgs) {
  const id = params.shareId;
  if (!id) return emptyLoaderData(url);
  const [
    {
      getRequestUserEmail,
      signScopedAgentAccessToken,
      verifyScopedAgentAccessToken,
    },
    { resolveAccess },
  ] = await Promise.all([
    import("@agent-native/core/server"),
    import("@agent-native/core/sharing"),
  ]);

  const [rec] = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      description: schema.recordings.description,
      thumbnailUrl: schema.recordings.thumbnailUrl,
      animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
      visibility: schema.recordings.visibility,
      status: schema.recordings.status,
      ownerEmail: schema.recordings.ownerEmail,
      password: schema.recordings.password,
      expiresAt: schema.recordings.expiresAt,
      archivedAt: schema.recordings.archivedAt,
      trashedAt: schema.recordings.trashedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id))
    .limit(1);

  const agentAccessToken =
    url.searchParams.get(CLIPS_AGENT_ACCESS_PARAM) ??
    url.searchParams.get("t") ??
    "";
  const hasAgentAccessToken = Boolean(agentAccessToken);
  const tokenGrantsAgentAccess = agentAccessToken
    ? verifyScopedAgentAccessToken(agentAccessToken, {
        resourceKind: CLIP_AGENT_ACCESS_TOKEN_PREFIX,
        resourceId: id,
      }).ok
    : false;

  if (!rec) return shareLoaderData(emptyLoaderData(url), hasAgentAccessToken);

  if (rec.expiresAt) {
    const expires = new Date(rec.expiresAt).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) {
      return shareLoaderData(emptyLoaderData(url), hasAgentAccessToken);
    }
  }

  if (rec.visibility !== "public" && !tokenGrantsAgentAccess) {
    const userEmail = getRequestUserEmail();
    const access = userEmail ? await resolveAccess("recording", id) : null;
    if (!access) {
      const status = userEmail ? 403 : 401;
      const deniedData = emptyLoaderData(url, status);
      deniedData.accessRequestToken = signScopedAgentAccessToken({
        resourceKind: CLIPS_ACCESS_REQUEST_TOKEN_PREFIX,
        resourceId: id,
        ...(userEmail ? { viewerEmail: userEmail } : {}),
        ttlSeconds: CLIPS_ACCESS_REQUEST_TOKEN_TTL_SECONDS,
      });
      return privateShareLoaderData(deniedData, status);
    }
  }

  const recording: SharePageMetaRecording = {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    ownerEmail: rec.ownerEmail,
    thumbnailUrl: rec.password
      ? null
      : resolvePlayerThumbnailUrl(rec, { appPath }),
    animatedThumbnailUrl: null,
    visibility: rec.visibility,
    status: rec.status,
    hasPassword: Boolean(rec.password),
    archivedAt: rec.archivedAt,
    trashedAt: rec.trashedAt,
  };
  const canExposeAnonymousAgentContext =
    rec.visibility === "public" &&
    !rec.password &&
    !rec.archivedAt &&
    !rec.trashedAt;
  return shareLoaderData(
    {
      recording,
      origin: url.origin,
      shareUrl: `${url.origin}${url.pathname}`,
      agentContextUrl: canExposeAnonymousAgentContext
        ? buildAgentApiUrls(id, {
            origin: url.origin,
            basePath:
              process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "",
          }).contextUrl
        : null,
    },
    hasAgentAccessToken,
  );
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  return buildClipsShareMeta({
    recording: loaderData?.recording ?? null,
    origin: loaderData?.origin ?? null,
    basePath: appBasePath(),
    shareUrl: loaderData?.shareUrl ?? null,
  });
};

const STORAGE_KEY_PREFIX = "clips-share-pw-";
const UPLOAD_STUCK_TIMEOUT_MS = 5 * 60 * 1000;
const PROCESSING_STUCK_TIMEOUT_MS = 12 * 60 * 1000;
const READY_MEDIA_SETTLE_POLL_MS = 20 * 1000;
const READY_MEDIA_SETTLE_POLL_INTERVAL_MS = 1000;

function AgentDiscovery({
  recording,
  agentContextUrl,
  frameAvailable,
}: {
  recording: Pick<SharePageMetaRecording, "id" | "title" | "status"> | null;
  agentContextUrl: string | null;
  frameAvailable: boolean;
}) {
  const t = useT();
  if (!recording || !agentContextUrl) return null;

  const payload = buildAgentDiscoveryPayload({
    recordingId: recording.id,
    title: recording.title,
    status: recording.status,
    agentContextUrl,
  });

  return (
    <>
      <a
        href={agentContextUrl}
        rel="alternate"
        type="application/json"
        className="sr-only"
        data-agent-context-url={agentContextUrl}
      >
        {t("sharePage.agentReadableContext")}
      </a>
      <script
        type="application/agent-native+json"
        id="clips-agent-context"
        dangerouslySetInnerHTML={{ __html: safeJsonForHtml(payload) }}
      />
      <ClipAgentWebMcp
        recordingId={recording.id}
        agentContextUrl={agentContextUrl}
        recordingStatus={recording.status}
        frameAvailable={frameAvailable}
      />
    </>
  );
}

export default function ShareRoute() {
  const t = useT();
  const loaderData = useLoaderData<typeof loader>() as SharePageLoaderData;
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startAt = searchParams.get("at");
  const startMs = useMemo(() => parseTimeParam(startAt), [startAt]);

  // Viral attribution: read the `ref`/`via` the visitor arrived on (the tagged
  // share link) so we can fire funnel events and forward attribution into the
  // signup URL even when cookies are blocked or `document.referrer` is empty.
  const attribution = useMemo(
    () =>
      readShareAttribution(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );
  const recordingId = shareId ?? "";

  // share_cta_click — fired alongside (never instead of) the real navigation.
  // `track` is non-throwing, but guard anyway so tracking can never break a CTA.
  const fireShareCtaClick = useCallback(
    (cta: "signup" | "download" | "try_clips" | "signin") => {
      try {
        void trackEvent("share_cta_click", {
          surface: "clip",
          recording_id: recordingId,
          cta,
          ref: attribution.ref,
          via: attribution.via,
        });
      } catch {
        // Never let analytics break a CTA.
      }
    },
    [recordingId, attribution.ref, attribution.via],
  );

  // Forward attribution into the signup URL so it survives blocked cookies.
  const signupHref = appPath(
    `/signup?${buildSignupAttributionQuery(attribution.via)}`,
  );

  // share_view — fire once when the public share page mounts. The ref guard
  // prevents double-fire across re-renders / StrictMode double-invocation.
  const shareViewFiredRef = useRef(false);
  useEffect(() => {
    if (shareViewFiredRef.current) return;
    shareViewFiredRef.current = true;
    try {
      void trackEvent("share_view", {
        surface: "clip",
        recording_id: recordingId,
        ref: attribution.ref,
        via: attribution.via,
      });
    } catch {
      // Never let analytics break the page render.
    }
  }, [recordingId, attribution.ref, attribution.via]);

  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const readyMediaPollRef = useRef<{ key: string; until: number } | null>(null);
  // Reading sessionStorage in the initializer makes the first client render
  // disagree with the server's, which has no storage and always renders the
  // locked state. React answers a mismatch by throwing away the hydrated tree
  // and re-rendering from scratch, so a returning viewer watches a blank share
  // page while everything refetches. Start where the server started and adopt
  // the stored password after mount.
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_PREFIX + shareId);
      if (stored) setPassword(stored);
      // Unreadable storage and no stored password are the same state to this
      // screen: both leave `password` null, which renders the password prompt.
      // coercion-ok: the fallback is visible to the viewer, not swallowed.
    } catch {}
  }, [shareId]);
  const [pwError, setPwError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(startMs);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentAtMs, setCommentAtMs] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const {
    session,
    isLoading: sessionLoading,
    status: sessionStatus,
    retry: retrySession,
  } = useSession();
  const retriedUnavailableSessionRef = useRef(false);
  const requestAccess = useActionMutation<
    {
      alreadyHasAccess: boolean;
      alreadyRequested?: boolean;
      message: string;
      notifiedOwner: boolean;
      ok: true;
    },
    {
      accessRequestToken?: string;
      recordingId: string;
      requesterEmail?: string;
    }
  >("request-recording-access");
  const [accountGateIntent, setAccountGateIntent] =
    useState<AccountGateIntent | null>(null);
  const pendingAccountActionRef = useRef<PendingAccountAction | null>(null);
  const resumedAccountActionRef = useRef<"comment" | "react" | null>(null);
  const [refreshSessionAfterAuth, setRefreshSessionAfterAuth] = useState(false);
  const [processingTimeout, setProcessingTimeout] = useState(false);
  // Keep the public viewer's rail in the same default state as the signed-in
  // viewer. Its own tab strip is the only panel navigation; the page toolbar
  // stays focused on recording actions.
  const [panel, setPanel] = useState<SharePanel>("transcript");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const commentsSectionRef = useRef<HTMLElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [accessRequestSent, setAccessRequestSent] = useState(false);
  const [accessRequestError, setAccessRequestError] = useState<string | null>(
    null,
  );
  const [requestAccessDialogOpen, setRequestAccessDialogOpen] = useState(false);
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requestAccessDialogError, setRequestAccessDialogError] = useState<
    string | null
  >(null);
  const agentAccessToken = useMemo(() => {
    if (typeof window === "undefined") return "";
    return (
      new URLSearchParams(window.location.search).get(
        CLIPS_AGENT_ACCESS_PARAM,
      ) ?? ""
    );
  }, []);

  const shareReturnTo = useMemo(() => {
    const path = `/share/${encodeURIComponent(recordingId)}`;
    if (typeof window === "undefined") return path;
    const query = buildShareContinuationQuery(attribution, startAt);
    return query ? `${path}?${query}` : path;
  }, [attribution, recordingId, startAt]);
  const signInHref = buildSignInReturnHref({ returnTo: shareReturnTo });

  const submitAccessRequest = useCallback(
    (email?: string) => {
      if (!shareId || accessRequestSent || requestAccess.isPending) return;
      const normalizedEmail = email?.trim() || undefined;
      setAccessRequestError(null);
      setRequestAccessDialogError(null);
      requestAccess.mutate(
        {
          accessRequestToken: loaderData.accessRequestToken,
          recordingId: shareId,
          ...(normalizedEmail ? { requesterEmail: normalizedEmail } : {}),
        },
        {
          onSuccess: () => {
            setAccessRequestSent(true);
            setRequestAccessDialogOpen(false);
            toast.success(
              normalizedEmail
                ? t("sharePage.accessRequestSentWithEmail", {
                    email: normalizedEmail,
                  })
                : t("sharePage.accessRequestSent"),
            );
          },
          onError: (error: unknown) => {
            const message =
              error instanceof Error && error.message
                ? error.message
                : t("sharePage.accessRequestFailed");
            setAccessRequestError(message);
            setRequestAccessDialogError(message);
          },
        },
      );
    },
    [
      accessRequestSent,
      loaderData.accessRequestToken,
      requestAccess,
      shareId,
      t,
    ],
  );

  const submitGuestAccessRequest = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const email = requesterEmail.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setRequestAccessDialogError(t("sharePage.requestAccessEmailRequired"));
        return;
      }
      submitAccessRequest(email);
    },
    [requesterEmail, submitAccessRequest, t],
  );

  const dataQ = useQuery({
    queryKey: [
      "public-recording",
      shareId,
      password,
      agentAccessToken,
      session?.email ?? null,
    ],
    queryFn: async () => {
      const url = new URL(
        `${appBasePath()}/api/public-recording`,
        window.location.origin,
      );
      url.searchParams.set("id", shareId ?? "");
      if (password) url.searchParams.set("password", password);
      if (agentAccessToken) {
        url.searchParams.set(CLIPS_AGENT_ACCESS_PARAM, agentAccessToken);
      }
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },
    // Let public shares resolve without waiting for auth. A session-loading
    // 401/404 remains behind the spinner until the authenticated retry.
    enabled: !!shareId,
    refetchInterval: (q) => {
      const payload = (q.state.data as { data?: any } | undefined)?.data;
      const rec = payload?.recording;
      if (!rec) return false;
      // Poll while the recording is still being assembled / transcoded so the
      // page auto-upgrades from "Processing" to the real player the moment
      // the server flips status to 'ready' and writes videoUrl. Mirrors
      // r.$recordingId.tsx's playerDataQ.refetchInterval.
      if (rec.status !== "ready" || !rec.videoUrl) {
        readyMediaPollRef.current = null;
        return 2000;
      }
      if (rec.seekableRepairPending === true) {
        readyMediaPollRef.current = null;
        return READY_MEDIA_SETTLE_POLL_INTERVAL_MS;
      }
      const mediaKey = [
        rec.id,
        rec.durationMs ?? "",
        rec.videoSizeBytes ?? "",
        rec.videoFormat ?? "",
        rec.updatedAt ?? "",
      ].join(":");
      const now = Date.now();
      if (readyMediaPollRef.current?.key !== mediaKey) {
        readyMediaPollRef.current = {
          key: mediaKey,
          until: now + READY_MEDIA_SETTLE_POLL_MS,
        };
      }
      if (now < readyMediaPollRef.current.until) {
        return READY_MEDIA_SETTLE_POLL_INTERVAL_MS;
      }
      // Also keep polling while a transcript is pending so "Transcribing…"
      // auto-flips to the ready transcript (or to the failure card). The
      // public payload has no transcript.cleanup field (that's authenticated
      // -only), so there is no equivalent of the cleanup.status poll here.
      if (payload?.transcript?.status === "pending") return 3000;
      // And keep polling while the title is still the server-seeded default
      // — the agent will land a generated title via `update-recording` and
      // we want the skeleton to swap in promptly.
      if (shouldShowGeneratedTitleSkeleton(rec, payload?.transcript?.status)) {
        return 3000;
      }
      return false;
    },
    refetchIntervalInBackground: false,
  });

  const recording = dataQ.data?.data?.recording;
  const {
    error: failProcessingToast,
    start: startProcessingToast,
    success: completeProcessingToast,
  } = useSonnerLifecycleToast();
  const lifecyclePhaseRef = useRef<
    "failed" | "processing" | "ready" | "uploading" | null
  >(null);

  useEffect(() => {
    if (!recording) return;
    const phase =
      recording.status === "ready"
        ? recording.videoUrl
          ? "ready"
          : "processing"
        : recording.status;
    const previousPhase = lifecyclePhaseRef.current;
    if (phase === "uploading") {
      startProcessingToast(t("sharePage.uploadingAssembling"));
    } else if (phase === "processing") {
      startProcessingToast(t("sharePage.finishingClip"));
    } else if (
      phase === "ready" &&
      previousPhase &&
      previousPhase !== "ready"
    ) {
      completeProcessingToast(t("recordRoute.videoUploaded"));
    } else if (
      phase === "failed" &&
      previousPhase &&
      previousPhase !== "failed"
    ) {
      failProcessingToast(t("sharePage.savingWentWrong"));
    }
    lifecyclePhaseRef.current = phase;
  }, [
    completeProcessingToast,
    failProcessingToast,
    recording?.id,
    recording?.status,
    recording?.videoUrl,
    startProcessingToast,
    t,
  ]);
  const playbackMs = resolveStartMs(currentMs, recording?.durationMs);
  const resolvePlaybackMs = useCallback(
    () => playerRef.current?.getCurrentOriginalMs() ?? playbackMs,
    [playbackMs],
  );
  const requireSignIn = useCallback(
    (intent: "comment" | "react") => {
      pendingAccountActionRef.current =
        intent === "comment" ? { intent, atMs: resolvePlaybackMs() } : null;
      setAccountGateIntent(intent);
    },
    [resolvePlaybackMs],
  );
  const openCreateAccount = useCallback((intent: AccountGateIntent) => {
    pendingAccountActionRef.current = null;
    setAccountGateIntent(intent);
  }, []);

  useEffect(() => {
    if (!accountGateIntent) return;
    trackEvent("share_account_gate_shown", {
      surface: "public_share",
      recording_id: recordingId,
      intent: accountGateIntent,
    });
  }, [accountGateIntent, recordingId]);
  const verificationPending = recording?.verificationPending === true;
  const comments = dataQ.data?.data?.comments ?? [];
  const reactions = dataQ.data?.data?.reactions ?? [];
  const chapters = dataQ.data?.data?.chapters ?? [];
  const transcriptSegments = dataQ.data?.data?.transcript?.segments ?? [];
  const transcriptFullText = dataQ.data?.data?.transcript?.fullText ?? null;
  const transcriptStatus = dataQ.data?.data?.transcript?.status;
  const transcriptFailureReason =
    dataQ.data?.data?.transcript?.failureReason ?? null;
  const ctas = dataQ.data?.data?.ctas ?? [];
  const apiStatus = dataQ.data?.status;
  const apiAccessDeniedStatus =
    apiStatus === 401 || apiStatus === 403 ? apiStatus : null;
  const accessDeniedStatus =
    apiAccessDeniedStatus ??
    (!recording && loaderData.accessDeniedStatus
      ? session
        ? 403
        : 401
      : null);
  const firstCta = ctas[0] ?? null;
  const viewerRole = dataQ.data?.data?.viewer?.role as
    | "owner"
    | "admin"
    | "editor"
    | "commenter"
    | "viewer"
    | undefined;
  const viewerCanEdit =
    Boolean(dataQ.data?.data?.viewer?.canEdit) ||
    viewerRole === "owner" ||
    viewerRole === "admin" ||
    viewerRole === "editor";
  // Any signed-in viewer with access to the recording may comment or react —
  // anonymous viewers keep the same controls and enter the account funnel
  // when they try to participate (see `requireSignIn` below).
  const viewerCanComment = Boolean(session) && viewerRole != null;
  const viewerCanUseFullscreenInteractions = !session || viewerCanComment;
  const viewerIsOwner = Boolean(dataQ.data?.data?.viewer?.isOwner);
  const canReshareLink =
    (viewerRole === "viewer" || viewerRole === "commenter") &&
    (recording?.visibility === "public" || recording?.visibility === "org");
  // A plain viewer only gets a copy-link control: it must not trigger
  // `list-resource-shares` (any read access is enough to call it, and its
  // response includes every individually-shared principal's email) and must
  // not surface the raw video download/open action independent of
  // `enableDownloads`.
  const viewerReshareOnly = canReshareLink && !viewerCanEdit;
  const viewerCanOpenDashboard = Boolean(
    dataQ.data?.data?.viewer?.canOpenDashboard,
  );
  const viewCount = Number(dataQ.data?.data?.viewCount ?? 0);
  const showTitleSkeleton = recording
    ? shouldShowGeneratedTitleSkeleton(recording, transcriptStatus)
    : false;
  const visibleTitle = recording
    ? displayRecordingTitle(recording.title)
    : t("sharePage.untitledClip");
  const ownerEmail =
    (typeof recording?.ownerEmail === "string"
      ? recording.ownerEmail.trim()
      : "") ||
    (typeof loaderData.recording?.ownerEmail === "string"
      ? loaderData.recording.ownerEmail.trim()
      : "") ||
    "";
  const ownerInitial = ownerEmail.charAt(0).toUpperCase() || "C";
  const recordedOn = formatRecordedOn(recording?.createdAt);
  const visibilityLabel = recording
    ? t(`shareUi.visibility.${recording.visibility}.label`)
    : "";
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const unlockedAgentContextUrl =
    typeof dataQ.data?.data?.agentContextUrl === "string"
      ? dataQ.data.data.agentContextUrl
      : null;
  const agentDiscovery = (
    <AgentDiscovery
      recording={recording ?? loaderData.recording}
      agentContextUrl={unlockedAgentContextUrl ?? loaderData.agentContextUrl}
      frameAvailable={Boolean(recording) && !isLoomEmbedBacked}
    />
  );

  useEffect(() => {
    if (!recording) return;
    document.title = clipsSharePageTitle(recording.title);
  }, [recording?.title]);

  // /share/:id and /r/:id render the same clip, so anyone who can open the
  // authenticated page goes straight there rather than through a redundant
  // "open dashboard" button. `canOpenDashboard` is the server's own
  // `canOpenDirectRecordingPage` verdict; deriving it from the display role
  // instead would bounce viewers between the two routes forever, since /r
  // sends anyone it rejects back here.
  useEffect(() => {
    const target = resolveDashboardRedirect({
      recordingId: recording?.id,
      canOpenDashboard: viewerCanOpenDashboard,
      search: searchParams.toString(),
    });
    if (target) void navigate(target, { replace: true });
  }, [viewerCanOpenDashboard, recording?.id, searchParams, navigate]);

  // The /share/* shell skips DbSyncSetup (and thus useNavigationState), so the
  // agent mounted in the side panel has no navigation context. Write it
  // explicitly for signed-in viewers so view-screen grounds the chat to this
  // clip instead of falling back to a generic library view.
  useEffect(() => {
    if (!session || !recording?.id) return;
    fetch(
      agentNativePath(
        `/_agent-native/application-state/navigation:${getBrowserTabId()}`,
      ),
      {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: "share",
          shareId: recording.id,
          recordingId: recording.id,
          path: `/share/${recording.id}`,
        }),
      },
    ).catch(() => {});
  }, [session, recording?.id]);

  useEffect(() => {
    if (!recording) {
      setProcessingTimeout(false);
      return;
    }
    if (recording.status === "ready" && recording.videoUrl) {
      setProcessingTimeout(false);
      return;
    }
    if (recording.status === "failed") {
      setProcessingTimeout(false);
      return;
    }
    if (verificationPending) {
      setProcessingTimeout(false);
      return;
    }

    const timeoutMs =
      recording.status === "processing"
        ? PROCESSING_STUCK_TIMEOUT_MS
        : UPLOAD_STUCK_TIMEOUT_MS;
    const handle = setTimeout(() => setProcessingTimeout(true), timeoutMs);
    return () => clearTimeout(handle);
  }, [
    recording?.id,
    recording?.status,
    recording?.videoUrl,
    verificationPending,
  ]);

  usePlayerShortcuts({ playerRef });

  const [trackedVideoEl, setTrackedVideoEl] = useState<HTMLVideoElement | null>(
    null,
  );

  const tracking = useViewTracking({
    recordingId: shareId ?? "",
    videoEl: trackedVideoEl,
    durationMs: recording?.durationMs ?? 0,
    trackOpenWithoutVideo: isLoomEmbedBacked,
  });

  const reactToRecording = useCallback(
    (emoji: string) => {
      if (!session) {
        pendingAccountActionRef.current = { intent: "react", emoji };
        setAccountGateIntent("react");
        return false;
      }
      if (!recording?.id) return false;

      tracking.reportReaction(emoji);
      const liveMs = resolvePlaybackMs();

      return fetch(
        agentNativePath("/_agent-native/actions/react-to-recording"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordingId: recording.id,
            emoji,
            videoTimestampMs: liveMs,
          }),
        },
      )
        .then((res) => {
          if (!res.ok) throw new Error(`react failed: ${res.status}`);
          return dataQ.refetch();
        })
        .then(() => true)
        .catch((err) => {
          console.warn("[clips] react failed", err);
          return false;
        });
    },
    [dataQ, recording?.id, resolvePlaybackMs, session, tracking],
  );

  useEffect(() => {
    if (
      !refreshSessionAfterAuth ||
      !session ||
      sessionStatus !== "authenticated"
    ) {
      return;
    }
    setRefreshSessionAfterAuth(false);
    const pending = pendingAccountActionRef.current;
    pendingAccountActionRef.current = null;
    if (!pending) return;
    if (pending.intent === "comment") {
      resumedAccountActionRef.current = "comment";
      setCommentAtMs(pending.atMs);
      setCommentOpen(true);
      return;
    }
    resumedAccountActionRef.current = "react";
    void Promise.resolve(reactToRecording(pending.emoji)).then((completed) => {
      if (!completed || resumedAccountActionRef.current !== "react") return;
      resumedAccountActionRef.current = null;
      trackEvent("share_account_action_completed", {
        surface: "public_share",
        recording_id: recordingId,
        intent: "react",
      });
    });
  }, [
    reactToRecording,
    recordingId,
    refreshSessionAfterAuth,
    session,
    sessionStatus,
  ]);

  // If the backend returned 401 with passwordRequired, prompt.
  const needsPassword =
    dataQ.data?.status === 401 && dataQ.data.data?.passwordRequired;

  useEffect(() => {
    if (!needsPassword) return;
    if (password) {
      // Wrong password entered → clear and show error.
      setPwError(t("sharePage.incorrectPassword"));
      setPassword(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY_PREFIX + shareId);
      } catch {}
    }
  }, [needsPassword, password, shareId, t]);

  function onSubmitPassword(pw: string) {
    setPwError(null);
    setPassword(pw);
    try {
      sessionStorage.setItem(STORAGE_KEY_PREFIX + (shareId ?? ""), pw);
    } catch {}
  }

  async function downloadRecording() {
    if (!recording?.videoUrl) return;
    setDownloading(true);
    const downloadToastId = toast.loading(t("sharePage.downloading"));
    try {
      const res = await fetch(recording.videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension =
        blob.type.includes("webm") || recording.videoFormat === "webm"
          ? "webm"
          : "mp4";
      a.download = `${sanitizeFilename(recording.title || "clip")}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(recording.videoUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
      toast.dismiss(downloadToastId);
    }
  }

  const shareNeedsSession =
    !needsPassword &&
    (!dataQ.data ||
      dataQ.data.status === 401 ||
      dataQ.data.status === 404 ||
      !dataQ.data.data?.recording);
  const sessionNeedsRetry =
    sessionStatus === "loading" ||
    sessionStatus === "signing-out" ||
    (sessionStatus === "unavailable" &&
      shareNeedsSession &&
      !retriedUnavailableSessionRef.current);

  useEffect(() => {
    if (
      sessionStatus === "authenticated" ||
      sessionStatus === "unauthenticated"
    ) {
      retriedUnavailableSessionRef.current = false;
    }
    if (
      sessionStatus !== "unavailable" ||
      !shareNeedsSession ||
      retriedUnavailableSessionRef.current
    ) {
      return;
    }
    retriedUnavailableSessionRef.current = true;
    retrySession();
  }, [retrySession, sessionStatus, shareNeedsSession]);

  if (dataQ.isLoading || (sessionNeedsRetry && shareNeedsSession)) {
    return (
      <>
        {agentDiscovery}
        <DefaultSpinner />
      </>
    );
  }

  if (
    sessionStatus === "unavailable" &&
    shareNeedsSession &&
    retriedUnavailableSessionRef.current
  ) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title={t("sharePage.somethingWentWrong")}
          message={t("sharePage.pleaseTryAgain")}
          action={
            <Button
              size="sm"
              onClick={() => {
                retriedUnavailableSessionRef.current = false;
                retrySession();
                void dataQ.refetch();
              }}
            >
              {t("sharePage.checkAgain")}
            </Button>
          }
        />
      </>
    );
  }

  if (needsPassword) {
    return (
      <>
        {agentDiscovery}
        <AccessPasswordPrompt
          onSubmit={onSubmitPassword}
          error={pwError}
          title={t("sharePage.passwordProtected")}
        />
      </>
    );
  }

  if (dataQ.data?.status === 410) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title={t("sharePage.linkExpired")}
          message={t("sharePage.linkExpiredMessage")}
        />
      </>
    );
  }

  if (accessDeniedStatus === 401 || accessDeniedStatus === 403) {
    const canRequestAccess = accessDeniedStatus === 403 && Boolean(session);
    const requestSent =
      accessRequestSent || Boolean(dataQ.data?.data?.alreadyRequested);

    return (
      <>
        {agentDiscovery}
        <EndState
          icon={<IconLock className="h-5 w-5" aria-hidden="true" />}
          title={t("sharePage.privateClip")}
          message={t(
            canRequestAccess
              ? "sharePage.privateClipMessage"
              : "sharePage.privateClipSignedOutMessage",
          )}
          error={canRequestAccess ? accessRequestError : null}
          action={
            canRequestAccess ? (
              <Button
                size="sm"
                disabled={requestAccess.isPending || requestSent}
                onClick={() => submitAccessRequest()}
              >
                {requestSent
                  ? t("sharePage.accessRequested")
                  : requestAccess.isPending
                    ? t("sharePage.requestingAccess")
                    : t("sharePage.requestAccess")}
              </Button>
            ) : shareId ? (
              <Button
                size="sm"
                onClick={() => {
                  setAccessRequestError(null);
                  setRequestAccessDialogError(null);
                  setRequestAccessDialogOpen(true);
                }}
              >
                {t("sharePage.requestAccess")}
              </Button>
            ) : null
          }
        />
        {!canRequestAccess && shareId ? (
          <RequestAccessDialog
            open={requestAccessDialogOpen}
            onOpenChange={setRequestAccessDialogOpen}
            signInHref={signInHref}
            email={requesterEmail}
            onEmailChange={(value) => {
              setRequesterEmail(value);
              setRequestAccessDialogError(null);
            }}
            onSubmit={submitGuestAccessRequest}
            isSubmitting={requestAccess.isPending}
            error={requestAccessDialogError}
          />
        ) : null}
      </>
    );
  }

  if (dataQ.data?.status === 404) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title={t("sharePage.clipUnavailable")}
          message={t("sharePage.clipUnavailableMessage")}
        />
      </>
    );
  }

  if (!recording) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title={t("sharePage.somethingWentWrong")}
          message={dataQ.data?.data?.error ?? t("sharePage.pleaseTryAgain")}
        />
      </>
    );
  }

  if (recording.status !== "ready" || !recording.videoUrl) {
    const progress = Number(recording.uploadProgress ?? 0);
    const explicitFailure = recording.status === "failed";
    const rawFailureReason =
      ((recording as any).failureReason as string | null | undefined) ?? null;
    const storageSetupFailure = isStorageSetupFailureReason(rawFailureReason);
    const loomStorageSetupFailure =
      storageSetupFailure && isLoomRecordingSource(recording);
    const stuckFailure =
      !explicitFailure && !verificationPending && processingTimeout;
    const isFailure = explicitFailure || storageSetupFailure || stuckFailure;
    const canManageStorage = viewerCanEdit;
    const signInHref = buildSignInReturnHref({
      returnTo: `/r/${recording.id}`,
    });
    const detail = failureDetail(rawFailureReason);
    const label = storageSetupFailure
      ? t("sharePage.connectStorageFinish")
      : stuckFailure
        ? t("sharePage.needsAttention")
        : explicitFailure
          ? t("sharePage.savingWentWrong")
          : t("sharePage.finishingClip");
    const message = storageSetupFailure
      ? canManageStorage
        ? loomStorageSetupFailure
          ? t("sharePage.loomPreservedManage")
          : t("sharePage.videoPreservedManage")
        : session
          ? t("sharePage.creatorNeedsStorage")
          : t("sharePage.signInStorage")
      : stuckFailure
        ? session
          ? t("sharePage.uploadNotCompleteSession")
          : t("sharePage.uploadNotCompleteSignIn")
        : explicitFailure
          ? (rawFailureReason ?? t("sharePage.creatorMayRetry"))
          : t("sharePage.uploadingAssembling");

    return (
      <>
        {agentDiscovery}
        <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
          {!isFailure ? (
            <Spinner className="h-8 w-8 mb-4 text-muted-foreground" />
          ) : (
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
              <IconAlertTriangle className="h-5 w-5" />
            </div>
          )}
          <h1 className="mb-1 text-center text-lg font-semibold">{label}</h1>
          <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
            {message}
          </p>
          {isFailure && detail && canManageStorage ? (
            <div className="mb-4 w-full max-w-xl rounded-md border border-border bg-card p-4 text-start shadow-sm">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("sharePage.details")}
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {detail}
              </pre>
            </div>
          ) : null}
          {!isFailure && progress > 0 ? (
            <div className="w-64 h-1.5 rounded-full bg-accent overflow-hidden mb-4">
              <div
                className="h-full bg-foreground"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          ) : null}
          {storageSetupFailure && canManageStorage ? (
            <div className="mb-4 w-full">
              <StorageSetupCard
                title={t("sharePage.connectStorageFinishSaving")}
                description={t("sharePage.chooseStorageCheck")}
                connectedDescription={t("sharePage.storageConnectedChecking")}
                onConfigured={() => {
                  void dataQ.refetch();
                }}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!session && isFailure ? (
              <Button asChild size="sm">
                <a href={signInHref} className="gap-1.5">
                  <IconLogin2 className="h-4 w-4 rtl:-scale-x-100" />
                  {t("sharePage.signInToFinish")}
                </a>
              </Button>
            ) : !session && !sessionLoading && !isFailure ? (
              <Button asChild variant="ghost" size="sm">
                <a href={signInHref} className="gap-1.5">
                  <IconLogin2 className="h-4 w-4 rtl:-scale-x-100" />
                  {t("sharePage.signInIfYours")}
                </a>
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setProcessingTimeout(false);
                void dataQ.refetch();
              }}
              variant="outline"
              size="sm"
              className="border-foreground/20 bg-muted/50 hover:bg-accent text-foreground"
            >
              {t("sharePage.checkAgain")}
            </Button>
          </div>
        </div>
      </>
    );
  }

  const canDownloadRecording = Boolean(
    recording.enableDownloads && recording.videoUrl && !isLoomEmbedBacked,
  );
  // Loom-backed clips only ever get an "open player" link (not a raw
  // download), so they're exempt from the enableDownloads gate here.
  const shareVideoUrl =
    canDownloadRecording || isLoomEmbedBacked ? recording.videoUrl : null;

  return (
    <div className="clips-recording-view relative flex h-[var(--agent-native-viewport-height,100vh)] min-h-0 w-full max-w-full flex-col overflow-y-auto bg-background xl:grid xl:h-screen xl:grid-cols-[minmax(0,1fr)_420px] xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-hidden [&_.agent-composer-root]:!border-0 [&_.agent-composer-root]:!bg-background">
      {agentDiscovery}
      <header className="col-span-full row-start-1 flex min-h-14 min-w-0 shrink-0 flex-wrap items-center gap-3 bg-background px-5 py-3 xl:flex-nowrap">
        {session ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label={t("sharePage.backToHome")}
          >
            <Link to={appPath("/")}>
              <IconArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            to={appPath("/")}
            aria-label={t("navigation.brand")}
            className="flex min-w-0 items-center gap-2 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AgentNativeIcon
              aria-hidden="true"
              className="h-3.5 w-6 shrink-0 text-foreground"
            />
            <span className="truncate text-sm font-semibold text-foreground">
              {t("navigation.brand")}
            </span>
          </Link>
          <EnvironmentBadge placement="inline" />
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
          {session ? null : (
            <SignedOutShareActions
              recordingId={recording.id}
              startAt={startAt}
              onCtaClick={fireShareCtaClick}
              onSignup={() => openCreateAccount("continue")}
            />
          )}
          {viewerCanEdit || canReshareLink ? (
            <ShareRecordingPopover
              recordingId={recording.id}
              recordingTitle={recording.title}
              initialVisibility={recording.visibility}
              initialRole={viewerIsOwner ? "owner" : undefined}
              videoUrl={shareVideoUrl}
              thumbnailUrl={recording.thumbnailUrl}
              animatedThumbnailUrl={recording.animatedThumbnailUrl}
              isLoomRecording={isLoomEmbedBacked}
              hasPassword={Boolean(recording.hasPassword)}
              expiresAt={recording.expiresAt}
              viewerReshareOnly={viewerReshareOnly}
            >
              <ClipsShareTrigger
                label={t("sharePage.share")}
                className="border-0 shadow-none"
              />
            </ShareRecordingPopover>
          ) : null}
        </div>
      </header>

      <div className="flex w-full min-w-0 flex-none flex-col overflow-visible xl:col-start-1 xl:row-start-2 xl:min-h-0 xl:flex-1 xl:overflow-y-hidden">
        <main className="overflow-visible xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <div className="mx-auto flex w-full flex-col gap-5 pb-10 sm:px-4 xl:pt-4">
            <div className="relative aspect-video w-full">
              <VideoPlayer
                ref={playerRef}
                onVideoElementChange={setTrackedVideoEl}
                recordingId={recording.id}
                videoUrl={recording.videoUrl}
                mediaVersion={
                  recording.mediaUpdatedAt ?? recording.videoSizeBytes ?? null
                }
                videoFormat={recording.videoFormat}
                embedProvider={isLoomEmbedBacked ? "loom" : null}
                durationMs={recording.durationMs}
                startMs={resolveStartMs(startMs, recording.durationMs)}
                persistPlaybackPosition={Boolean(session)}
                editsJson={recording.editsJson}
                thumbnailUrl={recording.thumbnailUrl}
                role={viewerRole ?? (viewerCanEdit ? "owner" : "viewer")}
                defaultSpeed={parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2}
                comments={comments}
                chapters={chapters}
                reactions={reactions}
                transcriptSegments={transcriptSegments}
                cta={firstCta}
                onCtaClick={() => tracking.reportCtaClick()}
                onTimeUpdate={(ms) => setCurrentMs(ms)}
                onCommentClick={
                  viewerCanUseFullscreenInteractions
                    ? () => {
                        requestAnimationFrame(() =>
                          commentsSectionRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                        );
                      }
                    : undefined
                }
                onFullscreenChange={setIsPlayerFullscreen}
                enableComments={
                  recording.enableComments && viewerCanUseFullscreenInteractions
                }
                onAddComment={
                  viewerCanUseFullscreenInteractions
                    ? () => {
                        if (!session) {
                          requireSignIn("comment");
                          return;
                        }
                        setCommentAtMs(resolvePlaybackMs());
                        setCommentOpen(true);
                      }
                    : undefined
                }
                enableReactions={
                  recording.enableReactions &&
                  viewerCanUseFullscreenInteractions
                }
                onReact={
                  viewerCanUseFullscreenInteractions
                    ? reactToRecording
                    : undefined
                }
                className="h-full w-full rounded-none sm:rounded-xl"
              />
              {commentOpen && viewerCanComment
                ? (() => {
                    const composer = (
                      <TimestampedCommentBar
                        recordingId={recording.id}
                        atMs={commentAtMs}
                        draft={commentDraft}
                        onDraftChange={setCommentDraft}
                        onClose={() => setCommentOpen(false)}
                        onAdded={() => {
                          void dataQ.refetch();
                          if (resumedAccountActionRef.current === "comment") {
                            resumedAccountActionRef.current = null;
                            trackEvent("share_account_action_completed", {
                              surface: "public_share",
                              recording_id: recording.id,
                              intent: "comment",
                            });
                          }
                        }}
                      />
                    );
                    // The Fullscreen API only paints the player's own element,
                    // so portal the composer there instead of exiting
                    // fullscreen when it's open.
                    const fullscreenContainer =
                      isPlayerFullscreen && playerRef.current?.container;
                    return fullscreenContainer
                      ? createPortal(composer, fullscreenContainer)
                      : composer;
                  })()
                : null}
            </div>

            <section className="flex shrink-0 flex-col gap-3 px-4 pt-1 sm:px-0">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  {showTitleSkeleton ? (
                    <Skeleton
                      aria-label={t("sharePage.generatingTitle")}
                      className="h-7 w-72 max-w-full"
                    />
                  ) : (
                    <h1 className="truncate text-xl font-semibold leading-tight tracking-[-0.02em] sm:text-2xl">
                      {visibleTitle}
                    </h1>
                  )}
                  <div className="mt-2 flex min-w-0 items-center gap-2">
                    <ClipsAvatar
                      email={ownerEmail}
                      alt={ownerEmail}
                      fallback={ownerInitial}
                      className="size-7 shrink-0"
                      fallbackClassName="bg-muted text-[10px] font-semibold text-muted-foreground"
                    />
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                      <bdi className="min-w-0 max-w-full truncate font-medium text-foreground">
                        {ownerEmail}
                      </bdi>
                      {recordedOn ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{recordedOn}</span>
                        </>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <span>{visibilityLabel}</span>
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <RecordingViewsBadge
                    recordingId={recording.id}
                    recordingTitle={recording.title}
                    viewCount={viewCount}
                    reactionCount={reactions.length}
                    durationMs={recording.durationMs}
                    canViewDetails={viewerCanEdit}
                    className="shrink-0 border-0 shadow-none"
                  />
                  {recording.enableReactions ? (
                    <ShareReactionPicker
                      disabled={Boolean(session) && !viewerCanComment}
                      onReact={reactToRecording}
                    />
                  ) : null}
                  {!viewerIsOwner && canDownloadRecording ? (
                    <RecordingOptionsMenu
                      recordingId={recording.id}
                      canDelete={false}
                      canDownload
                      downloadPending={downloading}
                      downloadLabel={t("recordRoute.downloadRecording")}
                      downloadingLabel={t("sharePage.downloading")}
                      onDownload={() => void downloadRecording()}
                    />
                  ) : null}
                  {viewerIsOwner ? (
                    <RecordingOptionsMenu
                      recordingId={recording.id}
                      canDelete
                      canDownload={canDownloadRecording}
                      downloadPending={downloading}
                      downloadLabel={t("recordRoute.downloadRecording")}
                      downloadingLabel={t("sharePage.downloading")}
                      onDownload={() => {
                        void downloadRecording();
                      }}
                      onDeleted={() => navigate("/library", { replace: true })}
                    />
                  ) : null}
                </div>
              </div>
              {recording.description ? (
                <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm leading-5">
                  <p
                    className={cn(
                      "max-w-4xl whitespace-pre-wrap break-words text-foreground/85",
                      !descriptionExpanded && "line-clamp-2",
                    )}
                  >
                    {recording.description}
                  </p>
                  {recording.description.length > 180 ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="mt-1 h-auto p-0 text-xs font-medium text-foreground"
                      onClick={() =>
                        setDescriptionExpanded((expanded) => !expanded)
                      }
                    >
                      {descriptionExpanded
                        ? t("settings.collapse")
                        : t("shareDialog.more")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </section>

            {recording.enableComments ? (
              <section
                ref={commentsSectionRef}
                className="scroll-mt-14 flex min-h-0 flex-1 flex-col px-1 pb-5 pt-4"
              >
                <h2 className="mb-3 shrink-0 text-sm font-semibold">
                  {t("sharePage.comments")}
                </h2>
                <CommentsPanel
                  recordingId={recording.id}
                  comments={comments}
                  currentMs={playbackMs}
                  getCurrentMs={resolvePlaybackMs}
                  currentUserEmail={session?.email}
                  currentUserName={session?.name}
                  enableComments={recording.enableComments}
                  canComment={viewerCanComment}
                  onSeek={(ms) => playerRef.current?.seek(ms)}
                  onUnauthenticated={requireSignIn}
                  queryKey={[
                    "public-recording",
                    shareId,
                    password,
                    agentAccessToken,
                    session?.email ?? null,
                  ]}
                  selectComments={(d: any) => d?.data?.comments}
                  applyComments={(d: any, next) =>
                    d
                      ? { ...d, data: { ...(d.data ?? {}), comments: next } }
                      : d
                  }
                  presentation="inline"
                />
              </section>
            ) : null}
          </div>
        </main>
      </div>

      <Tabs
        value={panel}
        onValueChange={(value) => setPanel(value as SharePanel)}
        className="contents"
      >
        <RecordingSidePanel
          className="xl:col-start-2 xl:row-start-2"
          tabs={
            <ViewerTabsList>
              <ViewerTabsTrigger value="transcript">
                {t("sharePage.transcript")}
              </ViewerTabsTrigger>
              <ViewerTabsTrigger value="agent">
                {t("sharePage.agent")}
              </ViewerTabsTrigger>
            </ViewerTabsList>
          }
        >
          <TabsContent
            value="agent"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {sessionStatus === "loading" ||
            sessionStatus === "signing-out" ? null : session ? (
              <AgentPanel
                emptyStateText={t("recordingPage.askAboutClip")}
                dynamicSuggestions={false}
                scope={
                  recording
                    ? { type: "recording" as const, id: recording.id }
                    : null
                }
                missingApiKeySetupLayout="sidebar"
                suggestions={[
                  t("recordingPage.summarizeClip"),
                  t("recordingPage.findKeyMoments"),
                  t("recordingPage.listFollowUpActions"),
                  t("recordingPage.draftQuestions"),
                ]}
                browserTabId={getBrowserTabId()}
                showHeader={false}
                showTabBar={false}
              />
            ) : (
              <PublicAgentEmptyState
                signupHref={signupHref}
                signInHref={signInHref}
                onCtaClick={fireShareCtaClick}
                onSignup={() => openCreateAccount("agent")}
              />
            )}
          </TabsContent>
          <TabsContent
            value="transcript"
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3"
          >
            <TranscriptPanel
              segments={transcriptSegments}
              fullText={transcriptFullText}
              durationMs={recording.durationMs}
              currentMs={playbackMs}
              onSeek={(ms) => playerRef.current?.seek(ms)}
              status={transcriptStatus}
              failureReason={transcriptFailureReason}
              recordingTitle={recording.title}
            />
          </TabsContent>
        </RecordingSidePanel>
      </Tabs>

      <AccountGateDialog
        open={accountGateIntent !== null}
        onOpenChange={(open) => {
          if (!open) setAccountGateIntent(null);
        }}
        intent={accountGateIntent ?? "continue"}
        returnTo={shareReturnTo}
        onSignIn={() => fireShareCtaClick("signin")}
        onAuthenticated={() => {
          setAccountGateIntent(null);
          setRefreshSessionAfterAuth(true);
          retrySession();
        }}
      />
    </div>
  );
}

function ShareReactionPicker({
  disabled,
  onReact,
}: {
  disabled?: boolean;
  onReact: (emoji: string) => boolean | Promise<boolean>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          <IconMoodSmile className="size-4" />
          {t("recordingPage.react")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-1.5">
        <div className="flex items-center gap-0.5">
          {REACTION_EMOJIS.map((emoji) => (
            <Button
              key={emoji}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full text-lg"
              aria-label={`${t("recordingPage.react")} ${REACTION_NAMES[emoji]}`}
              onClick={() => {
                setOpen(false);
                void onReact(emoji);
              }}
            >
              {emoji}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sanitizeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "clip"
  );
}

function formatRecordedOn(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    date,
  );
}

function PublicAgentEmptyState({
  signupHref,
  signInHref,
  onCtaClick,
  onSignup,
}: {
  signupHref: string;
  signInHref: string;
  onCtaClick: (cta: "signup" | "download" | "signin") => void;
  onSignup?: () => void;
}) {
  const t = useT();

  return (
    <Empty className="h-full rounded-none px-8 py-12">
      <EmptyHeader>
        <EmptyTitle className="text-base">
          {t("sharePage.agentEmptyTitle")}
        </EmptyTitle>
        <EmptyDescription>
          {t("sharePage.agentEmptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-xs gap-3">
        {onSignup ? (
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              onCtaClick("signup");
              onSignup();
            }}
          >
            {t("signInPrompt.createAccount")}
          </Button>
        ) : (
          <Button asChild className="w-full">
            <a href={signupHref} onClick={() => onCtaClick("signup")}>
              {t("signInPrompt.createAccount")}
            </a>
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {t("sharePage.agentEmptySignInPrompt")}{" "}
          <a
            href={signInHref}
            onClick={() => onCtaClick("signin")}
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            {t("signInPrompt.signIn")}
          </a>
        </p>
        <CaptureInstallButton
          variant="link"
          size="sm"
          className="h-auto gap-1.5 px-0 py-0 text-xs font-medium text-muted-foreground"
          onClick={() => onCtaClick("download")}
          downloadedChildren={
            <>
              <IconDeviceDesktop className="size-3.5" />
              {t("captureInstall.openDesktopApp")}
            </>
          }
        >
          <IconDownload className="size-3.5" />
          {t("sharePage.downloadDesktopApp")}
        </CaptureInstallButton>
      </EmptyContent>
    </Empty>
  );
}

function EndState({
  icon,
  title,
  message,
  error,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  error?: string | null;
  action?: ReactNode;
}) {
  const t = useT();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold mb-2">{title}</h1>
      <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
        {message}
      </p>
      {error ? (
        <p
          className="mb-6 max-w-md text-center text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {action}
        <Button asChild variant="ghost" size="sm">
          <a href={appPath("/")}>{t("clipsFinalRaw.goHome")}</a>
        </Button>
      </div>
    </div>
  );
}
