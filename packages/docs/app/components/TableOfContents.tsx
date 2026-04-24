import { useEffect, useState } from "react";

interface TocItem {
  id: string;
  label: string;
  indent?: boolean;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

export default function TableOfContents({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");
  const [headingLevels, setHeadingLevels] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
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

    const OFFSET = 120;

    const getActiveId = () => {
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

    const firstEl = document.getElementById(ids[0]);
    const scrollTarget = findScrollParent(firstEl);

    setActiveId(getActiveId());

    const onScroll = () => {
      const next = getActiveId();
      setActiveId((prev) => (prev === next ? prev : next));
    };
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollTarget.removeEventListener("scroll", onScroll);
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
