import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconLoader2,
  IconPlus,
  IconSearch,
  IconSearchOff,
} from "@tabler/icons-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { isAssetStorageSetupError } from "@/lib/asset-error-copy";

type SvglRoute = string | { light: string; dark: string };

type SvglLogo = {
  id: number;
  title: string;
  category: string | string[];
  route: SvglRoute;
};

type ImportedLogoAsset = {
  id: string;
  assetId: string;
  filename: string;
  type: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStorageSetup: () => void;
  onInserted: () => void;
  deckId?: string;
  canInsert: boolean;
  storageConfigured: boolean;
  onInsert: (
    assetId: string,
    filename: string,
    type: string,
  ) => Promise<string | null>;
};

export function Slides2SvglLogoSearchDialog({
  open,
  onOpenChange,
  onStorageSetup,
  onInserted,
  deckId,
  canInsert,
  storageConfigured,
  onInsert,
}: Props) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [pendingLogoId, setPendingLogoId] = useState<number | null>(null);
  const [savedAssets, setSavedAssets] = useState<
    Map<number, ImportedLogoAsset>
  >(() => new Map());
  const [importError, setImportError] = useState<string | null>(null);
  const searchQuery = useActionQuery<SvglLogo[]>(
    "search-svgl-logos",
    { q: submittedSearch },
    { enabled: open && submittedSearch.length > 0 },
  );
  const importLogo = useActionMutation<
    ImportedLogoAsset,
    { route: string; title: string; deckId?: string }
  >("import-svgl-logo");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSubmittedSearch("");
    setImportError(null);
    setSavedAssets(new Map());
  }, [open]);

  const searchLogos = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    setImportError(null);
    if (query) setSubmittedSearch(query);
  };

  const addLogo = async (logo: SvglLogo, route: string) => {
    if (!canInsert || pendingLogoId !== null) return;
    if (!storageConfigured) {
      onStorageSetup();
      return;
    }
    setImportError(null);
    setPendingLogoId(logo.id);
    try {
      const asset =
        savedAssets.get(logo.id) ??
        (await importLogo.mutateAsync({
          route,
          title: logo.title,
          ...(deckId ? { deckId } : {}),
        }));
      if (!savedAssets.has(logo.id)) {
        setSavedAssets((current) => new Map(current).set(logo.id, asset));
      }

      const error = await onInsert(asset.assetId, asset.filename, asset.type);
      if (error) {
        setImportError(error);
        return;
      }

      onOpenChange(false);
      onInserted();
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "errorCode" in error
          ? error.errorCode
          : undefined;
      if (isAssetStorageSetupError(errorCode)) {
        onStorageSetup();
        return;
      }
      setImportError(t("raw.assetErrors.assetSaveFailed"));
    } finally {
      setPendingLogoId(null);
    }
  };

  const results = searchQuery.data ?? [];
  const searchError = t("raw.searchFailed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("raw.logoSearchTitle")}</DialogTitle>
          <DialogDescription>
            <a
              href="https://svgl.app"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              svgl.app
            </a>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={searchLogos} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <IconSearch
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={t("raw.searchCompanyPlaceholder")}
              aria-label={t("raw.searchCompanyPlaceholder")}
              maxLength={120}
              className="ps-8"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={!search.trim() || searchQuery.isFetching}
          >
            {searchQuery.isFetching ? (
              <IconLoader2
                className="me-2 size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {t("raw.search")}
          </Button>
        </form>

        {importError ? (
          <p role="alert" className="text-sm text-destructive">
            {importError}
          </p>
        ) : null}

        <ScrollArea className="h-[min(58vh,32rem)] rounded-md border border-border">
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4">
            {searchQuery.isLoading || searchQuery.isFetching ? (
              Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="aspect-square rounded-md" />
              ))
            ) : searchQuery.isError ? (
              <div
                role="alert"
                className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-destructive"
              >
                <p>{searchError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void searchQuery.refetch()}
                >
                  {t("comments.retry")}
                </Button>
              </div>
            ) : !submittedSearch ? (
              <p className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <IconSearchOff className="size-6" aria-hidden="true" />
                {t("raw.searchCompanyLogo")}
              </p>
            ) : results.length === 0 ? (
              <p className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <IconSearchOff className="size-6" aria-hidden="true" />
                {t("raw.noLogosFound")}
              </p>
            ) : (
              results.map((logo) => (
                <SvglLogoCard
                  key={logo.id}
                  logo={logo}
                  pending={pendingLogoId === logo.id}
                  disabled={!canInsert || pendingLogoId !== null}
                  onAdd={addLogo}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function SvglLogoCard({
  logo,
  pending,
  disabled,
  onAdd,
}: {
  logo: SvglLogo;
  pending: boolean;
  disabled: boolean;
  onAdd: (logo: SvglLogo, route: string) => Promise<void>;
}) {
  const t = useT();
  const [variant, setVariant] = useState<"light" | "dark">("light");
  const hasVariants = typeof logo.route !== "string";
  const route =
    typeof logo.route === "string" ? logo.route : logo.route[variant];
  const category = Array.isArray(logo.category)
    ? logo.category.join(", ")
    : logo.category;

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted p-4">
        <img
          src={route}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 border-t border-border p-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium" title={logo.title}>
            {logo.title}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {category}
          </div>
        </div>
        {hasVariants ? (
          <div
            className="flex w-fit overflow-hidden rounded-md border border-border text-[10px]"
            role="group"
            aria-label={t("raw.logoSearchTitle")}
          >
            {(["light", "dark"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={variant === option ? "secondary" : "ghost"}
                aria-pressed={variant === option}
                onClick={() => setVariant(option)}
                className="h-6 rounded-none px-2 text-[10px]"
              >
                {t(`appMenu.theme${option === "light" ? "Light" : "Dark"}`)}
              </Button>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`${t("slides2Editor.addLogo")}: ${logo.title}`}
          onClick={() => void onAdd(logo, route)}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          {pending ? (
            <IconLoader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <IconPlus className="size-3.5" aria-hidden="true" />
          )}
          {pending ? t("designSystemSetup.saving") : t("slides2Editor.addLogo")}
        </Button>
      </div>
    </article>
  );
}
