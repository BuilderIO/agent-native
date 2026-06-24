import { redirect, type LoaderFunctionArgs } from "react-router";
import { hasLocalizedDoc } from "../components/docs-content";
import {
  DEFAULT_DOCS_LOCALE,
  docsPathForSlug,
  isDocsLocale,
} from "../components/docs-locale";

export function loader({ params }: LoaderFunctionArgs) {
  const locale = params.locale;
  if (!isDocsLocale(locale)) {
    throw new Response("Not Found", { status: 404 });
  }
  if (locale === DEFAULT_DOCS_LOCALE) {
    throw redirect(
      docsPathForSlug("getting-started", DEFAULT_DOCS_LOCALE),
      302,
    );
  }
  throw redirect(
    docsPathForSlug(
      "getting-started",
      hasLocalizedDoc(locale, "getting-started") ? locale : DEFAULT_DOCS_LOCALE,
    ),
    302,
  );
}
