import { useT } from "@agent-native/core/client";
import {
  IconExternalLink,
  IconPlus,
  IconRosetteDiscountCheck,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import {
  PRODUCTION_DESIGN_SYSTEM_TEMPLATES,
  type DesignSystemTemplateId,
  type ProductionDesignSystemTemplate,
} from "../../../shared/design-system-templates";

const descriptionKeys: Record<DesignSystemTemplateId, string> = {
  "material-3": "designSystems.showcase.descriptions.material3",
  "carbon-white": "designSystems.showcase.descriptions.carbon",
  "primer-light": "designSystems.showcase.descriptions.primer",
};

export function ProductionDesignSystemShowcase({
  pendingTemplateId,
  onAdd,
}: {
  pendingTemplateId: DesignSystemTemplateId | null;
  onAdd: (templateId: DesignSystemTemplateId) => void;
}) {
  const t = useT();

  return (
    <section aria-labelledby="production-design-systems-heading">
      <div className="mb-4 flex max-w-2xl items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <IconRosetteDiscountCheck className="size-4 text-muted-foreground" />
        </div>
        <div>
          <h2
            id="production-design-systems-heading"
            className="text-base font-semibold text-foreground"
          >
            {t("designSystems.showcase.title")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("designSystems.showcase.description")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PRODUCTION_DESIGN_SYSTEM_TEMPLATES.map((template) => {
          const isPending = pendingTemplateId === template.id;
          return (
            <article
              key={template.id}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <ProductionSystemPreview template={template} />
              <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {template.organization}
                  </span>
                  <span className="truncate rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono !text-[10px] text-muted-foreground">
                    {template.version}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">
                  {template.title}
                </h3>
                <p className="mt-1 min-h-16 text-xs leading-relaxed text-muted-foreground">
                  {t(descriptionKeys[template.id])}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 cursor-pointer"
                    disabled={pendingTemplateId !== null}
                    onClick={() => onAdd(template.id)}
                  >
                    {isPending ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <IconPlus className="size-3.5" />
                    )}
                    {isPending
                      ? t("designSystems.showcase.adding")
                      : t("designSystems.showcase.useTemplate")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    asChild
                  >
                    <a
                      href={template.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("designSystems.showcase.openSource", {
                        title: template.sourceLabel,
                      })}
                    >
                      <IconExternalLink className="size-3.5" />
                    </a>
                  </Button>
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground/70">
                  {t("designSystems.showcase.license", {
                    license: template.license,
                  })}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProductionSystemPreview({
  template,
}: {
  template: ProductionDesignSystemTemplate;
}) {
  if (template.id === "material-3") {
    return (
      <div
        aria-hidden="true"
        className="aspect-[16/9] border-b border-border p-4"
        style={{ backgroundColor: template.data.colors.background }}
      >
        <div className="flex h-full flex-col rounded-[12px] bg-[#F3EDF7] p-3">
          <div className="h-2 w-16 rounded-full bg-[#49454F]/35" />
          <div className="mt-3 grid flex-1 grid-cols-[1fr_44px] gap-2">
            <div className="rounded-[12px] bg-[#EADDFF] p-2">
              <div className="h-2 w-3/4 rounded-full bg-[#21005D]/65" />
              <div className="mt-2 h-2 w-1/2 rounded-full bg-[#21005D]/25" />
            </div>
            <div className="rounded-[16px] bg-[#7D5260]" />
          </div>
          <div className="mt-2 ms-auto h-6 w-20 rounded-full bg-[#6750A4]" />
        </div>
      </div>
    );
  }

  if (template.id === "carbon-white") {
    return (
      <div
        aria-hidden="true"
        className="aspect-[16/9] border-b border-border bg-white"
      >
        <div className="flex h-8 items-center bg-[#161616] px-3">
          <div className="h-2 w-14 bg-white/80" />
          <div className="ms-auto h-2 w-8 bg-white/35" />
        </div>
        <div className="grid h-[calc(100%-2rem)] grid-cols-[32%_1fr]">
          <div className="bg-[#F4F4F4] p-3">
            <div className="h-2 w-full bg-[#525252]/35" />
            <div className="mt-2 h-2 w-3/4 bg-[#525252]/20" />
            <div className="mt-4 h-6 w-full bg-[#0F62FE]" />
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 gap-px bg-[#E0E0E0]">
              <div className="h-10 bg-white" />
              <div className="h-10 bg-white" />
              <div className="h-10 bg-white" />
            </div>
            <div className="mt-3 h-2 w-4/5 bg-[#161616]/70" />
            <div className="mt-2 h-2 w-3/5 bg-[#525252]/30" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="aspect-[16/9] border-b border-border bg-white p-3"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-md border border-[#D1D9E0]">
        <div className="flex h-8 items-center border-b border-[#D1D9E0] bg-[#F6F8FA] px-2">
          <div className="size-3 rounded-full bg-[#1F2328]" />
          <div className="ms-2 h-2 w-16 rounded-full bg-[#1F2328]/55" />
          <div className="ms-auto h-4 w-10 rounded-md border border-[#D1D9E0] bg-white" />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-2 px-3">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-[#1A7F37]" />
            <div className="h-2 w-3/5 rounded-full bg-[#1F2328]/70" />
            <div className="ms-auto h-4 w-12 rounded-full bg-[#DDF4FF]" />
          </div>
          <div className="h-px bg-[#D8DEE4]" />
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-[#0969DA]" />
            <div className="h-2 w-2/5 rounded-full bg-[#59636E]/45" />
          </div>
        </div>
      </div>
    </div>
  );
}
