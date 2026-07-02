import {
  agentNativePath,
  appBasePath,
  appPath,
  track,
  useSession,
  AgentPanel,
  getBrowserTabId,
  useT,
} from "@agent-native/core/client";
import {
  getRequestUserEmail,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDownload,
  IconDots,
  IconExternalLink,
  IconLogin2,
  IconShare3,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  data,
  type HeadersArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";

import { CaptureInstallButton } from "@/components/capture-install-options";
import { AccessPasswordPrompt } from "@/components/player/access-password-prompt";
import { CommentsPanel } from "@/components/player/comments-panel";
import { RecordingOptionsMenu } from "@/components/player/delete-recording-menu";
import { ReactionsTray } from "@/components/player/reactions-tray";
import { ShareRecordingPopover } from "@/components/player/share-dialog";
import { SignInPromptDialog } from "@/components/player/sign-in-prompt-dialog";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { isDefaultTitle } from "@/hooks/use-auto-title";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useViewTracking } from "@/hooks/use-view-tracking";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";

import { getDb, schema } from "../../server/db";
import { CLIPS_AGENT_ACCESS_PARAM } from "../../server/lib/public-agent-context";
import {
  agentAccessTokenResourceId,
  buildAgentApiUrls,
  safeJsonForHtml,
} from "../../shared/agent-context";
import {
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "../../shared/loom";
import {
  buildSignupAttributionQuery,
  readShareAttribution,
} from "../../shared/share-attribution";
import {
  buildClipsShareMeta,
  clipsSharePageTitle,
  displayRecordingTitle,
} from "../../shared/share-meta";

type SharePageMetaRecording = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  visibility: "private" | "org" | "public";
  status: "uploading" | "processing" | "ready" | "failed";
  archivedAt: string | null;
  trashedAt: string | null;
};

type SharePageLoaderData = {
  recording: SharePageMetaRecording | null;
  agentContextUrl: string | null;
  origin: string | null;
  shareUrl: string | null;
};

const PRIVATE_AGENT_SHARE_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  "Referrer-Policy": "no-referrer",
};

function emptyLoaderData(url: URL): SharePageLoaderData {
  return {
    recording: null,
    agentContextUrl: null,
    origin: url.origin,
    shareUrl: null,
  };
}

function shareLoaderData(
  payload: SharePageLoaderData,
  privateAgentAccess = false,
) {
  if (!privateAgentAccess) return payload;
  return data(payload, {
    headers: PRIVATE_AGENT_SHARE_HEADERS,
  });
}

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

function failureDetail(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
}

function buildSignInHref(returnTo: string): string {
  return agentNativePath(
    `/_agent-native/sign-in?return=${encodeURIComponent(returnTo)}`,
  );
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

  const agentAccessToken = url.searchParams.get(CLIPS_AGENT_ACCESS_PARAM) ?? "";
  const hasAgentAccessToken = Boolean(agentAccessToken);
  const tokenGrantsAgentAccess = agentAccessToken
    ? verifyShortLivedToken(agentAccessToken, agentAccessTokenResourceId(id)).ok
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
    if (!access) return emptyLoaderData(url);
  }

  const recording: SharePageMetaRecording = {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    thumbnailUrl: rec.thumbnailUrl,
    animatedThumbnailUrl: rec.animatedThumbnailUrl,
    visibility: rec.visibility,
    status: rec.status,
    archivedAt: rec.archivedAt,
    trashedAt: rec.trashedAt,
  };
  const canExposeAgentContext =
    (rec.visibility === "public" || tokenGrantsAgentAccess) &&
    !rec.archivedAt &&
    !rec.trashedAt;
  const token = tokenGrantsAgentAccess
    ? agentAccessToken
    : canExposeAgentContext &&
        rec.password &&
        getRequestUserEmail() === rec.ownerEmail
      ? signShortLivedToken({ resourceId: agentAccessTokenResourceId(id) })
      : undefined;
  const canExposeAnonymousAgentContext = canExposeAgentContext && !rec.password;
  const canExposeOwnerAgentContext = canExposeAgentContext && Boolean(token);
  return shareLoaderData(
    {
      recording,
      origin: url.origin,
      shareUrl: `${url.origin}${url.pathname}`,
      agentContextUrl:
        canExposeAnonymousAgentContext || canExposeOwnerAgentContext
          ? buildAgentApiUrls(id, {
              origin: url.origin,
              basePath:
                process.env.VITE_APP_BASE_PATH ||
                process.env.APP_BASE_PATH ||
                "",
              token,
            }).contextUrl
          : null,
    },
    hasAgentAccessToken || canExposeOwnerAgentContext,
  );
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  return buildClipsShareMeta({
    recording: loaderData?.recording ?? null,
    origin: loaderData?.origin ?? null,
    shareUrl: loaderData?.shareUrl ?? null,
  });
};

