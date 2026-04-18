/**
 * Styled components for the scheduling package.
 *
 * These components import shadcn primitives from the consumer via the
 * `@/components/ui/*` alias — the package doesn't bundle shadcn. See each
 * component file for the list of primitives it expects.
 *
 * NOTE: In v0.1 the main `<Booker>` lives in the scheduling template first.
 * Once its API stabilizes we hoist it here (v0.2).
 */
export * from "./SlotPicker.js";
export * from "./TimezoneSelect.js";
