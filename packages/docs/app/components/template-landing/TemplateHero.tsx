import type { ReactNode } from "react";

type TemplateHeroProps = {
  action?: ReactNode;
  className?: string;
  description: ReactNode;
  eyebrow: ReactNode;
  headerClassName?: string;
  media: ReactNode;
  title: ReactNode;
};

export function TemplateHero({
  action,
  className = "",
  description,
  eyebrow,
  headerClassName = "",
  media,
  title,
}: TemplateHeroProps) {
  return (
    <section className={`pt-3 sm:pt-4 lg:pt-5 ${className}`}>
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
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.14em] lg:col-start-1 lg:row-start-1">
            {eyebrow}
          </div>

          <h1 className="m-0 text-[2rem] font-medium leading-[1.05] tracking-tight sm:text-4xl lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:text-[2.875rem]">
            {title}
          </h1>

          <div className="lg:col-start-3 lg:row-start-2 lg:self-center lg:ps-8">
            <div className="max-w-[300px] font-sans text-[15px] font-normal leading-[1.4] text-[var(--fg-secondary)]">
              {description}
            </div>
            {action ? <div className="mt-5">{action}</div> : null}
          </div>
        </div>

        <div className="relative py-3 sm:py-4 lg:py-5">{media}</div>
      </div>
    </section>
  );
}
