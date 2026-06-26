import { useLocale, useT } from "@agent-native/core/client";
import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router";

import { comparableDocsPath } from "./docs-locale";
import { getDocsNavItems, getDocsNavSections } from "./docsNavItems";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: "transform 200ms ease",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function MobileDocsNav() {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { locale } = useLocale();
  const t = useT();
  const navSections = useMemo(() => getDocsNavSections(locale, t), [locale, t]);
  const navItems = useMemo(() => getDocsNavItems(locale, t), [locale, t]);

  const currentPath = location.pathname;
  const norm = comparableDocsPath(currentPath.replace(/\/+$/, "") || "/");

  const currentItem =
    navItems.find((item) => norm === comparableDocsPath(item.to)) ??
    navItems[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={navRef} className="mobile-docs-nav lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="mobile-docs-nav-trigger"
        aria-expanded={open}
        aria-label={t("docs.navigateAria")}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span>{currentItem.label}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <nav className="mobile-docs-nav-dropdown">
          <ul className="mobile-docs-nav-list">
            {navSections.map((section) => (
              <li key={section.title}>
                <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)] first:pt-1">
                  {section.title}
                </p>
                <ul className="list-none p-0">
                  {section.items.map((item) => {
                    // Chevron-only group header (no `to`): render a plain,
                    // non-clickable label with its children listed below.
                    const isGroup = !item.to && Boolean(item.children?.length);
                    const isActive =
                      !isGroup &&
                      comparableDocsPath(item.to!) ===
                        comparableDocsPath(currentItem.to);
                    return (
                      <li key={item.to ?? item.label}>
                        {isGroup ? (
                          <p className="px-3 py-1.5 text-sm font-medium text-[var(--fg)]">
                            {item.label}
                          </p>
                        ) : (
                          <Link
                            data-an-prefetch="render"
                            to={item.to!}
                            className={`mobile-docs-nav-link ${isActive ? "is-active" : ""}`}
                            onClick={() => setOpen(false)}
                          >
                            {item.label}
                          </Link>
                        )}
                        {item.children ? (
                          <ul className="list-none p-0">
                            {item.children.map((child) => {
                              const childActive =
                                comparableDocsPath(child.to!) ===
                                comparableDocsPath(currentItem.to);
                              return (
                                <li key={child.to ?? child.label}>
                                  <Link
                                    data-an-prefetch="render"
                                    to={child.to!}
                                    className={`mobile-docs-nav-link mobile-docs-nav-sublink ${childActive ? "is-active" : ""}`}
                                    onClick={() => setOpen(false)}
                                  >
                                    {child.label}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
