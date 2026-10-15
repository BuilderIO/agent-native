import { redirect, type LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE } from "../../lib/campaign-content";
import { sitePathForLocale } from "../components/docs-locale";

export function loader({ params }: LoaderFunctionArgs) {
  return redirect(sitePathForLocale(ARTICLES_BASE, params.locale), 301);
}
