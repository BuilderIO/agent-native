import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TemplateFinalCtaProps = Omit<
  ComponentPropsWithoutRef<"section">,
  "title"
> & {
  actions?: ReactNode;
  eyebrow?: ReactNode;
  headerAction?: ReactNode;
  title: ReactNode;
};

export function TemplateFinalCta({
  actions,
  children,
  className = "",
  eyebrow,
  headerAction,
  title,
  ...props
}: TemplateFinalCtaProps) {
  return (
    <section
      className={`border-t border-[var(--docs-border)] ${className}`}
      {...props}
    >
      <div className="flex flex-col gap-6 border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:pb-14 sm:pt-24 lg:pb-20 lg:pt-32">
        <div>
          {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-[-0.56px] text-[var(--fg)] sm:text-4xl lg:text-[2.875rem] lg:tracking-[-0.92px]">
            {title}
          </h2>
        </div>
        {headerAction}
      </div>

      {children ? (
        <div className="border-x border-[var(--docs-border)] pb-16">
          {children}
        </div>
      ) : null}

      {actions ? (
        <div className="template-detail-cta-actions flex flex-col items-stretch justify-center gap-3 border-x border-t border-[var(--docs-border)] px-6 py-10 sm:flex-row sm:items-center sm:gap-[120px] sm:px-8">
          {actions}
        </div>
      ) : null}
    </section>
  );
}
