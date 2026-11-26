/** Headless sidebar and shell data. Intent callbacks belong to the model. */
export type ShellPart = "sidebar" | "app-shell";
export type SidebarSubPart =
  | "sidebar"
  | `sidebar.${"header" | "item" | "section" | "tree" | "rail" | "footer" | "resize-handle" | "slot"}`;
export type AppShellSubPart =
  | "app-shell"
  | `app-shell.${"nav" | "topbar" | "main" | "aside" | "banner" | "overlays" | "skeleton" | "split"}`;
export type ShellSubPart = SidebarSubPart | AppShellSubPart;
export type ShellIdentity = {
  id: string;
  entityKey?: string;
  parentEntityKey?: string;
  containerId: string;
  order: number;
  family?: { members: readonly string[]; entityKeySource?: string };
  presentations?: readonly string[];
} & (
  | { part: "sidebar"; subPart: SidebarSubPart }
  | { part: "app-shell"; subPart: AppShellSubPart }
);
export interface ShellCondition {
  visible?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  gate?: { key: string; allowed: boolean; denied: "hidden" | "disabled" };
}
export interface ShellBinding<Value> {
  value: Value;
  /** Local value/draft only; writes go through changeEffectId. */
  set?: (value: Value) => void;
  changeEffectId?: string;
  commit?: "change" | "blur" | "explicit";
}
export type ShellReadState =
  | { status: "ready" }
  | { status: "loading"; label: string }
  | {
      status: "error";
      message: string;
      reloadEffectId?: string;
      retryLabel?: string;
    };
export interface ShellActionEffect {
  id: string;
  kind: "action";
  actionName: string;
  run: (input?: ShellValue) => void | Promise<void>;
  /** Registry prerequisite; its successful completion precedes run. */
  beforeEffectId?: string;
  pending?: boolean;
  error?: string | undefined;
  retry?: () => void | Promise<void>;
}
export type ShellValue =
  | null
  | string
  | number
  | boolean
  | readonly ShellValue[]
  | { readonly [key: string]: ShellValue };
/** Actions are references into ShellModel.effects, never copies of action state. */
export type ShellEffect =
  | { kind: "action"; effectId: string; input?: ShellValue }
  | {
      kind: "navigate";
      to: string;
      state?: Readonly<Record<string, string | boolean>>;
      close?: "mobile" | "peek" | "menu" | "none";
      restoreScrollPosition?: number;
    }
  | { kind: "external"; href: string; target?: "_blank"; rel?: string }
  | {
      kind: "open";
      surfaceId: string;
      open: ShellBinding<boolean>;
      body: ShellContentOwner;
      /** Content owns its surface, dismissal and focus return. Omitted: house dialog. */
      surface?: {
        owner: "content";
        kind: "dialog" | "menu" | "listbox" | "tree" | "grid";
        /** Host mount survives a retained menu closing/unmounting its opener. */
        mount?: "host";
        /** Retained primitive owns activation timing and every open-state write. */
        activation?: "content";
      };
    }
  | { kind: "none" };
export type ShellContentOwner =
  | { owner: "model" | "page" | "kit"; key: string }
  | { owner: "custom" | "later-pattern"; key: string; reason: string };
export type ShellActiveRule =
  | { kind: "exact"; paths: readonly string[] }
  | { kind: "prefix"; path: string; boundary: "segment" }
  | { kind: "longest-match"; destination: string }
  | { kind: "resolved"; value: boolean; ruleId: string }
  | { kind: "none" };
export interface ShellDomIds {
  anchorId?: string;
  controlId?: string;
  labelId?: string;
  descriptionId?: string;
  headingId?: string;
  titleId?: string;
  countId?: string;
  panelId?: string;
}
export type ShellCompatibilityAttributeName =
  | "data-testid"
  | "data-team-id"
  | "data-team-favorite-id"
  | "data-active"
  | "data-settings-rail"
  | "data-rail-section"
  | "data-task-nav-item";
export interface ShellCompatibility {
  attributes?: Readonly<
    Partial<Record<ShellCompatibilityAttributeName, string>>
  >;
  nodes?: Readonly<
    Partial<
      Record<
        "control" | "badge" | "panel",
        {
          attributes?: Readonly<
            Partial<Record<ShellCompatibilityAttributeName, string>>
          >;
        }
      >
    >
  >;
}
/** Resolved appearance: looks may ignore/map color; the existing kind is the image fallback. */
export type ShellIconReference = (
  | { kind: "symbol"; key: string }
  | { kind: "initial"; text: string }
  | { kind: "entity"; key: string; fallbackText: string }
) & {
  color?: string;
  /** App-supplied URL and text alternative; empty alt preserves decorative images. */
  image?: { src: string; alt: string };
};
export type ShellAdornment = { kind: "dot" } | { kind: "badge"; text: string };
export interface ShellBadge {
  kind: "count" | "dot" | "text";
  value?: number;
  text?: string;
  accessibleLabel?: string;
  maxText?: string;
  visible: boolean;
  adornment?: ShellAdornment;
}
export interface ShellKeyChord {
  key?: string;
  code?: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}
