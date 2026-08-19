import { forwardRef, type ComponentType, type Ref } from "react";

import { useDesignSystemComponent } from "./context.js";
import { defaultDesignSystemComponents } from "./default-adapter.js";
import { DesignSystemErrorBoundary } from "./error-boundary.js";
import type {
  ActionButtonProps,
  AvatarProps,
  CheckboxProps,
  DesignSystemComponentName,
  DesignSystemComponents,
  DesignSystemKey,
  DialogProps,
  IconButtonProps,
  MenuProps,
  PickerProps,
  PopoverProps,
  SkeletonProps,
  SpinnerProps,
  StatusProps,
  SurfaceProps,
  SwitchProps,
  TabsProps,
  TextAreaProps,
  TextFieldProps,
  TooltipProps,
} from "./types.js";

function createComponent<Props extends object>(
  name: DesignSystemComponentName,
  DefaultComponent: ComponentType<Props>,
) {
  function DesignSystemComponent(props: Props) {
    const CustomComponent = useDesignSystemComponent(name) as
      | ComponentType<Props>
      | undefined;
    const fallback = <DefaultComponent {...props} />;
    if (
      !CustomComponent ||
      CustomComponent === DefaultComponent ||
      CustomComponent === DesignSystemComponent
    ) {
      return fallback;
    }
    return (
      <DesignSystemErrorBoundary component={name} fallback={fallback}>
        <CustomComponent {...props} />
      </DesignSystemErrorBoundary>
    );
  }
  DesignSystemComponent.displayName = `DesignSystem.${name}`;
  return DesignSystemComponent;
}

function mergeElementRefs<Element>(
  refs: readonly (Ref<Element> | undefined)[],
): Ref<Element> {
  return (node: Element | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: Element | null }).current = node;
    }
  };
}

/**
 * Like `createComponent`, but also wraps in `forwardRef` and merges the
 * forwarded ref into `elementRef` before rendering. Radix `asChild`/`Slot`
 * triggers attach a native `ref` directly to their JSX child to measure it
 * for popper positioning; without this, that ref is silently dropped by the
 * plain function component `createComponent` returns, and Radix falls back
 * to an unmeasured, off-screen position. Scoped to ActionButton/IconButton
 * because those are the only semantic contracts that declare `elementRef`.
 */
function createRefForwardingComponent<
  Props extends { elementRef?: Ref<Element> },
  Element,
>(name: DesignSystemComponentName, DefaultComponent: ComponentType<Props>) {
  const DesignSystemComponent = forwardRef<Element, Props>((props, ref) => {
    const CustomComponent = useDesignSystemComponent(name) as
      | ComponentType<Props>
      | undefined;
    const mergedProps = {
      ...props,
      elementRef: mergeElementRefs([ref, props.elementRef]),
    } as Props;
    const fallback = <DefaultComponent {...mergedProps} />;
    if (
      !CustomComponent ||
      CustomComponent === DefaultComponent ||
      (CustomComponent as unknown) === DesignSystemComponent
    ) {
      return fallback;
    }
    return (
      <DesignSystemErrorBoundary component={name} fallback={fallback}>
        <CustomComponent {...mergedProps} />
      </DesignSystemErrorBoundary>
    );
  });
  DesignSystemComponent.displayName = `DesignSystem.${name}`;
  return DesignSystemComponent;
}

export const ActionButton = createRefForwardingComponent<
  ActionButtonProps,
  HTMLButtonElement
>("ActionButton", defaultDesignSystemComponents.ActionButton);
export const IconButton = createRefForwardingComponent<
  IconButtonProps,
  HTMLButtonElement
>("IconButton", defaultDesignSystemComponents.IconButton);
export const TextField = createComponent<TextFieldProps>(
  "TextField",
  defaultDesignSystemComponents.TextField,
);
export const TextArea = createComponent<TextAreaProps>(
  "TextArea",
  defaultDesignSystemComponents.TextArea,
);
export const Spinner = createComponent<SpinnerProps>(
  "Spinner",
  defaultDesignSystemComponents.Spinner,
);
export const Skeleton = createComponent<SkeletonProps>(
  "Skeleton",
  defaultDesignSystemComponents.Skeleton,
);
export const Status = createComponent<StatusProps>(
  "Status",
  defaultDesignSystemComponents.Status,
);
export const Surface = createComponent<SurfaceProps>(
  "Surface",
  defaultDesignSystemComponents.Surface,
);
export const Avatar = createComponent<AvatarProps>(
  "Avatar",
  defaultDesignSystemComponents.Avatar,
);
export const Tooltip = createComponent<TooltipProps>(
  "Tooltip",
  defaultDesignSystemComponents.Tooltip,
);
export const Menu = createComponent<MenuProps>(
  "Menu",
  defaultDesignSystemComponents.Menu,
);
export const Popover = createComponent<PopoverProps>(
  "Popover",
  defaultDesignSystemComponents.Popover,
);
export const Dialog = createComponent<DialogProps>(
  "Dialog",
  defaultDesignSystemComponents.Dialog,
);
export const Checkbox = createComponent<CheckboxProps>(
  "Checkbox",
  defaultDesignSystemComponents.Checkbox,
);
export const Switch = createComponent<SwitchProps>(
  "Switch",
  defaultDesignSystemComponents.Switch,
);

export function Picker<Value extends DesignSystemKey = string>(
  props: PickerProps<Value>,
) {
  const CustomComponent = useDesignSystemComponent("Picker") as
    | DesignSystemComponents["Picker"]
    | undefined;
  const DefaultComponent = defaultDesignSystemComponents.Picker;
  const fallback = <DefaultComponent {...props} />;
  if (!CustomComponent || CustomComponent === DefaultComponent) return fallback;
  return (
    <DesignSystemErrorBoundary component="Picker" fallback={fallback}>
      <CustomComponent {...props} />
    </DesignSystemErrorBoundary>
  );
}

export function Tabs<Value extends DesignSystemKey = string>(
  props: TabsProps<Value>,
) {
  const CustomComponent = useDesignSystemComponent("Tabs") as
    | DesignSystemComponents["Tabs"]
    | undefined;
  const DefaultComponent = defaultDesignSystemComponents.Tabs;
  const fallback = <DefaultComponent {...props} />;
  if (!CustomComponent || CustomComponent === DefaultComponent) return fallback;
  return (
    <DesignSystemErrorBoundary component="Tabs" fallback={fallback}>
      <CustomComponent {...props} />
    </DesignSystemErrorBoundary>
  );
}
