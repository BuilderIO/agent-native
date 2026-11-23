import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  SettingsRowDefinition,
  SettingsRowId,
  SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { IconGripVertical } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { LABEL_COLORS } from "@/lib/model/label-colors";

import {
  OrganizationCatalogForm,
  type CatalogEntry,
} from "./OrganizationCatalogForm";
import { OrganizationCatalogMenu } from "./OrganizationCatalogMenu";

type LabelEntry = CatalogEntry;
type CollectionRow = Extract<SettingsRowDefinition, { kind: "collection" }>;

/**
 * Workspace settings for the two label catalogues: asset statuses and asset
 * categories. Both are organisation-wide lists that projects and data
 * resources draw from, so only a workspace admin can add an entry; the server
 * enforces the same rule and the form is hidden for everyone else.
 *
 * The colour swatches are the only colour control: the catalogue stores a hex
 * value, and the picker offers the same set used everywhere else.
 */
function useIsAdmin(): boolean {
  const shell = useActionQuery("get-workspace-bootstrap", {}, { retry: 1 });
  return shell.data?.features.isAdmin === true;
}

/**
 * The catalogue routes read one list; Organization reads both independently.
 */
export function useAnalyticsAssetLabelsSettingsSections(
  view: string,
): SettingsSectionDefinition[] {
  const queryClient = useQueryClient();
  const t = useT();
  const label = (key: string, values?: Record<string, string>) =>
    t(`analytics.organizationCatalog.${key}`, values);
  const isAdmin = useIsAdmin();
  const showCategories = view === "asset-categories";
  const showBoth = view === "organization";
  const statusesQuery = useActionQuery(
    "list-data-statuses",
    {},
    { enabled: showBoth || !showCategories },
  );
  const categoriesQuery = useActionQuery(
    "list-data-categories",
    {},
    { enabled: showBoth || showCategories },
  );

  const [statusOrder, setStatusOrder] = useState<string[]>([]);
  const [reorderError, setReorderError] = useState("");
  const [defaultError, setDefaultError] = useState("");
  const [reordering, setReordering] = useState(false);
  const dragging = useRef<string | null>(null);
  const initialOrder = useRef<string[]>([]);
  const currentOrder = useRef<string[]>([]);
  useEffect(() => {
    if (!dragging.current && statusesQuery.data) {
      const ids = statusesQuery.data.statuses.map((status) => status.id);
      currentOrder.current = ids;
      setStatusOrder(ids);
    }
  }, [statusesQuery.data?.statuses]);

  const moveStatus = (target: string) => {
    const source = dragging.current;
    const ids = [...currentOrder.current];
    const from = ids.indexOf(source ?? "");
    const to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    currentOrder.current = ids;
    setStatusOrder(ids);
  };
  const dropStatus = async () => {
    if (!dragging.current) return;
    dragging.current = null;
    const ids = currentOrder.current;
    if (ids.every((id, index) => id === initialOrder.current[index])) return;
    setReordering(true);
    setReorderError("");
    try {
      await callAction("reorder-data-status", { ids });
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    } catch {
      currentOrder.current = initialOrder.current;
      setStatusOrder(initialOrder.current);
      setReorderError(label("reorderError"));
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    } finally {
      setReordering(false);
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["action"] });

  const catalogue = (input: {
    id: SettingsRowId;
    label: string;
    description?: string | undefined;
    emptyLabel: string;
    nameLabel: string;
    entries: readonly LabelEntry[] | undefined;
    loading: boolean;
    error: boolean;
    retry: () => void;
    limit: number;
    visible: boolean;
    createAction: "create-data-status" | "create-data-category";
    deleteAction: "delete-data-status" | "delete-data-category";
    updateAction: "update-data-status" | "update-data-category";
    isStatus: boolean;
  }): CollectionRow => {
    const entries = input.entries;
    const base = {
      id: input.id,
      kind: "collection" as const,
      label: input.label,
      emptyLabel: input.emptyLabel,
      condition: { visible: input.visible },
    };
    const unavailable: CollectionRow["items"] | undefined = input.loading
      ? { status: "loading" }
      : input.error || !entries
        ? {
            status: "error",
            message: label("loadError"),
            retry: input.retry,
            retryLabel: label("retry"),
          }
        : undefined;
    const canAdd =
      isAdmin && !unavailable && entries && entries.length < input.limit;
    const dot = (entry: LabelEntry) => (
      <span
        className="ws-label-dot"
        style={{
          background:
            entry.color ??
            (showBoth ? "hsl(var(--muted-foreground))" : LABEL_COLORS.at(-1)),
        }}
        aria-hidden="true"
      />
    );
    const remove = async (id: string) => {
      await callAction(input.deleteAction, { id });
      await refresh();
    };
    if (!showBoth) {
      return {
        ...base,
        description: input.description,
        items: unavailable ?? {
          status: "ready",
          value: (entries ?? []).map((entry) => ({
            key: entry.id,
            title: entry.name,
            leading: dot(entry),
            ...(isAdmin
              ? {
                  actions: [
                    {
                      id: "remove",
                      label: label("remove"),
                      accessibleLabel: label("removeName", {
                        name: entry.name,
                      }),
                      trigger: {
                        kind: "invoke" as const,
                        actionName: input.deleteAction,
                        run: () => remove(entry.id),
                      },
                    },
                  ],
                }
              : {}),
          })),
        },
        ...(canAdd
          ? {
              add: {
                kind: "fields" as const,
                label: input.nameLabel,
                submitLabel: label("add"),
                actionName: input.createAction,
                fields: [
                  {
                    kind: "text" as const,
                    id: "name",
                    label: input.nameLabel,
                    placeholder: label("name"),
                    required: true,
                    maxLength: 200,
                  },
                  {
                    kind: "color" as const,
                    id: "color",
                    label: label("color"),
                    initialValue: LABEL_COLORS[0],
                    keepAfterSubmit: true,
                    options: LABEL_COLORS.map((color) => ({
                      value: color,
                      label: label("useColor", { color }),
                    })),
                  },
                ],
                submit: async (values) => {
                  try {
                    await callAction(input.createAction, {
                      name: String(values.name).trim(),
                      color: String(values.color),
                    });
                    await refresh();
                    return undefined;
                  } catch (cause) {
                    return {
                      error:
                        cause instanceof Error
                          ? cause.message
                          : input.isStatus
                            ? label("createStatusError")
                            : label("createCategoryError"),
                    };
                  }
                },
              },
            }
          : {}),
      };
    }
    return {
      ...base,
      ...(input.isStatus && reorderError ? { error: reorderError } : {}),
      items: unavailable ?? {
        status: "ready",
        value: [...(entries ?? [])]
          .sort((a, b) => {
            if (!input.isStatus) return 0;
            const first = statusOrder.indexOf(a.id);
            const second = statusOrder.indexOf(b.id);
            return first < 0 || second < 0 ? 0 : first - second;
          })
          .map((entry) => ({
            key: entry.id,
            title: entry.name,
            description: entry.description || undefined,
            leading: (
              <span className="flex items-center gap-2">
                {input.isStatus && isAdmin && (
                  <span
                    role="button"
                    aria-label={label("reorderName", { name: entry.name })}
                    aria-disabled={reordering}
                    draggable={!reordering}
                    className="cursor-grab"
                    onDragStart={(event) => {
                      dragging.current = entry.id;
                      initialOrder.current = [...currentOrder.current];
                      event.dataTransfer.setData("text/plain", entry.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      moveStatus(entry.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void dropStatus();
                    }}
                    onDragEnd={() => {
                      if (dragging.current) {
                        dragging.current = null;
                        currentOrder.current = initialOrder.current;
                        setStatusOrder(initialOrder.current);
                      }
                    }}
                  >
                    <IconGripVertical size={16} aria-hidden="true" />
                  </span>
                )}
                {dot(entry)}
                {isAdmin && (
                  <OrganizationCatalogMenu
                    entry={entry}
                    isStatus={input.isStatus}
                    isDefault={
                      input.isStatus &&
                      statusesQuery.data?.defaultStatusId === entry.id
                    }
                    showLibrary={
                      input.isStatus &&
                      (entries ?? []).some(
                        (item) => item.inLibrary && !item.endorsed,
                      )
                    }
                    names={(entries ?? [])
                      .filter((other) => other.id !== entry.id)
                      .map((other) => other.name)}
                    save={async (values) => {
                      await callAction(
                        input.updateAction,
                        input.isStatus
                          ? { id: entry.id, ...values }
                          : {
                              id: entry.id,
                              name: values.name,
                              color: values.color,
                              description: values.description,
                            },
                      );
                      await refresh();
                    }}
                    remove={() => remove(entry.id)}
                  />
                )}
              </span>
            ),
          })),
      },
      ...(canAdd
        ? {
            add: {
              kind: "trigger" as const,
              action: {
                id: "create",
                label: input.nameLabel,
                trigger: {
                  kind: "dialog" as const,
                  title: input.nameLabel,
                  body: ({ close }: { close: () => void }) => (
                    <OrganizationCatalogForm
                      isStatus={input.isStatus}
                      showLibrary={
                        input.isStatus &&
                        entries.some((item) => item.inLibrary && !item.endorsed)
                      }
                      names={entries.map((entry) => entry.name)}
                      close={close}
                      save={async (values) => {
                        await callAction(
                          input.createAction,
                          input.isStatus
                            ? values
                            : {
                                name: values.name,
                                color: values.color,
                                description: values.description,
                              },
                        );
                        await refresh();
                      }}
                    />
                  ),
                },
              },
            },
          }
        : {}),
    };
  };

  return [
    {
      id: "asset-labels",
      rows: [
        catalogue({
          id: "settings.asset-statuses.statuses",
          label: showBoth
            ? label("status")
            : t("analytics.settingsSearch.assetStatuses"),
          description: !showBoth ? label("statusesDescription") : undefined,
          emptyLabel: showBoth ? label("empty") : label("statusesEmpty"),
          nameLabel: label("newStatus"),
          entries: statusesQuery.data?.statuses,
          loading: statusesQuery.isLoading,
          error: statusesQuery.isError,
          retry: () => void statusesQuery.refetch(),
          limit: 15,
          visible: showBoth || !showCategories,
          createAction: "create-data-status",
          deleteAction: "delete-data-status",
          updateAction: "update-data-status",
          isStatus: true,
        }),
        ...(showBoth
          ? [
              {
                id: "settings.asset-statuses.default",
                kind: "select",
                label: label("defaultStatus"),
                placeholder: label("noStatus"),
                condition: {
                  visible: isAdmin,
                  disabled:
                    statusesQuery.isLoading ||
                    statusesQuery.isError ||
                    !statusesQuery.data?.statuses.some(
                      (status) => !status.endorsed,
                    ),
                },
                ...(defaultError ? { error: defaultError } : {}),
                binding: {
                  value: statusesQuery.data?.defaultStatusId ?? "none",
                  set: async (value) => {
                    setDefaultError("");
                    try {
                      await callAction("set-default-data-status", {
                        id: value === "none" ? null : value,
                      });
                      await refresh();
                    } catch {
                      setDefaultError(label("defaultError"));
                    }
                  },
                },
                options: [
                  { value: "none", label: label("noStatus") },
                  ...(statusesQuery.data?.statuses ?? [])
                    .filter((status) => !status.endorsed)
                    .map((status) => ({
                      value: status.id,
                      label: status.name,
                    })),
                ],
              } satisfies SettingsRowDefinition,
            ]
          : []),
        catalogue({
          id: "settings.asset-categories.categories",
          label: label("categories"),
          description: !showBoth ? label("categoriesDescription") : undefined,
          emptyLabel: showBoth ? label("empty") : label("categoriesEmpty"),
          nameLabel: label("newCategory"),
          entries: categoriesQuery.data?.categories,
          loading: categoriesQuery.isLoading,
          error: categoriesQuery.isError,
          retry: () => void categoriesQuery.refetch(),
          limit: 100,
          visible: showBoth || showCategories,
          createAction: "create-data-category",
          deleteAction: "delete-data-category",
          updateAction: "update-data-category",
          isStatus: false,
        }),
      ],
    },
  ];
}
