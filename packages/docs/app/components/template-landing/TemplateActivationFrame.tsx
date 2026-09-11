import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TemplateActivationFrameProps = ComponentPropsWithoutRef<"section"> & {
  heading?: ReactNode;
};

export function TemplateActivationFrame({
  children,
  className = "",
  heading,
  ...props
}: TemplateActivationFrameProps) {
  const hasHeading = Boolean(heading);

  return (
    <section
      className={`border-t border-[var(--docs-border)] ${className}`}
      {...props}
    >
      <div className="flex flex-col border-y border-[var(--docs-border)] lg:flex-row lg:items-stretch lg:border-x">
        {hasHeading ? (
          <div className="flex items-center border-b border-[var(--docs-border)] px-6 py-8 sm:px-10 lg:w-1/3 lg:shrink-0 lg:border-b-0 lg:border-e lg:py-8 lg:ps-8 lg:pe-16">
            <div className="max-w-[320px]">{heading}</div>
          </div>
        ) : null}
        <div
          className={`flex min-w-0 flex-1 items-center px-6 py-8 sm:px-10 lg:px-8 ${
            hasHeading ? "lg:w-2/3 lg:flex-none" : "lg:w-full"
          }`}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
