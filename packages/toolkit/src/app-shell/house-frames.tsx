import { Slot } from "@radix-ui/react-slot";
import {
  IconAlertTriangle,
  IconRefresh,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconGripVertical,
  IconLayoutSidebar,
  IconPoint,
  IconPin,
} from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  type MouseEvent,
  type ComponentPropsWithoutRef,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";

import { useWholePart } from "../design-system/whole-parts.js";
import { ButtonBase } from "../ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet.js";
import { Skeleton } from "../ui/skeleton.js";
import { cn } from "../utils.js";
import type {
  AppShellPartProps,
  NavigationEntry,
  NavigationModel,
  NavigationSection,
  ShellActionEffect,
  ShellBinding,
  ShellIdentity,
  ShellIconReference,
  ShellReadState,
  ShellRegion,
  SidebarPartProps,
} from "./contracts.js";
import {
  ShellContent,
  ShellGeneratedOwner,
  shellFrameAttributes,
  ShellMenuControl,
  ShellMenuEditor,
  ShellNavigationScope,
  ShellHostProvider,
  useShellHost,
  type ShellMenuControlProps,
} from "./house-shell-host.js";
import { HouseSurfaceRoot, useHouseSurface } from "./house-surface.js";
import {
  useNavigationFocusHandoff,
  useNavigationRename,
  useNavigationReorder,
  useSidebarResize,
} from "./shell-hooks.js";
import {
  isShellRouteActive,
  runShellAction,
  shellAction,
  shellConditionState,
} from "./shell-policies.js";
import { shellTags } from "./shell-testing.js";

const DisabledContext = createContext(false);
const BannerEffectContext = createContext<string | undefined>(undefined);
const NavigationContext = createContext<NavigationModel | null>(null);
const CompactContext = createContext(false);
const DensityContext = createContext<"default" | "compact">("default");
const InlineControlsContext = createContext(false);
const compactRowClass = "h-7 min-h-7 py-0 text-[13px] font-normal";
const iconControlClass = "size-7 min-h-7 w-7 shrink-0 justify-center p-0";
const RenameContext = createContext<ReturnType<
  typeof useNavigationRename
> | null>(null);
const rowClass =
  "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50";
const ordered = <T extends { order: number }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.order - b.order);
const supportsIconControl = (entry: NavigationEntry) =>
  Boolean(entry.icon) &&
  ["action", "destination", "identity"].includes(entry.kind) &&
  !entry.search &&
  !entry.binding &&
  !entry.choices &&
  !entry.rename &&
  !entry.disclosure &&
  !entry.children?.length &&
  !entry.trailingActions?.length;
const entryKey = (entry: ShellIdentity) =>
  JSON.stringify([entry.id, entry.entityKey ?? null]);
const nameOf = (entry: NavigationEntry) => {
  if (entry.accessibleLabel !== undefined) return entry.accessibleLabel;
  const badge = entry.badge;
  const badgeName = badge?.visible
    ? (badge.accessibleLabel ??
      (badge.kind === "dot"
        ? ""
        : (badge.text ?? badge.maxText ?? badge.value)))
    : undefined;
  return [entry.label ?? entry.controlLabel ?? "", badgeName]
    .filter((value) => value !== undefined && value !== "")
    .join(" ");
};
const effectIds = (entry: NavigationEntry) => [
  ...new Set(
    [
      entry.effect?.kind === "action" ? entry.effect.effectId : undefined,
      entry.effect?.kind === "open"
        ? entry.effect.open.changeEffectId
        : undefined,
      entry.binding?.changeEffectId,
      entry.search?.binding.changeEffectId,
      entry.disclosure?.binding.changeEffectId,
      entry.rename?.commitEffectId,
    ].filter((id): id is string => id !== undefined),
  ),
];
const tags = (entry: ShellIdentity) =>
  shellTags(entry, entry.subPart, entry.containerId);

/** Whole-part selection mirrors SettingsSections; omitted adapters use the house. */
export function Sidebar(props: SidebarPartProps) {
  const Part = useWholePart("sidebar") ?? HouseSidebar;
  return <Part {...props} />;
}
export function AppShell(props: AppShellPartProps) {
  const Part = useWholePart("app-shell") ?? HouseAppShell;
  return <Part {...props} />;
}

