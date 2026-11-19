import type { LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/site-content";
import { redirectLocalizedSiteContent } from "./localized-site-content-redirect";

export function loader({ params, request }: LoaderFunctionArgs) {
  return redirectLocalizedSiteContent(
    request,
    params.locale,
    `${USE_CASES_BASE}/`,
  );
}
