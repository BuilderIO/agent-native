import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ComposeAttachment } from "@shared/types";
import { IconFileText, IconLoader2, IconTable } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCanManageStorage } from "@/hooks/use-can-manage-storage";
import { useStorageSetupLabels } from "@/hooks/use-storage-setup-labels";
import { storageSetupReasonOf, UploadError } from "@/lib/upload";
import { toastUploadFailure } from "@/lib/upload-toast";
import { cn } from "@/lib/utils";

interface ContentPageItem {
  id: string;
  title: string;
  kind: "page" | "collection";
  format: "markdown" | "csv";
}

interface ContentPageList {
  items: ContentPageItem[];
  hasMore: boolean;
}

type PageFormat = "pdf" | "markdown";
type PdfFont = "sans" | "serif";

const PAGE_FORMATS: readonly PageFormat[] = ["pdf", "markdown"];
const PDF_FONTS: readonly PdfFont[] = ["sans", "serif"];
const PDF_FONT_STORAGE_KEY = "mail-content-pdf-font";

const SEARCH_DELAY_MS = 250;

function storedPdfFont(): PdfFont {
  if (typeof window === "undefined") return "sans";
  try {
    return window.localStorage.getItem(PDF_FONT_STORAGE_KEY) === "serif"
      ? "serif"
      : "sans";
    // coercion-ok: blocked storage (private browsing) has no remembered font to read.
  } catch {
    return "sans";
  }
}

function ChoiceRow<T extends string>({
  label,
  choices,
  value,
  labelOf,
  disabled,
  onChange,
}: {
  label: string;
  choices: readonly T[];
  value: T;
  labelOf: (choice: T) => string;
  disabled: boolean;
  onChange: (choice: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center justify-between gap-2"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {choices.map((choice) => (
          <Button
            key={choice}
            type="button"
            size="xs"
            variant={value === choice ? "secondary" : "ghost"}
            aria-pressed={value === choice}
            disabled={disabled}
            onClick={() => onChange(choice)}
          >
            {labelOf(choice)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function AttachFromContentButton({
  onAttach,
  onPendingChange,
  className,
}: {
  onAttach: (attachment: ComposeAttachment) => void;
  onPendingChange?: (pending: boolean) => void;
  className?: string;
}) {
  const t = useT();
  const canManageStorage = useCanManageStorage();
  const storageSetupLabels = useStorageSetupLabels();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState("");
  const [pageFormat, setPageFormat] = useState<PageFormat>("pdf");
  const [pdfFont, setPdfFont] = useState<PdfFont>(storedPdfFont);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setHighlighted("");
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const pages = useQuery<ContentPageList>({
    queryKey: ["content-pages", query],
    queryFn: () =>
      callAction(
        "list-content-pages",
        { page: 1, ...(query ? { search: query } : {}) },
        { method: "GET" },
      ) as Promise<ContentPageList>,
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });

  const pdfRefusal = (errorCode: unknown) => {
    switch (errorCode) {
      case "document_file_pdf_text_unsupported":
        return t("mail.toasts.contentPagePdfTextUnsupported");
      case "document_file_pdf_too_long":
        return t("mail.toasts.contentPagePdfTooLong");
      case "content_page_pdf_unavailable":
        return t("mail.toasts.contentPagePdfUnavailable");
      default:
        return undefined;
    }
  };

  const close = () => {
    setOpen(false);
    setSearch("");
    setQuery("");
    setHighlighted("");
  };

  const choosePdfFont = (font: PdfFont) => {
    setPdfFont(font);
    try {
      window.localStorage.setItem(PDF_FONT_STORAGE_KEY, font);
      // coercion-ok: with storage blocked the pick still holds for this visit.
    } catch {}
  };

  const attach = async (item: ContentPageItem) => {
    if (attachingId) return;
    setAttachingId(item.id);
    onPendingChange?.(true);
    const format = item.kind === "collection" ? item.format : pageFormat;
    try {
      const result = (await callAction("attach-content-page", {
        id: item.id,
        format,
        ...(format === "pdf" && pdfFont === "serif" ? { font: pdfFont } : {}),
      })) as { attachment: ComposeAttachment };
      onAttach(result.attachment);
      close();
    } catch (error) {
      const reason = storageSetupReasonOf(error);
      const { errorCode } = (error ?? {}) as { errorCode?: unknown };
      const message =
        pdfRefusal(errorCode) ??
        actionErrorMessage(error) ??
        t("mail.toasts.failedToAttachContentPage");
      toastUploadFailure(
        reason ? new UploadError(message, reason) : new Error(message),
        t("mail.toasts.failedToAttachContentPage"),
        storageSetupLabels,
        canManageStorage,
      );
      void pages.refetch();
    } finally {
      setAttachingId(null);
      onPendingChange?.(false);
    }
  };

  const settled = search.trim() === query;
  const items = pages.data?.items ?? [];
  const highlightedId = items.some((item) => item.id === highlighted)
    ? highlighted
    : (items[0]?.id ?? "");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (attachingId) return;
        if (next) setOpen(true);
        else close();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={t("mail.compose.attachFromContent")}
              className={cn("h-7 w-7", className)}
            >
              <IconFileText className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("mail.compose.attachFromContent")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="start" className="w-80 p-0">
        <Command
          shouldFilter={false}
          value={highlightedId}
          onValueChange={setHighlighted}
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("mail.compose.searchContentPages")}
            aria-label={t("mail.compose.searchContentPages")}
          />
          <CommandList className="max-h-72">
            {pages.isPending ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />
                {t("mail.compose.contentPagesLoading")}
              </div>
            ) : pages.isError ? (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
                <span>
                  {actionErrorMessage(pages.error) ??
                    t("mail.compose.contentPagesFailed")}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  type="button"
                  onClick={() => void pages.refetch()}
                >
                  {t("mail.compose.contentPagesRetry")}
                </Button>
              </div>
            ) : (
              <CommandEmpty>{t("mail.compose.contentPagesEmpty")}</CommandEmpty>
            )}
            {items.length > 0 && (
              <CommandGroup>
                {items.map((item) => {
                  const Icon =
                    item.kind === "collection" ? IconTable : IconFileText;
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      disabled={Boolean(attachingId) || !settled}
                      onSelect={() => void attach(item)}
                    >
                      {attachingId === item.id ? (
                        <IconLoader2 className="me-2 size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <Icon className="me-2 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {item.title}
                      </span>
                      <span className="ms-2 shrink-0 text-xs text-muted-foreground">
                        {item.kind === "collection"
                          ? t("mail.compose.contentFileCsv")
                          : pageFormat === "pdf"
                            ? t("mail.compose.contentFilePdf")
                            : t("mail.compose.contentFileMarkdown")}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="space-y-1.5 border-t border-border px-3 py-2">
          <ChoiceRow
            label={t("mail.compose.contentPageFormat")}
            choices={PAGE_FORMATS}
            value={pageFormat}
            labelOf={(format) =>
              format === "pdf"
                ? t("mail.compose.contentFormatPdf")
                : t("mail.compose.contentFormatMarkdown")
            }
            disabled={Boolean(attachingId)}
            onChange={setPageFormat}
          />
          {pageFormat === "pdf" && (
            <ChoiceRow
              label={t("mail.compose.contentPdfFont")}
              choices={PDF_FONTS}
              value={pdfFont}
              labelOf={(font) =>
                font === "sans"
                  ? t("mail.compose.contentFontSans")
                  : t("mail.compose.contentFontSerif")
              }
              disabled={Boolean(attachingId)}
              onChange={choosePdfFont}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
