import { type ReactNode, useEffect, useRef } from "react";
import DocsSidebar from "./DocsSidebar";
import TableOfContents from "./TableOfContents";
import MobileDocsNav from "./MobileDocsNav";
import DocsPrevNext from "./DocsPrevNext";

interface TocItem {
  id: string;
  label: string;
  indent?: boolean;
}

export default function DocsLayout({
  children,
  toc,
}: {
  children: ReactNode;
  toc?: TocItem[];
}) {
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    const headings = article.querySelectorAll("h2[id], h3[id]");
    for (const heading of headings) {
      if (heading.querySelector(".heading-anchor")) continue;
      const anchor = document.createElement("a");
      anchor.href = `#${heading.id}`;
      anchor.className = "heading-anchor";
      // Move all children into the anchor
      while (heading.firstChild) {
        anchor.appendChild(heading.firstChild);
      }
      // Add the # indicator
      const hash = document.createElement("span");
      hash.className = "heading-anchor-hash";
      hash.textContent = "#";
      anchor.appendChild(hash);
      heading.appendChild(anchor);
    }
  }, [children]);

  return (
    <div className="mx-auto flex max-w-[1440px] px-0 lg:px-6">
      <DocsSidebar />
      <main className="min-w-0 flex-1 border-0 border-[var(--docs-border)] px-4 pb-16 pt-0 sm:px-6 lg:border-x lg:px-12 lg:pt-8">
        <MobileDocsNav />
        <article
          ref={articleRef}
          className="docs-content mx-auto max-w-[720px]"
        >
          {children}
        </article>
        <div className="mx-auto max-w-[720px]">
          <DocsPrevNext />
        </div>
      </main>
      {toc && toc.length > 0 ? (
        <TableOfContents items={toc} />
      ) : (
        <div className="hidden w-[200px] shrink-0 xl:block" />
      )}
    </div>
  );
}
