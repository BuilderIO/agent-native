import { useT } from "@agent-native/core/client/i18n";
import {
  FilterBar,
  FilterButton,
  filterStateKey,
  isDefaultFilterState,
  useFilterUrlState,
  type FilterCounts,
  type FilterField,
  type FilterNouns,
  type FilterState,
} from "@agent-native/toolkit/app/filters";
import {
  LIBRARY_FILTER_LABELS_EN,
  libraryFilterFields,
  type LibraryFilterLabels,
} from "@shared/library-filters";
import {
  IconCalendar,
  IconClock,
  IconFileText,
  IconLock,
  IconMessage,
  IconRobot,
  IconTag,
  IconUser,
  IconUserOff,
  IconUsersGroup,
  IconVideo,
  IconWorld,
} from "@tabler/icons-react";
import { type ReactNode, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

const URL_FIELDS = libraryFilterFields(LIBRARY_FILTER_LABELS_EN);

const NO_TAGS: readonly string[] = [];

const FIELD_ICONS: Partial<Record<string, ReactNode>> = {
  source: <IconFileText />,
  madeBy: <IconRobot />,
  created: <IconCalendar />,
  sharing: <IconUsersGroup />,
  length: <IconClock />,
  tag: <IconTag />,
  transcript: <IconMessage />,
};

const OPTION_ICONS: Partial<Record<string, ReactNode>> = {
  "source:clips": <IconVideo />,
  "source:content": <IconFileText />,
  "madeBy:person": <IconUser />,
  "madeBy:agent": <IconRobot />,
  "sharing:private": <IconLock />,
  "sharing:org": <IconUsersGroup />,
  "sharing:public": <IconWorld />,
  "sharing:shared": <IconUser />,
  "sharing:not_shared": <IconUserOff />,
};

export interface LibraryFilter {
  state: FilterState;
  setState: (next: FilterState) => void;
  clear: () => void;
  query: string;
  isDefault: boolean;
}

export function useLibraryFilter(): LibraryFilter {
  const location = useLocation();
  const navigate = useNavigate();
  const onSearchChange = useCallback(
    (search: string, { replace }: { replace: boolean }) => {
      void navigate(
        { pathname: location.pathname, search, hash: location.hash },
        { replace },
      );
    },
    [location.hash, location.pathname, navigate],
  );
  const { state, setState, clear } = useFilterUrlState({
    fields: URL_FIELDS,
    search: location.search,
    onSearchChange,
  });
  return {
    state,
    setState,
    clear,
    query: filterStateKey(state, URL_FIELDS).replace(/^\?/, ""),
    isDefault: isDefaultFilterState(state, URL_FIELDS),
  };
}

function useLibraryFilterLabels(): LibraryFilterLabels {
  const t = useT();
  return useMemo(
    () => ({
      source: t("libraryFilters.source"),
      sourceShort: t("libraryFilters.sourceShort"),
      sourceClips: t("libraryFilters.sourceClips"),
      sourceContent: t("libraryFilters.sourceContent"),
      sourceAll: t("libraryFilters.sourceAll"),
      madeBy: t("libraryFilters.madeBy"),
      madeByPerson: t("libraryFilters.madeByPerson"),
      madeByAgent: t("libraryFilters.madeByAgent"),
      created: t("libraryFilters.created"),
      sharing: t("libraryFilters.sharing"),
      sharingPrivate: t("libraryFilters.sharingPrivate"),
      sharingOrg: t("libraryFilters.sharingOrg"),
      sharingPublic: t("libraryFilters.sharingPublic"),
      sharingShared: t("libraryFilters.sharingShared"),
      sharingNotShared: t("libraryFilters.sharingNotShared"),
      length: t("libraryFilters.length"),
      lengthUnder1m: t("libraryFilters.lengthUnder1m"),
      length1To5m: t("libraryFilters.length1To5m"),
      length5To20m: t("libraryFilters.length5To20m"),
      lengthOver20m: t("libraryFilters.lengthOver20m"),
      tag: t("libraryFilters.tag"),
      tagOne: t("libraryFilters.tagOne"),
      tagOther: t("libraryFilters.tagOther"),
      transcript: t("libraryFilters.transcript"),
      transcriptYes: t("libraryFilters.transcriptYes"),
      transcriptNo: t("libraryFilters.transcriptNo"),
    }),
    [t],
  );
}

function useLibraryFilterFields(
  tags: readonly string[] | undefined,
): FilterField<never>[] {
  const labels = useLibraryFilterLabels();
  const tagOptions = tags ?? NO_TAGS;
  return useMemo(
    () =>
      libraryFilterFields(labels, tagOptions).map((field) => ({
        ...field,
        icon: FIELD_ICONS[field.id],
        ...(field.options
          ? {
              options: field.options.map((option) => ({
                ...option,
                icon: OPTION_ICONS[`${field.id}:${option.id}`],
              })),
            }
          : {}),
      })),
    [labels, tagOptions],
  );
}

function useLibraryFilterNouns(): FilterNouns {
  const t = useT();
  return useMemo(
    () => ({
      items: t("libraryFilters.items"),
      matchCount: (count: number) => t("libraryFilters.matchCount", { count }),
      showCount: (count: number) => t("libraryFilters.showCount", { count }),
    }),
    [t],
  );
}

interface LibraryFilterControlsProps {
  filter: LibraryFilter;
  counts: FilterCounts | undefined;
  tags: readonly string[] | undefined;
}

export function LibraryFilterButton({
  filter,
  counts,
  tags,
}: LibraryFilterControlsProps) {
  const fields = useLibraryFilterFields(tags);
  const nouns = useLibraryFilterNouns();
  return (
    <FilterButton
      fields={fields}
      state={filter.state}
      onChange={filter.setState}
      counts={counts}
      nouns={nouns}
    />
  );
}

export function LibraryFilterBar({
  filter,
  counts,
  tags,
}: LibraryFilterControlsProps) {
  const fields = useLibraryFilterFields(tags);
  return (
    <div className="border-b border-border px-5 py-2">
      <FilterBar
        fields={fields}
        state={filter.state}
        onChange={filter.setState}
        counts={counts}
        copyLink
      />
    </div>
  );
}
