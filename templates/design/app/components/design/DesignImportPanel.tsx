import {
  useActionMutation,
  useFormatters,
  useT,
} from "@agent-native/core/client";
import { parseFigmaFileKey } from "@shared/figma-url";
import {
  IconBrandFigma,
  IconBrandGithub,
  IconChevronRight,
  IconCircleCheck,
  IconCode,
  IconCopy,
  IconHtml,
  IconUpload,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  uploadDesignFile,
  validateFigUploadFile,
} from "@/lib/design-file-upload";
import {
  importResultNotification,
  looksLikeStandaloneHtml,
  VISUAL_EDIT_CONNECT_COMMAND,
  VISUAL_EDIT_INSTALL_COMMAND,
  type ImportResult,
} from "@/lib/design-import";
import {
  getFigmaConnectionStatus,
  saveFigmaAccessToken,
} from "@/lib/figma-connection";
import { cn } from "@/lib/utils";

import type { DesignExtensionSlotContext } from "./DesignExtensionsPanel";

interface DesignImportPanelProps {
  context: Pick<DesignExtensionSlotContext, "designId" | "viewMode">;
}

type ImportMode =
  | "figma-url"
  | "figma-paste"
  | "fig-upload"
  | "html"
  | "local-app";

export function DesignImportPanel({ context }: DesignImportPanelProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const importSource = useActionMutation("import-design-source");
  const importFigmaFrame = useActionMutation("import-figma-frame");
  const figFileInputRef = useRef<HTMLInputElement | null>(null);
  const htmlFileInputRef = useRef<HTMLInputElement | null>(null);
  const [figmaUrl, setFigmaUrl] = useState("");
  const [figmaAccessToken, setFigmaAccessToken] = useState("");
  const [figmaConnectionChecked, setFigmaConnectionChecked] = useState(false);
  const [figmaConnected, setFigmaConnected] = useState(false);
  const [figmaConnectionLast4, setFigmaConnectionLast4] = useState<
    string | null
  >(null);
  const [figmaConnectionDocsUrl, setFigmaConnectionDocsUrl] = useState<
    string | null
  >(null);
  const [figmaConnectionError, setFigmaConnectionError] = useState<
    string | null
  >(null);
  const [figmaConnectionBusy, setFigmaConnectionBusy] = useState(false);
  const [htmlText, setHtmlText] = useState("");
  const [activeMode, setActiveMode] = useState<ImportMode | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [figUploadName, setFigUploadName] = useState<string | null>(null);
  const [figUploadProgress, setFigUploadProgress] = useState<number | null>(
    null,
  );
  const [figUploadBusy, setFigUploadBusy] = useState(false);

  const finishImport = useCallback(
    async (result: ImportResult | undefined, fallback: string) => {
      if (result?.error) throw new Error(result.error);
      setLastResult(result ?? null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] }),
        queryClient.invalidateQueries({ queryKey: ["action"] }),
      ]);
      const fidelityWarnings: string[] = [];
      const imageFallbackCount = result?.fidelityReport?.imageFallbacks.length;
      if (imageFallbackCount) {
        fidelityWarnings.push(
          t("designEditor.import.figmaImageFallbackWarning", {
            count: formatNumber(imageFallbackCount),
          }),
        );
      }
      const approximatedCount = result?.fidelityReport?.approximated.length;
      if (approximatedCount) {
        fidelityWarnings.push(
          t("designEditor.import.figmaApproximationWarning", {
            count: formatNumber(approximatedCount),
          }),
        );
      }
      const notification = importResultNotification(result, fallback, {
        fidelityWarnings,
      });
      if (notification.variant === "warning") {
        toast.warning(notification.title, {
          description: notification.description,
        });
      } else {
        toast.success(notification.title);
      }
      navigate(`/design/${result?.designId ?? context.designId}?view=overview`);
    },
    [context.designId, formatNumber, navigate, queryClient, t],
  );

  const importHtmlString = useCallback(
    (content: string, originalName?: string) => {
      if (!looksLikeStandaloneHtml(content)) {
        toast.error(t("designEditor.import.errors.notHtml"));
        return;
      }
      importSource.mutate(
        {
          designId: context.designId,
          sourceType: "html-string",
          content,
          originalName,
        },
        {
          onSuccess: (result: unknown) => {
            void finishImport(
              result as ImportResult,
              t("designEditor.import.htmlSuccess"),
            );
          },
          onError: (error: unknown) => {
            toast.error(t("designEditor.import.errors.importFailed"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("common.genericError"),
            });
          },
        },
      );
    },
    [context.designId, finishImport, importSource, t],
  );

  const checkFigmaConnection = useCallback(async () => {
    setFigmaConnectionBusy(true);
    setFigmaConnectionError(null);
    try {
      const status = await getFigmaConnectionStatus();
      setFigmaConnected(status.connected);
      setFigmaConnectionLast4(status.last4 ?? null);
      setFigmaConnectionDocsUrl(status.docsUrl ?? null);
    } catch (error) {
      setFigmaConnected(false);
      setFigmaConnectionError(
        error instanceof Error ? error.message : t("common.genericError"),
      );
    } finally {
      setFigmaConnectionChecked(true);
      setFigmaConnectionBusy(false);
    }
  }, [t]);

  const openFigmaUrlImport = useCallback(() => {
    if (activeMode === "figma-url") {
      setFigmaAccessToken("");
      setActiveMode(null);
      return;
    }
    setActiveMode("figma-url");
    if (!figmaConnectionChecked) void checkFigmaConnection();
  }, [activeMode, checkFigmaConnection, figmaConnectionChecked]);

  const figmaTokenRequired =
    figmaConnectionChecked && !figmaConnected && !figmaConnectionError;

  const handleFigmaUrlImport = useCallback(async () => {
    const normalizedUrl = figmaUrl.trim();
    if (!normalizedUrl) {
      toast.error(t("designEditor.import.errors.figmaUrlRequired"));
      return;
    }
    if (!parseFigmaFileKey(normalizedUrl)) {
      toast.error(t("designEditor.import.errors.invalidFigmaUrl"));
      return;
    }

    setFigmaConnectionBusy(true);
    try {
      if (figmaTokenRequired) {
        const status = await saveFigmaAccessToken(figmaAccessToken);
        setFigmaConnected(status.connected);
        setFigmaConnectionChecked(true);
        setFigmaConnectionLast4(status.last4 ?? null);
        setFigmaConnectionDocsUrl(status.docsUrl ?? null);
        setFigmaConnectionError(null);
        setFigmaAccessToken("");
      }

      const result = (await importFigmaFrame.mutateAsync({
        figmaUrl: normalizedUrl,
        designId: context.designId,
        asNewScreen: true,
      })) as ImportResult;
      await finishImport(result, t("designEditor.import.figmaUrlSuccess"));
    } catch (error) {
      // A rejected credential should not linger in component state or the DOM.
      setFigmaAccessToken("");
      toast.error(t("designEditor.import.errors.figmaImportFailed"), {
        description:
          error instanceof Error ? error.message : t("common.genericError"),
      });
    } finally {
      setFigmaConnectionBusy(false);
    }
  }, [
    context.designId,
    figmaAccessToken,
    figmaTokenRequired,
    figmaUrl,
    finishImport,
    importFigmaFrame,
    t,
  ]);

  const handleHtmlFileChange = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setActiveMode("html");
      try {
        importHtmlString(await file.text(), file.name);
      } finally {
        if (htmlFileInputRef.current) htmlFileInputRef.current.value = "";
      }
    },
    [importHtmlString],
  );

  const handleFigFileChange = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setActiveMode("fig-upload");
      const validationError = validateFigUploadFile(file);
      if (validationError === "invalid-extension") {
        toast.error(t("designEditor.import.errors.uploadFailed"), {
          description: t("designEditor.import.errors.invalidFigFile"),
        });
        if (figFileInputRef.current) figFileInputRef.current.value = "";
        return;
      }
      if (validationError === "too-large") {
        toast.error(t("designEditor.import.errors.uploadFailed"), {
          description: t("designEditor.import.errors.figFileTooLarge"),
        });
        if (figFileInputRef.current) figFileInputRef.current.value = "";
        return;
      }

      setFigUploadName(file.name);
      setFigUploadProgress(0);
      setFigUploadBusy(true);
      try {
        const result = await uploadDesignFile({
          designId: context.designId,
          file,
          fallbackErrorMessage: t("designEditor.import.errors.uploadFailed"),
          onProgress: ({ percent }) => setFigUploadProgress(percent),
        });
        await finishImport(result, t("designEditor.import.uploadSuccess"));
      } catch (error) {
        toast.error(t("designEditor.import.errors.uploadFailed"), {
          description:
            error instanceof Error ? error.message : t("common.genericError"),
        });
      } finally {
        setFigUploadBusy(false);
        setFigUploadName(null);
        setFigUploadProgress(null);
        if (figFileInputRef.current) figFileInputRef.current.value = "";
      }
    },
    [context.designId, finishImport, t],
  );

  const copyVisualEditCommand = useCallback(
    async (command: string) => {
      try {
        await navigator.clipboard.writeText(command);
        toast.success(t("designEditor.copied"));
      } catch {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
      }
    },
    [t],
  );

  const busy =
    importSource.isPending ||
    importFigmaFrame.isPending ||
    figUploadBusy ||
    figmaConnectionBusy;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-8 shrink-0 items-center border-b border-border/60 px-3">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {t("designEditor.import.title")}
        </h3>
      </div>

      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3">
        <div className="space-y-0.5">
          <ImportSourceRow
            id="figma-url-import"
            icon={<IconBrandFigma className="size-3.5" />}
            title={t("designEditor.import.figmaUrlTitle")}
            description={t("designEditor.import.figmaUrlDescription")}
            isOpen={activeMode === "figma-url"}
            onToggle={openFigmaUrlImport}
          >
            <form
              className="space-y-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleFigmaUrlImport();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="figma-frame-url" className="text-[11px]">
                  {t("designEditor.import.figmaUrlLabel")}
                </Label>
                <Input
                  id="figma-frame-url"
                  type="url"
                  value={figmaUrl}
                  onChange={(event) => setFigmaUrl(event.target.value)}
                  placeholder={t("designEditor.import.figmaUrlPlaceholder")}
                  autoComplete="url"
                  className="h-8 text-xs"
                />
              </div>

              {figmaConnectionBusy && !figmaConnectionChecked ? (
                <p
                  className="text-[10px] text-muted-foreground"
                  aria-live="polite"
                >
                  {t("designEditor.import.figmaConnectionChecking")}
                </p>
              ) : figmaConnected ? (
                <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
                  <IconCircleCheck className="size-3.5 shrink-0" />
                  <span>
                    {figmaConnectionLast4
                      ? t("designEditor.import.figmaConnectedWithSuffix", {
                          suffix: figmaConnectionLast4,
                        })
                      : t("designEditor.import.figmaConnected")}
                  </span>
                </div>
              ) : figmaTokenRequired ? (
                <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="figma-access-token" className="text-[11px]">
                      {t("designEditor.import.figmaTokenLabel")}
                    </Label>
                    {figmaConnectionDocsUrl ? (
                      <a
                        href={figmaConnectionDocsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-[10px] font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {t("designEditor.import.figmaTokenDocs")}
                      </a>
                    ) : null}
                  </div>
                  <Input
                    id="figma-access-token"
                    type="password"
                    value={figmaAccessToken}
                    onChange={(event) =>
                      setFigmaAccessToken(event.target.value)
                    }
                    placeholder={t("designEditor.import.figmaTokenPlaceholder")}
                    autoComplete="new-password"
                    aria-invalid={figmaConnectionError ? true : undefined}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {figmaConnectionError ??
                      t("designEditor.import.figmaTokenDescription")}
                  </p>
                </div>
              ) : figmaConnectionError ? (
                <p
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-destructive"
                  role="status"
                >
                  {figmaConnectionError}
                </p>
              ) : null}

              <Button
                type="submit"
                size="sm"
                className="h-8 w-full px-2"
                disabled={
                  busy ||
                  !figmaUrl.trim() ||
                  (figmaTokenRequired && !figmaAccessToken.trim())
                }
              >
                {figmaTokenRequired
                  ? t("designEditor.import.saveKeyAndImport")
                  : t("designEditor.import.importFigmaUrl")}
              </Button>
            </form>
          </ImportSourceRow>

          <ImportSourceRow
            id="figma-paste-import"
            icon={<IconBrandFigma className="size-3.5" />}
            title={t("designEditor.import.figmaPasteTitle")}
            description={
              "Copy a frame in Figma, then paste into the canvas." /* i18n-ignore */
            }
            isOpen={activeMode === "figma-paste"}
            onToggle={() =>
              setActiveMode((mode) =>
                mode === "figma-paste" ? null : "figma-paste",
              )
            }
          >
            <div className="space-y-1.5 p-2 text-[11px] leading-snug text-muted-foreground">
              <p>{t("designEditor.import.figmaPasteDescription")}</p>
              <p>
                {
                  "Click the canvas first, then paste with the same shortcut you use for copied Design content." /* i18n-ignore */
                }
              </p>
            </div>
          </ImportSourceRow>

          <ImportSourceRow
            id="fig-file-import"
            icon={<IconUpload className="size-3.5" />}
            title={t("designEditor.import.figUploadTitle")}
            description={t("designEditor.import.figUploadDescription")}
            isOpen={activeMode === "fig-upload"}
            onToggle={() =>
              setActiveMode((mode) =>
                mode === "fig-upload" ? null : "fig-upload",
              )
            }
          >
            <div className="space-y-2 p-2">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t("designEditor.import.figUploadDescription")}
              </p>
              <input
                ref={figFileInputRef}
                type="file"
                accept=".fig,application/octet-stream"
                className="hidden"
                onChange={(event) =>
                  void handleFigFileChange(event.target.files?.[0])
                }
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full px-2"
                disabled={busy}
                onClick={() => figFileInputRef.current?.click()}
              >
                {t("designEditor.import.chooseFigFile")}
              </Button>
              {figUploadBusy && figUploadName ? (
                <div
                  className="space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-2"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={figUploadName}
                    >
                      {figUploadName}
                    </span>
                    <span className="tabular-nums">
                      {figUploadProgress === 100
                        ? t("designEditor.import.figUploadProcessing")
                        : t("designEditor.import.figUploadUploading", {
                            progress: figUploadProgress ?? 0,
                          })}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={t("designEditor.import.figUploadTitle")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={figUploadProgress ?? 0}
                    className="h-1 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-foreground/70 origin-left transition-transform duration-150"
                      style={{
                        transform: `scaleX(${(figUploadProgress ?? 0) / 100})`,
                        width: "100%",
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </ImportSourceRow>

          <ImportSourceRow
            id="html-import"
            icon={<IconHtml className="size-3.5" />}
            title={t("designEditor.import.htmlTitle")}
            description={"Paste or choose a standalone file." /* i18n-ignore */}
            isOpen={activeMode === "html"}
            onToggle={() =>
              setActiveMode((mode) => (mode === "html" ? null : "html"))
            }
          >
            <div className="space-y-2 p-2">
              <Textarea
                value={htmlText}
                onChange={(event) => setHtmlText(event.target.value)}
                placeholder={t("designEditor.import.htmlPlaceholder")}
                className="min-h-24 resize-none text-xs"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-8 flex-1 px-2"
                  disabled={busy || !htmlText.trim()}
                  onClick={() => importHtmlString(htmlText, "html-import.html")}
                >
                  {t("designEditor.import.importHtml")}
                </Button>
                <input
                  ref={htmlFileInputRef}
                  type="file"
                  accept=".html,.htm"
                  className="hidden"
                  onChange={(event) =>
                    handleHtmlFileChange(event.target.files?.[0])
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  disabled={busy}
                  onClick={() => htmlFileInputRef.current?.click()}
                >
                  {t("designEditor.import.chooseHtmlFile")}
                </Button>
              </div>
            </div>
          </ImportSourceRow>

          <ImportSourceRow
            id="local-app-import"
            icon={<IconCode className="size-3.5" />}
            title={t("designEditor.import.localTitle")}
            description={t("designEditor.import.localDescription")}
            isOpen={activeMode === "local-app"}
            onToggle={() =>
              setActiveMode((mode) =>
                mode === "local-app" ? null : "local-app",
              )
            }
          >
            <div className="space-y-2 p-2">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t("designEditor.import.visualEditGuidance")}{" "}
                <a
                  href="/docs/template-design"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {"Read the visual-edit docs." /* i18n-ignore */}
                </a>
              </p>
              <VisualEditCommandRow
                command={VISUAL_EDIT_INSTALL_COMMAND}
                onCopy={copyVisualEditCommand}
              />
              <VisualEditCommandRow
                command={VISUAL_EDIT_CONNECT_COMMAND}
                onCopy={copyVisualEditCommand}
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                {
                  "Replace <port> with the running app's local port." /* i18n-ignore */
                }
              </p>
            </div>
          </ImportSourceRow>
        </div>

        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {"More sources" /* i18n-ignore */}
          </p>
          <div className="space-y-0.5">
            <CompactSourceRow
              icon={<IconBrandGithub className="size-3.5" />}
              title={t("designEditor.import.githubTitle")}
              description={
                "Repository import is coming soon." /* i18n-ignore */
              }
              badge={t("designEditor.import.comingSoon")}
            />
          </div>
        </div>

        {lastResult?.files?.length ? (
          <div className="mt-5 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <IconCircleCheck className="size-3.5 text-muted-foreground" />
              {t("designEditor.import.lastImport")}
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
              {lastResult.files.slice(0, 3).map((file) => (
                <li key={file.id} className="truncate">
                  {file.filename}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VisualEditCommandRow({
  command,
  onCopy,
}: {
  command: string;
  onCopy: (command: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 p-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[10px] leading-5 text-foreground/80">
        {command}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={"Copy command" /* i18n-ignore */}
        className="h-6 shrink-0 px-1.5 text-[10px]"
        onClick={() => onCopy(command)}
      >
        <IconCopy className="size-3" />
      </Button>
    </div>
  );
}

function ImportSourceRow({
  id,
  icon,
  title,
  description,
  isOpen,
  onToggle,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={onToggle}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60 active:bg-accent",
          isOpen && "bg-accent/45",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors group-hover:border-border group-hover:bg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
            {title}
          </span>
          <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
            {description}
          </span>
        </span>
        <IconChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
      </button>
      {isOpen ? (
        <div
          id={id}
          className="mb-1.5 mt-1 overflow-hidden rounded-md border border-border/70 bg-background/70"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function CompactSourceRow({
  icon,
  title,
  description,
  badge,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left opacity-85">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">
            {title}
          </span>
          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
            {badge}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {description}
        </span>
      </span>
      {action}
    </div>
  );
}
