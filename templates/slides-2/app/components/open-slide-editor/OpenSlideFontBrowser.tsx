import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconSearch, IconTypography } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";

type GoogleFontVariant = {
  family: string;
  category: string;
  variants: string[];
};

type ImportedFont = {
  id: string;
  assetId: string;
  family: string;
  variant: string;
  mimeType: string;
  url: string;
};

type FontTarget = "display" | "body";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  onApply: (font: ImportedFont, target: FontTarget) => void;
};

function cssFontWeight(variant: string): string {
  if (variant === "regular" || variant === "italic") return "400";
  return variant.replace(/italic$/, "");
}

function isItalicVariant(variant: string): boolean {
  return variant === "italic" || variant.endsWith("italic");
}

export function OpenSlideFontBrowser({
  open,
  onOpenChange,
  disabled,
  onApply,
}: Props) {
  const t = useT();
  const { id: deckId } = useParams<{ id: string }>();
  const storageQuery = useSlideFileStorageStatus(open);
  const storageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const storageButtonRef = useRef<HTMLButtonElement>(null);
  const fontFaceRef = useRef<FontFace | null>(null);
  const [search, setSearch] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedFamily, setSelectedFamily] = useState("");
  const [selectedVariant, setSelectedVariant] = useState("");
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);
  const [previewFont, setPreviewFont] = useState<ImportedFont | null>(null);
  const [previewFaceFamily, setPreviewFaceFamily] = useState("");

  const fontsQuery = useActionQuery<GoogleFontVariant[]>(
    "search-google-fonts",
    { q: submittedQuery },
    { enabled: open && submittedQuery.length > 0 },
  );
  const importFont = useActionMutation<
    ImportedFont,
    { deckId: string; family: string; variant: string }
  >("import-google-font");
  const fonts = fontsQuery.data ?? [];
  const selected = fonts.find((font) => font.family === selectedFamily);
  const activePreview =
    previewFont?.family === selectedFamily &&
    previewFont.variant === selectedVariant
      ? previewFont
      : null;

  useEffect(() => {
    if (!selected || selected.variants.includes(selectedVariant)) return;
    setSelectedVariant(selected.variants[0] ?? "");
  }, [selected, selectedVariant]);

  useEffect(() => {
    if (!open) return;
    if (!fonts.length) {
      setSelectedFamily("");
      setSelectedVariant("");
      return;
    }
    if (fonts.some((font) => font.family === selectedFamily)) return;
    setSelectedFamily(fonts[0]!.family);
    setSelectedVariant(fonts[0]!.variants[0] ?? "");
  }, [fonts, open, selectedFamily]);

  useEffect(
    () => () => {
      if (fontFaceRef.current) document.fonts?.delete(fontFaceRef.current);
    },
    [],
  );

  const searchFonts = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    setSubmittedQuery(query);
    setSelectedFamily("");
    setSelectedVariant("");
    setImportError(false);
  };

  const previewSelected = async () => {
    if (!selected || !selectedVariant || importing) return;
    if (!storageConfigured) {
      setStoragePromptOpen(true);
      return;
    }
    if (!deckId) {
      setImportError(true);
      return;
    }

    setImporting(true);
    setImportError(false);
    try {
      const imported = await importFont.mutateAsync({
        deckId,
        family: selected.family,
        variant: selectedVariant,
      });
      const faceFamily = `slides2-${imported.assetId}`;
      const face = new FontFace(faceFamily, `url("${imported.url}")`, {
        weight: cssFontWeight(imported.variant),
        style: isItalicVariant(imported.variant) ? "italic" : "normal",
      });
      await face.load();
      if (fontFaceRef.current) document.fonts.delete(fontFaceRef.current);
      document.fonts.add(face);
      fontFaceRef.current = face;
      setPreviewFaceFamily(faceFamily);
      setPreviewFont(imported);
    } catch {
      setImportError(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("openSlideFonts.title")}</DialogTitle>
          </DialogHeader>
          <form className="flex gap-2" onSubmit={searchFonts}>
            <Input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={t("openSlideFonts.searchPlaceholder")}
              aria-label={t("openSlideFonts.searchPlaceholder")}
            />
            <Button type="submit" variant="outline" disabled={!search.trim()}>
              <IconSearch className="me-2 size-4" aria-hidden="true" />
              {t("openSlideFonts.search")}
            </Button>
          </form>
          <div className="grid min-h-[18rem] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ScrollArea className="h-[min(48vh,24rem)] rounded-md border border-border">
              <div className="grid gap-1 p-2">
                {fontsQuery.isLoading ? (
                  Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-11 rounded-md" />
                  ))
                ) : fontsQuery.isError ? (
                  <p role="alert" className="p-3 text-sm text-destructive">
                    {t("openSlideFonts.searchFailed")}
                  </p>
                ) : fonts.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {submittedQuery
                      ? t("openSlideFonts.noResults")
                      : t("openSlideFonts.searchHint")}
                  </p>
                ) : (
                  fonts.map((font) => (
                    <Button
                      key={font.family}
                      type="button"
                      variant={
                        selectedFamily === font.family ? "secondary" : "ghost"
                      }
                      className="h-auto justify-start px-3 py-2 text-start"
                      onClick={() => {
                        setSelectedFamily(font.family);
                        setSelectedVariant(font.variants[0] ?? "");
                        setImportError(false);
                      }}
                    >
                      <span className="grid min-w-0">
                        <span className="truncate text-sm font-medium">
                          {font.family}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {font.category}
                        </span>
                      </span>
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3">
              {selected ? (
                <>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">
                      {selected.family}
                    </span>
                    <Select
                      value={selectedVariant}
                      onValueChange={setSelectedVariant}
                    >
                      <SelectTrigger aria-label={t("openSlideFonts.variant")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selected.variants.map((variant) => (
                          <SelectItem key={variant} value={variant}>
                            {variant}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-h-28 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted px-3 text-center">
                    <span
                      className="break-words text-3xl"
                      style={{
                        fontFamily: activePreview
                          ? `"${previewFaceFamily}"`
                          : undefined,
                        fontStyle: isItalicVariant(selectedVariant)
                          ? "italic"
                          : "normal",
                        fontWeight: cssFontWeight(selectedVariant),
                      }}
                    >
                      {t("openSlideFonts.previewSample")}
                    </span>
                  </div>
                  {importError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t("openSlideFonts.importFailed")}
                    </p>
                  ) : null}
                  <Button
                    ref={storageButtonRef}
                    type="button"
                    variant="outline"
                    disabled={disabled || importing || !selectedVariant}
                    onClick={() => void previewSelected()}
                  >
                    <IconTypography
                      className="me-2 size-4"
                      aria-hidden="true"
                    />
                    {importing
                      ? t("raw.uploading")
                      : activePreview
                        ? t("openSlideFonts.previewed")
                        : t("openSlideFonts.previewVariant")}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={disabled || !activePreview}
                      onClick={() =>
                        activePreview && onApply(activePreview, "display")
                      }
                    >
                      {t("openSlideFonts.useForHeadings")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || !activePreview}
                      onClick={() =>
                        activePreview && onApply(activePreview, "body")
                      }
                    >
                      {t("openSlideFonts.useForBody")}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                  {t("openSlideFonts.chooseFont")}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <UploadStorageGate
        configured={storageConfigured}
        unavailable={!storageQuery.isSuccess}
        open={storagePromptOpen}
        onOpenChange={setStoragePromptOpen}
        onRetry={() => void storageQuery.refetch()}
        anchorRef={storageButtonRef}
      />
    </>
  );
}
