import { trackEvent, useLocale, useT } from "@agent-native/core/client";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "./docs-locale";

type TemplateLinkTarget = {
  slug: string;
};

export function getTemplateDocsSlug(template: TemplateLinkTarget | string) {
  const slug = typeof template === "string" ? template : template.slug;
  return slug === "video" ? "videos" : slug;
}

export function getTemplateDocsPath(template: TemplateLinkTarget | string) {
  return `/docs/template-${getTemplateDocsSlug(template)}`;
}

export function TemplateDocsLink({
  template,
  location,
  className,
  children,
}: {
  template: TemplateLinkTarget;
  location: string;
  className?: string;
  children?: ReactNode;
}) {
  const { locale } = useLocale();
  const t = useT();

  return (
    <Link
      data-an-prefetch="render"
      to={sitePathForLocale(getTemplateDocsPath(template), locale)}
      onClick={() =>
        trackEvent("click view docs", {
          template: template.slug,
          location,
        })
      }
      className={
        className ??
        "inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
      }
    >
      {children ?? t("common.viewDocs")}
    </Link>
  );
}
