import {
  type comboboxPopupProps,
  type PropsOf,
} from "@agent-native/design-system";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import * as React from "react";

import { inheritedName, type AccessibleName } from "./accessible-name.js";
import { IconButton } from "./button.js";
import { scopePortal } from "./overlay-scope.js";
import { partClassName } from "./part-class.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

export const listboxIconButton = (
  <IconButton size="sm" variant="ghost" color="gray" />
);

export function listboxActionName(
  children: React.ReactNode,
  props: AccessibleName & { title?: string | undefined },
  fallback: string,
  render:
    | BaseCombobox.Trigger.Props["render"]
    | BaseCombobox.Clear.Props["render"],
) {
  if (
    props["aria-label"] !== undefined ||
    props["aria-labelledby"] !== undefined ||
    props.title !== undefined
  )
    return undefined;
  if (render === listboxIconButton && children == null)
    return { "aria-label": fallback };
  const label = React.isValidElement<{ children?: React.ReactNode }>(render)
    ? (render.props.children ?? children)
    : children;
  return {
    title: typeof label === "string" && label.trim() ? label : fallback,
  };
}

const ComboboxPortal = scopePortal(BaseCombobox.Portal);

type PopupDefs = typeof comboboxPopupProps;

interface ListboxRoot {
  name: AccessibleName;
  actionsRef: React.RefObject<BaseCombobox.Root.Actions | null>;
  closeRequests: React.RefObject<number>;
  positionerRef: React.RefObject<HTMLDivElement | null>;
  size: string | undefined;
  setSize: (size: string | undefined) => void;
  inline: boolean;
}

const ListboxRootContext = React.createContext<ListboxRoot | null>(null);

function useListboxRoot(): ListboxRoot {
  const root = React.useContext(ListboxRootContext);
  if (root === null) {
    throw new Error(
      "An autocomplete or combobox part must be inside its <Autocomplete> or <Combobox> root.",
    );
  }
  return root;
}

/** The root's context: its root element renders nothing to hang a size on. */
export function ListboxRootProvider({
  "aria-label": label,
  "aria-labelledby": labelledBy,
  actionsRef,
  closeRequests,
  positionerRef,
  inline,
  children,
}: {
  actionsRef: ListboxRoot["actionsRef"];
  closeRequests: ListboxRoot["closeRequests"];
  positionerRef: ListboxRoot["positionerRef"];
  inline: boolean | undefined;
  children: React.ReactNode;
} & AccessibleName) {
  const [size, setSize] = React.useState<string | undefined>(undefined);
  const value = React.useMemo(
    () => ({
      size,
      setSize,
      name: {
        ...(label === undefined ? {} : { "aria-label": label }),
        ...(labelledBy === undefined ? {} : { "aria-labelledby": labelledBy }),
      },
      inline: inline === true,
      actionsRef,
      closeRequests,
      positionerRef,
    }),
    [size, inline, actionsRef, closeRequests, positionerRef, label, labelledBy],
  );
  return (
    <ListboxRootContext.Provider value={value}>
      {children}
    </ListboxRootContext.Provider>
  );
}

export function useListboxOpenChange<
  Details extends {
    event: Event;
    isCanceled: boolean;
    preventUnmountOnClose(): void;
  },
>(
  listener: ((open: boolean, details: Details) => void) | undefined,
  actionsRef: ListboxRoot["actionsRef"],
) {
  const closeRequests = React.useRef(0);
  const positionerRef = React.useRef<HTMLDivElement>(null);
  const onOpenChange = React.useCallback(
    (open: boolean, details: Details) => {
      if (!open) closeRequests.current++;
      const { event } = details;
      const positioner = positionerRef.current;
      const win = positioner?.ownerDocument.defaultView;
      if (
        open ||
        event.type !== "keydown" ||
        !("key" in event) ||
        (event.key !== "Enter" && event.key !== "Escape") ||
        !win ||
        !(event.target instanceof win.HTMLInputElement) ||
        !positioner.contains(event.target)
      ) {
        listener?.(open, details);
        return;
      }
      const holdState = { held: false };
      const hold = details.preventUnmountOnClose;
      details.preventUnmountOnClose = () => {
        holdState.held = true;
        hold();
      };
      listener?.(false, details);
      if (holdState.held || details.isCanceled) return;
      event.preventDefault();
      actionsRef.current?.unmount();
    },
    [actionsRef, listener],
  );
  return { closeRequests, positionerRef, onOpenChange };
}

