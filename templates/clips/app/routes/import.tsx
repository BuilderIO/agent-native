import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowLeft, IconLink, IconUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type FormEvent } from "react";
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
  await fetch(
    agentNativePath("/_agent-native/application-state/navigate"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "recording", recordingId }),
    },
  ).catch(() => {});
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

  const [loomUrl, setLoomUrl] = useState("");
  const [loomImporting, setLoomImporting] = useState(false);
  const [loomError, setLoomError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const url = loomUrl.trim();
      if (!url || loomImporting) return;

      setLoomError(null);
      setLoomImporting(true);
      try {
        const result = (await callAction("import-loom-recording" as any, {
          url,
          spaceIds: spaceIdFromUrl ? [spaceIdFromUrl] : undefined,
          folderId: folderIdFromUrl ?? undefined,
        } as any)) as {
          recordingId?: string;
          status?: string;
          storageSetupRequired?: boolean;
        };
        const recordingId = result?.recordingId;
        if (!recordingId) {
          throw new Error("Loom import did not return a recording id.");
        }

        if (
          result?.storageSetupRequired ||
          result?.status === "waiting_storage"
        ) {
          toast.info(t("recordRoute.storageNeededToFinishLoomImport"), {
            description: t("recordRoute.connectStorageToRetryLoom"),
            duration: 12_000,
          });
        } else {
          await copyRecordingLink(recordingId);
          toast.success(t("recordRoute.loomImported"));
        }
        await writeNavigateAppState(recordingId);
        navigate(`/r/${recordingId}`);
      } catch (err) {
        setLoomError(
          err instanceof Error
            ? userFacingActionErrorMessage(err.message)
            : t("recordRoute.couldNotImportLoom"),
        );
      } finally {
        setLoomImporting(false);
      }
    },
    [folderIdFromUrl, loomImporting, loomUrl, navigate, spaceIdFromUrl, t],
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
        <div className="mb-6 flex items-center gap-2 text-primary">
          <IconLink className="h-6 w-6" />
          <span className="text-sm font-medium uppercase tracking-wide">
            {t("importRoute.title")}
          </span>
        </div>

        <div className="mx-auto w-full max-w-lg">
          {storageConfigured === null ? (
            <ImportPanelSkeleton />
          ) : storageConfigured ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              <div className="p-6">
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-3"
                >
                  <Input
                    autoFocus
                    value={loomUrl}
                    onChange={(event) => {
                      setLoomUrl(event.target.value);
                      setLoomError(null);
                    }}
                    disabled={loomImporting}
                    placeholder={t("importRoute.urlPlaceholder")}
                    className="h-12 text-base"
                    inputMode="url"
                  />
                  <Button
                    type="submit"
                    className="h-12 w-full gap-2"
                    disabled={loomImporting || !loomUrl.trim()}
                  >
                    <IconLink className="h-4 w-4" />
                    {loomImporting
                      ? t("preRecord.importing")
                      : t("importRoute.cta")}
                  </Button>
                  {loomError ? (
                    <p className="text-xs leading-relaxed text-destructive">
                      {loomError}
                    </p>
                  ) : null}
                </form>
              </div>

              <div className="flex items-center justify-center border-t border-border px-6 py-4">
                <Link
                  to={recordHref}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <IconUpload className="h-3.5 w-3.5" />
                  {t("preRecord.uploadVideo")}
                </Link>
              </div>
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
