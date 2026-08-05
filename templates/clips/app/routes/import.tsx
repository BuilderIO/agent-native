import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconCheck,
  IconLink,
  IconSparkles,
  IconUpload,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  VIDEO_STORAGE_STATUS_KEY,
  useVideoStorageStatus,
  type VideoStorageStatus,
} from "@/hooks/use-video-storage-status";
import enMessages from "@/i18n/en-US";
import { cn } from "@/lib/utils";

type ImportPhase = "form" | "importing" | "done" | "leaving";

export function meta() {
  return [{ title: enMessages.importRoute.pageTitle }];
}

function recordingLink(recordingId: string): string {
  const path = `${appBasePath()}/r/${encodeURIComponent(recordingId)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

async function copyRecordingLink(recordingId: string): Promise<void> {
  if (typeof navigator === "undefined") return;
  if (!navigator.clipboard?.writeText) return;
  await navigator.clipboard
    .writeText(recordingLink(recordingId))
    .catch(() => undefined);
}

async function writeNavigateAppState(recordingId: string): Promise<void> {
  await fetch(agentNativePath("/_agent-native/application-state/navigate"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ view: "recording", recordingId }),
  }).catch(() => {});
}

function userFacingActionErrorMessage(error: string): string {
  return error.replace(/^Action [a-z0-9-]+ failed:\s*/i, "").trim() || error;
}

function ImportPanelSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-lg">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="mt-3 h-12 w-full rounded-lg" />
    </div>
  );
}

export default function ImportRoute() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const storageQuery = useVideoStorageStatus();
  const storageConfigured: boolean | null = storageQuery.isLoading
    ? null
    : !!storageQuery.data?.configured;

  const spaceIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("spaceId") || null;
  }, [location.search]);
  const folderIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("folderId") || null;
  }, [location.search]);

  const recordHref = useMemo(() => {
    const params = new URLSearchParams();
    if (spaceIdFromUrl) params.set("spaceId", spaceIdFromUrl);
    if (folderIdFromUrl) params.set("folderId", folderIdFromUrl);
    const qs = params.toString();
    return qs ? `/record?${qs}` : "/record";
  }, [spaceIdFromUrl, folderIdFromUrl]);

  const uploadHref = useMemo(() => {
    const params = new URLSearchParams();
    if (spaceIdFromUrl) params.set("spaceId", spaceIdFromUrl);
    if (folderIdFromUrl) params.set("folderId", folderIdFromUrl);
    params.set("autoUpload", "1");
    return `/record?${params.toString()}`;
  }, [spaceIdFromUrl, folderIdFromUrl]);

  const [loomUrl, setLoomUrl] = useState("");
  const [phase, setPhase] = useState<ImportPhase>("form");
  const [loomError, setLoomError] = useState<string | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const busy = phase !== "form";

  const importStages = useMemo(
    () => [
      t("importRoute.stageFetching"),
      t("importRoute.stageUploading"),
      t("importRoute.stageTranscript"),
      t("importRoute.stageFinalizing"),
    ],
    [t],
  );

  const benefits = useMemo(
    () => [
      t("importRoute.benefitTranscript"),
      t("importRoute.benefitQueryable"),
      t("importRoute.benefitSummaries"),
      t("importRoute.benefitPrimitive"),
    ],
    [t],
  );

  const clearTimers = useCallback(() => {
    if (stageTimerRef.current) clearInterval(stageTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    stageTimerRef.current = null;
    progressTimerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      timeoutsRef.current.forEach((id) => clearTimeout(id));
    };
  }, [clearTimers]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const url = loomUrl.trim();
      if (!url || busy) return;

      setLoomError(null);
      setPhase("importing");
      setStageIndex(0);
      setProgress(6);
      stageTimerRef.current = setInterval(() => {
        setStageIndex((prev) => Math.min(prev + 1, importStages.length - 1));
      }, 1300);
      // Ease the accent bar toward ~92% while the request is in flight; the
      // real completion snaps it to 100%.
      progressTimerRef.current = setInterval(() => {
        setProgress((p) => (p >= 92 ? p : p + Math.max(0.6, (92 - p) * 0.07)));
      }, 120);

      try {
        const result = (await callAction(
          "import-loom-recording" as any,
          {
            url,
            spaceIds: spaceIdFromUrl ? [spaceIdFromUrl] : undefined,
            folderId: folderIdFromUrl ?? undefined,
          } as any,
        )) as {
          recordingId?: string;
          status?: string;
          storageSetupRequired?: boolean;
        };
        const recordingId = result?.recordingId;
        if (!recordingId) {
          throw new Error("Loom import did not return a recording id.");
        }

        clearTimers();
        setStageIndex(importStages.length - 1);
        setProgress(100);

        if (
          result?.storageSetupRequired ||
          result?.status === "waiting_storage"
        ) {
          toast.info(t("recordRoute.storageNeededToFinishLoomImport"), {
            description: t("recordRoute.connectStorageToRetryLoom"),
            duration: 12_000,
          });
          await writeNavigateAppState(recordingId);
          navigate(`/r/${recordingId}`);
          return;
        }

        await copyRecordingLink(recordingId);
        await writeNavigateAppState(recordingId);

        // Linger on the "done" reveal, then fade out into the clip.
        setPhase("done");
        timeoutsRef.current.push(
          setTimeout(() => setPhase("leaving"), 1900),
          setTimeout(() => navigate(`/r/${recordingId}`), 2300),
        );
      } catch (err) {
        clearTimers();
        setProgress(0);
        setPhase("form");
        setLoomError(
          err instanceof Error
            ? userFacingActionErrorMessage(err.message)
            : t("recordRoute.couldNotImportLoom"),
        );
      }
    },
    [
      busy,
      clearTimers,
      folderIdFromUrl,
      importStages.length,
      loomUrl,
      navigate,
      spaceIdFromUrl,
      t,
    ],
  );

  const markStorageConfigured = useCallback(() => {
    queryClient.setQueryData<VideoStorageStatus>(
      VIDEO_STORAGE_STATUS_KEY,
      (prev) => ({
        configured: true,
        activeProvider: prev?.activeProvider ?? null,
        builderConfigured: prev?.builderConfigured ?? false,
      }),
    );
  }, [queryClient]);

  return (
    <div className="relative min-h-screen bg-background">
      <button
        type="button"
        aria-label={t("recordRoute.backToLibrary")}
        onClick={() => navigate("/library")}
        className="fixed start-4 top-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
      </button>

      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <IconLink className="h-6 w-6" />
          <span className="text-sm font-medium uppercase tracking-wide">
            {t("importRoute.title")}
          </span>
        </div>
        <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
          {t("importRoute.helperText")}
        </p>

        <div className="mx-auto w-full max-w-lg">
          {storageConfigured === null ? (
            <ImportPanelSkeleton />
          ) : storageConfigured ? (
            <div
              className={cn(
                "overflow-hidden rounded-2xl border border-border bg-card shadow-lg transition-opacity duration-300",
                phase === "leaving" && "opacity-0",
              )}
            >
              {busy ? (
                <div className="h-1 w-full overflow-hidden bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              ) : null}
              <div className="p-6">
                {phase === "importing" ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <IconSparkles className="h-6 w-6 animate-pulse text-primary" />
                    <p
                      key={stageIndex}
                      className="text-base font-semibold text-foreground"
                      style={{ animation: "clips-benefit-in 260ms ease-out" }}
                    >
                      {importStages[stageIndex]}
                    </p>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      {t("importRoute.importingSubtitle")}
                    </p>
                  </div>
                ) : phase === "done" || phase === "leaving" ? (
                  <div className="flex flex-col items-center gap-4 py-6 text-center">
                    <div className="flex items-center gap-2 text-primary">
                      <IconSparkles className="h-6 w-6" />
                      <p className="text-base font-semibold text-foreground">
                        {t("importRoute.doneHeading")}
                      </p>
                    </div>
                    <ul className="flex flex-col items-start gap-2 text-start">
                      {benefits.map((benefit, index) => (
                        <li
                          key={benefit}
                          className="flex items-center gap-2 text-sm font-medium text-foreground"
                          style={{
                            animation: "clips-benefit-in 220ms ease-out both",
                            animationDelay: `${index * 110}ms`,
                          }}
                        >
                          <IconCheck className="h-4 w-4 shrink-0 text-primary" />
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <Input
                      autoFocus
                      value={loomUrl}
                      onChange={(event) => {
                        setLoomUrl(event.target.value);
                        setLoomError(null);
                      }}
                      placeholder={t("importRoute.urlPlaceholder")}
                      className="h-12 text-base"
                      inputMode="url"
                    />
                    <Button
                      type="submit"
                      className="h-12 w-full gap-2"
                      disabled={!loomUrl.trim()}
                    >
                      <IconLink className="h-4 w-4" />
                      {t("importRoute.cta")}
                    </Button>
                    {loomError ? (
                      <p className="text-xs leading-relaxed text-destructive">
                        {loomError}
                      </p>
                    ) : null}
                  </form>
                )}
              </div>

              {!busy ? (
                <div className="flex items-center justify-center gap-4 border-t border-border px-6 py-4">
                  <Link
                    to={uploadHref}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <IconUpload className="h-3.5 w-3.5" />
                    {t("preRecord.uploadVideo")}
                  </Link>
                  <Link
                    to={recordHref}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {t("preRecord.recordNew")}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <StorageSetupCard
              onConfigured={markStorageConfigured}
              connectSource="clips_import_storage_setup_card"
              connectFlow="import"
            />
          )}
        </div>
      </div>
    </div>
  );
}