export interface ShellShortcutDescriptor {
  id: string;
  actionName: string;
  ownerId: string;
  keys: readonly ShellKeyChord[];
  displayLabel: string;
  platform: "mac" | "other" | "all";
  sequenceTimeoutMs?: number;
  sequencePolicy?: {
    /** Defaults retain the inclusive window and matched-prefix restart. */
    expiry?: "inclusive" | "exclusive";
    /** Reserve consumes any unmatched suffix and reports it without dispatching. */
    unmatched?: "restart" | "consume" | "reserve";
    modifiers?: "preserve" | "consume";
    /** Omitted guards reset progress; preservation never extends the window. */
    guardRejected?: Partial<
      Record<
        | "repeat"
        | "defaultPrevented"
        | "composition"
        | "overlay"
        | "focus"
        | "pause"
        | "modifiers",
        "reset" | "preserve"
      >
    >;
  };
  /** Reserve at phase, then delegate the SAME event at this phase to activate. */
  activation?: {
    phase: "capture" | "bubble";
    guard: ShellShortcutDescriptor["guard"];
  };
  scope: string;
  phase: "capture" | "bubble";
  guard: {
    focusKinds: readonly string[];
    allowRepeat: boolean;
    composition: "ignore" | "allow";
    overlay: "ignore" | "allow";
    respectDefaultPrevented: boolean;
    /** Reject held modifiers before matching or consuming a sequence. */
    rejectModifiers?: readonly ("ctrl" | "alt" | "meta" | "shift")[];
    pauseOwner?: string;
    /** If present, pause applies only to these event.key values (case insensitive). */
    pauseKeys?: readonly string[];
  };
}
export interface ShellDisclosure {
  binding: ShellBinding<boolean>;
  panelId?: string;
  unmountWhenClosed: boolean;
  revealActive?: boolean;
  /** Inline content toggles only at its header; it is not a dismissible surface. */
  dismissal?: "header-only";
}
export interface ShellRename {
  binding: ShellBinding<string>;
  editing: ShellBinding<boolean>;
  controlLabel: string;
  trim: boolean;
  ignoreEmpty: boolean;
  ignoreUnchanged: boolean;
  commitOnBlur: boolean;
  cancelKey: "Escape";
  submitKey: "Enter";
  commitEffectId: string;
  autoFocus: boolean;
  blurBoundary: "control" | "row";
}
/** The retained controller composes generated nodes, and earns no row/body credit. */
export interface ShellGeneratedComposition {
  ownerKey: string;
}
export type NavigationEntry = ShellIdentity &
  ShellCondition & {
    kind:
      | "destination"
      | "action"
      | "choice"
      | "disclosure"
      | "heading"
      | "identity"
      | "status"
      | "filter"
      | "controller";
    composition?: ShellGeneratedComposition | undefined;
    label?: string;
    controlLabel?: string;
    accessibleLabel?: string;
    /** Read-only action annotation; does not create or control a surface. */
    expanded?: boolean;
    labelHidden?: boolean;
    /** Small icon control; independent of section layout and sidebar collapse. */
    iconOnly?: boolean;
    description?: string;
    tooltip?: string;
    icon?: ShellIconReference | undefined;
    effect?: ShellEffect;
    active?: ShellActiveRule;
    badge?: ShellBadge;
    shortcut?: ShellShortcutDescriptor;
    state?: ShellReadState;
    binding?: ShellBinding<string> | ShellBinding<boolean>;
    disclosure?: ShellDisclosure;
    children?: readonly NavigationEntry[];
    trailingActions?: readonly NavigationEntry[];
    choices?: readonly {
      value: string;
      label: string;
      disabled?: boolean;
      adornment?: ShellAdornment;
    }[];
    search?: {
      binding: ShellBinding<string>;
      placeholder: string;
      emptyLabel?: string;
      /** Decorative leading icon, resolved by the host symbol registry. */
      leadingIcon?: ShellIconReference;
      match: "label-substring" | "resolved";
    };
    rename?: ShellRename;
    metadata?: {
      secondaryText?: string;
      pinned?: boolean;
      completed?: boolean;
      current?: boolean;
    };
    dom?: ShellDomIds;
    compatibility?: ShellCompatibility;
  };
