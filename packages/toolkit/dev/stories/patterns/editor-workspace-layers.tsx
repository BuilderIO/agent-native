import {
  IconAdjustmentsHorizontal,
  IconFrame,
  IconLayoutSidebarLeftCollapse,
  IconLetterT,
  IconPlus,
  IconSearch,
  IconStar,
} from "@tabler/icons-react";
import * as React from "react";

import { AgentNativeIcon } from "../../../src/app/shared/AgentNativeIcon.js";
import { IconButton } from "../../../src/ui/base-ui/button.js";
import {
  DesignFilePanel,
  type DesignFilePanelProps,
  DesignFileContents,
  DesignFilePageList,
} from "../../../src/ui/base-ui/design-file-panel.js";
import { Input } from "../../../src/ui/base-ui/input.js";
import { Inline, Stack } from "../../../src/ui/base-ui/layout.js";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../src/ui/base-ui/select.js";
import { Text } from "../../../src/ui/base-ui/text.js";
import { isComposingKey } from "../../../src/ui/is-composing-key.js";
import type { WorkspaceLayer } from "./editor-workspace-fixture.js";

interface Props {
  renderPanels?: (panels: {
    layers: React.ReactNode;
    agent: React.ReactNode;
    library: React.ReactNode;
  }) => React.ReactNode;
  onRevealLayers?: () => void;
  tabVariant?: DesignFilePanelProps["tabVariant"];
  layers: WorkspaceLayer[];
  current: WorkspaceLayer[];
  allPages?: boolean;
  selected: readonly string[];
  onSelection: (ids: readonly string[]) => void;
  onChange: (next: WorkspaceLayer[]) => void;
  pageId: string;
  onPage: (id: string) => void;
  onCollapse?: () => void;
  collapseButtonRef?: React.Ref<HTMLButtonElement>;
}

