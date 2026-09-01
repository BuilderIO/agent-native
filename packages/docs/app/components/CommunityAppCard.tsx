import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconBrandGithub,
  IconExternalLink,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { BuilderImage } from "./builder-image";
import type { CommunityApp } from "./community-apps";
import { sitePathForLocale } from "./docs-locale";

const CARD_ARROW_CLASS = [
  "mt-auto flex h-8 w-8 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-transparent text-[var(--b-text-primary)]",
  "transition-[background,border-color,color] duration-150 ease-[ease]",
  "group-hover:border-[var(--b-text-primary)] group-hover:bg-[var(--b-text-primary)] group-hover:text-[var(--b-bg-page)]",
].join(" ");

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

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden border border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]">
      <Link
        data-an-prefetch="viewport"
        to={appPath}
        className="flex min-w-0 flex-1 flex-col no-underline"
        onClick={() => trackCommunityEvent("click community app", app, "card")}
      >
        <div className="relative flex aspect-[320/256] items-center justify-center overflow-hidden border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-raised)]">
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
          <div className="flex w-full items-start justify-between gap-3">
            <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
              {app.name}
            </h3>
            <span aria-hidden="true" className={CARD_ARROW_CLASS}>
              <IconArrowUpRight size={16} stroke={1.75} />
            </span>
          </div>
          <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
            {app.description}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] uppercase tracking-[0.04em] text-[var(--b-text-muted)]">
            {app.status ? (
              <span>
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
          </div>
        </div>
      </Link>

      <div className="flex flex-wrap gap-2 border-t border-solid border-[var(--b-border-subtle)] p-[var(--spacing-5)] pt-0">
        {app.demoUrl ? (
          <a
            href={app.demoUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackCommunityEvent("click community app demo", app, "card")
            }
            className="inline-flex min-h-8 flex-1 items-center justify-center gap-2 border border-solid border-[var(--b-action-primary-bg)] bg-[var(--b-action-primary-bg)] px-3 py-2 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase leading-none tracking-[0.02em] text-[var(--b-action-primary-text)] no-underline transition-[background-color] duration-150 hover:bg-[var(--b-action-primary-hover)] hover:no-underline"
          >
            <IconExternalLink size={14} aria-hidden="true" />
            {t("templatesPage.tryCommunityApp")}
          </a>
        ) : null}
        {(app.repositoryUrl ?? app.sourceUrl) ? (
          <a
            href={app.repositoryUrl ?? app.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackCommunityEvent("click community app source", app, "card")
            }
            className="inline-flex min-h-8 flex-1 items-center justify-center gap-2 border border-solid border-[var(--b-action-secondary-border)] bg-transparent px-3 py-2 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase leading-none tracking-[0.02em] text-[var(--b-action-secondary-text)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--b-text-primary)] hover:bg-[var(--b-action-secondary-hover)] hover:no-underline"
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
