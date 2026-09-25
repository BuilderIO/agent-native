export function isInsidePortaledLayer(target: EventTarget | null): boolean {
  return Boolean(
    (target as Element | null)?.closest?.(
      "[data-radix-popper-content-wrapper]",
    ),
  );
}
