import { messagesByLocale } from "@/i18n-data";

import DesignEditorRoute from "../pages/DesignEditor";

/**
 * The skill's local editor has its own route so a capability can authorize this
 * surface without widening ordinary public `/design/:id` links.
 */
export default function LocalVisualEditRoute() {
  return <DesignEditorRoute />;
}

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designEditor }];
}
