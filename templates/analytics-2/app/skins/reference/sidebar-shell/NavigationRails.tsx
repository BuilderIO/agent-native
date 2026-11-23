import type {
  NavigationSection,
  ShellActionEffect,
  SidebarPartProps,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { Link } from "react-router";

import { EntryIcon, invoke, required, selected, visible } from "./entry";

function ContextLinks({
  section,
  effects,
}: {
  section: NavigationSection;
  effects: readonly ShellActionEffect[];
}) {
  return visible(section.entries).map((entry) => {
    if (entry.effect?.kind !== "navigate")
      throw new Error(`Expected rail destination: ${entry.id}`);
    return (
      <Link
        key={entry.id}
        to={entry.effect.to}
        className={`context-rail-link${selected(entry) ? " is-active" : ""}`}
        aria-current={selected(entry) ? "page" : undefined}
        onClick={() => {
          for (const action of entry.trailingActions ?? [])
            invoke(action.effect, effects);
        }}
      >
        <EntryIcon entry={entry} stroke={1.8} hidden />
        <span>{entry.label}</span>
      </Link>
    );
  });
}

export function ContextRail({ model, effects }: SidebarPartProps) {
  const header = required(model.entries, "context-header");
  const sections = visible(model.sections);
  const footer = sections.filter(
    (section) => section.containerId === "context-rail-footer",
  );
  return (
    <nav className="context-area-rail" aria-label={header.accessibleLabel}>
      <div className="context-area-rail-header">
        <div className="context-studio-brand">
          <EntryIcon entry={header} hidden />
          <span>{header.label}</span>
        </div>
      </div>
      <div className="context-area-rail-body">
        {sections
          .filter((section) => section.containerId !== "context-rail-footer")
          .map((section) => (
            <div className="context-rail-group" key={section.id}>
              {section.label === undefined ? null : (
                <div className="context-rail-heading">{section.label}</div>
              )}
              <ContextLinks section={section} effects={effects} />
            </div>
          ))}
      </div>
      {footer.length === 0 ? null : (
        <div className="context-area-rail-footer">
          {footer.map((section) => (
            <div className="context-rail-footer" key={section.id}>
              {section.label === undefined ? null : (
                <div className="context-rail-heading">{section.label}</div>
              )}
              <ContextLinks section={section} effects={effects} />
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

export function SettingsRail({ model, effects }: SidebarPartProps) {
  const header = required(model.entries, "settings-header");
  return (
    <nav className="settings-nav" aria-label={header.accessibleLabel}>
      {visible(model.sections).map((section) => (
        <section className="settings-nav-group" key={section.id}>
          <h2 className="settings-nav-title">{section.label}</h2>
          <ul className="settings-nav-list">
            {visible(section.entries).map((entry) => {
              if (entry.effect?.kind !== "navigate")
                throw new Error(`Expected rail destination: ${entry.id}`);
              return (
                <li key={entry.id}>
                  <Link
                    to={entry.effect.to}
                    className="settings-nav-link"
                    aria-current={selected(entry) ? "page" : undefined}
                    onClick={() => {
                      for (const action of entry.trailingActions ?? [])
                        invoke(action.effect, effects);
                    }}
                  >
                    <EntryIcon entry={entry} />
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
