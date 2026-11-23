// Draft for defineSettingsPage. Examples and production row IDs follow the verified census.
import type { ComponentType } from "react";

type Text = string; // Already translated by the app or toolkit catalog.
export type SettingsRowId = `settings.${string}`;
type Id = SettingsRowId;
type Condition = { visible: boolean; disabledReason?: Text };
export type Operation<Args> = {
  actionName: string;
  run: (args: Args) => Promise<void>;
};
export type Read<Value> =
  | { status: "loading" }
  | { status: "error"; message: Text; retry: () => void }
  | { status: "ready"; value: Value };

export type Binding<Value> = {
  read: Read<Value>;
  write?: Operation<Value>;
  commit: "change" | "blur" | "explicit";
  optimistic: boolean;
  pending: boolean;
  error?: Text;
  saveLabel?: Text;
};

type BaseRow = {
  id: Id;
  label: Text;
  description?: Text;
  keywords?: Text;
  condition?: Condition;
};

export type Option<Value> = {
  value: Value;
  label: Text;
  disabledReason?: Text;
  summaryLabel?: Text;
  adornment?: { kind: "dot" } | { kind: "badge"; text: Text };
};

// Row references are validated within the disclosure's subtree.
export type CountSummary = {
  kind: "count";
  source:
    | {
        kind: "selected-options";
        row: "self" | Id;
        scope: "stored" | "available";
      }
    | { kind: "enabled-rows"; rows: readonly Id[] };
  template: Text; // {count}
};

export type SelectionStatusSummary = {
  kind: "selection-status";
  enabledBy: Id;
  selectedOptionsFrom: Id | readonly Id[];
  optionLabels?: Readonly<Record<string, Text>>;
  disabled: Text;
  none: Text;
  all: Text;
  partial: Text; // {list}
  list: {
    labelCase?: "as-provided" | "lowercase";
    separator: Text;
    pair?: {
      template: Text; // {first}, {second}
      useSeparatorIfLabelIncludes?: string;
    };
    overflow: { maxNamed: number; template: Text }; // {remaining}
  };
};

export type Summary = {
  when: "collapsed" | "always";
  content: CountSummary | SelectionStatusSummary;
};

type DisclosureState = {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  summary?: Summary;
};
type DialogSlot = ComponentType<{ close: () => void }>;

type ValueRow =
  | (BaseRow & { kind: "toggle" | "checkbox"; binding: Binding<boolean> })
  | (BaseRow & {
      kind: "text" | "textarea" | "time";
      binding: Binding<string>;
      placeholder?: Text;
      maxLength?: number;
    })
  | (BaseRow & {
      kind: "number";
      binding: Binding<number | null>;
      min?: number;
      max?: number;
      step?: number;
    })
  | (BaseRow & {
      kind: "select" | "radio" | "segmented";
      binding: Binding<string | null>;
      options: readonly Option<string>[];
    })
  | (BaseRow & {
      kind: "multi-select";
      binding: Binding<readonly string[]>;
      options: readonly Option<string>[];
    })
  | (BaseRow & {
      kind: "checkbox-group";
      binding: Binding<readonly string[]>;
      options: readonly Option<string>[];
      disclosure?: DisclosureState;
    });

type Trigger =
  | { kind: "invoke"; operation: Operation<void> }
  | { kind: "dialog"; title: Text; body: DialogSlot }
  | { kind: "navigate"; href: string };

export type RowAction = {
  id: string;
  label: Text;
  intent?: "neutral" | "danger";
  condition?: Condition;
  trigger: Trigger;
};

type CollectionItem = {
  key: string;
  title: Text;
  description?: Text;
  badges?: readonly Text[];
  image?: { src: string; alt: string };
  actions: readonly RowAction[];
};

export type CollectionField =
  | { kind: "text"; id: string; label: Text; required?: boolean }
  | {
      kind: "select";
      id: string;
      label: Text;
      options: readonly Option<string>[];
      required?: boolean;
    }
  | { kind: "checkbox"; id: string; label: Text }
  | {
      kind: "image";
      id: string;
      label: Text;
      accept: readonly string[];
      required?: boolean;
    };

export type CollectionFieldValue = string | boolean | File;

type CollectionAdd =
  | {
      kind: "fields";
      label: Text;
      fields: readonly CollectionField[];
      submitLabel: Text;
      submit: Operation<Readonly<Record<string, CollectionFieldValue>>>;
      error?: Text;
      pending?: boolean;
    }
  | { kind: "trigger"; action: RowAction };

export type CollectionRow = BaseRow & {
  kind: "collection";
  items: Read<readonly CollectionItem[]>;
  emptyLabel: Text;
  add?: CollectionAdd;
  noMatchesLabel?: Text;
  previousLabel?: Text;
  nextLabel?: Text;
  search?: { value: string; label: Text; set: (value: string) => void };
  paging?: { previous?: () => void; next?: () => void };
};

type DisclosureRow = BaseRow &
  DisclosureState & {
    kind: "disclosure";
    rows: readonly SettingsRowDefinition[];
  };

export type SettingsRowDefinition =
  | ValueRow
  | CollectionRow
  | DisclosureRow
  | (BaseRow & { kind: "action"; action: RowAction })
  | (BaseRow & { kind: "link"; href: string; external?: boolean })
  | (BaseRow & { kind: "info"; value: Text; copyLabel?: Text })
  | (BaseRow & { kind: "custom"; component: ComponentType });

export type SettingsSection = {
  id: string;
  label?: Text;
  rows: readonly SettingsRowDefinition[];
};

// In the registry, Common is today's SettingsPageDefinition without component.
// Props is the existing SettingsPageProps, including context and bridge.
export type SettingsPageBody<Props> =
  | { component: ComponentType<Props>; sections?: never }
  | {
      sections: (props: Props) => readonly SettingsSection[];
      component?: never;
    };

export type SettingsPageWithBody<Common, Props> = Common &
  SettingsPageBody<Props>;
