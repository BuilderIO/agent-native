import { IconArrowUpRight } from "@tabler/icons-react";

// Decorative on purpose: every card that shows this is itself a link, so the
// arrow would only repeat that link's accessible name. It fills in on hover
// from the card's `group`, which is why it is a span and not a control.
export const CARD_ARROW_CLASS = [
  "mt-auto flex h-8 w-8 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-transparent text-[var(--b-text-primary)]",
  "transition-[background,border-color,color] duration-150 ease-[ease]",
  "group-hover:border-[var(--b-text-primary)] group-hover:bg-[var(--b-text-primary)] group-hover:text-[var(--b-bg-page)]",
].join(" ");

export function CardArrow() {
  return (
    <span aria-hidden="true" className={CARD_ARROW_CLASS}>
      <IconArrowUpRight size={16} stroke={1.75} />
    </span>
  );
}
