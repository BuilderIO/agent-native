import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { getDocsNavSections } from "./docsNavItems";
import {
  ALWAYS_OPEN_SECTION_INDEX,
  docsNavGroupClipId,
  getActiveDocsNavGroupId,
  getActiveDocsNavSectionId,
  isDocsNavGroupItem,
  isDocsNavItemActive,
} from "./docsNavState";

export default function DocsSidebar() {
  const location = useLocation();
  const { locale } = useLocale();
  const t = useT();
  const navSections = useMemo(() => getDocsNavSections(locale, t), [locale, t]);
  const navRef = useRef<HTMLElement>(null);
  const [openSectionId, setOpenSectionId] = useState<string | null>(() =>
    getActiveDocsNavSectionId(navSections, location.pathname),
  );
  const [openGroupId, setOpenGroupId] = useState<string | null>(() =>
    getActiveDocsNavGroupId(navSections, location.pathname),
  );

  useEffect(() => {
    setOpenSectionId(getActiveDocsNavSectionId(navSections, location.pathname));
    setOpenGroupId(getActiveDocsNavGroupId(navSections, location.pathname));
  }, [location.pathname, navSections]);

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
  }, [location.pathname, openSectionId]);

  return (
    <aside className="hidden w-[228px] shrink-0 lg:block">
      <nav
        ref={navRef}
        className="docs-sidebar-nav sticky top-[65px] max-h-[calc(100vh-65px)] overflow-y-auto pb-8 pt-8 pe-4"
      >
        {navSections.map((section, index) => {
          const isAlwaysOpen = index === ALWAYS_OPEN_SECTION_INDEX;
          const isOpen = isAlwaysOpen || openSectionId === section.id;
          const sectionId = `docs-sidebar-section-${index}`;

          return (
            <section key={section.id} className="docs-sidebar-section">
              {isAlwaysOpen ? (
                <p className="docs-sidebar-section-label">{section.title}</p>
              ) : (
                <button
                  type="button"
                  className="docs-sidebar-section-trigger"
                  aria-expanded={isOpen}
                  aria-controls={sectionId}
                  onClick={() =>
                    setOpenSectionId((current) =>
                      current === section.id ? null : section.id,
                    )
                  }
                >
                  <span>{section.title}</span>
                  <IconChevronRight
                    size={16}
                    stroke={1.75}
                    className={`docs-sidebar-chevron rtl:-scale-x-100${isOpen ? " is-open" : ""}`}
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
                    const isGroup = isDocsNavGroupItem(item);
                    const active = item.to
                      ? isDocsNavItemActive(item.to, location.pathname)
                      : false;
                    const groupOpen = isGroup ? openGroupId === item.id : true;
                    const clipId = isGroup
                      ? docsNavGroupClipId(item)
                      : undefined;
                    const childrenTabbable = isOpen && groupOpen;
                    return (
                      <li key={item.id}>
                        {isGroup ? (
                          <button
                            type="button"
                            className="sidebar-link sidebar-group-trigger"
                            aria-expanded={groupOpen}
                            aria-controls={clipId}
                            tabIndex={isOpen ? undefined : -1}
                            onClick={() =>
                              setOpenGroupId((current) =>
                                current === item.id ? null : item.id,
                              )
                            }
                            style={
                              item.draft
                                ? { color: "var(--approaches-warn)" }
                                : undefined
                            }
                          >
                            <span>{item.label}</span>
                            <IconChevronRight
                              size={16}
                              stroke={1.75}
                              className={`docs-sidebar-chevron rtl:-scale-x-100${groupOpen ? " is-open" : ""}`}
                              aria-hidden="true"
                            />
                          </button>
                        ) : (
                          <Link
                            data-an-prefetch={isOpen ? "viewport" : undefined}
                            to={item.to!}
                            className={`sidebar-link${active ? " is-active" : ""}`}
                            tabIndex={isOpen ? undefined : -1}
                            style={
                              item.draft
                                ? { color: "var(--approaches-warn)" }
                                : undefined
                            }
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
                                  ? isDocsNavItemActive(
                                      child.to,
                                      location.pathname,
                                    )
                                  : false;
                                return (
                                  <li key={child.id}>
                                    <Link
                                      data-an-prefetch={
                                        childrenTabbable
                                          ? "viewport"
                                          : undefined
                                      }
                                      to={child.to!}
                                      className={`sidebar-link sidebar-sublink${childActive ? " is-active" : ""}`}
                                      tabIndex={
                                        childrenTabbable ? undefined : -1
                                      }
                                      style={
                                        child.draft
                                          ? { color: "var(--approaches-warn)" }
                                          : undefined
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
