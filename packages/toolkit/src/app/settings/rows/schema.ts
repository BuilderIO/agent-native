import type {
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";

/**
 * Settings rows as data. A page describes its sections and rows; a skin renders
 * them. The model owns values, writes, visibility and disabled state. A skin
 * owns markup and look only.
 */

/** Stable semantic id, shared by every skin: `settings.<page>.<row>`. */
export type SettingsRowId = `settings.${string}`;

export const SETTINGS_ROW_ID_PATTERN =
  /^settings(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

export interface SettingsCondition {
  /** A hidden row is not rendered and not counted. Defaults to visible. */
  visible?: boolean;
  disabled?: boolean;
  /** Shown to the user where the skin has room for it. */
  disabledReason?: string;
}

/**
 * Layout hints a skin may read and may ignore. They never change behavior.
 * Each distinct hint in use is listed by `settingsCoverage`, so the set stays
 * small and visible.
 */
export type SettingsHints = Readonly<Record<string, string | number | boolean>>;

export type SettingsRowTags = Readonly<Record<string, string>>;

/** Asks before a write, for the values `when` selects. */
export interface SettingsWriteConfirmation<Value> {
  when: (next: Value) => boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  intent?: "neutral" | "danger";
}

export interface SettingsBinding<Value> {
  value: Value;
  /** Absent means read-only. */
  set?: (value: Value) => void | Promise<void>;
  /** The action a write runs, for the semantic snapshot. */
  actionName?: string;
  /** A write is in flight. */
  pending?: boolean;
  /** When the value is committed. Defaults to `change`. */
  commit?: "change" | "blur" | "explicit";
  confirm?: SettingsWriteConfirmation<Value>;
}

export type SettingsOptionAdornment =
  | { kind: "dot" }
  | { kind: "badge"; text: string };

export interface SettingsDomIds {
  anchorId?: string;
  controlId?: string;
  labelId?: string;
  descriptionId?: string;
  headingId?: string;
  titleId?: string;
  countId?: string;
  panelId?: string;
}

export interface SettingsReferenceLayout {
  frame?: string;
  columns?: number;
  gap?: number;
  itemGap?: number;
  dividers?: boolean;
  placement?: "header" | "footer";
  text?: "identifier";
  emphasis?: "ghost";
  itemDescription?: "code";
  surface?: "plain";
  stacked?: boolean;
}

export interface SettingsReferenceCompatibility {
  layout?: SettingsReferenceLayout;
}

export interface SettingsReferenceAttributes {
  attributes?: Readonly<
    Partial<
      Record<
        | "data-testid"
        | "data-session-row"
        | "data-session-current"
        | "data-invite-link"
        | "data-api-key-row",
        string
      >
    >
  >;
}

export interface SettingsOption {
  dom?: Pick<SettingsDomIds, "controlId">;
  adornment?: SettingsOptionAdornment;
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** A drawn example of the choice, for options shown as cards. */
  preview?: ReactNode;
  /** DOM id for this option's control, when the page already has one. */
  controlId?: string;
}

/** A row's own data is loading or could not be read. */
export type SettingsRowState =
  | { status: "loading"; label: string }
  | {
      status: "error";
      message: string;
      retry?: () => void;
      retryLabel?: string;
    };

interface BaseRow {
  dom?: Pick<
    SettingsDomIds,
    "anchorId" | "controlId" | "labelId" | "descriptionId"
  >;
  reference?: SettingsReferenceCompatibility;
  id: SettingsRowId;
  label: string;
  /** The label names the row for assistive technology and is not drawn. */
  labelHidden?: boolean;
  description?: ReactNode;
  keywords?: string;
  condition?: SettingsCondition;
  icon?: ReactNode;
  /** DOM id for the control, when the page already has one. */
  controlId?: string;
  /** The control's accessible name, when it differs from `label`. */
  controlLabel?: string;
  /** DOM id the row's label points at, when that is not the control. */
  anchorId?: string;
  /** DOM id of the label element, for controls named by reference. */
  labelId?: string;
  /** DOM id of the description element, for controls described by reference. */
  descriptionId?: string;
  /** A short result shown beside the control, for example after a save. */
  status?: { tone: "neutral" | "success" | "danger"; message: string };
  /** The message of a failed or refused write. The row stays rendered. */
  error?: string;
  /** Present while the row's own value cannot be shown. */
  state?: SettingsRowState;
  hints?: SettingsHints;
}

export interface SettingsCountSummary {
  dom?: Pick<SettingsDomIds, "countId">;
  kind: "count";
  /** Count the selected options of this row, or of another checkbox group. */
  source:
    | { kind: "selected-options"; row: "self" | SettingsRowId }
    | { kind: "enabled-rows"; rows: readonly SettingsRowId[] };
  /** `{count}` is replaced. */
  template: string;
  /** DOM id of the element holding the number, when the page already has one. */
  countId?: string;
}

export interface SettingsSelectionStatusSummary {
  kind: "selection-status";
  /** A toggle row among the children. */
  enabledBy: SettingsRowId;
  /** One or more option rows among the children; their selections are joined. */
  selectedOptionsFrom: SettingsRowId | readonly SettingsRowId[];
  /** Labels for stored options the rows no longer offer. */
  optionLabels?: Readonly<Record<string, string>>;
  /** How many named options count as all of them. Defaults to the options offered. */
  allCount?: number;
  disabled: string;
  /** Enabled with no named option. */
  none: string;
  all: string;
  /** `{list}` is replaced. */
  partial: string;
  list: {
    labelCase?: "as-provided" | "lowercase";
    separator: string;
    pair?: {
      /** `{first}` and `{second}` are replaced. */
      template: string;
      /** Fall back to the separator when a label contains this word. */
      useSeparatorIfLabelIncludes?: string;
    };
    /** `{remaining}` is replaced. */
    overflow: { maxNamed: number; template: string };
  };
}

export interface SettingsSummary {
  when: "collapsed" | "always";
  content: SettingsCountSummary | SettingsSelectionStatusSummary;
}

export interface SettingsDisclosureState {
  dom?: Pick<SettingsDomIds, "panelId">;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  summary?: SettingsSummary;
  /** DOM id of the region the row opens, when the page already has one. */
  panelId?: string;
}

export type SettingsDialogBody = ComponentType<{
  close: () => void;
  /** For a body that draws its own window: spread on its root element. */
  tags: SettingsRowTags;
}>;

export type SettingsTrigger =
  | { kind: "invoke"; run: () => void | Promise<void>; actionName?: string }
  | {
      kind: "dialog";
      title: string;
      /** DOM id of the title element, when the page already has one. */
      titleId?: string;
      dom?: Pick<SettingsDomIds, "titleId">;
      description?: string;
      /** Absent when the title and description are the whole dialog. */
      body?: SettingsDialogBody;
      /** `body` when the body draws its own window. Defaults to `skin`. */
      chrome?: "skin" | "body";
      /** For a dialog the model also opens itself. */
      open?: boolean;
      setOpen?: (open: boolean) => void;
    }
  | {
      kind: "confirm";
      title: string;
      /** DOM id of the title element, when the page already has one. */
      titleId?: string;
      dom?: Pick<SettingsDomIds, "titleId">;
      description?: string;
      confirmLabel: string;
      cancelLabel: string;
      run: () => void | Promise<void>;
      actionName?: string;
    }
  | { kind: "navigate"; href: string; external?: boolean };

export interface SettingsRowAction {
  id: string;
  label: string;
  /** The control's accessible name, when it differs from `label`. */
  accessibleLabel?: string;
  intent?: "neutral" | "primary" | "danger";
  icon?: ReactNode;
  pending?: boolean;
  /** A pressed state, for an action that toggles something on an item. */
  active?: boolean;
  /** A transient acknowledgement, independent of a pressed toggle. */
  acknowledged?: boolean;
  /** The message of a failed run. */
  error?: string;
  condition?: SettingsCondition;
  trigger: SettingsTrigger;
}

export type SettingsCollectionCell =
  | string
  | {
      kind: "select";
      label: string;
      binding: SettingsBinding<string>;
      options: readonly SettingsOption[];
    }
  | {
      kind: "toggle" | "checkbox";
      label: string;
      binding: SettingsBinding<boolean>;
    }
  | { kind: "text"; label: string; binding: SettingsBinding<string> }
  | {
      /** Plain text with a tone or a tooltip. */
      kind: "value";
      value: string;
      /** A stable name for the state the value shows, for skins that mark it. */
      key?: string;
      tone?: "default" | "muted" | "warning" | "danger";
      tooltip?: string;
    }
  | {
      kind: "color";
      label: string;
      binding: SettingsBinding<string>;
      options: readonly SettingsOption[];
    }
  | {
      kind: "status";
      label: string;
      tone: "neutral" | "success" | "warning" | "danger";
      /** A stable name for the status, for skins that mark it. */
      key?: string;
    };

/** Data attributes the page already carries on an element. */
export type SettingsDataAttributes = Readonly<Record<`data-${string}`, string>>;

export interface SettingsCollectionItem {
  reference?: SettingsReferenceAttributes;
  /** Stable entity key; written to `data-rid-key`. */
  key: string;
  title: string;
  description?: ReactNode;
  /** Items with the same group are drawn together under it. */
  group?: string | { id: string; label: string };
  titleTooltip?: string;
  attributes?: SettingsDataAttributes;
  /** A muted item recedes, for example one that is no longer active. */
  tone?: "default" | "muted";
  /** Lets the title be renamed in place. */
  rename?: { label: string; binding: SettingsBinding<string> };
  /** A small visual before the title: an avatar, a color dot, a glyph. */
  leading?: ReactNode;
  badges?: readonly (
    | string
    | {
        label: string;
        tone: "neutral" | "success" | "warning" | "danger";
        attributes?: SettingsDataAttributes;
        reference?: SettingsReferenceAttributes;
      }
  )[];
  /** Extra columns, by column id. */
  cells?: Readonly<Record<string, SettingsCollectionCell>>;
  actions?: readonly SettingsRowAction[];
  /** Opens the item, when the whole item is a link. */
  href?: string;
}

interface CollectionFieldBase {
  condition?: SettingsCondition;
  dom?: Pick<SettingsDomIds, "controlId">;
  id: string;
  label: string;
  /** Quieter text after the label, for example "optional". */
  labelSuffix?: string;
  /** Help text shown with the field. */
  description?: string;
  /** DOM id for the field's control, when the page already has one. */
  controlId?: string;
  /** The value the form starts with and returns to. */
  initialValue?: string | boolean;
  /** Keep the entered value after a successful submit. */
  keepAfterSubmit?: boolean;
}

export type SettingsCollectionField =
  | (CollectionFieldBase & {
      kind: "text" | "textarea";
      placeholder?: string;
      required?: boolean;
      maxLength?: number;
    })
  | (CollectionFieldBase & {
      kind: "select" | "color";
      options: readonly SettingsOption[];
      required?: boolean;
    })
  | (CollectionFieldBase & { kind: "checkbox" })
  | (CollectionFieldBase & {
      kind: "image";
      accept?: string;
      required?: boolean;
      /** The visible text of the file control, when it differs from `label`. */
      buttonLabel?: string;
    });

export type SettingsCollectionFieldValue = string | boolean | File | null;

/** A submit that did not save returns the message to show; the form stays as it is. */
export type SettingsSubmitResult = void | { error: string };

export type SettingsCollectionAdd =
  | {
      kind: "fields";
      label: string;
      /** The form's own title, when it differs from the add control's label. */
      title?: string;
      /** Help text shown with the form. */
      description?: string;
      fields: readonly SettingsCollectionField[];
      submitLabel: string;
      cancelLabel?: string;
      submit: (
        values: Readonly<Record<string, SettingsCollectionFieldValue>>,
      ) => SettingsSubmitResult | Promise<SettingsSubmitResult>;
      /** A message the model already holds, for example from a failed write. */
      error?: string;
      actionName?: string;
      pending?: boolean;
    }
  | { kind: "trigger"; action: SettingsRowAction };

export type SettingsRead<Value> =
  | { status: "loading"; label?: string }
  | {
      status: "error";
      title?: string;
      message: string;
      retry?: () => void;
      retryLabel?: string;
    }
  | { status: "ready"; value: Value };

export interface SettingsCollectionColumn {
  id: string;
  label: string;
  /** A CSS track size. */
  width?: string;
  /** The column is dropped below this width. */
  hideBelow?: "sm" | "md" | "lg";
  tone?: "default" | "muted";
  /** Present on a column the user can sort by. */
  sort?: "ascending" | "descending" | "none";
}

export type SettingsRowDefinition =
  | (BaseRow & {
      kind: "toggle" | "checkbox";
      binding: SettingsBinding<boolean>;
    })
  | (BaseRow & {
      kind: "text" | "textarea" | "time";
      binding: SettingsBinding<string>;
      placeholder?: string;
      maxLength?: number;
      /** Opt-in display metadata, independent of input validation. */
      counter?: { limit: number };
      descriptionPlacement?: "below-field";
      /** Fixed text drawn inside the field before the value. */
      prefix?: string;
      /** The save control's label when the binding commits explicitly. */
      saveLabel?: string;
      cancelLabel?: string;
      /**
       * `view` shows the value as text with an edit control; editing then
       * commits explicitly. Defaults to `edit`.
       */
      mode?: "edit" | "view";
      editLabel?: string;
      onEditStart?: () => void;
      /** For a `view` row whose model decides when editing ends. */
      editing?: boolean;
      setEditing?: (editing: boolean) => void;
      /** What a `view` row shows when there is no value yet. */
      emptyValue?: { label: string; description?: string };
    })
  | (BaseRow & {
      kind: "number";
      binding: SettingsBinding<number | null>;
      min?: number;
      max?: number;
      step?: number;
    })
  | (BaseRow & {
      kind: "select" | "radio" | "segmented";
      binding: SettingsBinding<string | null>;
      options: readonly SettingsOption[];
      placeholder?: string;
      /** The form name of a radio group, when the page already has one. */
      name?: string;
    })
  | (BaseRow & {
      kind: "multi-select";
      binding: SettingsBinding<readonly string[]>;
      options: readonly SettingsOption[];
      /** The options are found by typing. */
      searchable?: boolean;
      placeholder?: string;
      /** Shown when nothing is chosen. */
      emptyValueLabel?: string;
      /** Shown when the typed text matches no option. */
      emptyLabel?: string;
    })
  | (BaseRow & {
      kind: "checkbox-group";
      binding: SettingsBinding<readonly string[]>;
      options: readonly SettingsOption[];
      disclosure?: SettingsDisclosureState;
    })
  | (BaseRow &
      SettingsDisclosureState & {
        kind: "disclosure";
        rows: readonly SettingsRowDefinition[];
      })
  | (BaseRow & { kind: "group"; rows: readonly SettingsRowDefinition[] })
  | (BaseRow & {
      kind: "collection";
      items: SettingsRead<readonly SettingsCollectionItem[]>;
      /** Shown when there are no items. Absent when the row hides while empty. */
      emptyLabel?: string;
      /** Header controls besides add, for example reset or clear all. */
      actions?: readonly SettingsRowAction[];
      /** The heading of the title column, where the list has headings. */
      titleLabel?: string;
      /** The heading of the column that holds each item's actions. */
      actionsLabel?: string;
      /** The name of the control that opens an item's actions; `{title}` is replaced. */
      itemActionsLabel?: string;
      /** A choice that narrows the list, for example a pair of tabs. */
      filter?: {
        label: string;
        value: string;
        options: readonly SettingsOption[];
        set: (value: string) => void;
      };
      columns?: readonly SettingsCollectionColumn[];
      onSort?: (columnId: string) => void;
      add?: SettingsCollectionAdd;
      search?: {
        value: string;
        label: string;
        set: (value: string) => void;
        onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
        /** Present when the typed text can also be added as a new item. */
        submit?: {
          label: string;
          run: () => void | Promise<void>;
          disabled?: boolean;
        };
        clearLabel?: string;
        /** Lets the model focus the field from a shortcut. */
        inputRef?: RefObject<HTMLInputElement | null>;
      };
      paging?: {
        previous?: () => void;
        next?: () => void;
        previousLabel: string;
        nextLabel: string;
        label?: string;
      };
      /** A line under the list, for example a count. */
      footer?: string;
    })
  | (BaseRow & { kind: "action"; action: SettingsRowAction })
  | (BaseRow & {
      kind: "link";
      href: string;
      external?: boolean;
      linkLabel?: string;
      /** The current value, shown with the link. */
      value?: string;
    })
  | (BaseRow & { kind: "info"; value: string; copyLabel?: string })
  | (BaseRow & {
      /** An app-rendered slot. Counted as not covered by the schema. */
      kind: "custom";
      /** `tags` go on the component's root element, so no wrapper is needed. */
      component: ComponentType<{ tags: SettingsRowTags }>;
      /** Why this row cannot be described as data. */
      reason: string;
    });

export type SettingsRowKind = SettingsRowDefinition["kind"];

export interface SettingsSectionDefinition {
  dom?: Pick<SettingsDomIds, "headingId">;
  reference?: SettingsReferenceCompatibility;
  /** Unique within the page; lowercase and hyphenated. */
  id: string;
  label?: string;
  description?: string;
  /** DOM id of the heading, when the page already has one. */
  headingId?: string;
  /** While the page's own data is loading or failed, rows are not rendered. */
  state?:
    | { status: "loading"; label: string; rows?: number }
    | {
        status: "error";
        message: string;
        retry?: () => void;
        retryLabel?: string;
      }
    | { status: "ready" };
  /** A message shown with the section while its rows stay rendered. */
  notice?: { tone: "neutral" | "warning" | "danger"; message: string };
  rows: readonly SettingsRowDefinition[];
  hints?: SettingsHints;
}

export interface SettingsSectionsProps {
  dom?: Pick<SettingsDomIds, "descriptionId">;
  reference?: SettingsReferenceCompatibility;
  sections: readonly SettingsSectionDefinition[];
  /** Page title, when the page renders its own heading above the sections. */
  title?: string;
  description?: string;
  /** DOM id of the description element, when the page already has one. */
  descriptionId?: string;
  hints?: SettingsHints;
}
