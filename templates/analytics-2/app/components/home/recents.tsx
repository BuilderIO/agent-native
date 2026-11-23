import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCompass,
  IconDatabase,
  IconFileText,
  IconMessageCircle,
  IconPlus,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { Link, useInRouterContext, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";

import {
  HomeRecentProjectActions,
  HomeRecentProjectFavorite,
} from "./HomeRecentProjectActions";
import { HomeLoading, HomeNonIdealState } from "./state";
import type {
  HomeCallbacks,
  HomeRecentRow,
  HomeRecents,
  HomeRecentsTab,
  HomeRowKind,
} from "./types";

const TAB_ORDER: readonly HomeRowKind[] = [
  "project",
  "thread",
  "exploration",
  "data",
];

const TAB_TITLES: Record<HomeRowKind, string> = {
  project: "Projects",
  thread: "Threads",
  exploration: "Explorations",
  data: "Data",
};

const TAB_ICONS: Record<HomeRowKind, ReactNode> = {
  project: <IconFileText size={15} aria-hidden="true" />,
  thread: <IconMessageCircle size={15} aria-hidden="true" />,
  exploration: <IconCompass size={15} aria-hidden="true" />,
  data: <IconDatabase size={15} aria-hidden="true" />,
};

const DEFAULT_ERROR: Record<HomeRowKind, string> = {
  project: "There was an error loading recent projects",
  thread: "There was an error loading recent threads",
  exploration: "There was an error loading recent explorations",
  data: "There was an error loading recently used datasets",
};

const EMPTY_DESCRIPTION: Record<HomeRowKind, string> = {
  project:
    "Analyze and visualize your data in a notebook and publish interactive apps",
  thread: "Chat with Analytics to explore your data",
  exploration: "No recent explorations",
  data: "Get to know the data in your workspace",
};

const EMPTY_ICONS: Record<HomeRowKind, ReactNode> = {
  project: <IconFileText size={28} aria-hidden="true" />,
  thread: <IconMessageCircle size={28} aria-hidden="true" />,
  exploration: <IconCompass size={28} aria-hidden="true" />,
  data: <IconDatabase size={28} aria-hidden="true" />,
};

function tabFor(recents: HomeRecents, kind: HomeRowKind): HomeRecentsTab {
  switch (kind) {
    case "project":
      return recents.projects;
    case "thread":
      return recents.threads;
    case "exploration":
      return recents.explorations;
    case "data":
      return recents.data;
  }
}

// A section heading offers its View all only when there is somewhere to go; a
// disabled button is a control that cannot be used, not a link that is missing.
function ViewAll({ href, label }: { href: string | undefined; label: string }) {
  if (href == null) return null;
  return (
    <Link className="ws-home-viewall" to={href}>
      {label}
    </Link>
  );
}

function EmptyAction({
  kind,
  callbacks,
}: {
  kind: Exclude<HomeRowKind, "thread">;
  callbacks: HomeCallbacks;
}) {
  const t = useT();
  if (kind === "data") {
    const onBrowseData = callbacks.onBrowseData;
    return (
      <button
        type="button"
        className="ws-home-button"
        onClick={onBrowseData}
        disabled={onBrowseData == null}
      >
        Browse data
        <IconArrowRight size={14} aria-hidden="true" />
      </button>
    );
  }

  if (kind === "project" && !callbacks.onCreateProject) return null;
  if (kind === "exploration" && !callbacks.onCreateExploration) return null;

  const action =
    kind === "project"
      ? {
          label: t("analytics.lists.createProject"),
          onClick: callbacks.onCreateProject,
        }
      : {
          label: t("analytics.explorationsPage.newExploration"),
          onClick: callbacks.onCreateExploration,
        };

  return (
    <button
      type="button"
      className="ws-home-button"
      onClick={action.onClick}
      disabled={action.onClick == null}
    >
      <IconPlus size={14} aria-hidden="true" />
      {action.label}
    </button>
  );
}

function RecentRow({
  row,
  callbacks,
}: {
  row: HomeRecentRow;
  callbacks: HomeCallbacks;
}) {
  return (
    <div
      className="ws-home-recent-row"
      data-project-id={row.kind === "project" ? row.id : undefined}
    >
      <div className="ws-home-recent-name">
        <Link className="ws-home-recent-link" to={row.href}>
          <span className="ws-home-recent-icon" aria-hidden="true">
            {TAB_ICONS[row.kind]}
          </span>
          <span className="ws-home-recent-title">{row.title}</span>
        </Link>
        <HomeRecentProjectFavorite row={row} callbacks={callbacks} />
      </div>
      {row.sourceLabel ? (
        <span className="ws-home-recent-source">{row.sourceLabel}</span>
      ) : null}
      {row.ownerLabel ? (
        <span className="ws-home-recent-owner">{row.ownerLabel}</span>
      ) : null}
      {row.metaLabel ? (
        <span className="ws-home-recent-meta">{row.metaLabel}</span>
      ) : null}
      <HomeRecentProjectActions row={row} callbacks={callbacks} />
    </div>
  );
}

const TAB_QUERY_PARAM = "tab";

function isHomeRowKind(value: string | null): value is HomeRowKind {
  return TAB_ORDER.includes(value as HomeRowKind);
}

export function HomeRecentsSection({
  recents,
  callbacks,
}: {
  recents: HomeRecents;
  callbacks: HomeCallbacks;
}) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <RoutedHomeRecentsSection recents={recents} callbacks={callbacks} />
  ) : (
    <LocalHomeRecentsSection recents={recents} callbacks={callbacks} />
  );
}

