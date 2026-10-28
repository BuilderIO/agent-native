import { comparableDocsPath } from "./docs-locale";
import type { NavItem, NavSection } from "./docsNavItems";

export const ALWAYS_OPEN_SECTION_INDEX = 0;

function normalizePath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isDocsNavItemActive(itemPath: string, pathname: string) {
  return (
    comparableDocsPath(normalizePath(pathname)) === comparableDocsPath(itemPath)
  );
}

function sectionContainsActive(section: NavSection, pathname: string) {
  return section.items.some(
    (item) =>
      (item.to ? isDocsNavItemActive(item.to, pathname) : false) ||
      item.children?.some((child) =>
        child.to ? isDocsNavItemActive(child.to, pathname) : false,
      ),
  );
}

export function isDocsNavGroupItem(item: NavItem) {
  return !item.to && Boolean(item.children?.length);
}

export function docsNavGroupClipId(item: NavItem) {
  return `docs-sidebar-group-${item.id}`;
}

export function getActiveDocsNavGroupId(
  sections: NavSection[],
  pathname: string,
) {
  for (const section of sections) {
    for (const item of section.items) {
      if (
        isDocsNavGroupItem(item) &&
        item.children?.some(
          (child) => child.to && isDocsNavItemActive(child.to, pathname),
        )
      ) {
        return item.id;
      }
    }
  }
  return null;
}

export function getActiveDocsNavSectionId(
  sections: NavSection[],
  pathname: string,
) {
  const activeSectionIndex = sections.findIndex((section) =>
    sectionContainsActive(section, pathname),
  );

  if (activeSectionIndex <= ALWAYS_OPEN_SECTION_INDEX) {
    return null;
  }

  return sections[activeSectionIndex]?.id ?? null;
}
