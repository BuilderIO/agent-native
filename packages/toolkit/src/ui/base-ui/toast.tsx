import {
  type Color,
  type ToastOwnProps,
  toastProps,
} from "@agent-native/design-system";
import { useDirection } from "@base-ui/react/direction-provider";
import {
  Toast as BaseToast,
  type ToastManagerAddOptions,
  type ToastManagerUpdateOptions,
  type ToastObject,
} from "@base-ui/react/toast";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import * as React from "react";

import { Button, type ButtonProps, IconButton } from "./button.js";
import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";
import { Spinner } from "./spinner.js";

const ToastPortal = scopePortal(BaseToast.Portal);

type Clearable<T> = { [K in keyof T]?: T[K] | undefined };

/** What a toast keeps in Base UI's `data`: the part's props and a second action. */
export interface ToastData extends Clearable<ToastOwnProps> {
  /** A button before the action, such as "Not now". It doesn't close the toast. */
  secondaryActionProps?: ToastObject<object>["actionProps"];
}

const DATA_KEYS = [
  "variant",
  "color",
  "highContrast",
  "secondaryActionProps",
] as const satisfies readonly (keyof ToastData)[];

export interface ToastOptions
  extends Omit<ToastManagerAddOptions<ToastData>, "data">, ToastData {}

export interface ToastUpdateOptions
  extends Omit<ToastManagerUpdateOptions<ToastData>, "data">, ToastData {}

type PromiseState<Arg> =
  | string
  | ToastUpdateOptions
  | ((value: Arg) => string | ToastUpdateOptions);

/** Base UI's promise states. A string is the toast's description. */
export interface ToastPromiseOptions<Value> {
  loading: string | ToastUpdateOptions;
  success: PromiseState<Value>;
  error: PromiseState<unknown>;
}

type BaseUpdate = ToastManagerUpdateOptions<ToastData>;

/**
 * How long a toast that closes on its own stays: 6 seconds, plus 60ms a
 * character of its title and description (about 200 words a minute), up to
 * 15 seconds.
 */
export const READING_TIME = {
  minimum: 6000,
  perCharacter: 60,
  maximum: 15000,
} as const;

function textLength(node: React.ReactNode): number {
  if (typeof node === "string" || typeof node === "number") {
    return String(node).length;
  }
  if (Array.isArray(node)) {
    return node.reduce<number>((sum, child) => sum + textLength(child), 0);
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textLength(node.props.children);
  }
  return 0;
}

/** The milliseconds a toast with this text stays, per `READING_TIME`. */
export function readingTimeout(
  title?: React.ReactNode,
  description?: React.ReactNode,
): number {
  const characters = textLength(title) + textLength(description);
  return Math.min(
    READING_TIME.maximum,
    READING_TIME.minimum + characters * READING_TIME.perCharacter,
  );
}

const TYPE_COLOR: Readonly<Partial<Record<string, Color>>> = {
  success: "success",
  error: "danger",
};

function statusColor(toast: {
  color?: Color | undefined;
  type?: string | undefined;
}): Color | undefined {
  return (
    toast.color ??
    (toast.type === undefined ? undefined : TYPE_COLOR[toast.type])
  );
}

export interface ToastPolicyInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  color?: Color | undefined;
  type?: string | undefined;
  actionProps?: unknown;
  secondaryActionProps?: unknown;
}

/**
 * The timeout and priority a toast gets unless it sets its own. A danger
 * toast, or one with an action, stays until dismissed (WCAG 2.2.1); any
 * other closes after its reading time. Danger is announced assertively,
 * everything else politely (WCAG 4.1.3).
 */
export function toastDefaults(toast: ToastPolicyInput): {
  timeout: number;
  priority: "low" | "high";
} {
  const danger = statusColor(toast) === "danger";
  const persists =
    danger ||
    toast.actionProps !== undefined ||
    toast.secondaryActionProps !== undefined;
  return {
    timeout: persists ? 0 : readingTimeout(toast.title, toast.description),
    priority: danger ? "high" : "low",
  };
}

function pickData(options: ToastData): ToastData {
  const data: ToastData = {};
  for (const key of DATA_KEYS) {
    if (key in options) Object.assign(data, { [key]: options[key] });
  }
  return data;
}

function withoutData<O extends ToastData>(
  options: O,
): Omit<O, keyof ToastData> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (!(DATA_KEYS as readonly string[]).includes(key)) rest[key] = value;
  }
  return rest as Omit<O, keyof ToastData>;
}

