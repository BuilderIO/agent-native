import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconBrandGithub,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";
import {
  Link,
  useLoaderData,
  type ClientLoaderFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { BuilderImage } from "../components/builder-image";
import {
  findCommunityApp,
  findCommunityAppInCatalog,
  type CommunityApp,
} from "../components/community-apps";
import { fetchCommunityApps } from "../components/community-apps.client";
import { sitePathForLocale } from "../components/docs-locale";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import {
  TemplateHero,
  TemplateLandingShell,
} from "../components/template-landing";
import { trackEvent } from "../components/TemplateCard";
import enUS from "../i18n/en-US";
import { withDefaultSocialImage, withTemplateSocialImage } from "../seo";

export type CommunityAppRouteData = {
  app: CommunityApp | null;
  hydrated: boolean;
};

export function loader({ params }: LoaderFunctionArgs): CommunityAppRouteData {
  return { app: findCommunityApp(params.slug) ?? null, hydrated: false };
}

export async function clientLoader({
  params,
  serverLoader,
}: ClientLoaderFunctionArgs): Promise<CommunityAppRouteData> {
  const fallback = await serverLoader<typeof loader>();
  try {
    return {
      app:
        findCommunityAppInCatalog(await fetchCommunityApps(), params.slug) ??
        null,
      hydrated: true,
    };
  } catch {
    return { app: fallback.app, hydrated: true };
  }
}

clientLoader.hydrate = true;

export const meta = ({
  data,
  loaderData,
}: {
  data?: CommunityAppRouteData;
  loaderData?: CommunityAppRouteData;
}) => {
  const app = (data ?? loaderData)?.app;
  if (!app) {
    return withDefaultSocialImage([
      { title: enUS.templateDetail.notFoundMetaTitle },
    ]);
  }
  return withTemplateSocialImage(
    [
      { title: `${app.name} - Community App` },
      { name: "description", content: app.description },
    ],
    app.name,
  );
};

function ScreenshotCarousel({ app }: { app: CommunityApp }) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function scrollTo(index: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const target = viewport.children[index];
    if (!(target instanceof HTMLElement)) return;
    viewport.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
    setActiveIndex(index);
  }

  if (app.screenshots.length === 0) {
    return (
      <div className="mx-3 flex min-h-[280px] items-center justify-center border border-dashed border-[var(--docs-border)] text-sm text-[var(--fg-secondary)] sm:mx-4">
        {t("templatesPage.communityNoScreenshots")}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between gap-4 px-3 sm:px-4">
        <p className="m-0 font-mono text-xs uppercase tracking-[0.12em] text-[var(--fg-secondary)]">
          {t("templatesPage.communityScreenshots")}{" "}
          <span aria-live="polite">
            {activeIndex + 1}/{app.screenshots.length}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label={t("templatesPage.previousScreenshot")}
            onClick={() => scrollTo(Math.max(0, activeIndex - 1))}
            disabled={activeIndex === 0}
            className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconChevronLeft size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("templatesPage.nextScreenshot")}
            onClick={() =>
              scrollTo(Math.min(app.screenshots.length - 1, activeIndex + 1))
            }
            disabled={activeIndex === app.screenshots.length - 1}
            className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const children = Array.from(viewport.children);
          const nextIndex = children.reduce((closest, child, index) => {
            const distance = Math.abs(
              (child as HTMLElement).offsetLeft - viewport.scrollLeft,
            );
            const closestDistance = Math.abs(
              (children[closest] as HTMLElement).offsetLeft -
                viewport.scrollLeft,
            );
            return distance < closestDistance ? index : closest;
          }, 0);
          setActiveIndex(nextIndex);
        }}
      >
        {app.screenshots.map((screenshot, index) => (
          <div
            key={screenshot}
            className="w-[88%] shrink-0 snap-center overflow-hidden border border-[var(--docs-border)] bg-[var(--bg-secondary)] sm:w-[68%]"
          >
            <BuilderImage
              src={screenshot}
              alt={t("templatesPage.communityScreenshotAlt", {
                name: app.name,
                index: index + 1,
              })}
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
              className="h-auto max-h-[640px] w-full object-cover object-top"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CommunityActionLink({
  app,
  children,
  href,
  primary = false,
}: {
  app: CommunityApp;
  children: ReactNode;
  href: string;
  primary?: boolean;
}) {
  const label = primary ? "primary" : "secondary";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={primary ? "primary-button" : "secondary-button"}
      onClick={(event) => {
        if (primary && app.demoUrl) {
          applyFirstTouchAttributionToLink(event.currentTarget);
        }
        trackEvent("click community app action", {
          app: app.slug,
          action: label,
          location: "community_detail_hero",
        });
      }}
    >
      {children}
    </a>
  );
}

export default function CommunityAppPage() {
  const { locale } = useLocale();
  const t = useT();
  const routeData = useLoaderData<typeof loader>();

  if (!routeData.app && !routeData.hydrated) {
    return (
      <TemplateLandingShell>
        <div
          className="mt-16 h-80 animate-pulse border border-[var(--docs-border)] bg-[var(--bg-secondary)]"
          aria-busy="true"
          aria-hidden="true"
        />
      </TemplateLandingShell>
    );
  }

  if (!routeData.app) {
    return (
      <TemplateLandingShell>
        <Link
          data-an-prefetch="viewport"
          to={sitePathForLocale("/apps", locale)}
          className="mt-12 inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
        >
          <IconArrowLeft size={16} aria-hidden="true" />
          {t("templateDetail.allTemplates")}
        </Link>
        <h1 className="mt-8 text-4xl font-medium tracking-tight">
          {t("templateDetail.notFoundTitle")}
        </h1>
      </TemplateLandingShell>
    );
  }

  const app = routeData.app;
  const primaryUrl = app.demoUrl ?? app.repositoryUrl ?? app.sourceUrl;
  const secondaryUrl = app.demoUrl
    ? (app.repositoryUrl ?? app.sourceUrl)
    : undefined;

  return (
    <TemplateLandingShell>
      <Link
        data-an-prefetch="viewport"
        to={sitePathForLocale("/apps", locale)}
        className="mt-8 inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
      >
        <IconArrowLeft size={16} aria-hidden="true" />
        {t("templateDetail.allTemplates")}
      </Link>

      <TemplateHero
        className="mt-4"
        eyebrow={
          <span className="text-[var(--docs-accent)]">
            {t("templatesPage.communityEyebrow")}
          </span>
        }
        title={app.name}
        description={<p className="m-0">{app.description}</p>}
        headingAction={
          primaryUrl ? (
            <div className="flex flex-wrap items-center gap-3">
              <CommunityActionLink app={app} href={primaryUrl} primary>
                {app.demoUrl ? (
                  <>
                    <IconExternalLink size={16} aria-hidden="true" />
                    {t("templatesPage.tryCommunityApp")}
                  </>
                ) : (
                  <>
                    <IconBrandGithub size={16} aria-hidden="true" />
                    {t("common.customizeIt")}
                  </>
                )}
              </CommunityActionLink>
              {secondaryUrl ? (
                <CommunityActionLink app={app} href={secondaryUrl}>
                  <IconBrandGithub size={16} aria-hidden="true" />
                  {t("templatesPage.viewCommunitySource")}
                </CommunityActionLink>
              ) : null}
            </div>
          ) : undefined
        }
        media={<ScreenshotCarousel app={app} />}
      />

      <section className="border-x border-t border-[var(--docs-border)] px-6 py-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--fg-secondary)]">
          {app.status ? (
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--docs-accent)]">
              {app.status === "new"
                ? t("templatesPage.communityNew")
                : t("templatesPage.communityComingSoon")}
            </span>
          ) : null}
          {app.githubStars && app.githubStars > 0 ? (
            <span>
              {t("templatesPage.communityGithubStars", {
                count: app.githubStars.toLocaleString(locale),
              })}
            </span>
          ) : null}
          {app.sourceLabel ? <span>{app.sourceLabel}</span> : null}
        </div>
        {!app.demoUrl ? (
          <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
            {t("templatesPage.communityNoHostedVersion")}
          </p>
        ) : null}
      </section>
    </TemplateLandingShell>
  );
}
