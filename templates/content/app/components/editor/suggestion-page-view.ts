export function scrollSuggestionIntoPageView(
  suggestionId: string,
  scrollContainer: HTMLElement | null,
) {
  const pageTarget = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-suggestion-id="${CSS.escape(suggestionId)}"]`,
    ),
  ).find((target) => target.closest(".content-editor"));
  const viewport = scrollContainer?.getBoundingClientRect();
  if (!pageTarget || !viewport) return;
  const rect = pageTarget.getBoundingClientRect();
  if (rect.top < viewport.top || rect.bottom > viewport.bottom)
    pageTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
