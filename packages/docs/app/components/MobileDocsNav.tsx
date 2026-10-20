import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconBook2,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router";

import { comparableDocsPath } from "./docs-locale";
import { getDocsNavItems, getDocsNavSections } from "./docsNavItems";
import {
  ALWAYS_OPEN_SECTION_INDEX,
  getActiveDocsNavGroupId,
  getActiveDocsNavSectionId,
  isDocsNavGroupItem,
  isDocsNavItemActive,
} from "./docsNavState";

const DESKTOP_NAV_QUERY = "(min-width: 1024px)";

export default function MobileDocsNav() {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { locale } = useLocale();
  const t = useT();
  const navSections = useMemo(() => getDocsNavSections(locale, t), [locale, t]);
  const navItems = useMemo(() => getDocsNavItems(locale, t), [locale, t]);
  const [openSectionId, setOpenSectionId] = useState<string | null>(() =>
    getActiveDocsNavSectionId(navSections, location.pathname),
  );
  const [openGroupId, setOpenGroupId] = useState<string | null>(() =>
    getActiveDocsNavGroupId(navSections, location.pathname),
  );

  const currentPath = location.pathname;
  const norm = comparableDocsPath(currentPath.replace(/\/+$/, "") || "/");

  const currentItem =
    navItems.find((item) => norm === comparableDocsPath(item.to)) ??
    navItems[0];

  useEffect(() => {
    setOpenSectionId(getActiveDocsNavSectionId(navSections, location.pathname));
    setOpenGroupId(getActiveDocsNavGroupId(navSections, location.pathname));
  }, [location.pathname, navSections]);

  useEffect(() => {
    if (!open) return;

    const query = window.matchMedia(DESKTOP_NAV_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [open]);

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
    <div ref={navRef} className="mobile-docs-nav z-0 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mobile-docs-nav-trigger"
        aria-expanded={open}
        aria-label={t("docs.navigateAria")}
      >
        <IconBook2 size={18} stroke={1.75} aria-hidden="true" />
        <span>{currentItem.label}</span>
        <IconChevronDown
          size={16}
          stroke={1.75}
          className={`mobile-docs-nav-chevron${open ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <nav className="mobile-docs-nav-dropdown">
          <ul className="mobile-docs-nav-list">
            {navSections.map((section, index) => {
              const isAlwaysOpen = index === ALWAYS_OPEN_SECTION_INDEX;
              const isOpen = isAlwaysOpen || openSectionId === section.id;
              const sectionId = `mobile-docs-nav-section-${index}`;

              return (
                <li key={section.id} className="mobile-docs-nav-section">
                  {isAlwaysOpen ? (
                    <p className="docs-sidebar-section-label">
                      {section.title}
                    </p>
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
                    <ul className="docs-sidebar-section-items mobile-docs-nav-section-items">
                      {section.items.map((item) => {
                        const isGroup = isDocsNavGroupItem(item);
                        const active = item.to
                          ? isDocsNavItemActive(item.to, location.pathname)
                          : false;
                        const groupOpen = !isGroup || openGroupId === item.id;
                        const groupClipId = `mobile-docs-nav-group-${item.id}`;

                        return (
                          <li key={item.id}>
                            {isGroup ? (
                              <button
                                type="button"
                                className="sidebar-link sidebar-group-trigger mobile-docs-nav-group-trigger"
                                aria-expanded={groupOpen}
                                aria-controls={groupClipId}
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
                            ) : item.to ? (
                              <Link
                                data-an-prefetch={
                                  isOpen ? "viewport" : undefined
                                }
                                to={item.to}
                                className={`mobile-docs-nav-link ${active ? "is-active" : ""}`}
                                tabIndex={isOpen ? undefined : -1}
                                style={
                                  item.draft
                                    ? { color: "var(--approaches-warn)" }
                                    : undefined
                                }
                                onClick={() => setOpen(false)}
                              >
                                {item.label}
                              </Link>
                            ) : (
                              <p className="px-3 py-1.5 text-sm font-medium text-[var(--fg)]">
                                {item.label}
                              </p>
                            )}

                            {item.children ? (
                              <div
                                id={groupClipId}
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
                                            isOpen && groupOpen
                                              ? "viewport"
                                              : undefined
                                          }
                                          to={child.to!}
                                          className={`mobile-docs-nav-link mobile-docs-nav-sublink ${childActive ? "is-active" : ""}`}
                                          tabIndex={
                                            isOpen && groupOpen ? undefined : -1
                                          }
                                          style={
                                            child.draft
                                              ? {
                                                  color:
                                                    "var(--approaches-warn)",
                                                }
                                              : undefined
                                          }
                                          onClick={() => setOpen(false)}
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
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
