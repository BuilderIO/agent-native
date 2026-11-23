import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconCopy,
  IconKey,
  IconLink,
  IconLock,
} from "@tabler/icons-react";
import { QueryClientContext } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { appEmbedHref, appEmbedIframeSnippet } from "@/lib/cell-link";

import type {
  PresignedEmbedUrl,
  ProjectEmbeddingSettings,
} from "../../../shared/app-embedding";

export function AppEmbeddingSection({
  projectId,
  publishedHint,
}: {
  projectId: string;
  publishedHint?: boolean;
}) {
  const t = useT();
  const queryClient = useContext(QueryClientContext);
  const [expanded, setExpanded] = useState(false);
  const [presigned, setPresigned] = useState<PresignedEmbedUrl | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const query = useActionQuery<ProjectEmbeddingSettings>(
    "get-project-embedding",
    { projectId },
    { enabled: expanded, retry: false },
  );
  const setEmbedding = useActionMutation<
    ProjectEmbeddingSettings,
    { projectId: string; allowEmbedding: boolean }
  >("set-project-embedding");
  const createPresigned = useActionMutation<
    PresignedEmbedUrl,
    {
      projectId: string;
      expiresInSeconds: number;
      userAttributes: Record<string, string | number | boolean | null>;
    }
  >("create-presigned-embed-url");

  const settings = query.data;
  const isPublished = settings?.published ?? publishedHint ?? false;
  const allowEmbedding = settings?.allowEmbedding ?? false;
  const canManage = settings?.canManageEmbedding ?? false;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const locationLike =
    typeof window === "undefined"
      ? { origin: "", pathname: "" }
      : window.location;
  const standardEmbedUrl = appEmbedHref(locationLike, {
    projectId,
    appHref: settings?.appHref,
  });
  const standardIframeSnippet = appEmbedIframeSnippet(standardEmbedUrl);
  const signedApiFullUrl = settings
    ? `${origin}${settings.signedEmbedActionPath}`
    : "";
  const presignedFullUrl = presigned ? `${origin}${presigned.embedPath}` : "";
  const presignedIframeSnippet = presignedFullUrl
    ? appEmbedIframeSnippet(presignedFullUrl)
    : "";

  async function copyText(text: string, successKey: string) {
    try {
      await writeClipboardText(text);
      toast.success(t(successKey));
    } catch {
      toast.error(t("appEmbedding.copyFailed"));
    }
  }

  async function toggleSignedEmbedding(next: boolean) {
    if (!canManage || setEmbedding.isPending) return;
    setErrorMessage(null);
    try {
      await setEmbedding.mutateAsync({
        projectId,
        allowEmbedding: next,
      });
      if (!next) setPresigned(null);
      toast.success(
        t(
          next
            ? "appEmbedding.signedEmbeddingEnabled"
            : "appEmbedding.signedEmbeddingDisabled",
        ),
      );
      await query.refetch();
      await queryClient?.invalidateQueries({ queryKey: ["action"] });
    } catch {
      setErrorMessage(t("appEmbedding.updateFailed"));
    }
  }

  async function handleGeneratePresignedUrl() {
    if (!allowEmbedding || !isPublished || createPresigned.isPending) return;
    setErrorMessage(null);
    try {
      const created = await createPresigned.mutateAsync({
        projectId,
        expiresInSeconds: 3600,
        userAttributes: {},
      });
      setPresigned(created);
      toast.success(t("appEmbedding.signedUrlGenerated"));
    } catch {
      setErrorMessage(t("appEmbedding.signedUrlFailed"));
    }
  }

  const standardCopyDisabled = !isPublished || allowEmbedding;

  return (
    <div className="border-t border-border/70 px-3 py-2 text-xs">
      <button
        type="button"
        data-testid="share-embedding-options"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between gap-2 rounded py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <IconCode size={14} aria-hidden />
          {t("appEmbedding.options")}
        </span>
        {expanded ? (
          <IconChevronUp size={14} aria-hidden />
        ) : (
          <IconChevronDown size={14} aria-hidden />
        )}
      </button>
      {expanded ? (
        <div className="mt-2 space-y-3 pb-1">
          {query.isPending ? (
            <p className="text-muted-foreground" role="status">
              {t("appEmbedding.loading")}
            </p>
          ) : query.isError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-destructive" role="alert">
                {t("appEmbedding.loadFailed")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                {t("appEmbedding.retry")}
              </Button>
            </div>
          ) : (
            <>
              {!isPublished ? (
                <p
                  className="rounded border border-border/70 bg-muted/50 px-2.5 py-2 text-muted-foreground"
                  role="status"
                >
                  {t("appEmbedding.unpublishedNotice")}
                </p>
              ) : null}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {t("appEmbedding.embedCode")}
                  </span>
                </div>
                {allowEmbedding ? (
                  <p className="text-muted-foreground">
                    {t("appEmbedding.signedEmbedCodeHint")}
                  </p>
                ) : null}
                <Input
                  readOnly
                  aria-label={t("appEmbedding.embedCode")}
                  value={standardIframeSnippet}
                  disabled={standardCopyDisabled}
                  className="h-8 font-mono text-[11px]"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={standardCopyDisabled}
                    onClick={() =>
                      void copyText(
                        standardIframeSnippet,
                        "appEmbedding.embedCodeCopied",
                      )
                    }
                  >
                    <IconCopy size={13} aria-hidden />
                    {t("appEmbedding.copyEmbedCode")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={standardCopyDisabled}
                    onClick={() =>
                      void copyText(
                        standardEmbedUrl,
                        "appEmbedding.embeddableLinkCopied",
                      )
                    }
                  >
                    <IconLink size={13} aria-hidden />
                    {t("appEmbedding.copyEmbeddableLink")}
                  </Button>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-2.5">
                <div className="min-w-0 space-y-0.5">
                  <label
                    htmlFor={`signed-embed-toggle-${projectId}`}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground"
                  >
                    <IconLock size={13} aria-hidden />
                    {t("appEmbedding.allowSignedEmbedding")}
                  </label>
                  <p className="text-muted-foreground">
                    {t("appEmbedding.allowSignedEmbeddingDescription")}
                  </p>
                </div>
                <Switch
                  id={`signed-embed-toggle-${projectId}`}
                  data-testid="share-signed-embedding-toggle"
                  checked={allowEmbedding}
                  disabled={!canManage || setEmbedding.isPending}
                  onCheckedChange={(checked) =>
                    void toggleSignedEmbedding(Boolean(checked))
                  }
                />
              </div>

              {allowEmbedding ? (
                <div className="space-y-2 rounded border border-border/70 bg-muted/30 p-2.5">
                  <div className="space-y-1">
                    <span className="font-medium text-foreground">
                      {t("appEmbedding.signedApiUrl")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        readOnly
                        aria-label={t("appEmbedding.signedApiUrl")}
                        value={signedApiFullUrl}
                        className="h-8 font-mono text-[11px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="copy-signed-embed-api-url"
                        onClick={() =>
                          void copyText(
                            signedApiFullUrl,
                            "appEmbedding.apiUrlCopied",
                          )
                        }
                      >
                        <IconCopy size={13} aria-hidden />
                        {t("appEmbedding.copyApiUrl")}
                      </Button>
                    </div>
                  </div>

                  {canManage ? (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid="generate-presigned-embed-url"
                        disabled={!isPublished || createPresigned.isPending}
                        onClick={() => void handleGeneratePresignedUrl()}
                      >
                        <IconKey size={13} aria-hidden />
                        {t(
                          createPresigned.isPending
                            ? "appEmbedding.generatingSignedUrl"
                            : "appEmbedding.generateSignedUrl",
                        )}
                      </Button>
                      {presigned ? (
                        <div className="space-y-1.5">
                          <Input
                            readOnly
                            aria-label={t("appEmbedding.presignedLinkLabel")}
                            value={presignedFullUrl}
                            className="h-8 font-mono text-[11px]"
                          />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void copyText(
                                  presignedFullUrl,
                                  "appEmbedding.embeddableLinkCopied",
                                )
                              }
                            >
                              <IconLink size={13} aria-hidden />
                              {t("appEmbedding.copyEmbeddableLink")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void copyText(
                                  presignedIframeSnippet,
                                  "appEmbedding.embedCodeCopied",
                                )
                              }
                            >
                              <IconCopy size={13} aria-hidden />
                              {t("appEmbedding.copyEmbedCode")}
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {t("appEmbedding.expiresAt", {
                              time: presigned.expiresAt,
                            })}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {errorMessage ? (
                <p className="text-destructive" role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