const STORAGE_KEY_PREFIX = "clips-share-pw-";
const CLIPS_SOURCE_URL =
  "https://github.com/BuilderIO/agent-native/tree/main/templates/clips";
const CLIPS_TEMPLATE_URL = "https://www.agent-native.com/templates/clips";
const CLIPS_AGENT_DOCS_URL =
  "https://www.agent-native.com/docs/template-clips#agent-readable-clips";
const UPLOAD_STUCK_TIMEOUT_MS = 5 * 60 * 1000;
const PROCESSING_STUCK_TIMEOUT_MS = 2 * 60 * 1000;

type ViewerPlatform = "mac" | "windows";

function detectViewerPlatform(): ViewerPlatform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  return null;
}

function AgentDiscovery({
  recording,
  agentContextUrl,
}: {
  recording: Pick<SharePageMetaRecording, "id" | "title"> | null;
  agentContextUrl: string | null;
}) {
  const t = useT();
  if (!recording || !agentContextUrl) return null;

  const payload = {
    type: "agent-native.clip.discovery",
    clipId: recording.id,
    title: recording.title,
    agentContextUrl,
    instructions:
      "Fetch agentContextUrl for the transcript and JPEG frame URLs. Fetch the frame URLs to SEE the screen, not just read the transcript.",
  };

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
    </>
  );
}