function useRun() {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  if (failure) throw failure.error;
  return (operation: () => unknown | Promise<unknown>) => {
    try {
      Promise.resolve(operation()).catch((error: unknown) =>
        setFailure({ error }),
      );
    } catch (error) {
      setFailure({ error });
    }
  };
}
function useChange(effects: readonly ShellActionEffect[], disabled = false) {
  const run = useRun();
  const inheritedDisabled = useContext(DisabledContext);
  return <T extends string | boolean>(
    binding: ShellBinding<T>,
    value: T,
    phase: "change" | "blur" | "explicit" = "change",
    allowLocalDismissal = false,
  ) => {
    const dismissing =
      allowLocalDismissal && phase === "change" && value === false;
    if (dismissing) binding.set?.(value);
    if (disabled || inheritedDisabled) return;
    const effectId = binding.changeEffectId;
    if (effectId && shellAction(effects, effectId).pending) return;
    if (phase === "change" && !dismissing) binding.set?.(value);
    if ((binding.commit ?? "change") === phase && effectId)
      run(() => runShellAction(effects, effectId, value));
  };
}
function HouseMenuControl({
  entry,
  disabled,
  children,
  ...controlProps
}: ShellMenuControlProps) {
  const navigation = useContext(NavigationContext);
  return (
    <ShellMenuControl
      {...controlProps}
      entry={entry}
      ownerKey={navigation?.menu?.ownerKey}
      disabled={disabled}
    >
      {children}
    </ShellMenuControl>
  );
}
function EffectFeedback({
  effect,
  identity,
}: {
  effect?: ShellActionEffect | undefined;
  identity: ShellIdentity;
}) {
  const host = useShellHost();
  const { t } = useTranslation();
  const run = useRun();
  const inheritedDisabled = useContext(DisabledContext);
  const compact = useContext(CompactContext);
  const bannerEffect = useContext(BannerEffectContext);
  if (effect?.id === bannerEffect || (!effect?.error && !effect?.pending))
    return null;
  return (
    <div
      className={cn("px-2 text-xs", compact && "px-0")}
      aria-live="polite"
      data-shell-effect={effect.id}
      data-shell-effect-for={entryKey(identity)}
    >
      {effect.pending && (
        <span
          role="status"
          className="text-muted-foreground"
          aria-label={effect.actionName}
        >
          <Skeleton className="my-1 h-1 w-full motion-reduce:animate-none" />
        </span>
      )}
      {effect.error && (
        <div
          role="alert"
          className="text-[color:color-mix(in_oklab,hsl(var(--destructive))_60%,hsl(var(--foreground)))]"
        >
          <span className={compact ? "sr-only" : undefined}>
            {effect.error}
          </span>
          {compact && (
            <IconAlertTriangle aria-hidden="true" className="mx-auto size-4" />
          )}
        </div>
      )}
      {effect.error && effect.retry && (
        <HouseMenuControl
          entry={{
            ...identity,
            id: `${identity.id}.retry.${effect.id}`,
            kind: "action",
            label: host.labels?.retry ?? t("common.retry"),
          }}
          disabled={Boolean(effect.pending || inheritedDisabled)}
        >
          <ButtonBase
            {...shellTags(
              {
                id: `${identity.id}.retry.${effect.id}`,
                entityKey: identity.entityKey,
              },
              identity.subPart,
              identity.containerId,
            )}
            type="button"
            variant="ghost"
            size={compact ? "icon-sm" : "xs"}
            aria-label={host.labels?.retry ?? t("common.retry")}
            disabled={effect.pending || inheritedDisabled}
            onClick={() => run(() => effect.retry?.())}
          >
            <span className={compact ? "sr-only" : undefined}>
              {host.labels?.retry ?? t("common.retry")}
            </span>
            {compact && <IconRefresh aria-hidden="true" className="size-4" />}
          </ButtonBase>
        </HouseMenuControl>
      )}
    </div>
  );
}
function ReadContent({
  state,
  identity,
  effects,
  children,
  title,
}: {
  title?: string | undefined;
  state?: ShellReadState | undefined;
  identity: ShellIdentity;
  effects: readonly ShellActionEffect[];
  children: ReactNode;
}) {
  const run = useRun();
  const host = useShellHost();
  const { t } = useTranslation();
  const inheritedDisabled = useContext(DisabledContext);
  const compact = useContext(CompactContext);
  if (state?.status === "loading")
    return (
      <div
        role="status"
        aria-label={state.label}
        aria-busy="true"
        className="grid gap-2 p-2"
      >
        {title && <strong>{title}</strong>}
        <Skeleton className="h-7 w-full motion-reduce:animate-none" />
        <Skeleton className="h-7 w-3/4 motion-reduce:animate-none" />
      </div>
    );
  if (state?.status === "error") {
    const effect = state.reloadEffectId
      ? shellAction(effects, state.reloadEffectId)
      : undefined;
    return (
      <div className={cn("grid gap-2 p-2", compact && "p-0")}>
        <div
          role="alert"
          className="text-sm text-[color:color-mix(in_oklab,hsl(var(--destructive))_60%,hsl(var(--foreground)))]"
        >
          {title && <strong>{title}</strong>}
          <span className={compact ? "sr-only" : undefined}>
            {state.message}
          </span>
          {compact && (
            <IconAlertTriangle aria-hidden="true" className="mx-auto size-4" />
          )}
        </div>
        {effect && (
          <HouseMenuControl
            entry={{
              ...identity,
              id: `${identity.id}.reload`,
              kind: "action",
              label:
                state.retryLabel ?? host.labels?.retry ?? t("common.retry"),
            }}
            disabled={Boolean(effect.pending || inheritedDisabled)}
          >
            <ButtonBase
              {...shellTags(
                { id: `${identity.id}.reload`, entityKey: identity.entityKey },
                identity.subPart,
                identity.containerId,
              )}
              type="button"
              variant="outline"
              size={compact ? "icon-sm" : "sm"}
              aria-label={
                state.retryLabel ?? host.labels?.retry ?? t("common.retry")
              }
              disabled={effect.pending || inheritedDisabled}
              onClick={() => run(() => runShellAction(effects, effect.id))}
            >
              <span className={compact ? "sr-only" : undefined}>
                {state.retryLabel ?? host.labels?.retry ?? t("common.retry")}
              </span>
              {compact && <IconRefresh aria-hidden="true" className="size-4" />}
            </ButtonBase>
          </HouseMenuControl>
        )}
        <EffectFeedback
          effect={effect}
          identity={{ ...identity, id: `${identity.id}.reload` }}
        />
      </div>
    );
  }
  return children;
}
function EntryImage({
  image,
  fallback,
  symbol,
}: {
  symbol?: { key: string; fallback: boolean } | undefined;
  image: { src: string; alt: string };
  fallback: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span
      aria-hidden={image.alt === "" ? true : undefined}
      {...(symbol
        ? {
            "data-shell-symbol": symbol.key,
            "data-shell-symbol-fallback":
              !loaded && symbol.fallback ? symbol.key : undefined,
          }
        : {})}
      className="relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded text-xs font-medium text-muted-foreground"
    >
      <span aria-hidden="true" className={loaded ? "invisible" : undefined}>
        {fallback}
      </span>
      <img
        src={image.src}
        alt={image.alt}
        width={20}
        height={20}
        className="absolute inset-0 size-full object-cover"
        style={{ opacity: loaded ? 1 : 0 }}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
    </span>
  );
}
function EntryIcon({ icon }: { icon?: ShellIconReference | undefined }) {
  const { symbols } = useShellHost();
  if (!icon) return null;
  const Symbol =
    icon.kind === "symbol" && symbols && Object.hasOwn(symbols, icon.key)
      ? symbols[icon.key]
      : undefined;
  const fallback =
    icon.kind === "initial" ? (
      icon.text
    ) : icon.kind === "entity" ? (
      icon.fallbackText
    ) : Symbol ? (
      <Symbol className="size-4" />
    ) : (
      <IconPoint className="size-4" />
    );
  if (icon.image?.src.trim())
    return (
      <EntryImage
        key={icon.image.src}
        image={icon.image}
        fallback={fallback}
        symbol={
          symbols && icon.kind === "symbol"
            ? { key: icon.key, fallback: !Symbol }
            : undefined
        }
      />
    );
  return (
    <span
      aria-hidden="true"
      {...(symbols && icon.kind === "symbol"
        ? {
            "data-shell-symbol": icon.key,
            "data-shell-symbol-fallback": Symbol ? undefined : icon.key,
          }
        : {})}
      className="flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium text-muted-foreground"
    >
      {fallback}
    </span>
  );
}
function EntryLabel({
  entry,
  compact,
}: {
  entry: NavigationEntry;
  compact: boolean;
}) {
  return (
    <>
      <EntryIcon icon={entry.icon} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          (entry.labelHidden || compact) && "sr-only",
        )}
      >
        {entry.label ?? entry.controlLabel ?? entry.accessibleLabel}
      </span>
      {compact && !entry.icon && (
        <IconLayoutSidebar aria-hidden="true" className="size-4" />
      )}
      {!compact && entry.metadata?.secondaryText && (
        <span
          aria-hidden="true"
          className="truncate text-xs text-muted-foreground"
        >
          {entry.metadata.secondaryText}
        </span>
      )}
      {entry.metadata?.current && (
        <IconCheck
          aria-hidden="true"
          data-shell-current
          className="size-4 shrink-0"
        />
      )}
      {entry.metadata?.pinned && (
        <IconPin
          aria-hidden="true"
          data-shell-pinned
          className="size-4 shrink-0"
        />
      )}
      {entry.badge?.visible && (
        <span
          data-shell-badge={entry.badge.kind}
          aria-label={entry.badge.accessibleLabel}
          className={cn(
            "shrink-0 rounded px-1 text-xs text-muted-foreground",
            compact && "sr-only",
          )}
        >
          {entry.badge.kind === "dot" ? (
            <span aria-hidden="true">•</span>
          ) : (
            (entry.badge.text ?? entry.badge.maxText ?? entry.badge.value)
          )}
        </span>
      )}
      {entry.shortcut && (
        <kbd
          aria-hidden="true"
          className={cn("text-xs text-muted-foreground", compact && "sr-only")}
        >
          {entry.shortcut.displayLabel}
        </kbd>
      )}
    </>
  );
}
function RenameScope({
  rename,
  effects,
  children,
}: {
  rename: NonNullable<NavigationEntry["rename"]>;
  effects: readonly ShellActionEffect[];
  children: ReactNode;
}) {
  const controller = useNavigationRename(rename, effects);
  const run = useRun();
  const disabled = useContext(DisabledContext);
  return (
    <RenameContext.Provider value={controller}>
      <div
        onBlur={(event) => {
          if (!disabled)
            run(() =>
              controller.blur(
                Boolean(
                  event.relatedTarget &&
                  event.currentTarget.contains(event.relatedTarget as Node),
                ),
              ),
            );
        }}
      >
        {children}
      </div>
    </RenameContext.Provider>
  );
}
function EntryRename({
  entry,
  effects,
  onKeyboardFinish,
  controlId,
  ref,
  ...inputProps
}: ComponentPropsWithoutRef<typeof Input> & {
  ref?: Ref<HTMLInputElement>;
  controlId: string;
  onKeyboardFinish: () => void;
  entry: NavigationEntry & { rename: NonNullable<NavigationEntry["rename"]> };
  effects: readonly ShellActionEffect[];
}) {
  const rename = useContext(RenameContext);
  if (!rename) throw new Error("Inline rename requires its row controller");
  useEffect(() => {
    const ownEscape = (event: KeyboardEvent) => {
      if (
        event.key === entry.rename.cancelKey &&
        event.target === document.getElementById(controlId)
      )
        event.preventDefault();
    };
    window.addEventListener("keydown", ownEscape, true);
    return () => window.removeEventListener("keydown", ownEscape, true);
  }, [controlId, entry.rename.cancelKey]);
  const run = useRun();
  const effect = shellAction(effects, entry.rename.commitEffectId);
  return (
    <Slot {...inputProps} ref={ref}>
      <Input
        {...tags(entry)}
        id={controlId}
        data-shell-rename
        aria-label={entry.rename.controlLabel}
        value={rename.draft}
        autoFocus={entry.rename.autoFocus}
        disabled={shellConditionState(entry).disabled || effect.pending}
        onChange={(event) => rename.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === entry.rename.cancelKey ||
            event.key === entry.rename.submitKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            onKeyboardFinish();
            run(() => rename.key(event.key));
          }
        }}
      />
    </Slot>
  );
}
function EntryControl({
  feedback,
  entry,
  effects,
  compact,
  destinations,
}: {
  feedback?: ReactNode;
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
  compact: boolean;
  destinations: readonly string[];
}) {
  const host = useShellHost();
  const density = useContext(DensityContext);
  const inline = useContext(InlineControlsContext);
  const iconOnly = inline || entry.iconOnly;
  const controlClass = cn(
    rowClass,
    density === "compact" && compactRowClass,
    iconOnly && iconControlClass,
  );
  const navigation = useContext(NavigationContext);
  const menuOwner = navigation?.menu?.ownerKey;
  const run = useRun();
  const change = useChange(effects, shellConditionState(entry).disabled);
  const uid = useId();
  const inputId = `${uid}-control`;
  const openValue = useRef(
    entry.effect?.kind === "open" ? entry.effect.open.value : false,
  );
  openValue.current =
    entry.effect?.kind === "open" ? entry.effect.open.value : false;
  const panelId = `${uid}-panel`;
  const descriptionId = `${uid}-description`;
  const isSurfaceOpen =
    entry.effect?.kind === "open"
      ? entry.effect.open.value
      : (entry.disclosure?.binding.value ?? false);
  const ownsSurface =
    entry.effect?.kind === "open"
      ? entry.effect.surface?.owner !== "content"
      : !menuOwner && entry.disclosure?.dismissal !== "header-only";
  const ready = !entry.state || entry.state.status === "ready";
  const surfaceFocus = useHouseSurface(isSurfaceOpen && ownsSurface && ready, {
    opener: () => document.getElementById(inputId),
    panel: () => document.getElementById(panelId),
    modal: entry.effect?.kind === "open",
    dismiss: entry.disclosure
      ? () => {
          if (entry.disclosure) {
            const binding = entry.disclosure.binding;
            change(binding, false, "change", true);
            if (binding.commit && binding.commit !== "change")
              change(binding, false, binding.commit);
          }
        }
      : undefined,
  });
  const handoff = useNavigationFocusHandoff();
  const restoreRenameFocus = useRef(false);
  const editing = Boolean(entry.rename?.editing.value);
  useLayoutEffect(() => {
    if (!editing && restoreRenameFocus.current) {
      restoreRenameFocus.current = false;
      handoff.remember(document.getElementById(inputId));
      handoff.restore();
    }
  }, [editing, inputId]);
  const toggle = (binding: ShellBinding<boolean>) => {
    const next = !binding.value;
    change(binding, next);
    if (binding.commit === "explicit") change(binding, next, "explicit");
  };

  const effect =
    entry.effect?.kind === "action"
      ? shellAction(effects, entry.effect.effectId)
      : entry.binding?.changeEffectId
        ? shellAction(effects, entry.binding.changeEffectId)
        : undefined;
  const rowEffects = effectIds(entry).map((id) => shellAction(effects, id));
  const disabled =
    shellConditionState(entry).disabled ||
    rowEffects.some((effect) => effect.pending);
  const active = entry.active
    ? isShellRouteActive(entry.active, host.pathname, destinations)
    : false;
  const label = nameOf(entry);
  const common = {
    "data-shell-action":
      entry.effect?.kind === "action" ? effect?.actionName : undefined,
    "data-shell-write": (
      entry.search?.binding ??
      entry.disclosure?.binding ??
      entry.binding
    )?.changeEffectId
      ? rowEffects.find(
          (effect) =>
            effect.id ===
            (
              entry.search?.binding ??
              entry.disclosure?.binding ??
              entry.binding
            )?.changeEffectId,
        )?.actionName
      : undefined,
    "data-shell-surface-slot":
      entry.effect?.kind === "open" ? entry.effect.body.key : undefined,
    "data-shell-surface-owner":
      entry.effect?.kind === "open"
        ? (entry.effect.surface?.owner ?? "house")
        : undefined,
    "data-shell-surface":
      entry.effect?.kind === "open" ? entry.effect.surfaceId : undefined,
    id: inputId,
    "aria-label": label || undefined,
    "aria-describedby":
      entry.description || entry.disabledReason ? descriptionId : undefined,
    title: entry.tooltip,
    disabled,
  };
  const contentActivation =
    entry.effect?.kind === "open" &&
    entry.effect.surface?.activation === "content";
  const activate = () => {
    if (disabled) return;
    const value = entry.effect;
    if (value?.kind === "action")
      run(() => runShellAction(effects, value.effectId, value.input));
    else if (value?.kind === "navigate") {
      host.navigate?.(value);
      if (value.close && value.close !== "none") host.close?.(value.close);
    } else if (value?.kind === "open" && !contentActivation) {
      const next = !value.open.value;
      if (next && ownsSurface) surfaceFocus.remember();
      openValue.current = next;
      change(value.open, next, "change", true);
      if (value.open.commit === "explicit")
        change(value.open, next, "explicit");
    }
  };
  const children = (
    <EntryLabel
      entry={iconOnly ? { ...entry, labelHidden: true } : entry}
      compact={compact || Boolean(iconOnly)}
    />
  );
  if (menuOwner && (entry.choices || entry.rename?.editing.value))
    throw new Error(`Unsupported shell menu control: ${entry.id}`);
  const menuControl = (control: ReactElement) =>
    menuOwner ? (
      <HouseMenuControl entry={entry} disabled={disabled}>
        {control}
      </HouseMenuControl>
    ) : (
      control
    );
  const nativeEditor =
    entry.search ||
    entry.kind === "filter" ||
    typeof entry.binding?.value === "string";
  const button = (
    nativeEditor ? (control: ReactElement) => control : menuControl
  )(
    <ButtonBase
      {...common}
      {...tags(entry)}
      type="button"
      variant="ghost"
      aria-haspopup={
        entry.effect?.kind === "open"
          ? (entry.effect.surface?.kind ?? "dialog")
          : undefined
      }
      aria-expanded={
        entry.effect?.kind === "open"
          ? entry.effect.open.value
          : entry.kind === "action"
            ? entry.expanded
            : undefined
      }
      aria-controls={
        entry.effect?.kind === "open" && ownsSurface && entry.effect.open.value
          ? panelId
          : undefined
      }
      className={cn(controlClass, active && "bg-accent font-medium")}
      {...(!menuOwner && typeof entry.binding?.value === "boolean"
        ? { role: "checkbox" as const }
        : {})}
      aria-checked={
        entry.binding && typeof entry.binding.value === "boolean"
          ? entry.binding.value
          : undefined
      }
      onBlur={() => {
        if (typeof entry.binding?.value === "boolean")
          change(
            entry.binding as ShellBinding<boolean>,
            entry.binding.value,
            "blur",
          );
        else if (entry.effect?.kind === "open" && !contentActivation)
          change(entry.effect.open, openValue.current, "blur");
      }}
      onClick={
        entry.binding && typeof entry.binding.value === "boolean"
          ? () => toggle(entry.binding as ShellBinding<boolean>)
          : activate
      }
    >
      {children}
      {typeof entry.binding?.value === "boolean" && entry.binding.value && (
        <IconCheck aria-hidden="true" className="size-4 shrink-0" />
      )}
    </ButtonBase>,
  );
  let control: ReactNode;
  let surfaceBody: ReactNode = null;
  let wrapSurface: ((children: ReactNode) => ReactElement) | undefined;
  if (entry.rename?.editing.value)
    control = (
      <EntryRename
        entry={
          entry as NavigationEntry & {
            rename: NonNullable<NavigationEntry["rename"]>;
          }
        }
        effects={effects}
        controlId={inputId}
        onKeyboardFinish={() => {
          restoreRenameFocus.current = true;
        }}
      />
    );
  else if (entry.kind === "heading")
    control = (
      <h3
        aria-label={label}
        {...tags(entry)}
        className={cn(
          "px-2 py-1 text-xs font-medium text-muted-foreground",
          (compact || entry.labelHidden) && "sr-only",
        )}
      >
        {children}
      </h3>
    );
  else if (entry.kind === "controller")
    control = (
      <span role="note" aria-label={label} {...tags(entry)} className="sr-only">
        {children}
      </span>
    );
  else if (
    (entry.kind === "identity" || entry.kind === "status") &&
    (!entry.effect || entry.effect.kind === "none") &&
    !entry.binding &&
    !entry.disclosure
  )
    control = (
      <div
        {...tags(entry)}
        role={entry.kind === "status" ? "status" : "group"}
        aria-current={
          entry.kind === "identity" && entry.metadata?.current
            ? "true"
            : undefined
        }
        aria-label={label}
        className={controlClass}
      >
        {children}
      </div>
    );
  else if (
    entry.search ||
    entry.kind === "filter" ||
    (typeof entry.binding?.value === "string" && !entry.choices)
  ) {
    const binding = entry.search?.binding ?? entry.binding;
    if (!binding || typeof binding.value !== "string")
      throw new Error(`Missing text binding: ${entry.id}`);
    const inputProps = {
      ...common,
      ...tags(entry),
      type: entry.search || entry.kind === "filter" ? "search" : "text",
      placeholder: entry.search?.placeholder,
      value: binding.value,
      onBlur: () =>
        change(binding as ShellBinding<string>, String(binding.value), "blur"),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter")
          change(
            binding as ShellBinding<string>,
            String(binding.value),
            "explicit",
          );
      },
    };
    control = menuOwner ? (
      <ShellMenuEditor
        {...inputProps}
        entry={entry}
        ownerKey={menuOwner}
        onValueChange={(value) =>
          change(binding as ShellBinding<string>, value)
        }
      />
    ) : (
      <Input
        {...inputProps}
        {...(density === "compact"
          ? { className: "h-7 min-h-7 py-0 text-[13px]" }
          : {})}
        onChange={(event) =>
          change(binding as ShellBinding<string>, event.target.value)
        }
      />
    );
    if (entry.search?.leadingIcon) {
      control = (
        <div className="relative min-w-0">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-2 flex items-center"
          >
            <EntryIcon icon={entry.search.leadingIcon} />
          </span>
          <span className="contents [&_input]:ps-9">{control}</span>
        </div>
      );
    }
  } else if (entry.choices) {
    if (!entry.binding || typeof entry.binding.value !== "string")
      throw new Error(`Missing choice binding: ${entry.id}`);
    control = (
      <select
        {...common}
        {...tags(entry)}
        className={cn(controlClass, "border border-input bg-background")}
        value={entry.binding.value}
        onChange={(event) =>
          change(entry.binding as ShellBinding<string>, event.target.value)
        }
        onBlur={() =>
          change(
            entry.binding as ShellBinding<string>,
            String(entry.binding?.value),
            "blur",
          )
        }
        onKeyDown={(event) => {
          if (event.key === "Enter")
            change(
              entry.binding as ShellBinding<string>,
              String(entry.binding?.value),
              "explicit",
            );
        }}
      >
        {entry.choices.map((choice) => (
          <option
            key={choice.value}
            value={choice.value}
            disabled={choice.disabled}
          >
            {choice.label}
          </option>
        ))}
      </select>
    );
  } else if (entry.disclosure) {
    control = (
      <ButtonBase
        {...common}
        {...tags(entry)}
        type="button"
        variant="ghost"
        className={controlClass}
        aria-expanded={entry.disclosure.binding.value}
        aria-controls={
          entry.disclosure.binding.value || !entry.disclosure.unmountWhenClosed
            ? panelId
            : undefined
        }
        onClick={() =>
          toggle(entry.disclosure?.binding as ShellBinding<boolean>)
        }
        onBlur={() => {
          if (entry.disclosure)
            change(
              entry.disclosure.binding,
              entry.disclosure.binding.value,
              "blur",
            );
        }}
      >
        {children}
        {!compact &&
          (entry.disclosure.binding.value ? (
            <IconChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <IconChevronRight aria-hidden="true" className="size-4" />
          ))}
      </ButtonBase>
    );
  } else if (
    entry.effect?.kind === "open" &&
    entry.effect.surface?.owner === "content"
  ) {
    const content =
      entry.effect.surface.mount !== "host" ? (
        <ShellContent content={entry.effect.body} />
      ) : null;
    if (entry.composition) {
      control = button;
      surfaceBody = content;
    } else
      control = (
        <>
          {button}
          {content}
        </>
      );
  } else if (entry.effect?.kind === "open") {
    const open = entry.effect;
    const dialog = (children: ReactNode) => (
      <Dialog
        open={open.open.value && ready}
        onOpenChange={(value) => {
          openValue.current = value;
          change(open.open, value, "change", true);
          if (open.open.commit === "explicit")
            change(open.open, value, "explicit");
        }}
      >
        {children}
      </Dialog>
    );
    const content = (
      <DialogContent
        data-shell-focus-landmark
        id={panelId}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          change(open.open, false, "blur");
          surfaceFocus.restore();
        }}
        className="motion-reduce:animate-none"
      >
        <DialogTitle>{label}</DialogTitle>
        <ShellContent content={open.body} />
      </DialogContent>
    );
    if (entry.composition) {
      control = button;
      surfaceBody = content;
      wrapSurface = dialog;
    } else
      control = dialog(
        <>
          {button}
          {content}
        </>,
      );
  } else if (
    entry.effect?.kind === "navigate" ||
    entry.effect?.kind === "external"
  ) {
    const target = entry.effect;
    control = (
      <a
        {...tags(entry)}
        id={inputId}
        data-shell-external={target.kind === "external" ? true : undefined}
        href={target.kind === "navigate" ? target.to : target.href}
        target={target.kind === "external" ? target.target : undefined}
        rel={
          target.kind === "external"
            ? (target.rel ??
              (target.target === "_blank" ? "noopener noreferrer" : undefined))
            : undefined
        }
        aria-label={label || undefined}
        aria-describedby={common["aria-describedby"]}
        aria-disabled={disabled || undefined}
        aria-current={active ? "page" : undefined}
        {...(disabled ? { tabIndex: -1 } : {})}
        title={entry.tooltip}
        className={cn(
          controlClass,
          active && "bg-accent font-medium",
          disabled && "opacity-50",
        )}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (
            target.kind === "navigate" &&
            host.navigate &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey &&
            event.button === 0
          ) {
            event.preventDefault();
            activate();
          }
        }}
      >
        {children}
      </a>
    );
  } else control = button;
  const childrenVisible = !entry.disclosure || entry.disclosure.binding.value;
  const filtered = ordered(entry.children ?? []).filter(
    (child) =>
      entry.search?.match !== "label-substring" ||
      (child.label ?? "")
        .toLocaleLowerCase()
        .includes(entry.search.binding.value.toLocaleLowerCase()),
  );
  const header =
    menuOwner &&
    (entry.effect?.kind === "navigate" ||
      entry.effect?.kind === "external" ||
      entry.disclosure)
      ? menuControl(control as ReactElement)
      : control;
  const body = (
    <>
      {!inline &&
        (entry.rename?.editing.value ||
          entry.search ||
          entry.kind === "filter" ||
          entry.choices ||
          typeof entry.binding?.value === "string") && (
          <div className="flex items-center gap-2 px-2">
            <EntryLabel
              entry={{ ...entry, labelHidden: true, icon: undefined }}
              compact={false}
            />
          </div>
        )}
      {(entry.description || entry.disabledReason) && (
        <span id={descriptionId} className="sr-only">
          {entry.disabledReason ?? entry.description}
        </span>
      )}
      {!inline && (!entry.disclosure?.unmountWhenClosed || childrenVisible) && (
        <div
          id={entry.disclosure ? panelId : undefined}
          hidden={!childrenVisible}
          className={
            entry.children?.length
              ? "ms-3 border-s border-border ps-1"
              : undefined
          }
        >
          {filtered.map((child) => (
            <HouseEntry
              key={entryKey(child)}
              entry={child}
              effects={effects}
              compact={compact}
              destinations={destinations}
            />
          ))}
          {!filtered.length && entry.search?.emptyLabel && (
            <p className="px-2 text-xs text-muted-foreground">
              {entry.search.emptyLabel}
            </p>
          )}
        </div>
      )}
      {entry.trailingActions?.length ? (
        <div className="flex flex-wrap gap-1">
          {ordered(entry.trailingActions).map((child) => (
            <HouseEntry
              key={entryKey(child)}
              entry={child}
              effects={effects}
              compact={compact}
              destinations={destinations}
            />
          ))}
        </div>
      ) : null}
    </>
  );
  if (!entry.composition)
    return (
      <>
        {header}
        {body}
      </>
    );
  const composed = (
    <ShellGeneratedOwner
      ownerKey={entry.composition.ownerKey}
      identity={entry}
      header={
        ready ? (
          header
        ) : (
          <div
            {...tags(entry)}
            role="group"
            aria-label={nameOf(entry)}
            aria-disabled={shellConditionState(entry).disabled || undefined}
          >
            <ReadContent state={entry.state} identity={entry} effects={effects}>
              {null}
            </ReadContent>
          </div>
        )
      }
    >
      {ready && surfaceBody}
      {ready && body}
      {feedback}
    </ShellGeneratedOwner>
  );
  return wrapSurface ? wrapSurface(composed) : composed;
}
function HouseEntry(input: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
  compact: boolean;
  destinations: readonly string[];
}) {
  const inheritedDisabled = useContext(DisabledContext);
  const navigation = useContext(NavigationContext);
  const inline = useContext(InlineControlsContext);
  const props = inheritedDisabled
    ? { ...input, entry: { ...input.entry, disabled: true } }
    : input;
  if (!shellConditionState(props.entry).visible) return null;
  if (props.entry.iconOnly && !supportsIconControl(props.entry))
    throw new Error(`Unsupported icon control: ${props.entry.id}`);
  const refs = [
    ...new Set([
      ...effectIds(props.entry),
      ...(props.entry.subPart === "sidebar.resize-handle" && navigation?.resize
        ? [navigation.resize.finishEffectId]
        : []),
    ]),
  ].filter(
    (id) =>
      props.entry.state?.status !== "error" ||
      props.entry.state.reloadEffectId !== id,
  );
  const feedback = refs.map((id) => (
    <EffectFeedback
      key={id}
      effect={shellAction(props.effects, id)}
      identity={props.entry}
    />
  ));
  if (
    props.entry.composition &&
    props.entry.subPart === "sidebar.resize-handle"
  )
    throw new Error(`Unsupported generated resize owner: ${props.entry.id}`);
  const body = props.entry.composition ? (
    <EntryControl {...props} feedback={feedback} />
  ) : inline ? (
    <>
      <ReadContent
        state={props.entry.state}
        identity={props.entry}
        effects={props.effects}
      >
        <EntryControl {...props} />
      </ReadContent>
      {feedback}
    </>
  ) : (
    <div data-shell-entry className="min-w-0">
      <div
        {...tags(props.entry)}
        aria-disabled={shellConditionState(props.entry).disabled || undefined}
        {...(props.entry.state && props.entry.state.status !== "ready"
          ? { "aria-label": nameOf(props.entry), role: "group" }
          : {})}
      >
        <ReadContent
          state={props.entry.state}
          identity={props.entry}
          effects={props.effects}
        >
          {props.entry.subPart === "sidebar.resize-handle" &&
          navigation?.resize ? (
            <ResizeHandle
              entry={props.entry}
              model={
                navigation as NavigationModel & {
                  resize: NonNullable<NavigationModel["resize"]>;
                }
              }
              effects={props.effects}
            />
          ) : (
            <EntryControl {...props} />
          )}
        </ReadContent>
      </div>
      {refs.map((id) => (
        <EffectFeedback
          key={id}
          effect={shellAction(props.effects, id)}
          identity={props.entry}
        />
      ))}
    </div>
  );
  return (
    <DisabledContext.Provider value={shellConditionState(props.entry).disabled}>
      {props.entry.rename ? (
        <RenameScope rename={props.entry.rename} effects={props.effects}>
          {body}
        </RenameScope>
      ) : (
        body
      )}
    </DisabledContext.Provider>
  );
}
function ReorderSection({
  section,
  effects,
  compact,
  destinations,
}: {
  section: NavigationSection & {
    reorder: NonNullable<NavigationSection["reorder"]>;
  };
  effects: readonly ShellActionEffect[];
  compact: boolean;
  destinations: readonly string[];
}) {
  const host = useShellHost();
  const { t } = useTranslation();
  const inheritedDisabled = useContext(DisabledContext);
  const run = useRun();
  const entries = ordered(section.entries);
  const visible = entries
    .filter((entry) => shellConditionState(entry).visible)
    .slice(0, section.limit);
  const reorder = useNavigationReorder(
    {
      ...section.reorder.policy,
      keyboard: section.reorder.policy.keyboard || {
        start: "Space",
        move: "arrows",
        end: "Space",
        cancel: "Escape",
      },
    },
    {
      complete: entries.map((entry) => entry.entityKey ?? entry.id),
      visible: visible.map((entry) => entry.entityKey ?? entry.id),
    },
    section.reorder.preview,
    effects,
    section.reorder.commitEffectId,
  );
  const effect = shellAction(effects, section.reorder.commitEffectId);
  const locked =
    inheritedDisabled ||
    Boolean(section.reorder.policy.disableWhileEffectPending && effect.pending);
  useLayoutEffect(() => {
    if (locked) reorder.cancel();
  }, [locked]);
  return (
    <>
      <div
        onPointerMove={(event) => {
          if (locked || !reorder.activeKey) return;
          const rows = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "[data-reorder-key]",
            ),
          ];
          const target = rows
            .sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              return (
                Math.hypot(
                  event.clientX - (ar.x + ar.width / 2),
                  event.clientY - (ar.y + ar.height / 2),
                ) -
                Math.hypot(
                  event.clientX - (br.x + br.width / 2),
                  event.clientY - (br.y + br.height / 2),
                )
              );
            })
            .at(0);
          if (target?.dataset.reorderKey)
            reorder.over(
              target.dataset.reorderKey,
              event.clientX,
              event.clientY,
            );
        }}
        onPointerUp={(event) => {
          if (!locked && reorder.activeKey) {
            const rect = event.currentTarget.getBoundingClientRect();
            run(() =>
              reorder.finish(
                event.clientX >= rect.left &&
                  event.clientX <= rect.right &&
                  event.clientY >= rect.top &&
                  event.clientY <= rect.bottom,
              ),
            );
          }
        }}
        onPointerCancel={() => reorder.cancel()}
      >
        {visible.map((entry) => {
          const key = entry.entityKey ?? entry.id;
          return (
            <ShellGeneratedOwner
              key={entryKey(entry)}
              ownerKey={entry.composition?.ownerKey}
              identity={entry}
              header={
                <div
                  data-reorder-key={key}
                  className={cn(
                    "flex items-start gap-0.5",
                    compact && "flex-col items-center",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <HouseEntry
                      entry={
                        entry.composition
                          ? { ...entry, composition: undefined }
                          : entry
                      }
                      effects={effects}
                      compact={compact}
                      destinations={destinations}
                    />
                  </div>
                  <ButtonBase
                    {...shellTags(
                      { id: `${section.id}.reorder`, entityKey: key },
                      section.subPart,
                      section.containerId,
                    )}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      host.labels?.reorder?.(nameOf(entry)) ??
                      `${t("queue.dragToReorder")}: ${nameOf(entry)}`
                    }
                    aria-pressed={reorder.activeKey === key}
                    disabled={locked}
                    onPointerDown={(event) => {
                      if (
                        !locked &&
                        event.button === 0 &&
                        reorder.begin(key, event.clientX, event.clientY)
                      )
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onLostPointerCapture={() => {
                      if (reorder.activeKey) reorder.cancel();
                    }}
                    onKeyDown={(event) => {
                      if (locked) return;
                      if (
                        [
                          " ",
                          "Escape",
                          "ArrowUp",
                          "ArrowDown",
                          "ArrowLeft",
                          "ArrowRight",
                        ].includes(event.key)
                      ) {
                        event.preventDefault();
                        run(() => reorder.key(event.key, key));
                      }
                    }}
                  >
                    <IconGripVertical aria-hidden="true" className="size-4" />
                  </ButtonBase>
                </div>
              }
            >
              {null}
            </ShellGeneratedOwner>
          );
        })}
      </div>
    </>
  );
}
function HouseSection({
  section,
  effects,
  compact,
  destinations,
}: {
  section: NavigationSection;
  effects: readonly ShellActionEffect[];
  compact: boolean;
  destinations: readonly string[];
}) {
  const inheritedDensity = useContext(DensityContext);
  const density = section.presentation?.density ?? inheritedDensity;
  const sectionRowClass = cn(
    rowClass,
    density === "compact" && compactRowClass,
  );
  const inline = section.presentation?.layout === "inline-icons";
  const change = useChange(effects, shellConditionState(section).disabled);
  const uid = useId();
  const inheritedDisabled = useContext(DisabledContext);
  const expanded = section.disclosure?.binding.value ?? true;
  const menu = useContext(NavigationContext)?.menu;
  useHouseSurface(
    Boolean(
      !menu &&
      section.disclosure &&
      expanded &&
      section.disclosure.dismissal !== "header-only",
    ),
    {
      opener: () => document.getElementById(`${uid}-trigger`),
      panel: () => document.getElementById(`${uid}-section`),
      dismiss: section.disclosure
        ? () => {
            if (section.disclosure) {
              const binding = section.disclosure.binding;
              change(binding, false, "change", true);
              if (binding.commit && binding.commit !== "change")
                change(binding, false, binding.commit);
            }
          }
        : undefined,
    },
  );
  const visibleEntries = ordered(section.entries)
    .filter((entry) => shellConditionState(entry).visible)
    .slice(0, section.limit);
  if (
    !shellConditionState(section).visible ||
    (section.hideIfEmpty &&
      visibleEntries.length === 0 &&
      (!section.state || section.state.status === "ready"))
  )
    return null;
  const sectionEffects = [
    ...new Set(
      [
        section.disclosure?.binding.changeEffectId,
        section.reorder?.commitEffectId,
      ].filter((id): id is string => id !== undefined),
    ),
  ].map((id) => shellAction(effects, id));
  const disabled =
    inheritedDisabled ||
    shellConditionState(section).disabled ||
    Boolean(
      section.disclosure?.binding.changeEffectId &&
      shellAction(effects, section.disclosure.binding.changeEffectId).pending,
    );
  if (inline) {
    if (
      section.disclosure ||
      section.reorder ||
      visibleEntries.some((entry) => !supportsIconControl(entry))
    )
      throw new Error(`Unsupported inline icon section: ${section.id}`);
    return (
      <DensityContext.Provider value={density}>
        <InlineControlsContext.Provider value={true}>
          <DisabledContext.Provider value={disabled}>
            <section
              {...tags(section)}
              aria-label={section.label}
              className="flex min-w-0 items-center gap-1 py-1"
            >
              <ShellGeneratedOwner
                ownerKey={section.composition?.ownerKey}
                identity={section}
                header={
                  section.label ? (
                    <h2 className="sr-only">{section.label}</h2>
                  ) : null
                }
              >
                <ReadContent
                  state={section.state}
                  identity={section}
                  effects={effects}
                >
                  {visibleEntries.map((entry) => (
                    <HouseEntry
                      key={entryKey(entry)}
                      entry={entry}
                      effects={effects}
                      compact={compact}
                      destinations={destinations}
                    />
                  ))}
                  {!visibleEntries.length && section.emptyLabel && (
                    <p className="px-2 text-xs text-muted-foreground">
                      {section.emptyLabel}
                    </p>
                  )}
                </ReadContent>
              </ShellGeneratedOwner>
            </section>
          </DisabledContext.Provider>
        </InlineControlsContext.Provider>
      </DensityContext.Provider>
    );
  }
  return (
    <DensityContext.Provider value={density}>
      <DisabledContext.Provider value={disabled}>
        <section
          {...tags(section)}
          aria-label={section.label}
          className={
            density === "compact" ? "grid gap-0 py-1" : "grid gap-1 py-2"
          }
        >
          <ShellGeneratedOwner
            ownerKey={section.composition?.ownerKey}
            identity={section}
            header={
              section.label &&
              (section.disclosure ? (
                <HouseMenuControl
                  entry={{
                    ...section,
                    kind: "disclosure",
                    label: section.label,
                  }}
                  disabled={disabled}
                >
                  <ButtonBase
                    type="button"
                    variant="ghost"
                    className={sectionRowClass}
                    aria-label={section.label}
                    aria-expanded={expanded}
                    id={`${uid}-trigger`}
                    aria-controls={
                      expanded || !section.disclosure.unmountWhenClosed
                        ? `${uid}-section`
                        : undefined
                    }
                    disabled={disabled}
                    onClick={() => {
                      const binding = section.disclosure?.binding;
                      if (!binding) return;
                      change(binding, !expanded);
                      if (binding.commit === "explicit")
                        change(binding, !expanded, "explicit");
                    }}
                    onBlur={() => {
                      const binding = section.disclosure?.binding;
                      if (binding) change(binding, binding.value, "blur");
                    }}
                  >
                    <span
                      className={cn(
                        "flex-1 text-xs font-medium text-muted-foreground",
                        compact && "sr-only",
                      )}
                    >
                      {section.label}
                    </span>
                    {expanded ? (
                      <IconChevronDown aria-hidden="true" className="size-4" />
                    ) : (
                      <IconChevronRight aria-hidden="true" className="size-4" />
                    )}
                  </ButtonBase>
                </HouseMenuControl>
              ) : (
                <h2
                  className={cn(
                    "px-2 text-xs font-medium text-muted-foreground",
                    compact && "sr-only",
                  )}
                >
                  {section.label}
                </h2>
              ))
            }
          >
            {sectionEffects.map((effect) => (
              <EffectFeedback
                key={effect.id}
                effect={effect}
                identity={section}
              />
            ))}
            {(!section.disclosure?.unmountWhenClosed || expanded) && (
              <div id={`${uid}-section`} hidden={!expanded}>
                <DisabledContext.Provider value={disabled}>
                  <fieldset
                    disabled={disabled}
                    className={
                      density === "compact"
                        ? "m-0 min-w-0 border-0 p-0"
                        : "min-w-0 border-0 p-0"
                    }
                  >
                    <ReadContent
                      state={section.state}
                      identity={section}
                      effects={effects}
                    >
                      {section.reorder ? (
                        <ReorderSection
                          section={
                            section as NavigationSection & {
                              reorder: NonNullable<
                                NavigationSection["reorder"]
                              >;
                            }
                          }
                          effects={effects}
                          compact={compact}
                          destinations={destinations}
                        />
                      ) : (
                        visibleEntries.map((entry) => (
                          <HouseEntry
                            key={entryKey(entry)}
                            entry={entry}
                            effects={effects}
                            compact={compact}
                            destinations={destinations}
                          />
                        ))
                      )}
                      {!visibleEntries.length && section.emptyLabel && (
                        <p className="px-2 text-xs text-muted-foreground">
                          {section.emptyLabel}
                        </p>
                      )}
                    </ReadContent>
                  </fieldset>
                </DisabledContext.Provider>
              </div>
            )}
          </ShellGeneratedOwner>
        </section>
      </DisabledContext.Provider>
    </DensityContext.Provider>
  );
}
function ResizeHandle({
  entry,
  model,
  effects,
}: {
  entry: NavigationEntry;
  model: NavigationModel & { resize: NonNullable<NavigationModel["resize"]> };
  effects: readonly ShellActionEffect[];
}) {
  const resize = model.resize;
  const inheritedDisabled = useContext(DisabledContext);
  const effect = shellAction(effects, resize.finishEffectId);
  const disabled =
    inheritedDisabled || shellConditionState(entry).disabled || effect.pending;
  const keyboard =
    resize.interaction === "policy" ? resize.policy.keyboard : true;
  const controller = useSidebarResize(
    { ...resize.policy, keyboard },
    {
      ...resize.width,
      set: (width) => {
        resize.width.set?.(width);
        resize.preview(width);
      },
    },
    effects,
    resize.finishEffectId,
  );
  const run = useRun();
  useLayoutEffect(() => {
    if (disabled) controller.abort();
  }, [disabled]);
  return (
    <>
      <div
        {...tags(entry)}
        role="separator"
        aria-label={nameOf(entry)}
        aria-orientation="vertical"
        aria-valuemin={resize.policy.min}
        aria-valuemax={resize.policy.max}
        aria-valuenow={resize.width.value}
        aria-disabled={disabled || undefined}
        tabIndex={disabled || !keyboard ? -1 : 0}
        className="absolute inset-y-0 end-0 w-1.5 cursor-col-resize rounded focus-visible:bg-ring focus-visible:outline-none"
        onPointerDown={(event) => {
          if (
            !disabled &&
            event.button === 0 &&
            controller.begin(event.clientX)
          )
            event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!disabled) run(() => controller.move(event.clientX));
        }}
        onPointerUp={() => {
          if (!disabled) run(controller.end);
        }}
        onPointerCancel={() => {
          if (!disabled) run(controller.cancel);
        }}
        onLostPointerCapture={() => {
          if (!disabled) run(controller.lostCapture);
        }}
        onDoubleClick={() => {
          if (!disabled) run(controller.reset);
        }}
        onKeyDown={(event) => {
          if (
            !disabled &&
            keyboard &&
            [
              "Home",
              "End",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
            ].includes(event.key)
          ) {
            event.preventDefault();
            run(() => controller.key(event.key, event.shiftKey));
          }
        }}
      />
    </>
  );
}
function allEntries(model: NavigationModel): NavigationEntry[] {
  const visit = (entries: readonly NavigationEntry[]): NavigationEntry[] =>
    entries.flatMap((entry) => [
      entry,
      ...visit(entry.children ?? []),
      ...visit(entry.trailingActions ?? []),
    ]);
  return visit([
    ...model.entries,
    ...model.sections.flatMap((section) => section.entries),
  ]);
}
export function HouseSidebar({ model, effects }: SidebarPartProps) {
  const host = useShellHost();
  const navRef = useRef<HTMLElement>(null);
  useHouseSurface(!model.menu && model.presentation.peekOpen, {
    opener: () =>
      (document.activeElement instanceof HTMLElement &&
      navRef.current?.contains(document.activeElement)
        ? document.activeElement
        : null) ??
      navRef.current?.querySelector<HTMLElement>(
        "[data-rid] button,[data-rid] a[href]",
      ) ??
      navRef.current,
    panel: () => navRef.current,
    dismiss: () => host.close?.("peek"),
  });
  const { t } = useTranslation();
  const compact =
    model.presentation.collapsed.value &&
    !model.presentation.peekOpen &&
    !model.presentation.mobileOpen.value;
  const entries = allEntries(model);
  const destinations = entries.flatMap((entry) =>
    entry.active?.kind === "longest-match" ? [entry.active.destination] : [],
  );
  const groups = ordered([
    ...model.entries,
    ...model.sections,
    ...(model.contentSlots ?? []),
  ]).filter((item) => shellConditionState(item).visible);
  if (
    model.menu &&
    (model.resize ||
      model.presentation.peekOpen ||
      model.presentation.mobileOpen.value ||
      model.presentation.collapsed.value)
  )
    throw new Error("Retained menu content cannot own sidebar presentation");
  const Frame = model.menu ? "div" : "nav";
  return (
    <DensityContext.Provider value={model.presentation.density ?? "default"}>
      <NavigationContext.Provider value={model}>
        <CompactContext.Provider value={compact}>
          <Frame
            ref={(element) => {
              navRef.current = element;
            }}
            data-shell-menu-owner={model.menu?.ownerKey}
            data-shell-focus-landmark={model.menu ? undefined : true}
            aria-label={
              model.menu
                ? undefined
                : (host.labels?.navigation ?? t("dispatch.nav.navigation"))
            }
            data-part="sidebar"
            data-look="house"
            data-collapsed={compact}
            hidden={model.presentation.visibility === "hidden"}
            inert={model.presentation.visibility === "inert" ? true : undefined}
            style={
              model.menu
                ? undefined
                : {
                    width: compact
                      ? 56
                      : (model.resize?.width.value ?? model.presentation.width),
                  }
            }
            className={
              model.menu
                ? "contents"
                : "relative flex h-full max-w-full shrink-0 flex-col border-e border-border bg-muted/30 p-2 text-foreground"
            }
          >
            <div
              className={
                model.menu
                  ? "contents"
                  : "min-h-0 flex-1 overflow-y-auto overscroll-contain"
              }
            >
              {groups.map((group) =>
                "content" in group ? (
                  <div
                    key={entryKey(group)}
                    data-shell-content-id={group.id}
                    data-shell-content-key={group.entityKey}
                    data-shell-content-order={group.order}
                  >
                    <ShellContent content={group.content} />
                  </div>
                ) : "entries" in group ? (
                  <HouseSection
                    key={entryKey(group)}
                    section={group}
                    effects={effects}
                    compact={compact}
                    destinations={destinations}
                  />
                ) : (
                  <HouseEntry
                    key={entryKey(group)}
                    entry={group}
                    effects={effects}
                    compact={compact}
                    destinations={destinations}
                  />
                ),
              )}
            </div>
          </Frame>
        </CompactContext.Provider>
      </NavigationContext.Provider>
    </DensityContext.Provider>
  );
}
function HouseRegion({
  region,
  model,
  children,
}: {
  region: ShellRegion;
  model: AppShellPartProps["model"];
  children?: ReactNode;
}) {
  if (!shellConditionState(region).visible) return null;
  const element = region.composition
    ? "div"
    : region.subPart === "app-shell.main"
      ? "main"
      : region.subPart === "app-shell.aside"
        ? "aside"
        : region.subPart === "app-shell.topbar"
          ? "header"
          : "section";
  const Tag = element;
  const destinations = allEntries({
    ...model.navigation,
    entries: region.actions ?? [],
    sections: [],
  }).flatMap((entry) =>
    entry.active?.kind === "longest-match" ? [entry.active.destination] : [],
  );
  return (
    <Tag
      data-shell-focus-landmark
      {...tags(region)}
      aria-label={
        region.readPresentation === "standalone" || region.effectError
          ? undefined
          : region.title
      }
      role={region.effectError ? "alert" : undefined}
      aria-disabled={shellConditionState(region).disabled || undefined}
      className={
        region.composition
          ? "contents"
          : cn(
              "min-h-0 min-w-0",
              region.subPart === "app-shell.main" && "flex-1 overflow-auto p-5",
              region.subPart === "app-shell.topbar" &&
                "flex min-h-12 items-center gap-2 border-b border-border px-4",
              region.subPart === "app-shell.aside" &&
                "w-72 overflow-auto border-s border-border p-4",
              region.subPart === "app-shell.banner" &&
                "border-b border-border bg-muted px-4 py-2",
              region.subPart === "app-shell.split" &&
                "flex flex-1 gap-4 overflow-auto p-4",
            )
      }
    >
      <DisabledContext.Provider value={shellConditionState(region).disabled}>
        <BannerEffectContext.Provider value={region.effectError?.effectId}>
          <ReadContent
            state={region.state}
            title={
              region.readPresentation === "standalone"
                ? region.title
                : undefined
            }
            identity={region}
            effects={model.effects}
          >
            {region.effectError && (
              <div data-shell-effect={region.effectError.effectId}>
                {region.title && <span>{region.title} </span>}
                {shellAction(model.effects, region.effectError.effectId).error}
              </div>
            )}
            <ShellGeneratedOwner
              ownerKey={region.composition?.ownerKey}
              identity={region}
              header={
                <>
                  {!region.effectError &&
                    region.title &&
                    region.subPart !== "app-shell.nav" && (
                      <h2 className="text-sm font-medium">{region.title}</h2>
                    )}
                  <fieldset
                    disabled={shellConditionState(region).disabled}
                    className="contents"
                  >
                    {ordered(region.actions ?? []).map((entry) => (
                      <HouseEntry
                        key={entryKey(entry)}
                        entry={entry}
                        effects={model.effects}
                        compact={false}
                        destinations={destinations}
                      />
                    ))}
                  </fieldset>
                </>
              }
            >
              {children ?? <ShellContent content={region.content} />}
            </ShellGeneratedOwner>
          </ReadContent>
        </BannerEffectContext.Provider>
      </DisabledContext.Provider>
    </Tag>
  );
}
export function HouseAppShell({ model }: AppShellPartProps) {
  const host = useShellHost();
  const uid = useId();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const regions = ordered(model.regions);
  const nav = regions.filter((region) => region.subPart === "app-shell.nav");
  const content = regions.filter(
    (region) => region.subPart !== "app-shell.nav",
  );
  const node = (region: ShellRegion) => (
    <HouseRegion key={entryKey(region)} region={region} model={model} />
  );
  const navigation = nav.map((region) => (
    <HouseRegion key={entryKey(region)} region={region} model={model}>
      <Sidebar model={model.navigation} effects={model.effects} />
    </HouseRegion>
  ));
  const expanded =
    model.mobileNavigation?.open ?? model.navigation.presentation.mobileOpen;
  const mobileEffect = expanded.changeEffectId
    ? shellAction(model.effects, expanded.changeEffectId)
    : undefined;
  const mobileIdentity = nav[0]
    ? { ...nav[0], id: `${nav[0].id}.mobile` }
    : undefined;
  const shellRef = useRef<HTMLDivElement>(null);
  const mobileFocus = useHouseSurface(mobile && expanded.value, {
    opener: () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : shellRef.current,
    panel: () => document.getElementById(`${uid}-drawer`),
    modal: true,
  });
  const change = useChange(model.effects);
  const mobileValue = useRef(expanded.value);
  mobileValue.current = expanded.value;
  const changeMobile = (value: boolean) => {
    mobileValue.current = value;
    change(expanded, value, "change", true);
    if (expanded.commit === "explicit") change(expanded, value, "explicit");
  };
  const blurMobile = () => change(expanded, mobileValue.current, "blur");
  const mobileFeedback =
    mobileEffect &&
    mobileIdentity &&
    (mobileEffect.pending || mobileEffect.error) ? (
      <div
        {...tags(mobileIdentity)}
        data-shell-entry
        aria-label={mobileEffect.actionName}
      >
        <EffectFeedback effect={mobileEffect} identity={mobileIdentity} />
      </div>
    ) : null;
  const { t } = useTranslation();
  return (
    <ShellHostProvider
      value={{
        ...host,
        close: (surface) => {
          if (surface === "mobile") changeMobile(false);
          host.close?.(surface);
        },
      }}
    >
      <HouseSurfaceRoot.Provider value={shellRef}>
        <div
          ref={shellRef}
          data-shell-focus-landmark
          tabIndex={-1}
          data-part="app-shell"
          data-look="house"
          data-frame={model.frame.key}
          {...shellFrameAttributes(model.frame)}
          className="flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground"
        >
          {mobile && !expanded.value && mobileFeedback}
          {model.mobileNavigation && (
            <div
              hidden={mobile}
              style={{ display: mobile ? "none" : "contents" }}
            >
              {navigation}
            </div>
          )}
          {mobile ? (
            <Sheet open={expanded.value} onOpenChange={changeMobile}>
              <SheetContent
                data-shell-focus-landmark
                side="left"
                id={`${uid}-drawer`}
                aria-labelledby={`${uid}-navigation`}
                onOpenAutoFocus={() => {
                  mobileFocus.remember();
                  blurMobile();
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  blurMobile();
                  mobileFocus.restore();
                }}
                aria-describedby={undefined}
                className="w-fit max-w-[90vw] gap-0 p-0 motion-reduce:animate-none"
              >
                <SheetTitle id={`${uid}-navigation`} className="sr-only">
                  {host.labels?.navigation ?? t("dispatch.nav.navigation")}
                </SheetTitle>
                {mobileFeedback}
                {model.mobileNavigation
                  ? expanded.value && (
                      <ShellNavigationScope
                        ownerKey={model.mobileNavigation.ownerKey}
                      >
                        {(scope) =>
                          nav.map((region) => (
                            <HouseRegion
                              key={entryKey(region)}
                              region={region}
                              model={{
                                ...model,
                                navigation: scope.model,
                                effects: scope.effects,
                              }}
                            >
                              <Sidebar {...scope} />
                            </HouseRegion>
                          ))
                        }
                      </ShellNavigationScope>
                    )
                  : navigation}
              </SheetContent>
            </Sheet>
          ) : model.mobileNavigation ? null : (
            navigation
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {content
              .filter((region) =>
                ["app-shell.topbar", "app-shell.banner"].includes(
                  region.subPart,
                ),
              )
              .map(node)}
            <div className="flex min-h-0 min-w-0 flex-1">
              {content
                .filter(
                  (region) =>
                    ![
                      "app-shell.topbar",
                      "app-shell.banner",
                      "app-shell.overlays",
                    ].includes(region.subPart),
                )
                .map(node)}
            </div>
            {content
              .filter((region) => region.subPart === "app-shell.overlays")
              .map(node)}
          </div>
        </div>
      </HouseSurfaceRoot.Provider>
    </ShellHostProvider>
  );
}
