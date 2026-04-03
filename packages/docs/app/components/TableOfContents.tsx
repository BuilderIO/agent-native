import { useEffect, useRef, useState } from "react";

interface TocItem {
  id: string;
  label: string;
  indent?: boolean;
}

export default function TableOfContents({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current?.disconnect();

    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[];

    if (headings.length === 0) return;

    // Track which headings are visible; pick the topmost one
    const visibleIds = new Set<string>();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleIds.add(entry.target.id);
          } else {
            visibleIds.delete(entry.target.id);
          }
        }

        // Pick the first visible heading in document order
        for (const item of items) {
          if (visibleIds.has(item.id)) {
            setActiveId(item.id);
            return;
          }
        }

        // If nothing visible, find the last heading above viewport
        const scrollY = window.scrollY + 80;
        let closest = items[0]?.id ?? "";
        for (const heading of headings) {
          if (heading.offsetTop <= scrollY) {
            closest = heading.id;
          }
        }
        setActiveId(closest);
      },
      { rootMargin: "-64px 0px -60% 0px", threshold: 0 },
    );

    for (const heading of headings) {
      observerRef.current.observe(heading);
    }

    return () => observerRef.current?.disconnect();
  }, [items]);

  return (
    <aside className="hidden w-[200px] shrink-0 xl:block">
      <nav className="sticky top-[65px] max-h-[calc(100vh-65px)] overflow-y-auto pb-8 pt-8 pl-4">
        <p className="mb-2 text-xs font-semibold text-[var(--fg-secondary)]">
          On this page
        </p>
        <ul className="list-none space-y-0 p-0">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`toc-link${activeId === item.id ? " is-active" : ""}`}
                style={item.indent ? { paddingLeft: 12 } : undefined}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