export default function ShareRoute() {
  const t = useT();
  const loaderData = useLoaderData<typeof loader>() as SharePageLoaderData;
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();

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
        void track("share_cta_click", {
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
      void track("share_view", {
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
  const [password, setPassword] = useState<string | null>(() => {
    if (typeof window === "undefined" || !shareId) return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY_PREFIX + shareId);
    } catch {
      return null;
    }
  });
  const [pwError, setPwError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const { session, isLoading: sessionLoading } = useSession();
  const [signInIntent, setSignInIntent] = useState<"comment" | "react" | null>(
    null,
  );
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const requireSignIn = useCallback(
    (intent: "comment" | "react") => setSignInIntent(intent),
    [],
  );
  const [downloading, setDownloading] = useState(false);
  const agentAccessToken = useMemo(() => {
    if (typeof window === "undefined") return "";
    return (
      new URLSearchParams(window.location.search).get(
        CLIPS_AGENT_ACCESS_PARAM,
      ) ?? ""
    );
  }, []);

  const dataQ = useQuery({
    queryKey: ["public-recording", shareId, password, agentAccessToken],
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
    enabled: !!shareId,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });

  const recording = dataQ.data?.data?.recording;
  const comments = dataQ.data?.data?.comments ?? [];
  const reactions = dataQ.data?.data?.reactions ?? [];
  const chapters = dataQ.data?.data?.chapters ?? [];
  const transcriptSegments = dataQ.data?.data?.transcript?.segments ?? [];
  const transcriptFullText = dataQ.data?.data?.transcript?.fullText ?? null;
  const transcriptStatus = dataQ.data?.data?.transcript?.status;
  const transcriptFailureReason =
    dataQ.data?.data?.transcript?.failureReason ?? null;
  const ctas = dataQ.data?.data?.ctas ?? [];
  const firstCta = ctas[0] ?? null;
  const viewerCanEdit = Boolean(dataQ.data?.data?.viewer?.canEdit);
  const viewerIsOwner = Boolean(dataQ.data?.data?.viewer?.isOwner);
  const showTitleSkeleton = recording
    ? shouldShowGeneratedTitleSkeleton(recording, transcriptStatus)
    : false;
  const visibleTitle = recording
    ? displayRecordingTitle(recording.title)
    : t("sharePage.untitledClip");
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const unlockedAgentContextUrl =
    typeof dataQ.data?.data?.agentContextUrl === "string"
      ? dataQ.data.data.agentContextUrl
      : null;
  const agentDiscovery = (
    <AgentDiscovery
      recording={recording ?? loaderData.recording}
      agentContextUrl={unlockedAgentContextUrl ?? loaderData.agentContextUrl}
    />
  );

  useEffect(() => {
    if (!recording) return;
    document.title = clipsSharePageTitle(recording.title);
  }, [recording?.title]);

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

    const timeoutMs =
      recording.status === "processing"
        ? PROCESSING_STUCK_TIMEOUT_MS
        : UPLOAD_STUCK_TIMEOUT_MS;
    const handle = setTimeout(() => setProcessingTimeout(true), timeoutMs);
    return () => clearTimeout(handle);
  }, [recording?.id, recording?.status, recording?.videoUrl]);

  usePlayerShortcuts({ playerRef });

  const tracking = useViewTracking({
    recordingId: shareId ?? "",
    videoRef: {
      get current() {
        return playerRef.current?.video ?? null;
      },
    } as any,
    durationMs: recording?.durationMs ?? 0,
    trackOpenWithoutVideo: isLoomEmbedBacked,
  });

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
  }, [needsPassword, password, shareId]);

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
    try {
      const res = await fetch(recording.videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(recording.title || "clip")}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(recording.videoUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  if (dataQ.isLoading) {
    return (
      <>
        {agentDiscovery}
        <div className="flex items-center justify-center h-screen w-full bg-background">
          <Spinner className="h-8 w-8 text-muted-foreground" />
        </div>
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

  if (dataQ.data?.status === 401 || dataQ.data?.status === 404) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title={t("sharePage.clipUnavailable")}
          message={t("sharePage.clipUnavailableMessage")}
          action={
            shareId ? (
              <Button asChild size="sm">
                <a href={buildSignInHref(`/r/${shareId}`)} className="gap-1.5">
                  <IconLogin2 className="h-4 w-4 rtl:-scale-x-100" />
                  {t("sharePage.signIn")}
                </a>
              </Button>
            ) : null
          }
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
    const stuckFailure = !explicitFailure && processingTimeout;
    const isFailure = explicitFailure || storageSetupFailure || stuckFailure;
    const canManageStorage = viewerCanEdit;
    const signInHref = buildSignInHref(`/r/${recording.id}`);
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
            ) : canManageStorage && isFailure ? (
              <Button asChild size="sm">
                <a href={appPath(`/r/${recording.id}`)}>
                  {t("sharePage.openDashboard")}
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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:flex-row lg:overflow-hidden">
      {agentDiscovery}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:flex-nowrap">
          {session ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              aria-label={t("sharePage.backToHome")}
            >
              <IconArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            {showTitleSkeleton ? (
              <Skeleton
                aria-label={t("sharePage.generatingTitle")}
                className="h-4 w-56 max-w-full"
              />
            ) : (
              <h1 className="truncate text-sm font-medium">{visibleTitle}</h1>
            )}
          </div>

          <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
            {viewerCanEdit ? (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={appPath(`/r/${recording.id}`)}
                  className="min-w-0 gap-1.5"
                >
                  <span className="truncate">
                    {t("sharePage.openDashboard")}
                  </span>
                  <IconExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </Button>
            ) : session ? null : (
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={appPath("/")}
                  className="gap-1.5"
                  onClick={() => fireShareCtaClick("try_clips")}
                >
                  {t("sharePage.tryClips")}
                  <IconExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            {!viewerCanEdit && canDownloadRecording ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 shrink-0 px-0"
                    aria-label={t("sharePage.clipOptions")}
                  >
                    <IconDots className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onSelect={() => {
                      void downloadRecording();
                    }}
                    disabled={downloading}
                  >
                    <IconDownload className="h-4 w-4" />
                    {downloading
                      ? t("sharePage.downloading")
                      : t("sharePage.downloadMp4")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {viewerIsOwner ? (
              <RecordingOptionsMenu
                recordingId={recording.id}
                canDelete
                canDownload={canDownloadRecording}
                downloadPending={downloading}
                downloadLabel={t("sharePage.downloadMp4")}
                downloadingLabel={t("sharePage.downloading")}
                onDownload={() => {
                  void downloadRecording();
                }}
                onDeleted={() => navigate("/library", { replace: true })}
              />
            ) : null}
            {viewerCanEdit ? (
              <ShareRecordingPopover
                recordingId={recording.id}
                recordingTitle={recording.title}
                videoUrl={recording.videoUrl}
                animatedThumbnailUrl={recording.animatedThumbnailUrl}
                isLoomRecording={isLoomEmbedBacked}
                hasPassword={Boolean(recording.hasPassword)}
              >
                <Button size="sm" className="shrink-0 gap-1.5">
                  <IconShare3 className="h-4 w-4" />
                  {t("sharePage.share")}
                </Button>
              </ShareRecordingPopover>
            ) : null}
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-visible p-4 lg:min-h-0 lg:overflow-hidden">
          <div className="min-h-[240px] flex-1 lg:min-h-0">
            <VideoPlayer
              ref={playerRef}
              recordingId={recording.id}
              videoUrl={recording.videoUrl}
              embedProvider={isLoomEmbedBacked ? "loom" : null}
              durationMs={recording.durationMs}
              editsJson={recording.editsJson}
              thumbnailUrl={recording.thumbnailUrl}
              role={viewerCanEdit ? "owner" : "viewer"}
              defaultSpeed={parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2}
              comments={comments}
              chapters={chapters}
              reactions={reactions}
              transcriptSegments={transcriptSegments}
              cta={firstCta}
              onCtaClick={() => tracking.reportCtaClick()}
              onTimeUpdate={(ms) => setCurrentMs(ms)}
              className="h-full w-full"
            />
          </div>

          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              {showTitleSkeleton ? (
                <Skeleton
                  aria-label={t("sharePage.generatingTitle")}
                  className="h-5 w-72 max-w-full"
                />
              ) : (
                <h2 className="break-words text-base font-semibold leading-tight">
                  {visibleTitle}
                </h2>
              )}
              {recording.description ? (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {recording.description}
                </p>
              ) : null}
            </div>
            <div className="flex max-w-full flex-col items-stretch gap-2 sm:items-end">
              {recording.enableReactions ? (
                <ReactionsTray
                  onReact={(emoji) => {
                    if (!session) {
                      requireSignIn("react");
                      return;
                    }
                    tracking.reportReaction(emoji);
                    const liveCt = isLoomEmbedBacked
                      ? null
                      : playerRef.current?.video?.currentTime;
                    const liveMs =
                      typeof liveCt === "number" &&
                      Number.isFinite(liveCt) &&
                      liveCt >= 0 &&
                      liveCt < 1e7
                        ? Math.floor(liveCt * 1000)
                        : currentMs;
                    fetch(
                      agentNativePath(
                        "/_agent-native/actions/react-to-recording",
                      ),
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
                      .then(() => dataQ.refetch())
                      .catch(() => {});
                  }}
                />
              ) : null}
              {viewerCanEdit && canDownloadRecording ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadRecording}
                  disabled={downloading}
                  className="gap-1.5"
                >
                  <IconDownload className="h-4 w-4" />
                  {downloading
                    ? t("sharePage.downloading")
                    : t("sharePage.downloadMp4")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <aside className="flex min-h-[420px] w-full shrink-0 flex-col border-t border-border bg-background lg:min-h-0 lg:w-[380px] lg:border-s lg:border-t-0">
        <Tabs defaultValue="agent" className="flex h-full flex-col">
          <TabsList className="mx-3 mt-3 grid w-auto grid-cols-4">
            <TabsTrigger value="agent" className="text-xs">
              {t("sharePage.agent")}
            </TabsTrigger>
            <TabsTrigger value="comments" className="text-xs gap-1">
              {t("sharePage.comments")}
              {comments.length > 0 ? (
                <span className="ms-0.5 rounded-full bg-accent px-1.5 text-[10px] tabular-nums">
                  {comments.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="transcript" className="text-xs">
              {t("sharePage.transcript")}
            </TabsTrigger>
            <TabsTrigger value="insights" className="text-xs">
              {t("sharePage.insights")}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="agent"
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {sessionLoading ? null : session ? (
              <AgentPanel
                emptyStateText={t("recordingPage.askAboutClip")}
                dynamicSuggestions={false}
                suggestions={[
                  t("recordingPage.summarizeClip"),
                  t("recordingPage.findKeyMoments"),
                  t("recordingPage.listFollowUpActions"),
                  t("recordingPage.draftQuestions"),
                ]}
                browserTabId={getBrowserTabId()}
              />
            ) : (
              <PublicAgentEmptyState
                signupHref={signupHref}
                onCtaClick={fireShareCtaClick}
              />
            )}
          </TabsContent>
          <TabsContent
            value="transcript"
            className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <TranscriptPanel
              segments={transcriptSegments}
              fullText={transcriptFullText}
              durationMs={recording.durationMs}
              currentMs={currentMs}
              onSeek={(ms) => playerRef.current?.seek(ms)}
              status={transcriptStatus}
              failureReason={transcriptFailureReason}
              recordingTitle={recording.title}
            />
          </TabsContent>
          <TabsContent
            value="comments"
            className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <CommentsPanel
              recordingId={recording.id}
              comments={comments}
              currentMs={currentMs}
              currentUserEmail={session?.email}
              enableComments={recording.enableComments}
              onSeek={(ms) => playerRef.current?.seek(ms)}
              onUnauthenticated={requireSignIn}
              queryKey={["public-recording", shareId, password]}
              selectComments={(d: any) => d?.data?.comments}
              applyComments={(d: any, next) =>
                d ? { ...d, data: { ...(d.data ?? {}), comments: next } } : d
              }
              presentation="share"
            />
          </TabsContent>
          <TabsContent
            value="insights"
            className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <PublicInsightsState />
          </TabsContent>
        </Tabs>
      </aside>

      <SignInPromptDialog
        open={signInIntent !== null}
        onOpenChange={(open) => {
          if (!open) setSignInIntent(null);
        }}
        intent={signInIntent ?? "comment"}
        onSignIn={() => fireShareCtaClick("signin")}
      />
    </div>
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

function PublicAgentEmptyState({
  signupHref,
  onCtaClick,
}: {
  signupHref: string;
  onCtaClick: (cta: "signup" | "download" | "try_clips" | "signin") => void;
}) {
  const t = useT();
  const [platform, setPlatform] = useState<ViewerPlatform | null>(null);

  useEffect(() => {
    setPlatform(detectViewerPlatform());
  }, []);

  const downloadLabel =
    platform === "mac"
      ? t("sharePage.downloadForMac")
      : platform === "windows"
        ? t("sharePage.downloadForWindows")
        : t("sharePage.downloadDesktopApp");

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-6 flex flex-col items-center gap-3">
        <img
          src={appPath("/agent-native-icon-light.svg")}
          alt="Agent-Native"
          className="block h-8 w-auto dark:hidden"
        />
        <img
          src={appPath("/agent-native-icon-dark.svg")}
          alt="Agent-Native"
          className="hidden h-8 w-auto dark:block"
        />
      </div>
      <p className="max-w-[280px] text-sm leading-6 text-muted-foreground">
        <a
          href={CLIPS_TEMPLATE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {t("sharePage.agentNativeClips")}
        </a>{" "}
        {t("sharePage.agentNativeClipsIntro")}{" "}
        <a
          href={CLIPS_SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {t("sharePage.openSource")}
        </a>
        ,{" "}
        <a
          href={CLIPS_AGENT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {t("sharePage.agentFriendly")}
        </a>{" "}
        {t("sharePage.loomAlternative")}
      </p>
      <div className="mt-7 flex w-full max-w-[220px] flex-col gap-2">
        <CaptureInstallButton
          className="w-full gap-2"
          align="center"
          onClick={() => onCtaClick("download")}
        >
          <IconDownload className="h-4 w-4" />
          {downloadLabel}
        </CaptureInstallButton>
        <Button asChild variant="outline" className="w-full">
          <a href={signupHref} onClick={() => onCtaClick("signup")}>
            {t("sharePage.signUp")}
          </a>
        </Button>
      </div>
    </div>
  );
}

function PublicInsightsState() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <p className="text-sm font-medium text-foreground">
        {t("sharePage.ownerInsights")}
      </p>
      <p className="mt-2 max-w-[240px] text-sm leading-5 text-muted-foreground">
        {t("sharePage.ownerInsightsDescription")}
      </p>
    </div>
  );
}

function EndState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  const t = useT();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
      <h1 className="text-2xl font-semibold mb-2">{title}</h1>
      <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
        {message}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {action}
        <Button asChild variant="ghost" size="sm">
          <a href={appPath("/")}>{t("clipsFinalRaw.goHome")}</a>
        </Button>
      </div>
    </div>
  );
}
