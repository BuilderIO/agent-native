import { trackEvent } from "@agent-native/core/client/analytics";
import { useT, useFormatters } from "@agent-native/core/client/i18n";
import { IconCopy, IconLink } from "@tabler/icons-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";

import { buildCampaignCtaUrl } from "../../lib/campaign-links";
import { TemplateFinalCta } from "../template-landing";
import {
  TEMPLATE_SCREENSHOTS,
  getScreenshotTileScaleX,
} from "../template-screenshots";
import { TemplateScreenshot } from "../TemplateScreenshot";
import { Button } from "../website-redesign/ds/button";
import { copyText } from "../website-redesign/ds/clipboard";
import { SectionHeader } from "../website-redesign/ds/section-header";
import { useSnackbar } from "../website-redesign/ds/snackbar";
import { safeHref, type Article } from "./public-content";

export function CampaignView({ item }: { item: Article }) {
  const { slug, job_id, use_case, topic } = item;
  useEffect(() => {
    trackEvent("article_view", { slug, use_case, job_id, topic });
  }, [slug, job_id, use_case, topic]);
  return null;
}

export function CampaignCta({
  item,
  location,
}: {
  item: Article;
  location: "inline" | "band";
}) {
  const [searchParams] = useSearchParams();
  const href = safeHref(
    buildCampaignCtaUrl(item.app_cta_url, item.job_id, searchParams.toString()),
  );
  if (!href) throw new Error("Campaign CTA requires a safe destination");
  return (
    <Button
      href={href}
      variant="primary"
      className="max-w-full whitespace-normal"
      onClick={() => {
        trackEvent("article_cta_click", {
          slug: item.slug,
          use_case: item.use_case,
          job_id: item.job_id,
          topic: item.topic,
          location,
        });
      }}
    >
      {item.cta_label}
    </Button>
  );
}

export function CampaignBand({ item }: { item: Article }) {
  return (
    <TemplateFinalCta contentClassName="campaign-section">
      <div className="flex flex-col items-start gap-[var(--spacing-4)] text-start">
        <SectionHeader heading={item.cta_band_heading} />
        <p className="campaign-body m-0">{item.cta_band_subhead}</p>
        <CampaignCta item={item} location="band" />
      </div>
    </TemplateFinalCta>
  );
}

export function CampaignScreenshot({ item }: { item: Article }) {
  const app = item.apps?.[0];
  if (!app) return null;
  const appKey = app === "plans" ? "plan" : app;
  return (
    <figure className="docs-content m-0">
      <div className="docs-image-frame relative aspect-[1200/750] overflow-hidden rounded-xl">
        <TemplateScreenshot
          variants={TEMPLATE_SCREENSHOTS[appKey]}
          frame
          alt={item.screenshot_alt ?? item.title}
          scaleX={getScreenshotTileScaleX(appKey)}
          sizes="(max-width: 767px) 100vw, 1200px"
        />
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

export function CampaignDate({
  date,
  kind = "updated",
}: {
  date: string;
  kind?: "updated" | "published";
}) {
  const t = useT();
  const format = useFormatters();
  return (
    <time dateTime={date}>
      {t(
        kind === "published"
          ? "campaign.publishedDate"
          : "campaign.updatedDate",
        {
          date: format.formatDate(new Date(date), {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }),
        },
      )}
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
