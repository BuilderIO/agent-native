import { trackEvent } from "@agent-native/core/client/analytics";
import { useT, useFormatters } from "@agent-native/core/client/i18n";
import { IconCopy, IconLink } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { buildCampaignCtaUrl } from "../../lib/campaign-links";
import { BuilderImage } from "../builder-image";
import { TemplateFinalCta } from "../template-landing";
import { Button } from "../website-redesign/ds/button";
import { copyText } from "../website-redesign/ds/clipboard";
import { useSnackbar } from "../website-redesign/ds/snackbar";
import { safeHref, type Article, type UseCase } from "./public-content";

export function CampaignView({ item }: { item: UseCase | Article }) {
  const article = "category" in item;
  const { slug, job_id } = item;
  const app = article ? undefined : item.app;
  const use_case = article ? item.use_case : undefined;
  const category = article ? item.category : undefined;
  useEffect(() => {
    trackEvent(
      article ? "article_view" : "use_case_view",
      article ? { slug, use_case, job_id, category } : { slug, job_id, app },
    );
  }, [article, slug, job_id, app, use_case, category]);
  return null;
}

export function CampaignCta({
  item,
  location,
}: {
  item: UseCase | Article;
  location: "hero" | "inline" | "band";
}) {
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), [item.slug]);
  const href = safeHref(
    buildCampaignCtaUrl(item.app_cta_url, item.job_id, search),
  );
  if (!href) throw new Error("Campaign CTA requires a safe destination");
  return (
    <Button
      href={href}
      variant="primary"
      className="max-w-full whitespace-normal"
      onClick={() => {
        trackEvent(
          "category" in item ? "article_cta_click" : "use_case_cta_click",
          "category" in item
            ? {
                slug: item.slug,
                use_case: item.use_case,
                job_id: item.job_id,
                category: item.category,
                location,
              }
            : { slug: item.slug, job_id: item.job_id, app: item.app, location },
        );
      }}
    >
      {item.cta_label}
    </Button>
  );
}

export function CampaignBand({ item }: { item: UseCase | Article }) {
  return (
    <TemplateFinalCta
      title={item.cta_band_heading}
      actions={<CampaignCta item={item} location="band" />}
    >
      <p className="m-0 px-6 text-lg text-[var(--fg-secondary)] sm:px-8">
        {item.cta_band_subhead}
      </p>
    </TemplateFinalCta>
  );
}

export function CampaignScreenshot({
  item,
}: {
  item: Pick<Article, "screenshot_url" | "screenshot_alt" | "screenshot_brief">;
}) {
  const t = useT();
  const url =
    item.screenshot_url && !/^TODO\b/i.test(item.screenshot_url)
      ? safeHref(item.screenshot_url)
      : undefined;
  return (
    <figure className="docs-content m-0">
      <div className="docs-image-frame">
        {url ? (
          <BuilderImage
            src={url}
            alt={item.screenshot_alt}
            loading="lazy"
            sizes="(max-width: 767px) 100vw, 1200px"
            className="block h-auto w-full"
          />
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="m-0 font-mono font-semibold">
              {t("campaign.screenshotTodo")}
            </p>
            <p className="m-0 max-w-xl text-[var(--b-text-secondary)]">
              {item.screenshot_brief}
            </p>
          </div>
        )}
      </div>
    </figure>
  );
}

export function JsonLd({ value }: { value: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(value)
          .replace(/</g, "\\u003c")
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029"),
      }}
    />
  );
}

export function faqSchema(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

export function CampaignDate({ date }: { date: string }) {
  const format = useFormatters();
  return (
    <time dateTime={date}>
      {format.formatDate(new Date(date), {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })}
    </time>
  );
}

export function CopyControl({
  text,
  heading = false,
}: {
  text: string;
  heading?: boolean;
}) {
  const t = useT();
  const notify = useSnackbar();
  const Icon = heading ? IconLink : IconCopy;
  return (
    <Button
      variant="tertiary"
      icon={null}
      aria-label={heading ? t("campaign.copyLink") : t("campaign.copyPage")}
      onClick={async () => {
        const value = heading
          ? `${window.location.origin}${window.location.pathname}#${text}`
          : text;
        const copied = await copyText(value);
        notify(t(copied ? "campaign.copied" : "campaign.copyFailed"));
      }}
      className={
        heading
          ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          : undefined
      }
    >
      <Icon size={16} aria-hidden="true" />
      {heading ? null : t("campaign.copyPage")}
    </Button>
  );
}
