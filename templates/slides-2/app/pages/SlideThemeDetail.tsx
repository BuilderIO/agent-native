import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemePreview } from "@/pages/SlideThemes";

type ThemeDetail = {
  id: string;
  name: string;
  description: string;
  mode: "light" | "dark";
  preview: {
    background: string;
    text: string;
    accent: string;
  };
  guide: string;
};

export default function SlideThemeDetailPage() {
  const t = useT();
  const { id = "" } = useParams<{ id: string }>();
  const [showFullGuide, setShowFullGuide] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const themeQuery = useActionQuery(
    "get-slide-theme",
    { id },
    { enabled: !!id },
  );
  const theme = themeQuery.data as ThemeDetail | undefined;
  const previewQuery = useActionQuery(
    "get-slide-theme-preview",
    { id, pageIndex },
    { enabled: !!id },
  );
  const pageCount = previewQuery.data?.pageCount ?? 1;

  useEffect(() => {
    setPageIndex(0);
  }, [id]);

  useEffect(() => {
    if (pageCount <= 1) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        setPageIndex((current) => Math.min(pageCount - 1, current + 1));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        setPageIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pageCount]);

  useSetPageTitle(theme?.name ?? t("themesPage.title"));

  if (themeQuery.isLoading || (!themeQuery.isError && !theme)) {
    return (
      <div className="mx-auto grid w-full max-w-370 gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="aspect-video w-full max-w-3xl rounded-lg" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-370 gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" className="-ms-2 w-fit">
        <Link to="/themes">
          <IconChevronLeft className="size-4 rtl:rotate-180" />
          {t("themesPage.back")}
        </Link>
      </Button>

      {themeQuery.isError || !theme ? (
        <div className="grid min-h-64 place-content-center justify-items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            {actionErrorMessage(themeQuery.error) ?? t("themesPage.loadFailed")}
          </p>
          <Button asChild variant="outline">
            <Link to="/themes">{t("themesPage.back")}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:gap-8">
          <div className="grid min-w-0 content-start gap-5">
            <ThemePreview
              theme={theme}
              label={t("themesPage.preview")}
              pageIndex={pageIndex}
            />
            {pageCount > 1 ? (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("templatesPage.previous")}
                  disabled={pageIndex === 0}
                  onClick={() =>
                    setPageIndex((current) => Math.max(0, current - 1))
                  }
                >
                  <IconChevronLeft className="size-4 rtl:rotate-180" />
                </Button>
                <span
                  className="text-xs tabular-nums text-muted-foreground"
                  aria-live="polite"
                >
                  {t("templatesPage.slidePosition", {
                    current: pageIndex + 1,
                    total: pageCount,
                  })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("templatesPage.next")}
                  disabled={pageIndex === pageCount - 1}
                  onClick={() =>
                    setPageIndex((current) =>
                      Math.min(pageCount - 1, current + 1),
                    )
                  }
                >
                  <IconChevronRight className="size-4 rtl:rotate-180" />
                </Button>
              </div>
            ) : null}
            <div>
              <h2 className="mb-3 text-sm font-medium text-foreground">
                {t("themesPage.guide")}
              </h2>
              <div className="relative">
                <pre
                  className={`w-full whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 font-mono text-xs leading-relaxed text-card-foreground ${showFullGuide ? "max-h-[min(70vh,800px)] overflow-auto" : "max-h-80 overflow-hidden"}`}
                >
                  {theme.guide}
                </pre>
                {theme.guide.length > 2_000 ? (
                  <div className="mt-2 flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowFullGuide((current) => !current)}
                    >
                      {showFullGuide
                        ? t("themesPage.showLess")
                        : t("themesPage.showMore")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="grid content-start gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {theme.description}
            </p>
            <Button asChild>
              <Link
                to={`/home?initialPrompt=${encodeURIComponent(t("themesPage.createDeckPrompt", { name: theme.name, id: theme.id }))}`}
              >
                {t("themesPage.useTheme")}
              </Link>
            </Button>
            <section className="grid gap-3 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium text-foreground">
                {t("themesPage.palette")}
              </h2>
              <PaletteColor
                label={t("themesPage.background")}
                color={theme.preview.background}
              />
              <PaletteColor
                label={t("themesPage.text")}
                color={theme.preview.text}
              />
              <PaletteColor
                label={t("themesPage.accent")}
                color={theme.preview.accent}
              />
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

function PaletteColor({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        aria-hidden="true"
        className="size-7 shrink-0 rounded-md border border-border"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
      <code className="font-mono text-xs text-foreground">{color}</code>
    </div>
  );
}
