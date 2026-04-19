/**
 * Shared booking-link / event-type UI components. Consumers:
 *   - calendar template → app/pages/BookingLinksPage
 *   - scheduling template → app/routes/_app.event-types.$id
 *
 * Every component here renders with the consumer's shadcn primitives
 * imported via `@/components/ui/*`. See the top of each file for the
 * list of primitives required.
 */
export * from "./AvailabilityEditor.js";
export * from "./BookingLinkCreateDialog.js";
export * from "./ConferencingSelector.js";
export * from "./CustomFieldsEditor.js";
export * from "./DurationPicker.js";
export * from "./SlugEditor.js";
