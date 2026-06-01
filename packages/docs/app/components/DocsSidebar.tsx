import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { NAV_SECTIONS } from "./docsNavItems";

const ALWAYS_OPEN_SECTION_INDEX = 0;

function normalizePath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function isItemActive(itemPath: string, pathname: string) {
  return normalizePath(pathname) === itemPath;
}

function getActiveSectionTitle(pathname: string) {
  const activeSectionIndex = NAV_SECTIONS.findIndex((section) =>
    section.items.some((item) => isItemActive(item.to, pathname)),
  );

  if (activeSectionIndex <= ALWAYS_OPEN_SECTION_INDEX) {
    return null;
  }

  return NAV_SECTIONS[activeSectionIndex]?.title ?? null;
}

export default function DocsSidebar() {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [openSectionTitle, setOpenSectionTitle] = useState<string | null>(() =>
    getActiveSectionTitle(location.pathname),
  );

  useEffect(() => {
    setOpenSectionTitle(getActiveSectionTitle(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const frame = window.requestAnimationFrame(() => {
      const activeLink = nav.querySelector<HTMLAnchorElement>(
        ".sidebar-link.is-active",
      );
      if (!activeLink) return;

      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      const topPadding = 24;
      const bottomPadding = 32;
      const isVisible =
        linkRect.top >= navRect.top + topPadding &&
        linkRect.bottom <= navRect.bottom - bottomPadding;

      if (isVisible) return;

      nav.scrollTo({
        top: Math.max(
          0,
          nav.scrollTop +
            linkRect.top +
            linkRect.height / 2 -
            (navRect.top + navRect.height / 2),
        ),
        behavior: "auto",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, openSectionTitle]);

  return (
    <aside className="hidden w-[220px] shrink-0 lg:block">
      <nav
        ref={navRef}
        className="sticky top-[65px] max-h-[calc(100vh-65px)] overflow-y-auto pb-8 pt-8 pr-4"
      >
        {NAV_SECTIONS.map((section, index) => {
          const isAlwaysOpen = index === ALWAYS_OPEN_SECTION_INDEX;
          const isOpen = isAlwaysOpen || openSectionTitle === section.title;
          const sectionId = `docs-sidebar-section-${index}`;

          return (
            <section key={section.title} className="docs-sidebar-section">
              {isAlwaysOpen ? (
                <p className="docs-sidebar-section-label">{section.title}</p>
              ) : (
                <button
                  type="button"
                  className="docs-sidebar-section-trigger"
                  aria-expanded={isOpen}
                  aria-controls={sectionId}
                  onClick={() =>
                    setOpenSectionTitle((current) =>
                      current === section.title ? null : section.title,
                    )
                  }
                >
                  <span>{section.title}</span>
                  <IconChevronRight
                    size={16}
                    stroke={1.75}
                    className={`docs-sidebar-chevron${isOpen ? " is-open" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              )}

              {isOpen ? (
                <ul id={sectionId} className="docs-sidebar-section-items">
                  {section.items.map((item) => {
                    const active = isItemActive(item.to, location.pathname);
                    return (
                      <li key={item.to}>
                        <Link
                          data-an-prefetch="render"
                          to={item.to}
                          className={`sidebar-link${active ? " is-active" : ""}`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
