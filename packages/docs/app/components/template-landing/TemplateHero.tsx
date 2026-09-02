import type { ReactNode } from "react";

import { CustomizeTemplatePopover } from "../CustomizeTemplatePopover";

type TemplateHeroTemplate = {
  cliCommand: string;
  name: string;
  slug: string;
};

type TemplateHeroProps = {
  action?: ReactNode;
  className?: string;
  description: ReactNode;
  eyebrow: ReactNode;
  headerClassName?: string;
  headingAction?: ReactNode;
  media: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  customizeTemplate?: TemplateHeroTemplate;
  /** Place the description under the title instead of in the right column. */
  descriptionPlacement?: "side" | "below-title";
};

export function TemplateHero({
  action,
  className = "",
  description,
  eyebrow,
  headerClassName = "",
  headingAction,
  media,
  title,
  titleClassName = "",
  customizeTemplate,
  descriptionPlacement = "side",
}: TemplateHeroProps) {
  const belowTitle = descriptionPlacement === "below-title";

  const descriptionBlock = (
    <div
      className={
        belowTitle
          ? "lg:col-span-2 lg:col-start-1 lg:row-start-3"
          : "lg:col-start-3 lg:row-start-2 lg:self-center lg:ps-8"
      }
    >
      <div
        className={`font-sans text-[15px] font-normal leading-[1.4] text-[var(--fg-secondary)] ${belowTitle ? "max-w-[440px]" : "max-w-[300px]"}`}
      >
        {description}
      </div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );

  return (
    <section className={className}>
      <div className="relative overflow-hidden border-x border-[var(--docs-border)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden lg:grid lg:grid-cols-3"
        >
          <div />
          <div className="border-x border-[var(--docs-border)]" />
          <div />
        </div>

        <div
          className={`relative grid gap-3 px-6 pb-10 pt-12 sm:gap-4 sm:px-10 sm:pb-14 sm:pt-16 lg:grid-cols-3 lg:gap-6 lg:pb-20 lg:pt-24 ${headerClassName}`}
        >
          <div className="font-mono text-[15px] font-bold tracking-[0.14em] lg:col-start-1 lg:row-start-1">
            {eyebrow}
          </div>

          <h1
            className={`m-0 font-medium leading-[1.05] tracking-tight lg:col-span-2 lg:col-start-1 lg:row-start-2 ${titleClassName || "text-[1.75rem] sm:text-[2.25rem] lg:text-[2.5rem]"}`}
          >
            {title}
          </h1>

          {belowTitle ? descriptionBlock : null}

          {headingAction || customizeTemplate ? (
            <div
              className={`mt-3 lg:col-span-2 lg:col-start-1 ${belowTitle ? "lg:row-start-4" : "lg:row-start-3"}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                {headingAction}
                {customizeTemplate ? (
                  <CustomizeTemplatePopover
                    template={customizeTemplate}
                    location="template_detail"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {belowTitle ? null : descriptionBlock}
        </div>

        <div className="relative py-3 sm:py-4 lg:py-5">{media}</div>
      </div>
    </section>
  );
}
