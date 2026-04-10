import { useEffect, useState } from "react";

interface TocItem {
  id: string;
  label: string;
  indent?: boolean;
}

export default function TableOfContents({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");
  const [headingLevels, setHeadingLevels] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    // Detect heading levels for indentation
    const levels: Record<string, number> = {};
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) {
        const tag = el.tagName.toLowerCase();
        levels[item.id] = tag === "h3" ? 1 : tag === "h4" ? 2 : 0;
      }
    }
    setHeadingLevels(levels);
  }, [items]);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[];

    if (headings.length === 0) return;

    // How far from the top of the viewport a heading is considered "active"
    const OFFSET = 120;

    const getActiveId = () => {
      // Walk headings in order; the last one whose top edge is above OFFSET is active
      let active = headings[0]?.id ?? "";
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= OFFSET) {
          active = heading.id;
        } else {
          break;
        }
      }
      return active;
    };

    // Set immediately on mount so the sidebar isn't blank
    setActiveId(getActiveId());

    const onScroll = () => {
      const next = getActiveId();
      setActiveId((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
                style={
                  headingLevels[item.id] || item.indent
                    ? { paddingLeft: 12 * (headingLevels[item.id] || 1) }
                    : undefined
                }
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
