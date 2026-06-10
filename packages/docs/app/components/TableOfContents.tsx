import { useEffect, useState } from "react";

interface TocItem {
  id: string;
  label: string;
  /** Heading depth: 2=top-level, 3=indented, 4=double-indented */
  level?: number;
  /** Legacy boolean alias — treated as level 3 when true */
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

export function getActiveTocId(
  ids: string[],
  getElementById: (
    id: string,
  ) => Pick<HTMLElement, "getBoundingClientRect"> | null,
  offset = 120,
) {
  let active = ids[0] ?? "";
  for (const id of ids) {
    const el = getElementById(id);
    if (el && el.getBoundingClientRect().top <= offset) {
      active = id;
    } else if (el) {
      break;
    }
  }
  return active;
}

/** Resolve indent depth (in multiples of 12px) from a TocItem. */
function indentDepth(item: TocItem): number {
  if (item.level && item.level >= 3) return item.level - 2; // h3→1, h4→2
  if (item.indent) return 1;
  return 0;
}

export default function TableOfContents({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) {
      setActiveId("");
      return;
    }

    const OFFSET = 120;
    const MAX_BIND_ATTEMPTS = 5;
    let scrollTarget: HTMLElement | Window | null = null;
    let raf = 0;
    let retryTimer = 0;
    let bindAttempts = 0;

    const getActiveId = () =>
      getActiveTocId(ids, (id) => document.getElementById(id), OFFSET);

    const onScroll = () => {
      const next = getActiveId();
      setActiveId((prev) => (prev === next ? prev : next));
    };

    const bindScrollTarget = () => {
      const firstEl = document.getElementById(ids[0]);
      if (!firstEl && bindAttempts < MAX_BIND_ATTEMPTS) {
        bindAttempts += 1;
        retryTimer = window.setTimeout(bindScrollTarget, 50);
        return;
      }

      scrollTarget = findScrollParent(firstEl);
      setActiveId(getActiveId());
      scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    };

    raf = window.requestAnimationFrame(bindScrollTarget);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(retryTimer);
      scrollTarget?.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  return (
    <aside className="hidden w-[200px] shrink-0 xl:block">
      <nav className="sticky top-[65px] max-h-[calc(100vh-65px)] overflow-y-auto pb-8 pt-8 pl-4">
        <p className="mb-2 text-xs font-semibold text-[var(--fg-secondary)]">
          On this page
        </p>
        <ul className="list-none space-y-0 p-0">
          {items.map((item) => {
            const depth = indentDepth(item);
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`toc-link${activeId === item.id ? " is-active" : ""}`}
                  style={depth > 0 ? { paddingLeft: 12 * depth } : undefined}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
