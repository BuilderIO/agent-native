import {
  shellConditionState,
  type NavigationSection,
  type ShellActionEffect,
  type SidebarPartProps,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { IconX } from "@tabler/icons-react";
import { Link } from "react-router";

import { ContentSlot } from "./ContentSlot";
import { EntryIcon, group, invoke, NavigationRow, required } from "./entry";
import {
  AccountMenu,
  MoreMenu,
  NotificationsMenu,
  QuickCreate,
  WorkspaceMenu,
} from "./menus";
import { ContextRail, SettingsRail } from "./NavigationRails";

export function SidebarSection({
  section,
  effects,
}: {
  section: NavigationSection;
  effects: readonly ShellActionEffect[];
}) {
  if (
    !shellConditionState(section).visible ||
    (section.hideIfEmpty && section.entries.length === 0)
  )
    return null;
  if (!section.disclosure)
    throw new Error(`Missing section disclosure: ${section.id}`);
  const open = section.disclosure.binding;
  return (
    <section className="ws-section" aria-label={section.label}>
      <button
        type="button"
        className="ws-section-header"
        aria-expanded={open.value}
        onClick={() => open.set?.(!open.value)}
      >
        <span>{section.label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: open.value ? "rotate(90deg)" : undefined }}
        >
          <path d="M9 6l6 6l-6 6" />
        </svg>
      </button>
      {open.value ? (
        <div className="ws-section-list">
          {section.entries
            .filter((entry) => shellConditionState(entry).visible)
            .sort((a, b) => a.order - b.order)
            .map((entry) => {
              if (entry.effect?.kind !== "navigate")
                throw new Error(`Expected section destination: ${entry.id}`);
              return (
                <Link
                  key={entry.entityKey}
                  to={entry.effect.to}
                  state={entry.effect.state}
                  className="ws-section-row"
                  title={entry.label}
                  onClick={() => {
                    for (const action of entry.trailingActions ?? [])
                      invoke(action.effect, effects);
                  }}
                >
                  <EntryIcon entry={entry} />
                  <span className="ws-nav-label">{entry.label}</span>
                </Link>
              );
            })}
        </div>
      ) : null}
    </section>
  );
}

export function Sidebar({ model, effects }: SidebarPartProps) {
  if (model.presentation.visibility === "hidden") return null;
  if (model.presentation.profile === "context")
    return <ContextRail model={model} effects={effects} />;
  if (model.presentation.profile === "settings")
    return <SettingsRail model={model} effects={effects} />;
  if (model.presentation.profile !== "workspace")
    throw new Error(`Unknown sidebar profile: ${model.presentation.profile}`);
  const header = required(model.entries, "sidebar-header");
  const footer = required(model.entries, "sidebar-footer");
  const search = required(model.entries, "sidebar-search");
  const close = group(header.children ?? [], "drawer-close")[0];
  const settings = required(footer.children ?? [], "footer-settings");
  if (settings.effect?.kind !== "navigate")
    throw new Error("Expected settings destination");
  return (
    <aside
      className="ws-sidebar"
      aria-label={header.accessibleLabel}
      data-closed={!model.presentation.mobileOpen.value}
    >
      <div className="ws-sidebar-inner">
        <div className="ws-sidebar-header">
          <div className="ws-workspace-slot">
            <WorkspaceMenu
              entry={required(header.children ?? [], "header-workspace")}
              effects={effects}
            />
          </div>
          <div className="ws-header-actions">
            <NotificationsMenu
              entry={required(header.children ?? [], "header-notifications")}
              effects={effects}
            />
            {close ? (
              <button
                type="button"
                className="ws-icon-button"
                aria-label={close.accessibleLabel}
                onClick={() => invoke(close.effect, effects)}
              >
                <IconX size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        <QuickCreate entries={model.entries} effects={effects} />
        <div className="ws-search-slot">
          <button
            type="button"
            className="ws-search-button"
            data-search-trigger="true"
            onClick={() => invoke(search.effect, effects)}
          >
            <EntryIcon entry={search} hidden />
            <span className="ws-search-label">{search.label}</span>
            <span className="ws-keycap" aria-hidden="true">
              {search.shortcut?.displayLabel}
            </span>
          </button>
        </div>
        <div className="ws-tabs">
          {group(model.entries, "sidebar-primary").map((entry) => {
            if (entry.subPart === "sidebar.slot") {
              if (entry.effect?.kind !== "open")
                throw new Error("Sidebar slot requires a content owner");
              return (
                <ContentSlot
                  key={entry.effect.body.key}
                  owner={entry.effect.body}
                />
              );
            }
            return (
              <NavigationRow key={entry.id} entry={entry} effects={effects} />
            );
          })}
        </div>
        <div className="ws-scroll">
          <div className="ws-tabs-scroll">
            {group(model.entries, "sidebar-scroll").map((entry) => (
              <NavigationRow key={entry.id} entry={entry} effects={effects} />
            ))}
            <MoreMenu
              entry={required(model.entries, "sidebar-more")}
              effects={effects}
            />
            <div className="ws-spacer" />
            <div className="ws-sections">
              {[...model.sections]
                .sort((a, b) => a.order - b.order)
                .map((section) => (
                  <SidebarSection
                    key={section.id}
                    section={section}
                    effects={effects}
                  />
                ))}
            </div>
            <div className="ws-spacer" />
            {group(model.entries, "sidebar-bottom").map((entry) => (
              <NavigationRow key={entry.id} entry={entry} effects={effects} />
            ))}
          </div>
        </div>
        <div className="ws-footer">
          <div className="ws-footer-surface">
            <div className="ws-footer-row">
              <AccountMenu
                entry={required(footer.children ?? [], "footer-account")}
                effects={effects}
              />
              <Link
                to={settings.effect.to}
                className="ws-icon-button"
                aria-label={settings.accessibleLabel}
                title={settings.tooltip}
                onClick={() => {
                  for (const action of settings.trailingActions ?? [])
                    invoke(action.effect, effects);
                }}
              >
                <EntryIcon entry={settings} hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
