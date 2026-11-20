import { useT } from "@agent-native/core/client/i18n";
import {
  TEMPLATE_IDS,
  templateOutline,
  type TemplateId,
} from "@shared/form-templates";

import {
  templateNameKey,
  templateDescriptionKey,
} from "@/components/editor/welcome/template-keys";
import { TemplateThumbnail } from "@/components/templates/TemplateThumbnail";
import { cn } from "@/lib/utils";

const OUTLINES = Object.fromEntries(
  TEMPLATE_IDS.map((id) => [id, templateOutline(id)]),
) as Record<TemplateId, ReturnType<typeof templateOutline>>;

export function TemplateRow({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (id: TemplateId) => void;
}) {
  const t = useT();
  return (
    <section
      aria-label={t("forms.templates.startFromTemplate")}
      className="mb-10"
    >
      <h2 className="mb-3 flex h-[30px] items-center text-lg leading-[20.7px] font-bold text-[color:var(--forms-ink-heading)]">
        {t("forms.templates.startFromTemplate")}
      </h2>
      <div className="grid grid-cols-3 gap-[5px]">
        {TEMPLATE_IDS.map((id) => (
          <div
            key={id}
            className={cn(
              "relative flex min-w-0 flex-col items-start gap-2 rounded-[7px] border border-border p-2.5 text-left hover:bg-accent/50",
              disabled && "opacity-60",
            )}
          >
            <TemplateThumbnail id={id} />
            <button
              type="button"
              disabled={disabled}
              title={t(templateDescriptionKey(id))}
              onClick={() => onPick(id)}
              className="flex w-full min-w-0 flex-col items-start px-1 text-left after:absolute after:inset-0"
            >
              <span className="w-full truncate text-sm leading-5 font-medium">
                {t(templateNameKey(id))}
              </span>
              <span className="text-[13px] leading-[18px] font-medium text-muted-foreground">
                {t("forms.templates.questionCount", {
                  count: OUTLINES[id].questions.length,
                })}
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