function RoutedHomeRecentsSection({
  recents,
  callbacks,
}: {
  recents: HomeRecents;
  callbacks: HomeCallbacks;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get(TAB_QUERY_PARAM);
  const selected: HomeRowKind = isHomeRowKind(param) ? param : "project";
  const onSelect = (kind: HomeRowKind) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (kind === "project") {
          next.delete(TAB_QUERY_PARAM);
        } else {
          next.set(TAB_QUERY_PARAM, kind);
        }
        return next;
      },
      { replace: true },
    );
  };
  return (
    <HomeRecentsSectionView
      recents={recents}
      callbacks={callbacks}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function LocalHomeRecentsSection({
  recents,
  callbacks,
}: {
  recents: HomeRecents;
  callbacks: HomeCallbacks;
}) {
  const [selected, setSelected] = useState<HomeRowKind>("project");
  return (
    <HomeRecentsSectionView
      recents={recents}
      callbacks={callbacks}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

function HomeRecentsSectionView({
  recents,
  callbacks,
  selected,
  onSelect,
}: {
  recents: HomeRecents;
  callbacks: HomeCallbacks;
  selected: HomeRowKind;
  onSelect: (kind: HomeRowKind) => void;
}) {
  const t = useT();
  const tabs = TAB_ORDER.map((kind) => tabFor(recents, kind)).filter(
    (tab) => tab.enabled,
  );
  const active = tabs.find((tab) => tab.kind === selected) ?? tabs[0];

  if (active == null) {
    return null;
  }

  return (
    <div className="ws-home-recents">
      <div className="ws-home-recents-header">
        <div
          className="ws-home-recents-tabs"
          role="tablist"
          aria-label={t("analytics.home.jumpBackIn")}
        >
          {tabs.map((tab) => {
            const isActive = tab.kind === active.kind;
            return (
              <button
                key={tab.kind}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`ws-home-recents-tab${isActive ? " is-active" : ""}`}
                onClick={() => onSelect(tab.kind)}
              >
                {TAB_ICONS[tab.kind]}
                <span>{TAB_TITLES[tab.kind]}</span>
              </button>
            );
          })}
        </div>
        {active.kind === "thread" && callbacks.onCreateThread ? (
          <Button
            className="ms-auto"
            size="sm"
            type="button"
            onClick={callbacks.onCreateThread}
          >
            <IconPlus size={16} aria-hidden="true" />
            {t("analytics.lists.createThread")}
          </Button>
        ) : null}
      </div>

      <div className="ws-home-recents-body" role="tabpanel">
        {active.status === "loading" ? <HomeLoading /> : null}
        {active.status === "error" ? (
          <HomeNonIdealState
            icon={<IconAlertTriangle size={28} aria-hidden="true" />}
            description={active.errorMessage ?? DEFAULT_ERROR[active.kind]}
          />
        ) : null}
        {active.status === "ready" && active.rows.length === 0 ? (
          <HomeNonIdealState
            icon={EMPTY_ICONS[active.kind]}
            description={EMPTY_DESCRIPTION[active.kind]}
          >
            {active.kind !== "thread" ? (
              <EmptyAction kind={active.kind} callbacks={callbacks} />
            ) : null}
          </HomeNonIdealState>
        ) : null}
        {active.status === "ready" && active.rows.length > 0 ? (
          <div className="ws-home-recents-list">
            {active.rows.map((row) => (
              <RecentRow key={row.id} row={row} callbacks={callbacks} />
            ))}
            <ViewAll href={active.viewAllHref} label="View all" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