/** The input reports its size so the popup's rows can match it. */
export function useListboxInput(
  size: string | undefined,
  props: AccessibleName,
) {
  const { setSize, name } = useListboxRoot();
  React.useLayoutEffect(() => {
    setSize(size);
  }, [setSize, size]);
  return inheritedName(name, props);
}

type PositionerProps = Pick<
  BaseCombobox.Positioner.Props,
  | "anchor"
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionBoundary"
  | "collisionPadding"
  | "collisionAvoidance"
  | "sticky"
  | "arrowPadding"
  | "disableAnchorTracking"
  | "positionMethod"
>;

export type ListboxPopupProps = Omit<BaseCombobox.Popup.Props, "color"> &
  PositionerProps &
  PropsOf<PopupDefs> & {
    /** Portal target. */
    container?: BaseCombobox.Portal.Props["container"];
  };

/** Portal, positioner and popup, below the input and as wide as it. */
export function createListboxPopup(
  part: "autocomplete" | "combobox",
  defs: PopupDefs,
  displayName: string,
) {
  const Popup = React.forwardRef<HTMLDivElement, ListboxPopupProps>(
    (props, ref) => {
      const [attributes, { className, container, ...rest }] = splitProps(
        defs,
        props,
      );
      const [positioner, popup] = splitPositionerProps(rest);
      const { size, actionsRef, closeRequests, positionerRef } =
        useListboxRoot();
      const watchWindow = React.useCallback(
        (node: HTMLDivElement | null) => {
          if (!node) return;
          const doc = node.ownerDocument;
          const win = doc.defaultView;
          if (!win) return;
          positionerRef.current = node;
          let frame: number | undefined;
          const onTab = (event: KeyboardEvent) => {
            if (event.key !== "Tab" || event.defaultPrevented) return;
            const input = event.composedPath()[0];
            if (
              !(input instanceof win.HTMLInputElement) ||
              node.contains(input)
            )
              return;
            const listId = input.getAttribute("aria-controls");
            if (!listId || !node.querySelector("#" + win.CSS.escape(listId)))
              return;
            const requests = closeRequests.current;
            if (frame !== undefined) win.cancelAnimationFrame(frame);
            frame = win.requestAnimationFrame(() => {
              frame = undefined;
              const next = doc.activeElement;
              if (
                requests === closeRequests.current &&
                node.hasAttribute("data-open") &&
                next &&
                !input.closest(".input")?.contains(next) &&
                !node.contains(next) &&
                next.closest('[aria-hidden="true"]')
              )
                actionsRef.current?.close();
            });
          };
          const leaveDocument = () => {
            if (
              doc.activeElement === doc.body &&
              node.hasAttribute("data-open")
            ) {
              actionsRef.current?.close();
            }
          };
          win.addEventListener("blur", leaveDocument);
          doc.addEventListener("keydown", onTab);
          return () => {
            if (positionerRef.current === node) positionerRef.current = null;
            win.removeEventListener("blur", leaveDocument);
            doc.removeEventListener("keydown", onTab);
            if (frame !== undefined) win.cancelAnimationFrame(frame);
          };
        },
        [actionsRef, closeRequests, positionerRef],
      );
      return (
        <ComboboxPortal container={container}>
          <BaseCombobox.Positioner
            ref={watchWindow}
            className={`${part}-positioner`}
            align="start"
            sideOffset={4}
            {...positioner}
          >
            <BaseCombobox.Popup
              ref={ref}
              {...popup}
              {...attributes}
              data-size={size}
              className={partClassName(`${part}-popup`, className)}
            />
          </BaseCombobox.Positioner>
        </ComboboxPortal>
      );
    },
  );
  Popup.displayName = displayName;
  return Popup;
}

/**
 * The list. Inline (the root's `inline`), it has no popup around it, so it
 * takes the popup's defaults and the input's size itself.
 */
export function createListboxList(
  part: "autocomplete" | "combobox",
  defs: PopupDefs,
  displayName: string,
) {
  const List = React.forwardRef<
    HTMLDivElement,
    Omit<BaseCombobox.List.Props, "color"> & PropsOf<PopupDefs>
  >((listProps, ref) => {
    const { inline, size, name } = useListboxRoot();
    const [attributes, { className, ...props }] = splitProps(defs, listProps);
    return (
      <BaseCombobox.List
        ref={ref}
        {...props}
        {...inheritedName(name, props)}
        {...(inline ? { ...attributes, "data-size": size } : {})}
        className={partClassName(`${part}-list`, className)}
      />
    );
  });
  List.displayName = displayName;
  return List;
}