function resolveState(
  state: string | ToastUpdateOptions,
  implied: Color | undefined,
): BaseUpdate {
  const options = typeof state === "string" ? { description: state } : state;
  const policy = toastDefaults({
    ...options,
    color: options.color ?? implied,
  });
  return {
    ...withoutData(options),
    data: pickData(options),
    timeout: options.timeout ?? policy.timeout,
    priority: options.priority ?? policy.priority,
  };
}

function promiseState<Arg>(
  state: PromiseState<Arg>,
  implied: Color,
): BaseUpdate | ((value: Arg) => BaseUpdate) {
  if (typeof state === "function") {
    return (value: Arg) => resolveState(state(value), implied);
  }
  return resolveState(state, implied);
}

const STATUS_KEYS = [
  "color",
  "type",
  "actionProps",
  "secondaryActionProps",
] as const;

const manager = BaseToast.createToastManager<ToastData>();

let mounted = 0;
let rendered = false;
let reported = false;
let nextId = 0;
const pending: (() => void)[] = [];

function send(call: () => void) {
  if (mounted > 0) call();
  else pending.push(call);
}

function flush() {
  for (const call of pending.splice(0)) call();
}

function reportMissingToaster() {
  if (rendered || mounted > 0 || reported) return;
  reported = true;
  console.error(
    "toast.add() ran with no Toaster rendered, so the toast isn't shown. Mount <Toaster> at the app root; toasts raised before it mounts show once it does.",
  );
}

export interface ToastManager {
  /**
   * Raises a toast and returns its id. Adding an existing `id` replaces that
   * toast's content, props and `type`: a loading toast re-added without
   * `type` stops loading. `timeout` and `priority` default per
   * `toastDefaults`; set either to override it.
   */
  add(options: ToastOptions): string;
  /**
   * Changes a toast in place; its props merge with the ones it has. A
   * change of status moves a defaulted timeout and priority with it.
   */
  update(id: string, options: ToastUpdateOptions): void;
  /** Closes one toast, or every toast without an id. */
  close(id?: string): void;
  /** A loading toast that becomes the success or error state as the promise settles. */
  promise<Value>(
    promise: Promise<Value>,
    options: ToastPromiseOptions<Value>,
  ): Promise<Value>;
}

/** Raises toasts from anywhere, React or not, into the mounted Toaster. */
const toast: ToastManager = {
  add: (options) => {
    reportMissingToaster();
    nextId += 1;
    const id = options.id ?? `toast-${nextId}`;
    const policy = toastDefaults(options);
    send(() =>
      manager.add({
        ...withoutData(options),
        id,
        type: options.type,
        timeout: options.timeout ?? policy.timeout,
        priority: options.priority ?? policy.priority,
        data: pickData(options),
      }),
    );
    return id;
  },
  update: (id, options) => {
    const data = pickData(options);
    const rest = withoutData(options);
    const statusChanges = STATUS_KEYS.some((key) => key in options);
    send(() =>
      manager.update(id, (previous) => {
        const nextData = { ...previous.data, ...data };
        if (!statusChanges) return { ...rest, data: nextData };
        const was = toastDefaults({ ...previous, ...previous.data });
        const next = toastDefaults({ ...previous, ...rest, ...nextData });
        return {
          ...rest,
          data: nextData,
          ...(options.timeout === undefined && previous.timeout === was.timeout
            ? { timeout: next.timeout }
            : {}),
          ...(options.priority === undefined &&
          (previous.priority ?? "low") === was.priority
            ? { priority: next.priority }
            : {}),
        };
      }),
    );
  },
  close: (id) => send(() => manager.close(id)),
  promise: (promise, { loading, success, error }) => {
    const options = {
      loading: resolveState(loading, undefined),
      success: promiseState(success, "success"),
      error: promiseState(error, "danger"),
    };
    if (mounted > 0) return manager.promise(promise, options);
    send(() => void manager.promise(promise, options).catch(() => undefined));
    return promise;
  },
};

export interface UseToastReturnValue extends ToastManager {
  /** The toasts on screen, newest first. */
  toasts: ToastObject<ToastData>[];
}

/** `toast` with the toasts on screen. Call it inside a Toaster that wraps the app. */
function useToast(): UseToastReturnValue {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  return React.useMemo(() => ({ ...toast, toasts }), [toasts]);
}

export interface ToastRootProps
  extends Omit<BaseToast.Root.Props, "color">, ToastOwnProps {}

