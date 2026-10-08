import { IconBrandGithub } from "@tabler/icons-react";
import { type ReactNode, useEffect } from "react";
import { useLocation } from "react-router";

import { hasLocalizedDoc } from "./docs-content";
import {
  DEFAULT_DOCS_LOCALE,
  docsLocaleFromPathname,
  docsSlugFromPathname,
} from "./docs-locale";
import { resolveFragmentRedirect } from "./docs-slug-redirects";
import DocsPrevNext from "./DocsPrevNext";
import DocsSidebar from "./DocsSidebar";
import MobileDocsNav from "./MobileDocsNav";
import TableOfContents from "./TableOfContents";

function useLegacyFragmentRedirect(pathname: string, hash: string) {
  useEffect(() => {
    if (!hash) return;
    const slug = docsSlugFromPathname(pathname);
    if (!slug) return;
    const target = resolveFragmentRedirect(slug, hash);
    if (!target) return;
    if (target.startsWith("/docs/")) {
      window.location.replace(target);
      return;
    }
    window.location.hash = target;
    const id = target.slice(1);
    document.getElementById(id)?.scrollIntoView();
  }, [pathname, hash]);
}

interface TocItem {
  id: string;
  label: string;
  level?: number;
  indent?: boolean;
}

const GITHUB_EDIT_BASE_URL =
  "https://github.com/BuilderIO/agent-native/edit/main/packages/core/docs/content";

export function docsEditUrlForPathname(pathname: string): string | undefined {
  const slug = docsSlugFromPathname(pathname);
  if (!slug) return undefined;

  const locale = docsLocaleFromPathname(pathname) ?? DEFAULT_DOCS_LOCALE;
  if (locale !== DEFAULT_DOCS_LOCALE && hasLocalizedDoc(locale, slug)) {
    return `${GITHUB_EDIT_BASE_URL}/locales/${locale}/${slug}.mdx`;
  }
  return `${GITHUB_EDIT_BASE_URL}/${slug}.mdx`;
}

export default function DocsLayout({
  children,
  markdownUrl,
  toc,
}: {
  children: ReactNode;
  markdownUrl?: string;
  toc?: TocItem[];
}) {
  const location = useLocation();
  const editUrl = docsEditUrlForPathname(location.pathname);
  useLegacyFragmentRedirect(location.pathname, location.hash);

  return (
    <div className="mx-auto flex w-full max-w-site px-0 lg:px-6">
      <DocsSidebar />
      <main className="min-w-0 flex-1 border-0 border-[var(--docs-border)] px-4 pb-16 pt-0 sm:px-6 lg:border-x lg:px-12 lg:pt-8">
        <MobileDocsNav />
        <article className="docs-article mx-auto max-w-[900px]">
          {children}
        </article>
        <div className="mx-auto max-w-[900px]">
          <DocsPrevNext />
          {editUrl ? (
            <a
              href={editUrl}
              target="_blank"
              rel="noreferrer"
              className="docs-edit-page-link"
            >
              <IconBrandGithub className="size-4" />
              {/* i18n-ignore -- GitHub's canonical edit action label. */} Edit
              this page on GitHub
            </a>
          ) : null}
        </div>
      </main>
      {toc && toc.length > 0 ? (
        <TableOfContents items={toc} markdownUrl={markdownUrl} />
      ) : (
        <div className="hidden w-[200px] shrink-0 xl:block" />
      )}
    </div>
  );
}
