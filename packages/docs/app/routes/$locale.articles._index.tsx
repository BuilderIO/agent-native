import type { LoaderFunctionArgs } from "react-router";

import {
  ARTICLES_BASE,
  translatedArticleLocales,
} from "../../lib/site-content";
import { loadSiteContent } from "../../lib/site-content.server";
import { docsLocaleFromSegment } from "../components/docs-locale";
import { articlesListCopy } from "../lib/articles-copy.server";
import { articlesPageData } from "./articles._index";
import { redirectLocalizedSiteContent } from "./localized-site-content-redirect";

export { default, meta } from "./articles._index";

// The grid is served in a language once an article is translated into it.
export function loader({ params, request }: LoaderFunctionArgs) {
  const locale = docsLocaleFromSegment(params.locale);
  const { articles } = loadSiteContent();
  if (locale && translatedArticleLocales(articles).includes(locale))
    return {
      ...articlesPageData(articles, 1, locale),
      copy: articlesListCopy(locale),
    };
  return redirectLocalizedSiteContent(
    request,
    params.locale,
    `${ARTICLES_BASE}/`,
  );
}
