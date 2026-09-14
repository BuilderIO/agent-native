import { IconChevronDown } from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";

export interface FaqAccordionItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
}

interface FaqAccordionProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  items: readonly FaqAccordionItem[];
  idPrefix?: string;
}

// Sidebar intro (eyebrow + title) beside a single-column accordion, no outer
// box border — matches builder.io/for/engineers's FAQ section so it reads as
// part of the same page rhythm instead of a boxed-off card.
export function FaqAccordion({
  eyebrow,
  title,
  items,
  idPrefix,
}: FaqAccordionProps) {
  const generatedId = useId().replaceAll(":", "");
  const regionId = idPrefix ?? `faq-${generatedId}`;
  const [openItemId, setOpenItemId] = useState<string | null>(
    items[0]?.id ?? null,
  );
  const headingId = `${regionId}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col lg:flex-row lg:items-stretch"
    >
      <div className="flex shrink-0 flex-col gap-[var(--spacing-3)] border-b border-solid border-[var(--b-border-subtle)] px-[var(--spacing-8)] py-[var(--spacing-8)] lg:w-1/3 lg:border-b-0 lg:border-e lg:py-[var(--spacing-8)] lg:pe-[var(--spacing-16)]">
        {eyebrow ? (
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={headingId}
          className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]"
        >
          {title}
        </h2>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {items.map((item, index) => {
          const isOpen = openItemId === item.id;
          const triggerId = `${regionId}-${item.id}-trigger`;
          const panelId = `${regionId}-${item.id}-panel`;

          return (
            <div
              key={item.id}
              data-state={isOpen ? "open" : "closed"}
              className={`border-solid border-[var(--b-border-subtle)] ${index > 0 ? "border-t" : ""} ${isOpen ? "bg-[var(--b-bg-page)]" : "bg-[var(--b-bg-raised)]"}`}
            >
              <h3 className="m-0">
                <button
                  id={triggerId}
                  type="button"
                  aria-controls={panelId}
                  aria-expanded={isOpen}
                  onClick={() => setOpenItemId(isOpen ? null : item.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-[var(--spacing-4)] px-[var(--spacing-8)] py-[var(--spacing-4)] text-start outline-none focus-visible:ring-2 focus-visible:ring-[var(--b-text-primary)] focus-visible:ring-inset"
                >
                  <span className="font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-6)] font-medium leading-[1.15] text-[var(--b-text-primary)]">
                    {item.question}
                  </span>
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] text-[var(--b-text-primary)]">
                    <IconChevronDown
                      aria-hidden="true"
                      className={`size-[18px] transition-transform duration-200 motion-reduce:transition-none ${
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
                className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${
                  isOpen
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-[var(--spacing-8)] pb-[var(--spacing-6)]">
                    <div className="font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
                      {item.answer}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