function icon(layer: WorkspaceLayer) {
  if (layer.kind === "text") return <IconLetterT />;
  if (layer.kind === "screen") return <IconFrame />;
  if (layer.kind === "icon") return <IconStar />;
  return <IconFrame />;
}
const types = [
  { value: "all", label: "All types" },
  { value: "frame", label: "Frames" },
  { value: "text", label: "Text" },
  { value: "icon", label: "Icons" },
];
export const WorkspaceLayersPanel = React.memo(function WorkspaceLayersPanel({
  layers,
  current,
  allPages,
  selected,
  onSelection,
  onChange,
  pageId,
  onPage,
  onCollapse,
  collapseButtonRef,
  tabVariant,
  renderPanels,
  onRevealLayers,
}: Props) {
  const [tab, setTab] = React.useState("file"),
    [showPages, setShowPages] = React.useState(true),
    [showLayers, setShowLayers] = React.useState(true);
  const [search, setSearch] = React.useState(false),
    [query, setQuery] = React.useState(""),
    [filter, setFilter] = React.useState(false),
    [kind, setKind] = React.useState("all");
  const searchButton = React.useRef<HTMLButtonElement>(null);
  const filterButton = React.useRef<HTMLButtonElement>(null);
  const [focusTree, setFocusTree] = React.useState(false);
  const [revealRevision, revealTree] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  const pendingPage = React.useRef<string | null>(null);
  const pages = React.useMemo(
    () =>
      layers
        .filter(
          (l) =>
            l.parentId === null &&
            (!l.id.startsWith("home-") || l.id === pageId),
        )
        .map((l) => ({ id: l.id, label: l.name })),
    [layers, pageId],
  );
  React.useEffect(() => {
    if (
      pendingPage.current &&
      pages.some((p) => p.id === pendingPage.current)
    ) {
      const id = pendingPage.current;
      pendingPage.current = null;
      onPage(id);
    }
  }, [pages, onPage]);
  const records = allPages ? layers : current;
  const [expanded, setExpanded] = React.useState<readonly string[]>(() =>
    layers
      .filter((l) => l.container && (allPages || l.sourceId !== "hero-eyebrow"))
      .map((l) => l.id),
  );
  const needle = query.trim().normalize().toLocaleLowerCase();
  const searching = Boolean(needle || kind !== "all");
  const results = React.useMemo(
    () =>
      searching
        ? current.filter(
            (l) =>
              (kind === "all" || l.kind === kind) &&
              (!needle ||
                l.name.normalize().toLocaleLowerCase().includes(needle)),
          )
        : [],
    [current, kind, needle, searching],
  );
  function selectLayer(id: string) {
    const lookup = new Map(current.map((layer) => [layer.id, layer]));
    setExpanded((open) => {
      const ancestors = new Set(open);
      let parent = lookup.get(id)?.parentId;
      while (parent != null) {
        ancestors.add(parent);
        parent = lookup.get(parent)?.parentId;
      }
      return ancestors.size === open.length ? open : [...ancestors];
    });
    onSelection([id]);
  }
  function closeSearch() {
    searchButton.current?.focus();
    setQuery("");
    setSearch(false);
  }
  function closeFilter() {
    filterButton.current?.focus();
    setKind("all");
    setFilter(false);
  }
  function change(next: WorkspaceLayer[]) {
    if (allPages) return onChange(next);
    const ids = new Set(current.map((l) => l.id));
    const rest = layers.filter((l) => !ids.has(l.id));
    rest.splice(layers.indexOf(current[0]), 0, ...next);
    onChange(rest);
  }
  function addPage() {
    const id = crypto.randomUUID();
    pendingPage.current = id;
    onChange([
      ...layers,
      {
        id,
        sourceId: "home",
        parentId: null,
        name: "Untitled",
        kind: "screen",
        container: true,
        fixed: true,
      },
    ]);
  }
  const actions = (
    <Inline gap={0}>
      <IconButton
        color="gray"
        size="md"
        variant="ghost"
        ref={searchButton}
        aria-label="Search layers"
        aria-pressed={search}
        onClick={() => {
          setSearch(!search);
          setQuery("");
          setShowLayers(true);
        }}
      >
        <IconSearch />
      </IconButton>
      <IconButton
        color="gray"
        size="md"
        variant="ghost"
        ref={filterButton}
        aria-label="Filter layers"
        aria-pressed={filter}
        onClick={() => {
          setFilter(!filter);
          setKind("all");
          setShowLayers(true);
        }}
      >
        <IconAdjustmentsHorizontal />
      </IconButton>
    </Inline>
  );
  const file = (
    <DesignFileContents
      pages={{
        label: "Pages",
        pages,
        value: pageId,
        onValueChange: onPage,
        expanded: showPages,
        onExpandedChange: setShowPages,
        actions: (
          <IconButton
            color="gray"
            size="md"
            variant="ghost"
            aria-label="Add page"
            onClick={addPage}
          >
            <IconPlus />
          </IconButton>
        ),
      }}
      layers={{
        label: "Layers",
        expanded: showLayers,
        onExpandedChange: setShowLayers,
        actions,
      }}
      treeKey={`${allPages ? "all" : pageId}:${revealRevision}`}
      tree={{
        autoFocus: focusTree,
        onFocus: () => setFocusTree(false),
        items: records,
        selection: selected,
        onSelectionChange: onSelection,
        onItemsChange: change,
        expanded,
        onExpandedChange: setExpanded,
        renderIcon: icon,
        getActionLabel: (action, l) =>
          action[0].toUpperCase() + action.slice(1) + " " + l.name,
      }}
      layerTools={
        (search || filter) && (
          <>
            {search && (
              <Input
                type="search"
                aria-label="Find layer by name"
                placeholder="Search layers"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !isComposingKey(e)) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeSearch();
                  }
                }}
              />
            )}
            {filter && (
              <Select
                aria-label="Layer type"
                items={types}
                value={kind}
                onValueChange={(v) => {
                  if (v) setKind(v);
                }}
              >
                <SelectTrigger
                  onKeyDown={(event) => {
                    if (
                      event.key === "Escape" &&
                      !isComposingKey(event) &&
                      event.currentTarget.getAttribute("aria-expanded") ===
                        "false"
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      closeFilter();
                    }
                  }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {types.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
          </>
        )
      }
      searchResults={
        searching ? (
          <div
            className="overflow-auto"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isComposingKey(event)) {
                event.preventDefault();
                event.stopPropagation();
                if (needle) closeSearch();
                else closeFilter();
              }
            }}
          >
            {results.length ? (
              <DesignFilePageList
                label="Matching layers"
                value={selected.at(-1) ?? ""}
                current="true"
                onValueChange={selectLayer}
                pages={results.map((l) => ({
                  id: l.id,
                  label: l.name,
                  icon: icon(l),
                }))}
              />
            ) : (
              <p role="status">No matching layers</p>
            )}
          </div>
        ) : undefined
      }
    />
  );
  const selection = React.useMemo(() => {
    const ids = new Set(selected);
    return current.filter((l) => ids.has(l.id));
  }, [selected, current]);
  const agent = (
    <Stack className="p-4">
      <Text render={<h2 />} textStyle="label-large">
        Selection context
      </Text>
      {selection.length ? (
        selection.slice(0, 10).map((l) => <p key={l.id}>{l.name}</p>)
      ) : (
        <p>No layers selected</p>
      )}
    </Stack>
  );
  const library = (
    <DesignFilePageList
      label="Components on this page"
      current="true"
      pages={current
        .filter((l) =>
          ["nav-logo", "hero-eyebrow", "cta-primary", "hero-cmd"].includes(
            l.sourceId,
          ),
        )
        .map((l) => ({ id: l.id, label: l.name, icon: icon(l) }))}
      value={selected.at(-1) ?? ""}
      onValueChange={(id) => {
        selectLayer(id);
        setSearch(false);
        setQuery("");
        setFilter(false);
        setKind("all");
        setShowLayers(true);
        revealTree();
        setFocusTree(true);
        setTab("file");
        onRevealLayers?.();
      }}
    />
  );
  if (renderPanels)
    return renderPanels({
      layers: (
        <aside className="design-file-panel workspace-layers" aria-label="File">
          {file}
        </aside>
      ),
      agent,
      library,
    });
  return (
    <DesignFilePanel
      className="workspace-layers"
      aria-label="File"
      brand={<AgentNativeIcon size="var(--control-icon-size-3)" aria-hidden />}
      title="Agent-Native Web"
      tabVariant={tabVariant}
      tabsLabel="Left panel"
      tab={tab}
      onTabChange={setTab}
      tabs={[
        { value: "agent", label: "Agent", panel: agent },
        { value: "file", label: "File", panel: file },
        { value: "library", label: "Library", panel: library },
      ]}
      headerActions={
        onCollapse && (
          <IconButton
            color="gray"
            size="md"
            variant="ghost"
            ref={collapseButtonRef}
            aria-label="Collapse file panel"
            onClick={onCollapse}
          >
            <IconLayoutSidebarLeftCollapse />
          </IconButton>
        )
      }
      footer={
        <>
          <a href="https://github.com/BuilderIO/agent-native/releases">
            What’s new
          </a>
          <span aria-hidden>·</span>
          <a href="https://github.com/BuilderIO/agent-native/issues/new">
            Feedback
          </a>
        </>
      }
    />
  );
});
