import { redirect } from "react-router";

import { docsLocaleFromSegment } from "../components/docs-locale";

export function redirectLocalizedSiteContent(
  request: Request,
  locale: unknown,
  pathname: string,
) {
  if (!docsLocaleFromSegment(locale)) throw new Response(null, { status: 404 });
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error(
      "Localized site content redirects require a root-relative path",
    );
  }
  return redirect(`${pathname}${new URL(request.url).search}`, 301);
}
