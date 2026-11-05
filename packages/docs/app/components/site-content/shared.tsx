import { trackEvent } from "@agent-native/core/client/analytics";
import { useT, useFormatters } from "@agent-native/core/client/i18n";
import { IconCopy, IconLink } from "@tabler/icons-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";

import { buildSiteContentCtaUrl } from "../../lib/site-content-links";
import { TemplateFinalCta } from "../template-landing";
import { Button } from "../website-redesign/ds/button";
import { copyText } from "../website-redesign/ds/clipboard";
import { useSnackbar } from "../website-redesign/ds/snackbar";
import { safeHref, type Article } from "./public-content";

export function SiteContentView({ item }: { item: Article }) {
  const { slug, type, app, use_case } = item;
  useEffect(() => {
    trackEvent("article_view", { slug, type, app, use_case });
  }, [slug, type, app, use_case]);
  return null;
}

export function SiteContentCta({
  item,
  location,
}: {
  item: Article;
  location: "inline" | "band";
}) {
  const [searchParams] = useSearchParams();
  if (!item.cta) return null;
  const href = safeHref(
    buildSiteContentCtaUrl(
      item.cta.url,
      `article-${item.slug}`,
      searchParams.toString(),
    ),
  );
  if (!href) throw new Error("SiteContent CTA requires a safe destination");
  return (
    <Button
      href={href}
      variant="primary"
      className="max-w-full whitespace-normal"
      onClick={() => {
        trackEvent("article_cta_click", {
          slug: item.slug,
          app: item.app,
          use_case: item.use_case,
          location,
        });
      }}
    >
      {item.cta.label}
    </Button>
  );
}

// The guide's app: its heading, the button to open it, and a prompt to paste into its agent.
export function SiteContentCallout({
  item,
  location,
}: {
  item: Article;
  location: "inline" | "band";
}) {
  const t = useT();
  const notify = useSnackbar();
  if (!item.cta?.heading || !item.app) return null;
  const { heading, prompt } = item.cta;
  const Heading = location === "band" ? "h2" : "p";
  return (
    <div className={`site-content-callout site-content-callout-${location}`}>
      <Heading className="site-content-callout-heading">{heading}</Heading>
      <div className="flex flex-wrap items-center gap-3">
        <SiteContentCta item={item} location={location} />
        {prompt ? (
          <Button
            variant="secondary"
            icon={null}
            onClick={() => {
              void copyText(prompt).then((copied) => {
                notify(
                  t(copied ? "siteContent.copied" : "siteContent.copyFailed"),
                );
                if (copied)
                  trackEvent("article_prompt_copy", {
                    slug: item.slug,
                    app: item.app,
                    location,
                  });
              });
            }}
          >
            <IconCopy size={16} aria-hidden="true" />
            {t("siteContent.copyPrompt")}
          </Button>
        ) : null}
      </div>
      {prompt ? (
        <p className="site-content-callout-hint">
          {t("siteContent.promptHint", { app: item.app })}
        </p>
      ) : null}
    </div>
  );
}

export function SiteContentBand({ item }: { item: Article }) {
  if (!item.cta?.heading || !item.app) return null;
  return (
    <TemplateFinalCta contentClassName="site-content-section">
      <div className="mx-auto w-full max-w-[760px]">
        <SiteContentCallout item={item} location="band" />
      </div>
    </TemplateFinalCta>
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

export function SiteContentDate({
  date,
  kind = "updated",
  month = "long",
}: {
  date: string;
  kind?: "updated" | "published";
  /** "short" (Oct) where space is tight, such as article cards. */
  month?: "long" | "short";
}) {
  const t = useT();
  const format = useFormatters();
  return (
    <time dateTime={date}>
      {t(
        kind === "published"
          ? "siteContent.publishedDate"
          : "siteContent.updatedDate",
        {
          date: format.formatDate(new Date(date), {
            year: "numeric",
            month,
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
      aria-label={
        heading ? t("siteContent.copyLink") : t("siteContent.copyPage")
      }
      onClick={async () => {
        const value = heading
          ? `${window.location.origin}${window.location.pathname}#${text}`
          : text;
        const copied = await copyText(value);
        notify(t(copied ? "siteContent.copied" : "siteContent.copyFailed"));
      }}
      className={
        heading
          ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          : undefined
      }
    >
      <Icon size={16} aria-hidden="true" />
      {heading ? null : t("siteContent.copyPage")}
    </Button>
  );
}
