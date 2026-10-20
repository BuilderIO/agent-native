import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { Link } from "react-router";

import type { ElementSnapshot } from "@/components/slides-2-editor/types";
import {
  SandboxedSlide,
  type FramePointer,
} from "@/components/slides-2-runtime/SandboxedSlide";
import { Slides2Canvas } from "@/components/slides-2-runtime/Slides2Canvas";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type ThemeSummary = {
  id: string;
  name: string;
  description?: string;
  mode: "light" | "dark";
  preview: {
    background: string;
    text: string;
    accent: string;
  };
};

export default function SlideThemes() {
  const t = useT();
  const themesQuery = useActionQuery("list-slide-themes", {});
  const themes = themesQuery.data?.themes ?? [];

  useSetPageTitle(t("themesPage.title"));

  if (themesQuery.isLoading) {
    return (
      <div className="mx-auto grid w-full max-w-370 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-4 px-4 py-6 sm:px-6 lg:px-8">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="grid gap-3">
            <Skeleton className="aspect-video rounded-lg" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  if (themesQuery.isError) {
    return (
      <div className="mx-auto flex min-h-80 w-full max-w-370 flex-col items-center justify-center gap-3 px-4 py-6 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-muted-foreground">
          {actionErrorMessage(themesQuery.error) ?? t("themesPage.loadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void themesQuery.refetch()}
        >
          {t("home.retry")}
        </Button>
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <div className="mx-auto flex min-h-80 w-full max-w-370 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
        {t("themesPage.empty")}
      </div>
    );
  }

  return (
    <ul
      aria-label={t("themesPage.title")}
      className="mx-auto grid w-full max-w-370 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-x-5 gap-y-7 px-4 py-6 sm:px-6 lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] lg:px-8"
    >
      {themes.map((theme: ThemeSummary) => (
        <li key={theme.id}>
          <Link
            to={`/themes/${encodeURIComponent(theme.id)}`}
            aria-label={t("themesPage.openTheme", { name: theme.name })}
            className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ThemePreview theme={theme} />
            <div className="mt-3 grid gap-1">
              <h2 className="truncate text-sm font-medium text-foreground">
                {theme.name}
              </h2>
              {theme.description ? (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {theme.description}
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ThemePreview({
  theme,
  label,
  pageIndex = 0,
}: {
  theme: ThemeSummary;
  label?: string;
  pageIndex?: number;
}) {
  const t = useT();
  const previewQuery = useActionQuery("get-slide-theme-preview", {
    id: theme.id,
    pageIndex,
  });
  const artifact = previewQuery.data?.artifact;

  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative grid aspect-video grid-cols-[1fr_0.72fr] gap-3 overflow-hidden rounded-lg border border-border/70 p-4 shadow-sm transition-[box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md"
      style={{
        backgroundColor: theme.preview.background,
        color: theme.preview.text,
      }}
    >
      {artifact ? (
        <Slides2Canvas flat>
          <SandboxedSlide
            artifact={artifact}
            title={theme.name}
            onNodes={ignoreNodes}
            onPointer={ignorePointer}
          />
        </Slides2Canvas>
      ) : previewQuery.isError ? (
        <div className="grid h-full w-full place-items-center px-4 text-center text-xs text-muted-foreground">
          {t("themesPage.loadFailed")}
        </div>
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
    </div>
  );
}

function ignoreNodes(_nodes: ElementSnapshot[]) {}

function ignorePointer(_pointer: FramePointer) {}
