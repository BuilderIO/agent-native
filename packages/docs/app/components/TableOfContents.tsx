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
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;

    // How far from the top of the viewport a heading is considered "active"
    const OFFSET = 120;

    const getActiveId = () => {
      // Query elements fresh each time — MarkdownRenderer replaces the DOM
      // when async syntax highlighting finishes, which detaches old nodes.
      let active = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= OFFSET) {
          active = id;
        } else if (el) {
          break;
        }
      }
      return active;
    };

    setActiveId(getActiveId());

    const onScroll = () => {
      const next = getActiveId();
      setActiveId((prev) => (prev === next ? prev : next));
    };
    // Capture phase catches scroll events from any ancestor (e.g. AgentSidebar's overflow-auto div)
    document.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    return () =>
      document.removeEventListener("scroll", onScroll, { capture: true });
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