/**
 * One toast, on Base UI's Toast Root with Radix Themes' variant and color.
 * The Toaster renders these; use it only to build your own region.
 *
 * @import import { ToastRoot } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastRoot = React.forwardRef<HTMLDivElement, ToastRootProps>(
  (props, ref) => {
    const direction = useDirection();
    const [attributes, { className, swipeDirection, ...rest }] = splitProps(
      toastProps,
      props,
    );
    return (
      <BaseToast.Root
        ref={ref}
        swipeDirection={
          swipeDirection ?? ["down", direction === "rtl" ? "left" : "right"]
        }
        {...rest}
        {...attributes}
        className={partClassName("toast", className)}
      />
    );
  },
);
ToastRoot.displayName = "ToastRoot";

/**
 * The region the toasts stack in, which F6 moves focus to. The Toaster
 * renders one.
 *
 * @import import { ToastViewport } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastViewport = React.forwardRef<
  HTMLDivElement,
  BaseToast.Viewport.Props
>(({ className, ...props }, ref) => (
  <BaseToast.Viewport
    ref={ref}
    aria-keyshortcuts="F6"
    {...props}
    className={partClassName("toast-viewport", className)}
  />
));
ToastViewport.displayName = "ToastViewport";

/**
 * Holds a toast's text and actions, so the stack can hide it behind the
 * front toast.
 *
 * @import import { ToastContent } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastContent = React.forwardRef<HTMLDivElement, BaseToast.Content.Props>(
  ({ className, ...props }, ref) => (
    <BaseToast.Content
      ref={ref}
      {...props}
      className={partClassName("toast-content", className)}
    />
  ),
);
ToastContent.displayName = "ToastContent";

/**
 * The toast's title, which names it for assistive technology.
 *
 * @import import { ToastTitle } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastTitle = React.forwardRef<HTMLHeadingElement, BaseToast.Title.Props>(
  ({ className, ...props }, ref) => (
    <BaseToast.Title
      ref={ref}
      {...props}
      className={partClassName("toast-title", className)}
    />
  ),
);
ToastTitle.displayName = "ToastTitle";

/**
 * The sentence under the toast's title.
 *
 * @import import { ToastDescription } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastDescription = React.forwardRef<
  HTMLParagraphElement,
  BaseToast.Description.Props
>(({ className, ...props }, ref) => (
  <BaseToast.Description
    ref={ref}
    {...props}
    className={partClassName("toast-description", className)}
  />
));
ToastDescription.displayName = "ToastDescription";

export type ToastActionProps = Omit<ButtonProps, "render">;

/**
 * The toast's action, Base UI's Toast Action drawn as a Button. The toast's
 * `actionProps` give its label and handler.
 *
 * @import import { ToastAction } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastAction = React.forwardRef<HTMLButtonElement, ToastActionProps>(
  (props, ref) => (
    <BaseToast.Action
      ref={ref}
      className="toast-action"
      render={<Button size="md" {...props} />}
    />
  ),
);
ToastAction.displayName = "ToastAction";

export interface ToastCloseProps extends Omit<
  ButtonProps,
  "render" | "children"
> {
  /** Names the close button: the part carries no copy. */
  "aria-label": string;
}

/**
 * The button that dismisses a toast, a 24px square: the WCAG 2.5.8 minimum
 * target.
 *
 * @import import { ToastClose } from "@agent-native/toolkit/ui/base-ui/toast";
 */
const ToastClose = React.forwardRef<HTMLButtonElement, ToastCloseProps>(
  (props, ref) => (
    <BaseToast.Close
      ref={ref}
      className="toast-close"
      render={
        <IconButton size="md" variant="ghost" {...props}>
          <IconX aria-hidden />
        </IconButton>
      }
    />
  ),
);
ToastClose.displayName = "ToastClose";

let anchors: readonly HTMLElement[] = [];
const anchorListeners = new Set<() => void>();

function setAnchors(next: readonly HTMLElement[]) {
  anchors = next;
  for (const listener of anchorListeners) listener();
}

function subscribeAnchors(listener: () => void) {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
}

const latestAnchor = () => anchors.at(-1) ?? null;
const noAnchor = () => null;

/**
 * A ref that makes its element the place toasts sit: they stack at its
 * bottom right. The latest mounted anchor wins.
 */
function useToastAnchor<
  Element extends HTMLElement,
>(): React.RefCallback<Element> {
  return React.useCallback((element: Element | null) => {
    if (element === null) return undefined;
    setAnchors([...anchors, element]);
    return () => setAnchors(anchors.filter((anchor) => anchor !== element));
  }, []);
}

