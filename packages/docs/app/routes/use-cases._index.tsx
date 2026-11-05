import { useLoaderData } from "react-router";

import { USE_CASES_BASE } from "../../lib/site-content";
import { loadSiteContent } from "../../lib/site-content.server";
import { UseCasesIndex } from "../components/site-content/use-cases";
import enUS from "../i18n/en-US";
import { siteContentMeta } from "../lib/site-content-seo";

export const meta = ({ params }: { params?: { locale?: string } } = {}) =>
  siteContentMeta(
    enUS.siteContent.useCases,
    enUS.siteContent.useCasesIntro.replace(
      "{{articles}}",
      enUS.siteContent.articlesLink,
    ),
    USE_CASES_BASE,
    "website",
    params?.locale,
  );
export function loader() {
  return {
    items: loadSiteContent().useCases.map((page) => ({
      slug: page.slug,
      app: page.app,
      roles: page.roles,
      title: page.title,
      subhead: page.hero.body,
    })),
  };
}
export default function UseCasesRoute() {
  const { items } = useLoaderData<typeof loader>();
  return <UseCasesIndex items={items} />;
}
