import { Link, useLocation } from "react-router";
import { useState, useEffect, useRef } from "react";
import { NAV_ITEMS } from "./docsNavItems";

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

  const currentPath = location.pathname;
  const currentItem =
    NAV_ITEMS.find((item) => {
      if (item.to === "/docs") {
        return currentPath === "/docs" || currentPath === "/docs/";
      }
      return currentPath.startsWith(item.to);
    }) ?? NAV_ITEMS[0];

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
        aria-label="Navigate docs"
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
            {NAV_ITEMS.map((item) => {
              const isActive = item.to === currentItem.to;
              return (
                <li key={item.to}>
                  <Link
                    prefetch="render"
                    to={item.to}
                    className={`mobile-docs-nav-link ${isActive ? "is-active" : ""}`}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
