import {
  type comboboxPopupProps,
  type PropsOf,
} from "@agent-native/design-system";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import * as React from "react";

import { cn } from "../../utils.js";
import { partClassName } from "./part-class.js";
import { splitPositionerProps } from "./positioning.js";
import { splitProps } from "./props.js";

type PopupDefs = typeof comboboxPopupProps;

interface ListboxRoot {
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
  inline,
  children,
}: {
  inline: boolean | undefined;
  children: React.ReactNode;
}) {
  const [size, setSize] = React.useState<string | undefined>(undefined);
  const value = React.useMemo(
    () => ({ size, setSize, inline: inline === true }),
    [size, inline],
  );
  return (
    <ListboxRootContext.Provider value={value}>
      {children}
    </ListboxRootContext.Provider>
  );
}

/** The input reports its size so the popup's rows can match it. */
export function useReportInputSize(size: string | undefined) {
  const { setSize } = useListboxRoot();
  React.useLayoutEffect(() => {
    setSize(size);
  }, [setSize, size]);
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

export type ListboxPopupProps = Omit<
  BaseCombobox.Popup.Props,
  "className" | "color"
> &
  PositionerProps &
  PropsOf<PopupDefs> & {
    className?: string;
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
      const { size } = useListboxRoot();
      return (
        <BaseCombobox.Portal container={container}>
          <BaseCombobox.Positioner
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
              className={cn(`${part}-popup`, className)}
            />
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
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
  const List = React.forwardRef<HTMLDivElement, BaseCombobox.List.Props>(
    ({ className, ...props }, ref) => {
      const { inline, size } = useListboxRoot();
      const [attributes] = splitProps(defs, {});
      return (
        <BaseCombobox.List
          ref={ref}
          {...props}
          {...(inline ? { ...attributes, "data-size": size } : {})}
          className={partClassName(`${part}-list`, className)}
        />
      );
    },
  );
  List.displayName = displayName;
  return List;
}
