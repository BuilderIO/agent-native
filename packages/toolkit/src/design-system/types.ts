import type {
  ComponentType,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
  Ref,
  RefObject,
} from "react";

export const DESIGN_SYSTEM_CONTRACT_VERSION = 1 as const;

export type DesignSystemIntent = "primary" | "neutral" | "danger";
export type DesignSystemEmphasis = "solid" | "outline" | "ghost";
export type DesignSystemSize = "compact" | "default" | "large";
export type DesignSystemTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";
export type DesignSystemPlacement = "top" | "right" | "bottom" | "left";
export type DesignSystemAlign = "start" | "center" | "end";
export type DesignSystemKey = string | number;
export type DesignSystemPressEvent =
  | ReactMouseEvent<HTMLElement>
  | ReactKeyboardEvent<HTMLElement>;

/**
 * Styling hooks are optional interoperability affordances. Adapters must not
 * rely on either hook being present, and Toolkit views must not pass
 * framework-specific utility classes through this contract.
 */
export interface DesignSystemStyleProps {
  className?: string;
  style?: CSSProperties;
}

export interface DesignSystemAccessibleProps {
  id?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: boolean | "dialog" | "grid" | "listbox" | "menu" | "tree";
  "aria-pressed"?: boolean | "mixed";
}

export interface DesignSystemOverlayProps extends DesignSystemStyleProps {
  portalContainer?: Element | null;
  placement?: DesignSystemPlacement;
  align?: DesignSystemAlign;
  collisionPadding?: number;
}

export interface ActionButtonProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  children?: ReactNode;
  intent?: DesignSystemIntent;
  emphasis?: DesignSystemEmphasis;
  size?: DesignSystemSize;
  pending?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  onPress?: (event?: DesignSystemPressEvent) => void;
  elementRef?: Ref<HTMLButtonElement>;
}

export interface IconButtonProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  label: string;
  icon: ReactNode;
  intent?: DesignSystemIntent;
  emphasis?: DesignSystemEmphasis;
  size?: DesignSystemSize;
  pending?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onPress?: (event?: DesignSystemPressEvent) => void;
  elementRef?: Ref<HTMLButtonElement>;
}

export type DesignSystemTextInputType =
  | "text"
  | "email"
  | "password"
  | "search"
  | "tel"
  | "url";

export interface TextFieldProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  placeholder?: string;
  name?: string;
  type?: DesignSystemTextInputType;
  inputMode?:
    | "none"
    | "text"
    | "tel"
    | "url"
    | "email"
    | "numeric"
    | "decimal"
    | "search";
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  leadingContent?: ReactNode;
  trailingContent?: ReactNode;
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export interface TextAreaProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  placeholder?: string;
  name?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  textAreaRef?: Ref<HTMLTextAreaElement>;
}

export interface SpinnerProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  label?: string;
  size?: DesignSystemSize;
}

export interface SkeletonProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  width?: string | number;
  height?: string | number;
  shape?: "line" | "rectangle" | "circle";
}

export interface StatusProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  children: ReactNode;
  tone?: DesignSystemTone;
  icon?: ReactNode;
  size?: DesignSystemSize;
}

export interface SurfaceProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  children: ReactNode;
  as?: "div" | "section" | "article" | "aside";
  elevation?: "none" | "low" | "medium";
  padding?: "none" | "compact" | "default" | "spacious";
  interactive?: boolean;
  onPress?: (event?: DesignSystemPressEvent) => void;
}

export interface AvatarProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  name: string;
  src?: string | null;
  fallback?: ReactNode;
  size?: DesignSystemSize;
  status?: "online" | "offline" | "busy" | "away";
  imageRef?: Ref<HTMLImageElement>;
}

export interface TooltipProps extends DesignSystemOverlayProps {
  trigger: ReactElement;
  content: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayMs?: number;
  disabled?: boolean;
}

export interface MenuItem {
  id: DesignSystemKey;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  disabled?: boolean;
  intent?: Extract<DesignSystemIntent, "neutral" | "danger">;
  selected?: boolean;
  children?: readonly MenuItem[];
}

export interface MenuSection {
  id: DesignSystemKey;
  label?: ReactNode;
  items: readonly MenuItem[];
}

export interface MenuProps extends DesignSystemOverlayProps {
  trigger: ReactElement;
  items?: readonly MenuItem[];
  sections?: readonly MenuSection[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAction: (id: DesignSystemKey) => void;
  closeOnAction?: boolean;
}

export interface PopoverProps extends DesignSystemOverlayProps {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export interface DialogProps extends DesignSystemOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  trigger?: ReactElement;
  size?: "small" | "medium" | "large" | "fullscreen";
  dismissible?: boolean;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export interface PickerOption<Value extends DesignSystemKey = string> {
  value: Value;
  label: ReactNode;
  textValue?: string;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: readonly string[];
}

export interface PickerProps<Value extends DesignSystemKey = string>
  extends DesignSystemOverlayProps, DesignSystemAccessibleProps {
  mode: "select" | "combobox";
  options: readonly PickerOption<Value>[];
  value: Value | null;
  onChange: (value: Value | null) => void;
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  placeholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  emptyContent?: ReactNode;
  loadingContent?: ReactNode;
  loading?: boolean;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  pickerRef?: Ref<HTMLElement>;
}

export interface CheckboxProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  inputRef?: Ref<HTMLButtonElement>;
}

export interface SwitchProps
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  inputRef?: Ref<HTMLButtonElement>;
}

export interface TabItem<Value extends DesignSystemKey = string> {
  value: Value;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface TabsProps<Value extends DesignSystemKey = string>
  extends DesignSystemStyleProps, DesignSystemAccessibleProps {
  items: readonly TabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  orientation?: "horizontal" | "vertical";
  activationMode?: "automatic" | "manual";
}

export interface PickerComponent {
  <Value extends DesignSystemKey = string>(
    props: PickerProps<Value>,
  ): ReactNode;
}

export interface TabsComponent {
  <Value extends DesignSystemKey = string>(props: TabsProps<Value>): ReactNode;
}

export interface DesignSystemComponents {
  ActionButton: ComponentType<ActionButtonProps>;
  IconButton: ComponentType<IconButtonProps>;
  TextField: ComponentType<TextFieldProps>;
  TextArea: ComponentType<TextAreaProps>;
  Spinner: ComponentType<SpinnerProps>;
  Skeleton: ComponentType<SkeletonProps>;
  Status: ComponentType<StatusProps>;
  Surface: ComponentType<SurfaceProps>;
  Avatar: ComponentType<AvatarProps>;
  Tooltip: ComponentType<TooltipProps>;
  Menu: ComponentType<MenuProps>;
  Popover: ComponentType<PopoverProps>;
  Dialog: ComponentType<DialogProps>;
  Picker: PickerComponent;
  Checkbox: ComponentType<CheckboxProps>;
  Switch: ComponentType<SwitchProps>;
  Tabs: TabsComponent;
}

export type DesignSystemComponentName = keyof DesignSystemComponents;
