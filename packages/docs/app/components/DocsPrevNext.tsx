import { useLocale, useT } from "@agent-native/core/client";
import { useMemo } from "react";
import { Link, useLocation } from "react-router";

import { comparableDocsPath } from "./docs-locale";
import { getDocsNavItems } from "./docsNavItems";

function ArrowLeft() {
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
      className="rtl:-scale-x-100"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ArrowRight() {
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
      className="rtl:-scale-x-100"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function DocsPrevNext() {
  const location = useLocation();
  const { locale } = useLocale();
  const t = useT();
  const navItems = useMemo(() => getDocsNavItems(locale, t), [locale, t]);
  const currentPath = location.pathname;

  const norm = comparableDocsPath(currentPath.replace(/\/+$/, "") || "/");

  const currentIndex = navItems.findIndex(
    (item) => norm === comparableDocsPath(item.to),
  );

  if (currentIndex === -1) return null;

  const prev = currentIndex > 0 ? navItems[currentIndex - 1] : null;
  const next =
    currentIndex < navItems.length - 1 ? navItems[currentIndex + 1] : null;

  if (!prev && !next) return null;

  return (
    <nav className="docs-prev-next">
      {prev ? (
        <Link
          data-an-prefetch="render"
          to={prev.to}
          className="docs-prev-next-link docs-prev-link"
        >
          <ArrowLeft />
          <div className="docs-prev-next-text">
            <span className="docs-prev-next-label">{t("docs.previous")}</span>
            <span className="docs-prev-next-title">{prev.label}</span>
          </div>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          data-an-prefetch="render"
          to={next.to}
          className="docs-prev-next-link docs-next-link"
        >
          <div className="docs-prev-next-text docs-next-text">
            <span className="docs-prev-next-label">{t("docs.next")}</span>
            <span className="docs-prev-next-title">{next.label}</span>
          </div>
          <ArrowRight />
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
