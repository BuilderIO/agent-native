import type { ComponentType } from "react";

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

export const ActionButton = createComponent<ActionButtonProps>(
  "ActionButton",
  defaultDesignSystemComponents.ActionButton,
);
export const IconButton = createComponent<IconButtonProps>(
  "IconButton",
  defaultDesignSystemComponents.IconButton,
);
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
