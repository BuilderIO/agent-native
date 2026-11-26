import type {
  SettingsCollectionItem,
  SettingsHints,
  SettingsOption,
  SettingsReferenceCompatibility,
  SettingsRowAction,
  SettingsRowDefinition,
  SettingsSectionsProps,
  SettingsDisclosureState,
} from "./schema.js";

function withLayout(
  hints: SettingsHints | undefined,
  reference: SettingsReferenceCompatibility | undefined,
) {
  return reference?.layout ? { ...hints, ...reference.layout } : hints;
}

function layoutHints(
  hints: SettingsHints | undefined,
  reference: SettingsReferenceCompatibility | undefined,
) {
  const resolved = withLayout(hints, reference);
  return resolved ? { hints: resolved } : {};
}

function optionIds(options: readonly SettingsOption[]) {
  return options.map((option) => ({ ...option, ...option.dom }));
}

function actionIds(action: SettingsRowAction): SettingsRowAction {
  const trigger = action.trigger;
  if (trigger.kind !== "dialog" && trigger.kind !== "confirm") return action;
  return { ...action, trigger: { ...trigger, ...trigger.dom } };
}

function itemPresentation(
  item: SettingsCollectionItem,
): SettingsCollectionItem {
  return {
    ...item,
    ...(item.reference?.attributes
      ? {
          attributes: { ...item.attributes, ...item.reference.attributes },
        }
      : {}),
    ...(item.actions ? { actions: item.actions.map(actionIds) } : {}),
    ...(item.badges
      ? {
          badges: item.badges.map((badge) =>
            typeof badge === "string" || !badge.reference?.attributes
              ? badge
              : {
                  ...badge,
                  attributes: {
                    ...badge.attributes,
                    ...badge.reference.attributes,
                  },
                },
          ),
        }
      : {}),
    ...(item.cells
      ? {
          cells: Object.fromEntries(
            Object.entries(item.cells).map(([id, cell]) => [
              id,
              typeof cell === "object" && cell.kind === "select"
                ? { ...cell, options: optionIds(cell.options) }
                : cell,
            ]),
          ),
        }
      : {}),
  };
}

function disclosurePresentation(state: SettingsDisclosureState) {
  const summary = state.summary;
  if (summary?.content.kind !== "count" || !summary.content.dom) return state;
  return {
    ...state,
    summary: {
      ...summary,
      content: { ...summary.content, ...summary.content.dom },
    },
  };
}

function rowPresentation(row: SettingsRowDefinition): SettingsRowDefinition {
  const base = {
    ...row,
    ...row.dom,
    ...layoutHints(row.hints, row.reference),
  };
  switch (base.kind) {
    case "disclosure":
      return {
        ...base,
        ...disclosurePresentation(base),
        rows: base.rows.map(rowPresentation),
      };
    case "group":
      return { ...base, rows: base.rows.map(rowPresentation) };
    case "checkbox-group":
      return {
        ...base,
        options: optionIds(base.options),
        ...(base.disclosure
          ? {
              disclosure: {
                ...disclosurePresentation(base.disclosure),
                ...base.disclosure.dom,
              },
            }
          : {}),
      };
    case "multi-select":
    case "select":
    case "radio":
    case "segmented":
      return { ...base, options: optionIds(base.options) };
    case "action":
      return { ...base, action: actionIds(base.action) };
    case "collection":
      return {
        ...base,
        items:
          base.items.status === "ready"
            ? { status: "ready", value: base.items.value.map(itemPresentation) }
            : base.items,
        ...(base.add?.kind === "fields"
          ? {
              add: {
                ...base.add,
                fields: base.add.fields.map((field) =>
                  field.kind === "select" || field.kind === "color"
                    ? {
                        ...field,
                        ...field.dom,
                        options: optionIds(field.options),
                      }
                    : { ...field, ...field.dom },
                ),
              },
            }
          : base.add?.kind === "trigger"
            ? { add: { ...base.add, action: actionIds(base.add.action) } }
            : {}),
      };
    case "checkbox":
    case "custom":
    case "info":
    case "link":
    case "number":
    case "text":
    case "textarea":
    case "time":
    case "toggle":
      return base;
  }
}

/** Resolve grouped presentation metadata into the flat bridge fields used by existing skins. */
export function resolveSettingsPresentation(
  props: SettingsSectionsProps,
): SettingsSectionsProps {
  return {
    ...props,
    ...props.dom,
    ...layoutHints(props.hints, props.reference),
    sections: props.sections.map((section) => ({
      ...section,
      ...section.dom,
      ...layoutHints(section.hints, section.reference),
      rows: section.rows.map(rowPresentation),
    })),
  };
}

export function selectedSettingsAdornment(
  options: readonly SettingsOption[],
  value: string | null,
) {
  return options.find((option) => option.value === value)?.adornment;
}