export interface SidebarResizePolicy {
  min: number;
  max: number;
  step: number;
  shiftStep?: number;
  reset?: number;
  round: boolean;
  keyboard: boolean;
  growOnlyFrom?: number;
  pointerCancel: "restore-start-and-commit" | "commit-current";
  lostPointerCapture: "restore-start-and-commit" | "commit-current" | "unbound";
  persist: "end" | "change";
  storageKey: string;
  codec: "decimal";
}
export interface SidebarReorderPolicy {
  containerId: string;
  pointerThreshold: number;
  collision: "closestCenter";
  keyboard:
    | false
    | { start: "Space"; move: "arrows"; end: "Space"; cancel: "Escape" };
  cancel: "restore-order";
  missingDropTarget: "no-commit";
  merge: "visible-into-complete-order" | "siblings";
  persist: "server" | "local" | "none";
  disableWhileEffectPending: boolean;
}
export type ShellNavigationDensity = "default" | "compact";
export type NavigationSection = ShellIdentity &
  ShellCondition & {
    composition?: ShellGeneratedComposition;
    label?: string;
    entries: readonly NavigationEntry[];
    /** Optional house layout; inline controls retain model order and accessible names. */
    presentation?: {
      layout?: "inline-icons";
      density?: ShellNavigationDensity;
    };
    disclosure?: ShellDisclosure;
    state?: ShellReadState;
    emptyLabel?: string;
    hideIfEmpty: boolean;
    limit?: number;
    dom?: ShellDomIds;
    compatibility?: ShellCompatibility;
    reorder?: {
      controllerId: string;
      policy: SidebarReorderPolicy;
      commitEffectId: string;
      preview: (keys: readonly string[]) => void;
    };
  };
export interface ShellPreferencePolicy {
  key: string;
  storage: "local" | "session";
  encoding:
    | "zero-one"
    | "true-false"
    | "decimal"
    | "json-string-array"
    | "section-memory"
    | "theme";
  readStatus: "absent" | "value" | "invalid" | "unavailable";
  write: "end" | "change" | "controller";
}
export type NavigationContentSlot = ShellIdentity & {
  visible?: boolean;
  part: "sidebar";
  subPart: "sidebar.slot";
  content: Extract<ShellContentOwner, { owner: "custom" | "later-pattern" }>;
};
export interface NavigationModel {
  /** Retained menu content has no sidebar frame; its host adapter owns collection/keyboard semantics. */
  menu?: { ownerKey: string };
  /** Interleaved by order with entries and sections; retained content earns no shared credit. */
  contentSlots?: readonly NavigationContentSlot[];
  entries: readonly NavigationEntry[];
  sections: readonly NavigationSection[];
  presentation: {
    /** Omitted preserves the existing house rhythm; compact rows are 28px. */
    density?: ShellNavigationDensity;
    collapsed: ShellBinding<boolean>;
    mobileOpen: ShellBinding<boolean>;
    peekOpen: boolean;
    profile: string;
    themeFamily: string;
    visibility: "visible" | "hidden" | "inert";
    width: number;
  };
  resize?: {
    /** Omitted keeps the registered accessible house choice; policy honors pointer-only hosts. */
    interaction?: "policy";
    policy: SidebarResizePolicy;
    width: ShellBinding<number>;
    preview: (width: number) => void;
    finishEffectId: string;
  };
}
export type ShellRegion = ShellIdentity &
  ShellCondition & {
    composition?: ShellGeneratedComposition;
    /** Standalone state keeps title/detail/recovery together without naming the alert. */
    readPresentation?: "standalone";
    /** One alert, registry failure first, then the region's modeled recovery controls. */
    effectError?: { effectId: string };
    content: ShellContentOwner;
    title?: string;
    actions?: readonly NavigationEntry[];
    state?: ShellReadState;
    dom?: ShellDomIds;
    compatibility?: ShellCompatibility;
  };
/** Observations preserve competing writers; the kit never applies these attributes. */
export interface ShellBootWitness {
  phase: "boot" | "ready" | "settled";
  rootAttributes: Readonly<Record<string, string | null>>;
  bodyAttributes: Readonly<Record<string, string | null>>;
  navigationWidth: number | null;
  themeFamily: {
    attribute: string | null;
    stored: string | null;
    lastWriter: string | null;
  };
}
export interface ShellRiskRegistration {
  id: string;
  rows: readonly string[];
  reason: string;
  witnesses: readonly ShellBootWitness[];
}
export interface ShellModel {
  frame: {
    key: string;
    routeRuleId: string;
    identity?: Extract<ShellIdentity, { part: "app-shell" }> & {
      subPart: "app-shell";
    };
    preferences?: { pointerCursors?: boolean; underlineLinks?: boolean };
  };
  regions: readonly ShellRegion[];
  navigation: NavigationModel;
  /** Independent controller mounted only inside the open mobile drawer. */
  mobileNavigation?: { ownerKey: string; open: ShellBinding<boolean> };
  shortcuts: readonly ShellShortcutDescriptor[];
  preferences: readonly ShellPreferencePolicy[];
  effects: readonly ShellActionEffect[];
  risks?: readonly ShellRiskRegistration[];
}
export interface SidebarPartProps {
  model: NavigationModel;
  effects: readonly ShellActionEffect[];
}
export interface AppShellPartProps {
  model: ShellModel;
}
