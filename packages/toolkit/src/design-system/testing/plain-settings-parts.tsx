import type { ModelRow, RowBadge } from "@agent-native/design-system/model";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useId,
} from "react";

import { useSettingsSurface } from "../../app/settings/SettingsSection.js";
import {
  definePartSet,
  type PartComponent,
  type PartProps,
  rowAttributes,
  useRowEffect,
  useRowRegions,
  useRowSlot,
} from "../parts.js";

const PlainGroupContext = createContext(false);

function badgeText(rowId: string, badge: RowBadge): string {
  if (badge.kind === "dot") {
    throw new Error(
      `Row ${rowId} has a dot badge, which settings rows do not draw`,
    );
  }
  return String(badge.value);
}

function isModifiedClick(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function PlainGroup({ row, children }: PartProps) {
  const slot = useRowSlot(row);
  return (
    <section {...rowAttributes(row)} className="plain-group">
      <h3
        data-rid-label=""
        className={row.labelHidden === true ? "sr-only" : undefined}
      >
        {row.label}
      </h3>
      {row.description && !row.labelHidden ? <p>{row.description}</p> : null}
      <PlainGroupContext.Provider value={true}>
        {slot}
        {children}
      </PlainGroupContext.Provider>
    </section>
  );
}

function PlainRow({ row, children }: PartProps) {
  const run = useRowEffect(row);
  const slot = useRowSlot(row);
  const regions = useRowRegions(row, [
    "label",
    "description",
    "status",
    "detail",
  ]);
  const pending = row.state?.pending === true;
  const description = regions.description ?? row.description;
  return (
    <div {...rowAttributes(row)} className="plain-row">
      <p>
        <strong data-rid-label="">{regions.label ?? row.label}</strong>
        {row.state?.badge ? (
          <small>{badgeText(row.id, row.state.badge)}</small>
        ) : null}
        {regions.status}
      </p>
      {description ? <p>{description}</p> : null}
      {row.kind === "toggle" ? (
        <button
          type="button"
          role="switch"
          aria-label={row.label}
          aria-checked={row.state?.checked === true}
          aria-busy={pending ? true : undefined}
          disabled={row.state?.disabled === true || pending}
          onClick={() => run?.()}
        />
      ) : null}
      {slot}
      {children}
      {regions.detail ? <div>{regions.detail}</div> : null}
    </div>
  );
}

function PlainNotice({ row, children }: PartProps) {
  const slot = useRowSlot(row);
  useRowRegions(row, []);
  if (row.description) {
    throw new Error(
      `Row ${row.id} is settings.notice with a description; a notice's message is its label`,
    );
  }
  return (
    <aside {...rowAttributes(row)} className="plain-notice">
      <p data-rid-label="">{row.label}</p>
      {slot}
      {children}
    </aside>
  );
}

function PlainContent({ row }: PartProps) {
  const slot = useRowSlot(row);
  if (!row.slot) {
    throw new Error(`Row ${row.id} is settings.content with no slot to draw`);
  }
  return <>{slot}</>;
}

function SectionStatus({ row }: { row: ModelRow }) {
  return (
    <>
      {row.state?.complete ? <span aria-hidden="true">done</span> : null}
      {row.state?.badge ? (
        <small>{badgeText(row.id, row.state.badge)}</small>
      ) : null}
    </>
  );
}

function PlainSection({ row, children }: PartProps) {
  const surface = useSettingsSurface();
  const grouped = useContext(PlainGroupContext);
  const run = useRowEffect(row);
  const slot = useRowSlot(row);
  const { body } = useRowRegions(row, ["body"]);
  const content: ReactNode = (
    <>
      {body}
      {slot}
      {children}
    </>
  );
  const description = row.description ? <p>{row.description}</p> : null;

  if (surface === "sidebar") {
    const expanded = row.state?.expanded === true;
    return (
      <div {...rowAttributes(row)} className="plain-section">
        <button type="button" aria-expanded={expanded} onClick={() => run?.()}>
          <span data-rid-label="">{row.label}</span>
          <SectionStatus row={row} />
        </button>
        {expanded ? (
          <div>
            {description}
            {content}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section {...rowAttributes(row)} className="plain-section">
      {grouped ? null : (
        <>
          <h3>
            <span data-rid-label="">{row.label}</span>
            <SectionStatus row={row} />
          </h3>
          {description}
        </>
      )}
      {content}
    </section>
  );
}

function PlainReport({ row, children }: PartProps) {
  const slot = useRowSlot(row);
  const { action, body } = useRowRegions(row, ["action", "body"]);
  return (
    <section {...rowAttributes(row)} className="plain-report">
      <header>
        <h3 data-rid-label="">{row.label}</h3>
        {action}
      </header>
      {body}
      {children}
      {slot}
    </section>
  );
}

function PlainNav({ row, children }: PartProps) {
  return (
    <nav {...rowAttributes(row)} aria-label={row.label}>
      {children}
    </nav>
  );
}

function PlainNavGroup({ row, children }: PartProps) {
  const labelId = useId();
  return (
    <div {...rowAttributes(row)} role="group" aria-labelledby={labelId}>
      <h4 id={labelId}>{row.label}</h4>
      <ul>{children}</ul>
    </div>
  );
}

function PlainNavItem({ row }: PartProps) {
  const run = useRowEffect(row);
  const disabled = row.state?.disabled === true;
  const badge = row.state?.badge;
  const trailing =
    badge?.kind === "label" ? <small>{badge.value}</small> : null;
  if (row.effect?.kind === "navigate") {
    return (
      <li>
        <a
          {...rowAttributes(row)}
          href={row.effect.to}
          aria-current={row.state?.selected ? "page" : undefined}
          aria-disabled={disabled || undefined}
          onClick={(event) => {
            if (isModifiedClick(event)) return;
            event.preventDefault();
            if (!disabled) run?.();
          }}
        >
          <span data-rid-label="">{row.label}</span>
          {trailing}
        </a>
      </li>
    );
  }
  return (
    <li>
      <button
        {...rowAttributes(row)}
        type="button"
        disabled={disabled}
        onClick={run}
      >
        <span data-rid-label="">{row.label}</span>
      </button>
    </li>
  );
}

function PlainButton({ row }: PartProps) {
  const run = useRowEffect(row);
  const pending = row.state?.pending === true;
  if (row.effect?.kind === "navigate") {
    return (
      <a
        {...rowAttributes(row)}
        href={row.effect.to}
        onClick={(event) => {
          if (isModifiedClick(event)) return;
          event.preventDefault();
          run?.();
        }}
      >
        {row.label}
      </a>
    );
  }
  return (
    <button
      {...rowAttributes(row)}
      type="button"
      aria-busy={pending ? true : undefined}
      disabled={row.state?.disabled === true || pending}
      onClick={() => run?.()}
    >
      {row.label}
    </button>
  );
}

/**
 * A second part set for toolkit's settings screens, in plain HTML. Specs and
 * stories draw a screen with it and with toolkit's parts to check the two
 * agree on every row.
 */
export const PLAIN_SETTINGS_PART_SET = definePartSet({
  name: "plain",
  parts: {
    button: PlainButton,
    "settings.nav": PlainNav,
    "settings.nav-group": PlainNavGroup,
    "settings.nav-item": PlainNavItem,
    "settings.group": PlainGroup,
    "settings.row": PlainRow,
    "settings.notice": PlainNotice,
    "settings.content": PlainContent,
    "settings.section": PlainSection,
    "settings.report": PlainReport,
  } satisfies Record<string, PartComponent>,
});
