import { Link, useLocation } from "react-router";
import { NAV_ITEMS } from "./docsNavItems";

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
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function DocsPrevNext() {
  const location = useLocation();
  const currentPath = location.pathname;

  const currentIndex = NAV_ITEMS.findIndex((item) => {
    if (item.to === "/docs") {
      return currentPath === "/docs" || currentPath === "/docs/";
    }
    return currentPath.startsWith(item.to);
  });

  const prev = currentIndex > 0 ? NAV_ITEMS[currentIndex - 1] : null;
  const next =
    currentIndex < NAV_ITEMS.length - 1 ? NAV_ITEMS[currentIndex + 1] : null;

  if (!prev && !next) return null;

  return (
    <nav className="docs-prev-next">
      {prev ? (
        <Link to={prev.to} className="docs-prev-next-link docs-prev-link">
          <ArrowLeft />
          <div className="docs-prev-next-text">
            <span className="docs-prev-next-label">Previous</span>
            <span className="docs-prev-next-title">{prev.label}</span>
          </div>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link to={next.to} className="docs-prev-next-link docs-next-link">
          <div className="docs-prev-next-text docs-next-text">
            <span className="docs-prev-next-label">Next</span>
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
