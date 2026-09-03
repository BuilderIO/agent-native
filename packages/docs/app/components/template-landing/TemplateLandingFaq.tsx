"use client";

import { IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";

export type TemplateLandingFaqItem = {
  answer: ReactNode;
  id: string;
  question: ReactNode;
};

type TemplateLandingFaqProps = {
  className?: string;
  eyebrow: ReactNode;
  idPrefix?: string;
  items: readonly TemplateLandingFaqItem[];
  title: ReactNode;
};

export function TemplateLandingFaq({
  className = "",
  eyebrow,
  idPrefix,
  items,
  title,
}: TemplateLandingFaqProps) {
  const generatedId = useId().replaceAll(":", "");
  const regionId = idPrefix ?? `template-landing-faq-${generatedId}`;
  const [openItemId, setOpenItemId] = useState<string | null>(
    items[0]?.id ?? null,
  );
  const headingId = `${regionId}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className={`border border-[var(--docs-border)] ${className}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--docs-border)] px-6 py-8 sm:px-8 lg:w-1/3 lg:border-b-0 lg:border-e lg:py-8 lg:ps-8 lg:pe-16">
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.28px]">
            {eyebrow}
          </div>
          <h2
            id={headingId}
            className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-[-0.56px] text-[var(--fg)]"
          >
            {title}
          </h2>
        </div>

        <div className="flex min-w-0 flex-1 flex-col border-t border-[var(--docs-border)] lg:border-t-0">
          {items.map((item) => {
            const isOpen = openItemId === item.id;
            const triggerId = `${regionId}-${item.id}-trigger`;
            const panelId = `${regionId}-${item.id}-panel`;

            return (
              <div
                key={item.id}
                data-state={isOpen ? "open" : "closed"}
                className={`border-t border-[var(--docs-border)] first:border-t-0 ${
                  isOpen ? "bg-[var(--bg)]" : "bg-[var(--bg-secondary)]"
                }`}
              >
                <h3 className="m-0">
                  <button
                    id={triggerId}
                    type="button"
                    aria-controls={panelId}
                    aria-expanded={isOpen}
                    onClick={() => setOpenItemId(isOpen ? null : item.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-4 px-6 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-inset sm:px-8"
                  >
                    <span className="text-lg font-medium leading-[1.15] tracking-[-0.36px] text-[var(--fg)]">
                      {item.question}
                    </span>
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg)] text-[var(--fg)]">
                      <IconChevronDown
                        aria-hidden="true"
                        className={`size-[18px] transition-transform duration-200 ease-[var(--ease-collapse)] motion-reduce:transition-none ${
                          isOpen ? "rotate-180" : ""
                        }`}
                        stroke={1.75}
                      />
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-hidden={!isOpen}
                  aria-labelledby={triggerId}
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-collapse)] motion-reduce:transition-none ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-6 pb-6 pe-16 sm:px-8 sm:pe-20">
                      <div className="text-lg leading-[1.3] text-[var(--fg-secondary)]">
                        {item.answer}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
