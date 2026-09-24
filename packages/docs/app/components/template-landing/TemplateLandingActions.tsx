import { useT } from "@agent-native/core/client/i18n";

import { CustomizeTemplatePopover } from "../CustomizeTemplatePopover";
import { firstPartyAppUrl } from "../deployment-links";
import { applyFirstTouchAttributionToLink } from "../marketing-attribution";
import { trackEvent, type Template } from "../TemplateCard";

export type TemplateLandingCtaTemplate = Pick<
  Template,
  "cliCommand" | "demoUrl" | "name" | "slug"
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

  return (
    <>
      <a
        href={firstPartyAppUrl(template.demoUrl)}
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
      <CustomizeTemplatePopover
        template={template}
        location="template_detail"
      />
    </>
  );
}
