import type { DesignSystemComponents } from "@agent-native/toolkit/design-system";
import {
  defineDesignSystem,
  defineTheme,
} from "@agent-native/toolkit/design-system";
import type {
  DesignSystemKey,
  DesignSystemSize,
  MenuItem,
  PickerOption,
} from "@agent-native/toolkit/design-system";
import {
  Avatar as AntAvatar,
  Badge,
  Button,
  Card,
  Checkbox as AntCheckbox,
  ConfigProvider,
  Dropdown,
  Input,
  Modal,
  Popover as AntPopover,
  Select,
  Skeleton as AntSkeleton,
  Spin,
  Switch as AntSwitch,
  Tag,
  Tabs as AntTabs,
  Tooltip as AntTooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import type {
  CSSProperties,
  KeyboardEvent,
  ReactElement,
  ReactNode,
} from "react";
import { cloneElement, useEffect, useRef, useState } from "react";

const size = (value?: DesignSystemSize) =>
  value === "compact" ? "small" : value === "large" ? "large" : "middle";
const buttonType = (emphasis?: "solid" | "outline" | "ghost") =>
  emphasis === "outline"
    ? "default"
    : emphasis === "ghost"
      ? "text"
      : "primary";
const buttonDanger = (intent?: "primary" | "neutral" | "danger") =>
  intent === "danger";

const palette = {
  light: {
    background: "#f7f8fa",
    foreground: "#1f2937",
    card: "#ffffff",
    "card-foreground": "#1f2937",
    popover: "#ffffff",
    "popover-foreground": "#1f2937",
    primary: "#1677ff",
    "primary-foreground": "#ffffff",
    secondary: "#e8eef7",
    "secondary-foreground": "#243b53",
    muted: "#eef2f7",
    "muted-foreground": "#62748a",
    accent: "#e2e8f0",
    "accent-foreground": "#1f2937",
    border: "#d5dde8",
    input: "#d5dde8",
    ring: "#1677ff",
    destructive: "#ff4d4f",
    "destructive-foreground": "#ffffff",
  },
  dark: {
    background: "#121820",
    foreground: "#e6edf5",
    card: "#1a2430",
    "card-foreground": "#e6edf5",
    popover: "#1a2430",
    "popover-foreground": "#e6edf5",
    primary: "#4096ff",
    "primary-foreground": "#061c3c",
    secondary: "#27364a",
    "secondary-foreground": "#d8e7f8",
    muted: "#202d3b",
    "muted-foreground": "#9eb0c4",
    accent: "#30435b",
    "accent-foreground": "#e6edf5",
    border: "#34475c",
    input: "#34475c",
    ring: "#4096ff",
    destructive: "#ff7875",
    "destructive-foreground": "#3a1010",
  },
} as const;

export const theme = defineTheme({
  colors: palette,
  radius: "0.5rem",
  typography: {
    fontFamily: "Inter, system-ui, sans-serif",
    monoFontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  elevation: {
    low: "0 1px 3px rgb(15 23 42 / 0.12)",
    medium: "0 8px 24px rgb(15 23 42 / 0.16)",
    high: "0 16px 48px rgb(15 23 42 / 0.24)",
  },
});

export const antdLightTheme = {
  token: {
    colorPrimary: palette.light.primary,
    colorBgBase: palette.light.background,
    colorBgContainer: palette.light.card,
    colorText: palette.light.foreground,
    colorTextSecondary: palette.light["muted-foreground"],
    colorBorder: palette.light.border,
    borderRadius: 8,
    fontFamily: theme.typography?.fontFamily,
  },
};

export const antdDarkTheme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: palette.dark.primary,
    colorBgBase: palette.dark.background,
    colorBgContainer: palette.dark.card,
    colorText: palette.dark.foreground,
    colorTextSecondary: palette.dark["muted-foreground"],
    colorBorder: palette.dark.border,
    borderRadius: 8,
    fontFamily: theme.typography?.fontFamily,
  },
};

const contentProps = (props: {
  className?: string;
  style?: CSSProperties;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-controls"?: string;
}) => ({
  className: props.className,
  style: props.style,
  id: props.id,
  "aria-label": props["aria-label"],
  "aria-labelledby": props["aria-labelledby"],
  "aria-describedby": props["aria-describedby"],
  "aria-controls": props["aria-controls"],
});

