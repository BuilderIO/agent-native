import { messagesByLocale } from "@/i18n-data";

import DesignEditorRoute from "../pages/DesignEditor";

/**
 * Keep the route module itself as a React Fast Refresh boundary. A bare
 * re-export does not register a local component, so an invalidated editor
 * dependency can otherwise propagate into a full-page reload.
 */
export default function DesignRoute() {
  return <DesignEditorRoute />;
}

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designEditor }];
}