type ToastContainer = HTMLElement | React.RefObject<HTMLElement | null> | null;

function useAnchor(container: ToastContainer | undefined): HTMLElement | null {
  const registered = React.useSyncExternalStore(
    subscribeAnchors,
    latestAnchor,
    noAnchor,
  );
  const [fromRef, setFromRef] = React.useState<HTMLElement | null>(null);
  const isRef = container != null && "current" in container;
  React.useEffect(() => {
    const next = isRef ? container.current : null;
    if (next !== fromRef) setFromRef(next);
  });
  if (container === undefined) return registered;
  return isRef ? fromRef : container;
}

function useVisibleRect(
  anchor: HTMLElement | null,
): React.CSSProperties | undefined {
  const [rect, setRect] = React.useState<React.CSSProperties>();
  React.useLayoutEffect(() => {
    const win = anchor?.ownerDocument.defaultView;
    if (anchor === null || win == null) {
      setRect(undefined);
      return undefined;
    }
    let frame = 0;
    let previous: React.CSSProperties | undefined;
    const measure = () => {
      frame = 0;
      const box = anchor.getBoundingClientRect();
      const left = Math.max(box.left, 0);
      const top = Math.max(box.top, 0);
      const width = Math.max(Math.min(box.right, win.innerWidth) - left, 0);
      const height = Math.max(Math.min(box.bottom, win.innerHeight) - top, 0);
      if (
        previous?.left === left &&
        previous.top === top &&
        previous.width === width &&
        previous.height === height
      )
        return;
      previous = { left, top, width, height };
      setRect(previous);
    };
    const schedule = () => {
      if (frame === 0) frame = win.requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof win.ResizeObserver === "function"
        ? new win.ResizeObserver(schedule)
        : undefined;
    observer?.observe(anchor);
    win.addEventListener("resize", schedule);
    win.addEventListener("scroll", schedule, true);
    return () => {
      observer?.disconnect();
      win.removeEventListener("resize", schedule);
      win.removeEventListener("scroll", schedule, true);
      if (frame !== 0) win.cancelAnimationFrame(frame);
    };
  }, [anchor]);
  return rect;
}

const STATUS_ICON: Readonly<Partial<Record<Color, typeof IconX>>> = {
  success: IconCircleCheck,
  danger: IconCircleX,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
};

export interface ToasterProps extends Omit<ToastOwnProps, "color"> {
  /** Names every toast's close button, in the app's language. */
  closeLabel: string;
  /**
   * Names the toast region that F6 moves focus to, in the app's language,
   * such as "Notifications".
   */
  regionLabel: string;
  /** How many toasts show at once; older ones wait behind the stack. */
  limit?: number;
  /**
   * The element toasts sit at the bottom right of, as an element or a ref:
   * the app's canvas. Unset, the element a `useToastAnchor` ref is on
   * (AppShellCanvas); with neither, the window's corner, as a fallback.
   */
  container?: ToastContainer;
  /** The app, when it calls useToast(). `toast` works without it. */
  children?: React.ReactNode;
}

/**
 * Renders every toast, stacked at the bottom right of the app's canvas, so
 * they never cover the side panels. Mount one, at the app root, and raise
 * toasts with `toast.add()` from anywhere. On App Shell the canvas anchors
 * the toasts by itself; another shell passes its canvas as `container`.
 * Without either they sit at the window's corner, which is a fallback, not
 * the place for an app's toasts.
 *
 * ## When to use a toast
 *
 * - A brief, non-blocking confirmation of something the user just did:
 *   "Saved", "Link copied", "Export started".
 * - Anything the user must act on or must not miss belongs inline as well:
 *   a Field error beside the input, a Callout on the page. A toast can echo
 *   it, but is never the only place an error is reported.
 * - Not for content the user needs to come back to, and not for a choice
 *   that blocks their work: that is a dialog.
 *
 * ## What the Toaster does for you
 *
 * - A danger toast, or one with an action, stays until dismissed; any other
 *   stays for its reading time (`readingTimeout`). Hovering, focusing the
 *   region and leaving the window pause every timer. `timeout` overrides.
 * - Danger is announced assertively, everything else politely. `priority`
 *   overrides.
 * - Every status toast carries an icon, so color is never the only cue.
 * - At most `limit` toasts show; the rest wait behind the stack and fan out
 *   on hover or focus. F6 moves focus into the region and back.
 * - The stack steps aside while focus is on something it would cover.
 *
 * @import import { Toaster, toast, useToast } from "@agent-native/toolkit/ui/base-ui/toast";
 */
function Toaster({
  closeLabel,
  regionLabel,
  limit = 3,
  container,
  children,
  variant,
  highContrast,
}: ToasterProps) {
  rendered = true;
  const anchor = useAnchor(container);
  const rect = useVisibleRect(anchor);
  React.useEffect(() => {
    mounted += 1;
    flush();
    return () => {
      mounted -= 1;
      if (mounted === 0) rendered = false;
    };
  }, []);
  return (
    <BaseToast.Provider toastManager={manager} limit={limit}>
      {children}
      <ToastPortal
        className="toast-portal"
        {...(anchor === null
          ? {}
          : { container: anchor, "data-anchored": "", style: rect })}
      >
        <ToastRegion
          regionLabel={regionLabel}
          closeLabel={closeLabel}
          {...(variant === undefined ? {} : { variant })}
          {...(highContrast === undefined ? {} : { highContrast })}
        />
      </ToastPortal>
    </BaseToast.Provider>
  );
}

type ToastRegionProps = Pick<
  ToasterProps,
  "closeLabel" | "regionLabel" | "variant" | "highContrast"
>;

function coversFocus(viewport: HTMLElement): boolean {
  const doc = viewport.ownerDocument;
  const focused = doc.activeElement;
  if (focused === null || focused === doc.body || viewport.contains(focused)) {
    return false;
  }
  const target = focused.getBoundingClientRect();
  return Array.from(
    viewport.querySelectorAll(".toast:not([data-limited])"),
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.left < target.right &&
      rect.right > target.left &&
      rect.top < target.bottom &&
      rect.bottom > target.top
    );
  });
}

