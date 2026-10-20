import type { LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/campaign-content";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export function loader({ params, request }: LoaderFunctionArgs) {
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${USE_CASES_BASE}/`,
  );
}
