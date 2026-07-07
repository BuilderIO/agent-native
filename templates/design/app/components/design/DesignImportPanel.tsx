import { useActionMutation, useT } from "@agent-native/core/client";
import {
  IconBrandFigma,
  IconBrandGithub,
  IconChevronRight,
  IconCircleCheck,
  IconCode,
  IconCopy,
  IconHtml,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  importResultSummary,
  looksLikeStandaloneHtml,
  VISUAL_EDIT_CONNECT_COMMAND,
  VISUAL_EDIT_INSTALL_COMMAND,
  type ImportResult,
} from "@/lib/design-import";
import { cn } from "@/lib/utils";

import type { DesignExtensionSlotContext } from "./DesignExtensionsPanel";

interface DesignImportPanelProps {
  context: Pick<DesignExtensionSlotContext, "designId" | "viewMode">;
}

type ImportMode = "figma-paste" | "html" | "local-app";

export function DesignImportPanel({ context }: DesignImportPanelProps) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const importSource = useActionMutation("import-design-source");
  const htmlFileInputRef = useRef<HTMLInputElement | null>(null);
  const [htmlText, setHtmlText] = useState("");
  const [activeMode, setActiveMode] = useState<ImportMode | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const finishImport = useCallback(
    async (result: ImportResult | undefined, fallback: string) => {
      if (result?.error) throw new Error(result.error);
      setLastResult(result ?? null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] }),
        queryClient.invalidateQueries({ queryKey: ["action"] }),
      ]);
      toast.success(importResultSummary(result, fallback));
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

  const busy = importSource.isPending;

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