function ToastRegion({ regionLabel, ...itemProps }: ToastRegionProps) {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [yielding, setYielding] = React.useState(false);
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;
    const doc = viewport.ownerDocument;
    const check = () => setYielding(coversFocus(viewport));
    const checkAfterBlur = () => queueMicrotask(check);
    check();
    doc.addEventListener("focusin", check);
    doc.addEventListener("focusout", checkAfterBlur);
    return () => {
      doc.removeEventListener("focusin", check);
      doc.removeEventListener("focusout", checkAfterBlur);
    };
  }, [toasts]);
  return (
    <ToastViewport
      ref={viewportRef}
      aria-label={regionLabel}
      {...(yielding ? { "data-yielding": "" } : {})}
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} {...itemProps} />
      ))}
    </ToastViewport>
  );
}

function ToastItem({
  toast: item,
  closeLabel,
  ...defaults
}: Omit<ToastRegionProps, "regionLabel"> & {
  toast: ToastObject<ToastData>;
}) {
  const data = item.data ?? {};
  const variant =
    data.variant ?? defaults.variant ?? toastProps.variant.default;
  const color = statusColor({ color: data.color, type: item.type });
  const highContrast = data.highContrast ?? defaults.highContrast ?? false;
  const solid = variant === "solid";
  const Icon = color === undefined ? undefined : STATUS_ICON[color];
  const { children: secondaryLabel, ...secondary } =
    data.secondaryActionProps ?? {};
  return (
    <ToastRoot
      toast={item}
      {...(variant === undefined ? {} : { variant })}
      {...(color === undefined ? {} : { color })}
      highContrast={highContrast}
    >
      <ToastContent>
        {item.type === "loading" ? (
          <span className="toast-icon">
            <Spinner />
          </span>
        ) : Icon ? (
          <span className="toast-icon">
            <Icon aria-hidden />
          </span>
        ) : null}
        <div className="toast-text">
          <ToastTitle />
          <ToastDescription />
        </div>
        {data.secondaryActionProps === undefined ? null : (
          <Button
            size="md"
            variant={solid ? "solid" : "soft"}
            highContrast={highContrast}
            className="toast-action"
            render={<button type="button" {...secondary} />}
          >
            {secondaryLabel}
          </Button>
        )}
        <ToastAction
          variant="solid"
          highContrast={
            solid
              ? !highContrast
              : highContrast || (color ?? toastProps.color.default) === "gray"
          }
        />
        <ToastClose
          aria-label={closeLabel}
          variant={solid ? "solid" : "ghost"}
          highContrast={highContrast}
        />
      </ToastContent>
    </ToastRoot>
  );
}

export {
  Toaster,
  toast,
  useToast,
  useToastAnchor,
  ToastViewport,
  ToastRoot,
  ToastContent,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
};
