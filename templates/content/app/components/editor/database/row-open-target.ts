// What a click inside a row or card acts on before the row itself does.
export const DATABASE_ROW_NESTED_CONTROL_SELECTOR =
  "a, button, input, textarea, [role='menuitem']";

const ROW_OPEN_ATTRIBUTE = "data-database-row-open";

// Marks what opens a row when clicked. While a row's panel is open, a press on
// one switches the panel to that row rather than dismissing it. The press comes
// before the click, so dismissing would leave the click nothing to switch.
export function databaseRowOpenTarget(documentId: string) {
  return { [ROW_OPEN_ATTRIBUTE]: documentId };
}

export function databaseRowOpenTargetAt(
  target: EventTarget | null,
): { element: HTMLElement; documentId: string } | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(
    `${DATABASE_ROW_NESTED_CONTROL_SELECTOR}, [${ROW_OPEN_ATTRIBUTE}]`,
  );
  const documentId = element?.getAttribute(ROW_OPEN_ATTRIBUTE);
  return element && documentId ? { element, documentId } : null;
}
