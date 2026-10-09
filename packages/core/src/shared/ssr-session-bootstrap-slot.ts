import { createContext } from "react";

import {
  getSsrSessionBootstrapScriptBody,
  SSR_SESSION_BOOTSTRAP_MARKER,
} from "./ssr-session-bootstrap.js";

/**
 * A server render calls this with the session path of the early session read
 * its document starts, and the document request handler starts that read from
 * the top of `<head>`. Rendered in the body instead, the script waits for every
 * stylesheet above it to load. Absent outside that handler's render.
 */
export const SsrSessionBootstrapContext = createContext<
  ((sessionPath: string) => void) | null
>(null);

export function getSsrSessionBootstrapScriptTag(sessionPath: string): string {
  return `<script ${SSR_SESSION_BOOTSTRAP_MARKER}>${getSsrSessionBootstrapScriptBody(sessionPath)}</script>`;
}
