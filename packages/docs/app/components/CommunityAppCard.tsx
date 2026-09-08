import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight, IconBrandGithub } from "@tabler/icons-react";
import { Link } from "react-router";

import { BuilderImage } from "./builder-image";
import type { CommunityApp } from "./community-apps";
import { sitePathForLocale } from "./docs-locale";
import { Button, buttonClassName } from "./website-redesign/ds/button";

// Matches the secondary action on the first-party cards, so the two grids
// read as one set.
const cardSecondaryActionClass = buttonClassName({
  variant: "secondary",
  compact: true,
  className: "flex-1 uppercase",
});

function trackCommunityEvent(
  event: string,
  app: CommunityApp,
  location: string,
) {
  trackEvent(event, { app: app.slug, location });
}

export function CommunityAppCard({ app }: { app: CommunityApp }) {
  const t = useT();
  const { locale } = useLocale();
  const appPath = sitePathForLocale(`/apps/community/${app.slug}`, locale);
  const hasMeta = app.status === "comingSoon" || (app.githubStars ?? 0) > 0;

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden border border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]">
      <Link
        data-an-prefetch="viewport"
        to={appPath}
        className="flex min-w-0 flex-1 flex-col no-underline"
        onClick={() => trackCommunityEvent("click community app", app, "card")}
      >
        <div className="relative flex aspect-[320/256] items-center justify-center overflow-hidden border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)]">
          {app.screenshots[0] ? (
            <BuilderImage
              src={app.screenshots[0]}
              alt={t("templateCard.screenshotAlt", { name: app.name })}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-top transition-transform duration-150 ease-[ease] group-hover:scale-[1.01]"
            />
          ) : null}
        </div>
        <div className="flex flex-auto flex-col items-start gap-[var(--spacing-3)] p-[var(--spacing-5)]">
          <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {app.name}
          </h3>
          {/* Rendered only when it has something to say: an empty row would
              still take a gap from the column above the description. */}
          {hasMeta ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] uppercase tracking-[0.04em] text-[var(--b-text-eyebrow)]">
              {app.status === "comingSoon" ? (
                <span>{t("templatesPage.communityComingSoon")}</span>
              ) : null}
              {app.githubStars && app.githubStars > 0 ? (
                <span>
                  {t("templatesPage.communityGithubStars", {
                    count: app.githubStars.toLocaleString(locale),
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
          <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
            {app.description}
          </p>
        </div>
      </Link>

      <div className="flex flex-wrap gap-2 border-t border-solid border-[var(--b-border-subtle)] px-[var(--spacing-5)] pt-[var(--spacing-4)] pb-[var(--spacing-5)]">
        {/* Prefers the hosted demo and falls back to the app's own page, so
            every card keeps one primary way in — which is what the arrow in
            the title used to be. */}
        <Button
          variant="white"
          icon={IconArrowUpRight}
          compact
          href={app.demoUrl ?? appPath}
          target={app.demoUrl ? "_blank" : undefined}
          rel={app.demoUrl ? "noopener noreferrer" : undefined}
          onClick={() =>
            trackCommunityEvent(
              app.demoUrl ? "click community app demo" : "click community app",
              app,
              "card",
            )
          }
          className="flex-1 uppercase"
        >
          {t("common.tryIt")}
        </Button>
        {(app.repositoryUrl ?? app.sourceUrl) ? (
          <a
            href={app.repositoryUrl ?? app.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackCommunityEvent("click community app source", app, "card")
            }
            className={cardSecondaryActionClass}
          >
            {app.repositoryUrl ? (
              <IconBrandGithub size={14} aria-hidden="true" />
            ) : null}
            {app.repositoryUrl
              ? t("templatesPage.viewRepository")
              : t("templatesPage.viewCommunitySource")}
          </a>
        ) : null}
      </div>
    </article>
  );
}