const ActionButton: DesignSystemComponents["ActionButton"] = ({
  children,
  intent,
  emphasis = "solid",
  size: buttonSize,
  pending,
  disabled,
  type = "button",
  leadingIcon,
  trailingIcon,
  onPress,
  elementRef,
  ...props
}) => (
  <Button
    {...contentProps(props)}
    ref={elementRef}
    htmlType={type}
    type={buttonType(emphasis)}
    danger={buttonDanger(intent)}
    size={size(buttonSize)}
    disabled={disabled || pending}
    loading={pending}
    icon={leadingIcon}
    onClick={(event) => onPress?.(event)}
  >
    {children}
    {trailingIcon}
  </Button>
);

const IconButton: DesignSystemComponents["IconButton"] = ({
  label,
  icon,
  intent,
  emphasis,
  size: buttonSize,
  pending,
  disabled,
  onPress,
  elementRef,
  ...props
}) => (
  <Button
    {...contentProps(props)}
    ref={elementRef}
    aria-label={label}
    type={buttonType(emphasis)}
    danger={buttonDanger(intent)}
    size={size(buttonSize)}
    disabled={disabled || pending}
    loading={pending}
    shape="circle"
    icon={icon}
    onClick={(event) => onPress?.(event)}
  />
);

const TextField: DesignSystemComponents["TextField"] = ({
  value,
  onChange,
  label,
  description,
  errorMessage,
  invalid,
  leadingContent,
  trailingContent,
  inputRef,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}) => (
  <label
    {...contentProps(props)}
    style={{ display: "grid", gap: 6, ...props.style }}
  >
    {label ? <Typography.Text strong>{label}</Typography.Text> : null}
    <Input
      ref={inputRef as any}
      value={value}
      status={invalid ? "error" : undefined}
      placeholder={props.placeholder}
      prefix={leadingContent}
      suffix={trailingContent}
      disabled={props.disabled}
      required={props.required}
      readOnly={props.readOnly}
      type={props.type}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    />
    {errorMessage ? (
      <Typography.Text type="danger">{errorMessage}</Typography.Text>
    ) : description ? (
      <Typography.Text type="secondary">{description}</Typography.Text>
    ) : null}
  </label>
);

const TextArea: DesignSystemComponents["TextArea"] = ({
  value,
  onChange,
  label,
  description,
  errorMessage,
  invalid,
  textAreaRef,
  ...props
}) => (
  <label
    {...contentProps(props)}
    style={{ display: "grid", gap: 6, ...props.style }}
  >
    {label ? <Typography.Text strong>{label}</Typography.Text> : null}
    <Input.TextArea
      ref={textAreaRef as any}
      value={value}
      status={invalid ? "error" : undefined}
      rows={props.rows}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      disabled={props.disabled}
      required={props.required}
      readOnly={props.readOnly}
      onChange={(event) => onChange(event.target.value)}
      onBlur={props.onBlur}
      onFocus={props.onFocus}
      onKeyDown={props.onKeyDown}
    />
    {errorMessage ? (
      <Typography.Text type="danger">{errorMessage}</Typography.Text>
    ) : description ? (
      <Typography.Text type="secondary">{description}</Typography.Text>
    ) : null}
  </label>
);

const Spinner: DesignSystemComponents["Spinner"] = ({
  label,
  size: spinSize,
  ...props
}) => (
  <span
    {...contentProps(props)}
    role={label ? "status" : undefined}
    aria-label={label}
  >
    <Spin
      size={
        spinSize === "compact"
          ? "small"
          : spinSize === "large"
            ? "large"
            : "default"
      }
      description={label}
    />
  </span>
);
const Skeleton: DesignSystemComponents["Skeleton"] = ({
  width,
  height,
  shape,
  ...props
}) => (
  <span aria-hidden="true">
    <AntSkeleton
      {...contentProps(props)}
      active
      style={{
        width,
        height,
        borderRadius: shape === "circle" ? "50%" : undefined,
      }}
    />
  </span>
);
const Status: DesignSystemComponents["Status"] = ({
  children,
  tone = "neutral",
  icon,
  ...props
}) => (
  <Tag {...contentProps(props)} color={tone === "danger" ? "error" : tone}>
    {icon}
    {children}
  </Tag>
);

