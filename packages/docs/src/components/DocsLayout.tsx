import type { ReactNode } from "react";
import DocsSidebar from "./DocsSidebar";
import TableOfContents from "./TableOfContents";

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
  return (
    <div className="mx-auto flex max-w-[1440px] px-6">
      <DocsSidebar />
      <main className="min-w-0 flex-1 border-x border-[var(--border)] px-8 pb-16 pt-8 lg:px-12">
        <article className="docs-content mx-auto max-w-[720px]">
          {children}
        </article>
      </main>
      {toc && toc.length > 0 ? (
        <TableOfContents items={toc} />
      ) : (
        <div className="hidden w-[200px] shrink-0 xl:block" />
      )}
    </div>
  );
}
