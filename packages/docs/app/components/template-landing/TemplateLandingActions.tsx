import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Link } from "react-router";

import { sitePathForLocale } from "../docs-locale";
import { applyFirstTouchAttributionToLink } from "../marketing-attribution";
import { TemplateDocsLink } from "../template-docs";
import { trackEvent, type Template } from "../TemplateCard";

export type TemplateLandingCtaTemplate = Pick<
  Template,
  "demoUrl" | "name" | "slug"
>;

type TemplateLandingActionsProps = {
  location?: string;
  template: TemplateLandingCtaTemplate;
};

export function TemplateLandingActions({
  location = "landing_page_cta",
  template,
}: TemplateLandingActionsProps) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <>
      <a
        href={template.demoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="primary-button"
        onClick={(event) => {
          applyFirstTouchAttributionToLink(event.currentTarget);
          trackEvent("try live demo", {
            template: template.slug,
            location,
          });
        }}
      >
        {t("common.tryTemplateFree", { name: template.name })}
      </a>
      <TemplateDocsLink
        template={template}
        location={location}
        className="secondary-button"
      >
        {t("common.readDocs")}
        <IconArrowUpRight aria-hidden="true" className="size-4" />
      </TemplateDocsLink>
      <Link
        data-an-prefetch="viewport"
        to={sitePathForLocale("/apps", locale)}
        className="secondary-button"
      >
        {t("common.viewAllApps")}
        <IconArrowUpRight aria-hidden="true" className="size-4" />
      </Link>
    </>
  );
}