const Surface: DesignSystemComponents["Surface"] = ({
  children,
  as = "div",
  elevation = "low",
  padding = "default",
  interactive,
  onPress,
  ...props
}) => {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPress?.(event);
  };
  return (
    <div
      {...contentProps(props)}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(event) => onPress?.(event)}
      onKeyDown={onKeyDown}
    >
      <Card
        variant={elevation === "none" ? "borderless" : "outlined"}
        styles={{
          body: {
            padding:
              padding === "none"
                ? 0
                : padding === "compact"
                  ? 12
                  : padding === "spacious"
                    ? 24
                    : 16,
          },
        }}
      >
        {children}
      </Card>
    </div>
  );
};

const Avatar: DesignSystemComponents["Avatar"] = ({
  name,
  src,
  fallback,
  size: avatarSize,
  status,
  ...props
}) => {
  const avatar = (
    <AntAvatar
      {...contentProps(props)}
      src={src ?? undefined}
      size={avatarSize === "compact" ? 28 : avatarSize === "large" ? 48 : 36}
    >
      {fallback ?? name.slice(0, 2).toUpperCase()}
    </AntAvatar>
  );
  return status ? (
    <Badge
      dot
      status={
        status === "online"
          ? "success"
          : status === "busy"
            ? "error"
            : status === "away"
              ? "warning"
              : "default"
      }
    >
      {avatar}
    </Badge>
  ) : (
    avatar
  );
};

const Tooltip: DesignSystemComponents["Tooltip"] = ({
  trigger,
  content,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  placement = "top",
  portalContainer,
  ...props
}) => (
  <AntTooltip
    {...contentProps(props)}
    title={content}
    open={disabled ? false : open}
    defaultOpen={defaultOpen}
    onOpenChange={onOpenChange}
    placement={placement}
    getPopupContainer={() => (portalContainer as HTMLElement) ?? document.body}
  >
    {trigger}
  </AntTooltip>
);

function dropdownItems(items: readonly MenuItem[]): Array<{
  key: string;
  label: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}> {
  return items.map((item) => ({
    key: String(item.id),
    label: (
      <>
        {item.icon}
        {item.label}
        {item.shortcut ? (
          <Typography.Text keyboard>{item.shortcut}</Typography.Text>
        ) : null}
      </>
    ),
    disabled: item.disabled,
    danger: item.intent === "danger",
    className: item.selected ? "ant-menu-item-selected" : undefined,
  }));
}

const Menu: DesignSystemComponents["Menu"] = ({
  trigger,
  items,
  sections,
  open,
  defaultOpen,
  onOpenChange,
  onAction,
  closeOnAction = true,
  ...props
}) => {
  const menuItems = sections
    ? sections.flatMap((section) => dropdownItems(section.items))
    : dropdownItems(items ?? []);
  const triggerWithClick = trigger as ReactElement<{
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  }>;
  const wrappedTrigger = cloneElement(triggerWithClick, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      triggerWithClick.props.onClick?.(event);
    },
  });
  return (
    <Dropdown
      {...contentProps(props)}
      menu={{
        items: menuItems,
        onClick: ({ key }) => {
          onAction(key);
          if (closeOnAction) onOpenChange?.(false);
        },
      }}
      open={open}
      onOpenChange={onOpenChange}
      trigger={["click"]}
    >
      {wrappedTrigger}
    </Dropdown>
  );
};

const Popover: DesignSystemComponents["Popover"] = ({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  dismissible = true,
  portalContainer,
  ...props
}) => (
  <AntPopover
    {...contentProps(props)}
    content={children}
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={(next) => {
      if (next || dismissible) onOpenChange?.(next);
    }}
    getPopupContainer={() => (portalContainer as HTMLElement) ?? document.body}
    trigger="click"
    placement={props.placement}
  >
    {trigger}
  </AntPopover>
);

