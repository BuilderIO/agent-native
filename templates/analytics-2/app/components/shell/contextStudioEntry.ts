import { resolveRoutePage } from "@/components/workspace/pages";

/**
 * Whether the Context Studio entry should be offered.
 *
 * An entry is a link: it is offered only when the route has a page to render.
 * The reference keeps Context Studio out of the primary sidebar (it lives under
 * More), and this app has no studio page yet, so the entry stays out of both
 * places until the page lands - a card in the sidebar that opens nothing is the
 * defect row 122 reports.
 */
export function contextStudioEntryAvailable(): boolean {
  return Boolean(
    resolveRoutePage({
      id: "context-studio",
      view: "setup",
    } as unknown as Parameters<typeof resolveRoutePage>[0]),
  );
}
