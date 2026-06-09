import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { NAV_SECTIONS, type NavItem } from "./docsNavItems";

const ALWAYS_OPEN_SECTION_INDEX = 0;

function normalizePath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function isItemActive(itemPath: string, pathname: string) {
  return normalizePath(pathname) === itemPath;
}

function sectionContainsActive(
  section: (typeof NAV_SECTIONS)[number],
  pathname: string,
) {
  return section.items.some(
    (item) =>
      (item.to ? isItemActive(item.to, pathname) : false) ||
      item.children?.some((child) =>
        child.to ? isItemActive(child.to, pathname) : false,
      ),
  );
}

// A nav item with children and no `to` is a chevron-only group header.
function isGroupItem(item: NavItem) {
  return !item.to && Boolean(item.children?.length);
}

function groupClipId(label: string) {
  return `docs-sidebar-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// The label of the group whose child matches the active route, if any — used
// to auto-open that group (mirrors getActiveSectionTitle for sections).
function getActiveGroupLabel(pathname: string) {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (
        isGroupItem(item) &&
        item.children?.some((child) =>
          child.to ? isItemActive(child.to, pathname) : false,
        )
      ) {
        return item.label;
      }
    }
  }
  return null;
}

function getActiveSectionTitle(pathname: string) {
  const activeSectionIndex = NAV_SECTIONS.findIndex((section) =>
    sectionContainsActive(section, pathname),
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
  const [openGroupLabel, setOpenGroupLabel] = useState<string | null>(() =>
    getActiveGroupLabel(location.pathname),
  );

  useEffect(() => {
    setOpenSectionTitle(getActiveSectionTitle(location.pathname));
    setOpenGroupLabel(getActiveGroupLabel(location.pathname));
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
    <aside className="hidden w-[228px] shrink-0 lg:block">
      <nav
        ref={navRef}
        className="docs-sidebar-nav sticky top-[65px] max-h-[calc(100vh-65px)] overflow-y-auto pb-8 pt-8 pr-4"
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

              <div
                id={sectionId}
                className="docs-sidebar-section-items-clip"
                data-state={isOpen ? "open" : "closed"}
                aria-hidden={isOpen ? undefined : true}
                inert={isOpen ? undefined : true}
              >
                <ul className="docs-sidebar-section-items">
                  {section.items.map((item) => {
                    const isGroup = isGroupItem(item);
                    const active = item.to
                      ? isItemActive(item.to, location.pathname)
                      : false;
                    // Groups expand/collapse; non-group children (if any ever
                    // exist) always render open.
                    const groupOpen = isGroup
                      ? openGroupLabel === item.label
                      : true;
                    const clipId = isGroup
                      ? groupClipId(item.label)
                      : undefined;
                    const childrenTabbable = isOpen && groupOpen;
                    return (
                      <li key={item.label}>
                        {isGroup ? (
                          <button
                            type="button"
                            className="sidebar-link sidebar-group-trigger"
                            aria-expanded={groupOpen}
                            aria-controls={clipId}
                            tabIndex={isOpen ? undefined : -1}
                            onClick={() =>
                              setOpenGroupLabel((current) =>
                                current === item.label ? null : item.label,
                              )
                            }
                          >
                            <span>{item.label}</span>
                            <IconChevronRight
                              size={16}
                              stroke={1.75}
                              className={`docs-sidebar-chevron${groupOpen ? " is-open" : ""}`}
                              aria-hidden="true"
                            />
                          </button>
                        ) : (
                          <Link
                            data-an-prefetch={isOpen ? "render" : undefined}
                            to={item.to!}
                            className={`sidebar-link${active ? " is-active" : ""}`}
                            tabIndex={isOpen ? undefined : -1}
                          >
                            {item.label}
                          </Link>
                        )}
                        {item.children ? (
                          <div
                            id={clipId}
                            className="docs-sidebar-section-items-clip"
                            data-state={groupOpen ? "open" : "closed"}
                            aria-hidden={groupOpen ? undefined : true}
                            inert={groupOpen ? undefined : true}
                          >
                            <ul className="docs-sidebar-subitems">
                              {item.children.map((child) => {
                                const childActive = child.to
                                  ? isItemActive(child.to, location.pathname)
                                  : false;
                                return (
                                  <li key={child.to ?? child.label}>
                                    <Link
                                      data-an-prefetch={
                                        childrenTabbable ? "render" : undefined
                                      }
                                      to={child.to!}
                                      className={`sidebar-link sidebar-sublink${childActive ? " is-active" : ""}`}
                                      tabIndex={
                                        childrenTabbable ? undefined : -1
                                      }
                                    >
                                      {child.label}
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
