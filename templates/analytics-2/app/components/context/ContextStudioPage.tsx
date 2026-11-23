import { useT } from "@agent-native/core/client/i18n";
import {
  IconLayoutGrid,
  IconLink,
  IconSettings,
  IconShield,
  IconStack2,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

// The connections view is the workspace's data-connections page; loading it only
// when that rail row is open keeps the studio's own bundle free of it.
const DataConnectionsView = lazyRoute(() =>
  import("@/components/workspace/DataConnectionsPage").then((module) => ({
    default: module.DataConnectionsPage,
  })),
);

import { Suspense } from "react";

import { lazyRoute } from "@/components/workspace/lazy-route";
import type { RoutePageProps } from "@/components/workspace/types";

import { ContextArea } from "./ContextArea";
import { ContextSetupView } from "./ContextSetupView";

import "./context-studio.css";

export const CONTEXT_RAIL_GROUPS = [
  {
    headingKey: "context.rail.management",
    items: [
      {
        id: "connections",
        labelKey: "context.rail.connections",
        to: "/context-studio/connections",
        icon: IconLink,
      },
    ],
  },
] as const;

const RAIL_SETUP = {
  id: "setup",
  labelKey: "context.rail.setup",
  to: "/context-studio/setup",
  icon: IconLayoutGrid,
} as const;

export const RELATED_SETTINGS: ReadonlyArray<{
  id: string;
  label: string;
  to: string;
  icon: typeof IconLayoutGrid;
}> = [
  {
    id: "data-sources",
    label: "Data sources",
    to: "/home/data",
    icon: IconLayoutGrid,
  },
  {
    id: "trusted-mode",
    label: "Governed mode",
    to: "/settings/trusted-mode",
    icon: IconShield,
  },
];

export const RAIL_SETTINGS_FOOTER = {
  id: "settings",
  label: "Settings",
  to: "/settings",
  icon: IconSettings,
} as const;

function RailLink({
  to,
  label,
  active,
  icon: Icon,
}: {
  to: string;
  label: string;
  active: boolean;
  icon: typeof IconLayoutGrid;
}) {
  return (
    <Link
      to={to}
      className={`context-rail-link${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={16} stroke={1.8} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

function ContextUnavailableView({ view }: { view: string | undefined }) {
  const t = useT();
  const title = view?.startsWith("eval")
    ? t("context.rail.evals")
    : t("context.rail.label");
  return (
    <main className="context-studio-content" aria-label={title}>
      <h1 className="context-studio-title">{title}</h1>
      <p className="context-studio-description">
        {t("context.unavailable.description")}
      </p>
      <p className="context-studio-description">
        <Link to={RAIL_SETUP.to}>{t("context.unavailable.backToSetup")}</Link>
      </p>
    </main>
  );
}

export function ContextStudioPage({ route }: RoutePageProps) {
  const t = useT();
  const location = useLocation();
  const view = route.view;

  return (
    <ContextArea
      header={
        <div className="context-studio-brand">
          <IconStack2 size={16} aria-hidden="true" />
          <span>Context Studio</span>
        </div>
      }
      rail={
        <>
          <div className="context-rail-group">
            <div className="context-rail-heading">
              {t("context.rail.observability")}
            </div>
            <RailLink
              to={RAIL_SETUP.to}
              label={t(RAIL_SETUP.labelKey)}
              active={view === RAIL_SETUP.id}
              icon={RAIL_SETUP.icon}
            />
          </div>
          {CONTEXT_RAIL_GROUPS.map((group) => (
            <div className="context-rail-group" key={group.headingKey}>
              <div className="context-rail-heading">{t(group.headingKey)}</div>
              {group.items.map((item) => (
                <RailLink
                  key={item.id}
                  to={item.to}
                  label={t(item.labelKey)}
                  active={
                    view !== RAIL_SETUP.id &&
                    (location.pathname === item.to ||
                      location.pathname.startsWith(`${item.to}/`))
                  }
                  icon={item.icon}
                />
              ))}
            </div>
          ))}
          <div className="context-rail-group">
            <div className="context-rail-heading">Related settings</div>
            {RELATED_SETTINGS.map((entry) => (
              <RailLink
                key={entry.id}
                to={entry.to}
                label={entry.label}
                active={location.pathname.startsWith(entry.to)}
                icon={entry.icon}
              />
            ))}
          </div>
        </>
      }
      footer={
        <div className="context-rail-footer">
          <RailLink
            to={RAIL_SETTINGS_FOOTER.to}
            label={RAIL_SETTINGS_FOOTER.label}
            active={
              location.pathname.startsWith(RAIL_SETTINGS_FOOTER.to) &&
              !RELATED_SETTINGS.some((entry) =>
                location.pathname.startsWith(entry.to),
              )
            }
            icon={RAIL_SETTINGS_FOOTER.icon}
          />
        </div>
      }
    >
      {view === "setup" ? (
        <ContextSetupView />
      ) : view === "connections" ? (
        <Suspense fallback={null}>
          <DataConnectionsView />
        </Suspense>
      ) : (
        <ContextUnavailableView view={view} />
      )}
    </ContextArea>
  );
}
