import type { ReactNode } from "react";

export const ONBOARDING_PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60";

export function OnboardingStepLayout({
  title,
  description,
  header,
  children,
  footer,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={`mx-auto flex w-full max-w-2xl flex-col ${className ?? ""}`}
    >
      {header ??
        (title !== undefined ? (
          <div className="flex flex-col gap-2 pt-2">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-foreground">
              {title}
            </h1>
            {description !== undefined ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        ) : null)}
      <div className={contentClassName ?? "mt-7"}>{children}</div>
      {footer ? (
        <div className="mt-6 flex items-center justify-between gap-2">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
