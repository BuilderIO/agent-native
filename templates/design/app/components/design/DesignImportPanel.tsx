import { appApiPath, useActionMutation, useT } from "@agent-native/core/client";
import {
  IconBrandFigma,
  IconBrandGithub,
  IconChevronRight,
  IconCircleCheck,
  IconCode,
  IconHtml,
  IconUpload,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

import type { DesignExtensionSlotContext } from "./DesignExtensionsPanel";

interface DesignImportPanelProps {
  context: Pick<DesignExtensionSlotContext, "designId" | "viewMode">;
}

interface ImportResult {
  designId?: string;
  files?: Array<{ id: string; filename: string }>;
  warnings?: string[];
  error?: string;
}

type ImportMode = "figma-paste" | "fig-file" | "html";

function hasFigmaPayload(html: string): boolean {
  return /\(figmeta\)|\(figma\)|data-metadata=|data-buffer=/i.test(html);
}

function looksLikeHtml(value: string): boolean {
  return /<(html|body|main|section|div|article|header|footer|button|img)\b/i.test(
    value,
  );
}

function resultSummary(result: ImportResult | undefined, fallback: string) {
  const count = result?.files?.length ?? 0;
  if (count === 0) return fallback;
  if (count === 1) return `Imported ${result!.files![0]!.filename}.`;
  return `Imported ${count} screens.`;
}

export function DesignImportPanel({ context }: DesignImportPanelProps) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const importSource = useActionMutation("import-design-source");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const htmlFileInputRef = useRef<HTMLInputElement | null>(null);
  const [htmlText, setHtmlText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeMode, setActiveMode] = useState<ImportMode | null>(null);
  const [activeUploadName, setActiveUploadName] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const finishImport = useCallback(
    async (result: ImportResult | undefined, fallback: string) => {
      if (result?.error) throw new Error(result.error);
      setLastResult(result ?? null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] }),
        queryClient.invalidateQueries({ queryKey: ["action"] }),
      ]);
      toast.success(resultSummary(result, fallback));
      if (result?.warnings?.length) {
        toast.warning(t("designEditor.import.warningsToast"), {
          description: result.warnings[0],
        });
      }
      navigate(`/design/${result?.designId ?? context.designId}?view=overview`);
    },
    [context.designId, navigate, queryClient, t],
  );

  const importHtmlString = useCallback(
    (content: string, originalName?: string) => {
      if (!looksLikeHtml(content)) {
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

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      const content = html || text;
      if (!content) return;
      if (hasFigmaPayload(content)) {
        event.preventDefault();
        importSource.mutate(
          {
            designId: context.designId,
            sourceType: "figma-paste-html",
            content,
            originalName: "figma-paste.html",
          },
          {
            onSuccess: (result: unknown) => {
              void finishImport(
                result as ImportResult,
                t("designEditor.import.figmaSuccess"),
              );
            },
            onError: (error: unknown) => {
              toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
                description:
                  error instanceof Error
                    ? error.message
                    : t("common.genericError"),
              });
            },
          },
        );
        return;
      }
      if (looksLikeHtml(content)) {
        event.preventDefault();
        importHtmlString(content, "pasted-html.html");
      }
    },
    [context.designId, finishImport, importHtmlString, importSource, t],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setActiveUploadName(file.name);
      const body = new FormData();
      body.append("designId", context.designId);
      body.append("file", file);
      try {
        const response = await fetch(
          appApiPath(
            `/api/import-design-file?designId=${encodeURIComponent(context.designId)}`,
          ),
          {
            method: "POST",
            body,
          },
        );
        const result = (await response.json()) as ImportResult;
        if (!response.ok) {
          throw new Error(
            result.error || t("designEditor.import.errors.uploadFailed"),
          );
        }
        await finishImport(result, t("designEditor.import.uploadSuccess"));
      } catch (error) {
        toast.error(t("designEditor.import.errors.uploadFailed"), {
          description:
            error instanceof Error ? error.message : t("common.genericError"),
        });
      } finally {
        setUploading(false);
        setActiveUploadName(null);
      }
    },
    [context.designId, finishImport, t],
  );

  const handleFigmaFileChange = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setActiveMode("fig-file");
      void uploadFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFile],
  );

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

  const askVisualEdit = useCallback(() => {
    sendToDesignAgentChat({
      message:
        "Use the visual-edit skill to connect my local app to this Design project. Run the app if needed, call `npx @agent-native/core@latest design connect`, then add URL-backed screens to this design.",
    } as Parameters<typeof sendToDesignAgentChat>[0]);
    toast.success(t("designEditor.import.visualEditSent"));
  }, [t]);

  const busy = importSource.isPending || uploading;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-16 shrink-0 items-center border-b border-border/60 px-4">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {t("designEditor.import.title")}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {"Bring source screens into this design" /* i18n-ignore */}
          </p>
        </div>
      </div>

      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
        <div className="space-y-1">
          <ImportSourceRow
            id="figma-paste-import"
            icon={<IconBrandFigma className="size-3.5" />}
            title={t("designEditor.import.figmaPasteTitle")}
            description={
              "Copy a frame in Figma, then paste here." /* i18n-ignore */
            }
            isOpen={activeMode === "figma-paste"}
            onToggle={() =>
              setActiveMode((mode) =>
                mode === "figma-paste" ? null : "figma-paste",
              )
            }
          >
            <div className="p-2.5">
              <div
                role="textbox"
                tabIndex={0}
                aria-label={t("designEditor.import.figmaPasteTarget")}
                onPaste={handlePaste}
                className={cn(
                  "flex min-h-24 cursor-text items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground outline-none transition-colors",
                  "focus:border-primary/60 focus:bg-background focus:ring-2 focus:ring-primary/15",
                )}
              >
                {t("designEditor.import.figmaPasteTarget")}
              </div>
            </div>
          </ImportSourceRow>

          <ImportSourceRow
            id="fig-file-import"
            icon={<IconUpload className="size-3.5" />}
            title={t("designEditor.import.figUploadTitle")}
            description={"Upload exported Figma frames." /* i18n-ignore */}
            isOpen={activeMode === "fig-file"}
            onToggle={() =>
              setActiveMode((mode) => (mode === "fig-file" ? null : "fig-file"))
            }
          >
            <div className="space-y-2 p-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".fig"
                className="hidden"
                onChange={(event) =>
                  handleFigmaFileChange(event.target.files?.[0])
                }
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full justify-center"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading
                  ? "Importing..." /* i18n-ignore */
                  : t("designEditor.import.chooseFigFile")}
              </Button>
              <p className="truncate text-[10px] leading-snug text-muted-foreground">
                {
                  activeUploadName ??
                    "Export only the frames you need." /* i18n-ignore */
                }
              </p>
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
            <div className="space-y-2 p-2.5">
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
        </div>

        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {"More sources" /* i18n-ignore */}
          </p>
          <div className="space-y-1">
            <CompactSourceRow
              icon={<IconBrandGithub className="size-3.5" />}
              title={t("designEditor.import.githubTitle")}
              description={
                "Repository import is coming soon." /* i18n-ignore */
              }
              badge={t("designEditor.import.comingSoon")}
            />
            <CompactSourceRow
              icon={<IconCode className="size-3.5" />}
              title={t("designEditor.import.localTitle")}
              description={
                "Connect a running app with visual-edit." /* i18n-ignore */
              }
              badge={t("designEditor.import.comingSoon")}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={askVisualEdit}
                >
                  {t("designEditor.import.useVisualEditNow")}
                </Button>
              }
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
          "group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/60 active:bg-accent",
          isOpen && "bg-accent/45",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors group-hover:border-border group-hover:bg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-tight text-foreground">
            {title}
          </span>
          <span className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        </span>
        <IconChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
      </button>
      {isOpen ? (
        <div
          id={id}
          className="mb-2 mt-1 overflow-hidden rounded-md border border-border/70 bg-background/70"
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
    <div className="flex items-center gap-2 rounded-md px-2 py-2 text-left opacity-85">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">
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
