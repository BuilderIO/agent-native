import { appApiPath, useActionMutation, useT } from "@agent-native/core/client";
import {
  IconBrandFigma,
  IconBrandGithub,
  IconCode,
  IconFileImport,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      }
    },
    [context.designId, finishImport, t],
  );

  const handleFigmaFileChange = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      void uploadFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFile],
  );

  const handleHtmlFileChange = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
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
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <div className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">
            {t("designEditor.import.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("designEditor.import.description")}
          </p>
        </div>

        <Card>
          <CardHeader className="space-y-2 p-4">
            <div className="flex items-start gap-3">
              <IconBrandFigma className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-sm">
                  {t("designEditor.import.figmaPasteTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("designEditor.import.figmaPasteDescription")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div
              role="textbox"
              tabIndex={0}
              onPaste={handlePaste}
              className={cn(
                "rounded-md border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground outline-none transition",
                "focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/15",
              )}
            >
              {t("designEditor.import.figmaPasteTarget")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2 p-4">
            <div className="flex items-start gap-3">
              <IconUpload className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-sm">
                  {t("designEditor.import.figUploadTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("designEditor.import.figUploadDescription")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
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
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconFileImport className="mr-2 size-4" />
              {t("designEditor.import.chooseFigFile")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2 p-4">
            <div className="flex items-start gap-3">
              <IconHtml className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-sm">
                  {t("designEditor.import.htmlTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("designEditor.import.htmlDescription")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <Textarea
              value={htmlText}
              onChange={(event) => setHtmlText(event.target.value)}
              placeholder={t("designEditor.import.htmlPlaceholder")}
              className="min-h-28 text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
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
                disabled={busy}
                onClick={() => htmlFileInputRef.current?.click()}
              >
                {t("designEditor.import.chooseHtmlFile")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <ComingSoonCard
          icon={<IconBrandGithub className="size-5" />}
          title={t("designEditor.import.githubTitle")}
          description={t("designEditor.import.githubDescription")}
          badge={t("designEditor.import.comingSoon")}
        />

        <Card>
          <CardHeader className="space-y-2 p-4">
            <div className="flex items-start gap-3">
              <IconCode className="mt-0.5 size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">
                    {t("designEditor.import.localTitle")}
                  </CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    {t("designEditor.import.comingSoon")}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  {t("designEditor.import.localDescription")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <p className="text-xs text-muted-foreground">
              {t("designEditor.import.visualEditGuidance")}
            </p>
            <Button size="sm" variant="outline" onClick={askVisualEdit}>
              {t("designEditor.import.useVisualEditNow")}
            </Button>
          </CardContent>
        </Card>

        {lastResult?.files?.length ? (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-medium">
              {t("designEditor.import.lastImport")}
            </div>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {lastResult.files.map((file) => (
                <li key={file.id}>{file.filename}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComingSoonCard({
  icon,
  title,
  description,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <Card className="opacity-80">
      <CardHeader className="space-y-2 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-muted-foreground">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">{title}</CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {badge}
              </Badge>
            </div>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
