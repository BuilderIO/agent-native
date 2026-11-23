import {
  shellConditionState,
  type NavigationEntry,
  type ShellActionEffect,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import {
  IconBell,
  IconBellOff,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconLogin,
} from "@tabler/icons-react";
import { useRef } from "react";

import { Avatar } from "../../../components/shell/primitives";
import { ControlledPopover } from "./ControlledPopover";
import {
  EntryIcon,
  group,
  invoke,
  MenuRow,
  openBinding,
  required,
  selected,
  visible,
} from "./entry";

export function Submenu({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  const binding = openBinding(entry);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  function show(focus: boolean) {
    binding.set?.(true);
    if (focus)
      requestAnimationFrame(() =>
        panel.current
          ?.querySelector<HTMLElement>('[data-menu-item="true"]:not(:disabled)')
          ?.focus(),
      );
  }
  return (
    <div
      className="ws-submenu-wrap"
      onMouseEnter={() => show(false)}
      onMouseLeave={() => {
        if (!panel.current?.contains(document.activeElement))
          binding.set?.(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        data-menu-item="true"
        aria-haspopup="menu"
        aria-expanded={binding.value}
        className="ws-menu-item"
        onClick={() => binding.set?.(!binding.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            show(true);
          } else if (event.key === "ArrowLeft") binding.set?.(false);
        }}
      >
        <EntryIcon entry={entry} />
        <span className="ws-menu-label">{entry.label}</span>
        <span className="ws-menu-trailing">
          <IconChevronRight size={16} aria-hidden="true" />
        </span>
      </button>
      {binding.value ? (
        <div
          ref={panel}
          className="ws-submenu"
          role="menu"
          aria-label={entry.label}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              binding.set?.(false);
              trigger.current?.focus();
            }
          }}
        >
          {group(entry.children ?? [], "theme-choices").map((child) =>
            child.kind === "heading" ? (
              <div key={child.id} className="ws-menu-heading">
                {child.label}
              </div>
            ) : (
              <MenuRow key={child.id} entry={child} effects={effects} />
            ),
          )}
          {group(entry.children ?? [], "preferences-link").length ? (
            <div className="ws-menu-divider" role="separator" />
          ) : null}
          {group(entry.children ?? [], "preferences-link").map((child) => (
            <MenuRow
              key={child.id}
              entry={child}
              effects={effects}
              close={() => binding.set?.(false)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceMenu({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  const entries = entry.children ?? [];
  const search = group(entries, "workspace-search")[0];
  const term = search?.search?.binding.value.trim().toLowerCase() ?? "";
  return (
    <ControlledPopover
      entry={entry}
      label={entry.accessibleLabel ?? ""}
      role="menu"
      minWidth={243}
      allowOverflow
      trigger={(props) => (
        <button type="button" className="ws-workspace-trigger" {...props}>
          <span className="ws-workspace-name">{entry.label}</span>
          <IconChevronDown size={12} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="ws-menu">
          <Submenu
            entry={required(entries, "workspace-preferences")}
            effects={effects}
          />
          <div className="ws-menu-divider" role="separator" />
          <div className="ws-workspace-picker">
            {search ? (
              <div className="ws-workspace-search">
                <input
                  type="search"
                  value={search.search?.binding.value}
                  placeholder={search.search?.placeholder}
                  aria-label={search.accessibleLabel}
                  onChange={(event) =>
                    search.search?.binding.set?.(event.target.value)
                  }
                />
              </div>
            ) : null}
            {group(entries, "workspace-choices")
              .filter(
                (choice) => !term || choice.label?.toLowerCase().includes(term),
              )
              .map((choice) => (
                <button
                  key={choice.entityKey}
                  type="button"
                  role="menuitem"
                  data-menu-item="true"
                  disabled={shellConditionState(choice).disabled}
                  title={choice.tooltip}
                  className={`ws-workspace-row${selected(choice) ? " is-active" : ""}`}
                  onClick={() => {
                    close();
                    invoke(choice.effect, effects);
                  }}
                >
                  <span className="ws-workspace-row-body">
                    <span className="ws-workspace-row-title">
                      {choice.label}
                    </span>
                    {(choice.children?.length ?? 0) > 0 ? (
                      <span className="ws-workspace-row-subtitle">
                        {choice.children?.map((part, index) => (
                          <span key={part.order}>
                            {index > 0 ? (
                              <span
                                className="ws-workspace-row-divider"
                                aria-hidden="true"
                              />
                            ) : null}
                            {part.label}
                          </span>
                        ))}
                        {choice.badge?.visible ? (
                          <span className="ws-tag">{choice.badge.text}</span>
                        ) : null}
                      </span>
                    ) : choice.badge?.visible ? (
                      <span className="ws-workspace-row-subtitle">
                        <span className="ws-tag">{choice.badge.text}</span>
                      </span>
                    ) : null}
                  </span>
                  {selected(choice) ? (
                    <IconCheck size={16} aria-hidden="true" />
                  ) : choice.icon?.kind === "symbol" &&
                    choice.icon.key === "login" ? (
                    <IconLogin
                      className="ws-login-icon"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              ))}
          </div>
          {group(entries, "workspace-add").map((child) => (
            <MenuRow
              key={child.id}
              entry={child}
              effects={effects}
              close={close}
            />
          ))}
          <div className="ws-menu-divider" role="separator" />
          {group(entries, "workspace-logout").map((child) => (
            <MenuRow
              key={child.id}
              entry={child}
              effects={effects}
              close={close}
            />
          ))}
        </div>
      )}
    </ControlledPopover>
  );
}

export function AccountMenu({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  const entries = entry.children ?? [];
  if (entry.icon?.kind !== "initial")
    throw new Error(`Unsupported account icon: ${entry.id}`);
  return (
    <ControlledPopover
      entry={entry}
      label={entry.controlLabel ?? ""}
      role="menu"
      placement="top-start"
      minWidth={270}
      allowOverflow
      trigger={(props) => (
        <button
          type="button"
          className="ws-account-button"
          aria-label={entry.accessibleLabel}
          {...props}
        >
          {entry.icon?.image?.src ? (
            <span className="ws-avatar">
              <img alt={entry.icon.image.alt} src={entry.icon.image.src} />
            </span>
          ) : (
            <Avatar
              name={entry.icon?.kind === "initial" ? entry.icon.text : ""}
              email=""
            />
          )}
          <span className="ws-account-name">{entry.label}</span>
          <IconDots size={16} aria-hidden="true" />
        </button>
      )}
    >
      <div className="ws-menu">
        <Submenu entry={required(entries, "account-theme")} effects={effects} />
        {group(entries, "account-help").map((child) =>
          child.kind === "heading" ? (
            <div key={child.id} className="ws-menu-heading">
              {child.label}
            </div>
          ) : (
            <HelpRow key={child.id} entry={child} effects={effects} />
          ),
        )}
        <div className="ws-menu-divider" role="separator" />
        {group(entries, "account-support").map((child) => (
          <HelpRow key={child.id} entry={child} effects={effects} />
        ))}
      </div>
    </ControlledPopover>
  );
}
function HelpRow({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item="true"
      disabled={shellConditionState(entry).disabled}
      title={entry.tooltip}
      className="ws-menu-item"
      onClick={() => invoke(entry.effect, effects)}
    >
      <EntryIcon entry={entry} />
      <span className="ws-menu-label">{entry.label}</span>
      {entry.trailingActions?.map((adornment) => (
        <span key={adornment.id} className="ws-menu-trailing">
          <EntryIcon entry={adornment} hidden />
        </span>
      ))}
    </button>
  );
}

export function NotificationsMenu({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  const entries = entry.children ?? [];
  const filter = required(entries, "notification-filter");
  const binding = openBinding(filter);
  const mark = required(entries, "notification-mark");
  const empty = required(entries, "notification-body");
  return (
    <ControlledPopover
      entry={entry}
      label={entry.controlLabel ?? ""}
      role="dialog"
      minWidth={320}
      className="ws-notifications"
      trigger={(props) => (
        <button
          type="button"
          className="ws-icon-button ws-bell-button"
          aria-label={entry.accessibleLabel}
          title={entry.tooltip}
          {...props}
        >
          <IconBell size={16} aria-hidden="true" />
          {entry.badge?.visible ? (
            <span className="ws-bell-badge" aria-hidden="true">
              {entry.badge.value}
            </span>
          ) : null}
        </button>
      )}
    >
      <div className="ws-notifications-header">
        <h5 className="ws-notifications-title">{entry.label}</h5>
        <div className="ws-notifications-controls">
          <div className="ws-filter">
            <button
              type="button"
              className="ws-filter-button"
              aria-expanded={binding.value}
              aria-haspopup="menu"
              onClick={() => binding.set?.(!binding.value)}
            >
              {filter.label}
              <IconChevronDown size={12} aria-hidden="true" />
            </button>
            {binding.value ? (
              <div className="ws-filter-menu" role="menu">
                {visible(filter.children ?? []).map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="menuitem"
                    className={`ws-menu-item${selected(choice) ? " is-active" : ""}`}
                    onClick={() => {
                      invoke(choice.effect, effects);
                      binding.set?.(false);
                    }}
                  >
                    <span className="ws-menu-label">{choice.label}</span>
                    {selected(choice) ? (
                      <span className="ws-menu-trailing">
                        <IconCheck size={16} />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ws-notifications-mark"
            disabled={shellConditionState(mark).disabled}
            title={mark.tooltip}
            onClick={() => invoke(mark.effect, effects)}
          >
            {mark.label}
          </button>
        </div>
      </div>
      <div className="ws-notifications-empty">
        <IconBellOff size={24} aria-hidden="true" />
        <h4>{empty.label}</h4>
        <p>{empty.description}</p>
      </div>
    </ControlledPopover>
  );
}

export function QuickCreate({
  entries,
  effects,
}: {
  entries: readonly NavigationEntry[];
  effects: readonly ShellActionEffect[];
}) {
  const menu = required(entries, "create-menu");
  return (
    <div className="ws-quick-create">
      {group(entries, "create-buttons").map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="ws-quick-button"
          disabled={shellConditionState(entry).disabled}
          onClick={() => invoke(entry.effect, effects)}
        >
          <EntryIcon entry={entry} hidden />
          {entry.label}
        </button>
      ))}
      <ControlledPopover
        entry={menu}
        label={menu.label ?? ""}
        role="menu"
        minWidth={180}
        trigger={(props) => (
          <button
            type="button"
            className="ws-quick-button ws-quick-plus"
            aria-label={menu.accessibleLabel}
            title={menu.tooltip}
            {...props}
          >
            <EntryIcon entry={menu} hidden />
          </button>
        )}
      >
        {(close) => (
          <div className="ws-menu">
            {group(menu.children ?? [], "create-primary").map((child) => (
              <MenuRow
                key={child.id}
                entry={child}
                effects={effects}
                close={close}
              />
            ))}
            {group(menu.children ?? [], "create-import").length ? (
              <div className="ws-menu-divider" role="separator" />
            ) : null}
            {group(menu.children ?? [], "create-import").map((child) => (
              <MenuRow
                key={child.id}
                entry={child}
                effects={effects}
                close={close}
              />
            ))}
          </div>
        )}
      </ControlledPopover>
    </div>
  );
}

export function MoreMenu({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  if (!visible(entry.children ?? []).length) return null;
  return (
    <ControlledPopover
      entry={entry}
      label={entry.label ?? ""}
      role="menu"
      minWidth={180}
      trigger={(props) => (
        <button
          type="button"
          className={[
            "ws-nav-row",
            "is-muted",
            selected(entry) ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          {...props}
        >
          <EntryIcon entry={entry} hidden />
          <span className="ws-nav-label">{entry.label}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="ws-menu">
          {visible(entry.children ?? []).map((child) => (
            <MenuRow
              key={child.id}
              entry={child}
              effects={effects}
              close={close}
            />
          ))}
        </div>
      )}
    </ControlledPopover>
  );
}