const Dialog: DesignSystemComponents["Dialog"] = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  restoreFocusRef,
  portalContainer,
  ...props
}) => {
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      if (open) initialFocusRef?.current?.focus();
      else restoreFocusRef?.current?.focus();
    }, 0);
    return () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    };
  }, [open, initialFocusRef, restoreFocusRef]);
  return (
    <Modal
      {...contentProps(props)}
      open={open}
      title={title}
      footer={footer}
      closable={dismissible}
      mask={{ closable: dismissible }}
      keyboard={dismissible}
      getContainer={
        portalContainer ? () => portalContainer as HTMLElement : undefined
      }
      onCancel={() => {
        if (dismissible) onOpenChange(false);
      }}
    >
      {description ? (
        <Typography.Paragraph type="secondary">
          {description}
        </Typography.Paragraph>
      ) : null}
      {children}
    </Modal>
  );
};

const Picker: DesignSystemComponents["Picker"] = ({
  mode,
  options,
  value,
  onChange,
  label,
  description,
  errorMessage,
  placeholder,
  searchValue,
  onSearchChange,
  open,
  onOpenChange,
  loading,
  required,
  disabled,
  invalid,
  pickerRef,
  ...props
}) => (
  <label
    {...contentProps(props)}
    style={{ display: "grid", gap: 6, ...props.style }}
  >
    {label ? <Typography.Text strong>{label}</Typography.Text> : null}
    <>
      <Select
        ref={pickerRef as any}
        showSearch={mode === "combobox"}
        virtual={false}
        getPopupContainer={() => document.body}
        mode={undefined}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          disabled: option.disabled,
        }))}
        value={(value as any) ?? undefined}
        placeholder={placeholder}
        searchValue={searchValue}
        onSearch={onSearchChange}
        open={open}
        onOpenChange={onOpenChange}
        loading={loading}
        disabled={disabled}
        status={invalid ? "error" : undefined}
        onChange={(next) => onChange((next as typeof value) ?? null)}
      />
    </>
    {errorMessage ? (
      <Typography.Text type="danger">{errorMessage}</Typography.Text>
    ) : description ? (
      <Typography.Text type="secondary">{description}</Typography.Text>
    ) : null}
  </label>
);

const Checkbox: DesignSystemComponents["Checkbox"] = ({
  checked,
  onChange,
  label,
  description,
  indeterminate,
  disabled,
  invalid,
  inputRef,
  ...props
}) => (
  <span
    role="checkbox"
    aria-checked={checked}
    {...contentProps(props)}
    onClick={(event) => {
      if (event.target === event.currentTarget) onChange(!checked);
    }}
  >
    <AntCheckbox
      ref={inputRef as any}
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.checked)}
    >
      {label ?? description}
    </AntCheckbox>
  </span>
);
const Switch: DesignSystemComponents["Switch"] = ({
  checked,
  onChange,
  label,
  description,
  disabled,
  inputRef,
  ...props
}) => (
  <label
    {...contentProps(props)}
    style={{
      display: "inline-flex",
      gap: 8,
      alignItems: "center",
      ...props.style,
    }}
  >
    <span
      role="switch"
      aria-checked={checked}
      onClick={(event) => {
        if (event.target === event.currentTarget) onChange(!checked);
      }}
    >
      <AntSwitch
        ref={inputRef as any}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </span>
    {label ?? description}
  </label>
);
const Tabs: DesignSystemComponents["Tabs"] = ({
  items,
  value,
  onChange,
  ...props
}) => (
  <AntTabs
    {...contentProps(props)}
    activeKey={String(value)}
    onChange={(next) => {
      const selected = items.find((item) => String(item.value) === next);
      if (selected) onChange(selected.value);
    }}
    items={items.map((item) => ({
      key: String(item.value),
      label: item.label,
      children: item.content,
      disabled: item.disabled,
      icon: item.icon,
    }))}
  />
);

export const designSystem = defineDesignSystem({
  name: "Ant Design",
  theme,
  components: {
    ActionButton,
    IconButton,
    TextField,
    TextArea,
    Spinner,
    Skeleton,
    Status,
    Surface,
    Avatar,
    Tooltip,
    Menu,
    Popover,
    Dialog,
    Picker,
    Checkbox,
    Switch,
    Tabs,
  },
});

export { ConfigProvider };
