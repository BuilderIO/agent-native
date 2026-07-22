import type { DesignSystemComponents } from "@agent-native/toolkit/design-system";
import {
  defineDesignSystem,
  defineTheme,
} from "@agent-native/toolkit/design-system";
import type {
  DesignSystemKey,
  MenuItem,
  PickerOption,
  DesignSystemSize,
} from "@agent-native/toolkit/design-system";
import {
  Alert,
  Avatar as MuiAvatar,
  Badge,
  Box,
  Button as MuiButton,
  Checkbox as MuiCheckbox,
  Chip,
  CircularProgress,
  Dialog as MuiDialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton as MuiIconButton,
  InputLabel,
  InputAdornment,
  Menu as MuiMenu,
  MenuItem as MuiMenuItem,
  Paper,
  Popover as MuiPopover,
  Select as MuiSelect,
  Skeleton as MuiSkeleton,
  Switch as MuiSwitch,
  Tab,
  Tabs as MuiTabs,
  TextField as MuiTextField,
  Tooltip as MuiTooltip,
  Typography,
  createTheme,
} from "@mui/material";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  cloneElement,
} from "react";

const muiSize = (size?: DesignSystemSize) =>
  size === "compact" ? "small" : size === "large" ? "large" : "medium";

const muiColor = (intent?: "primary" | "neutral" | "danger") =>
  intent === "danger" ? "error" : intent === "primary" ? "primary" : "inherit";

const muiLightTheme = createTheme({ palette: { mode: "light" } });
const muiDarkTheme = createTheme({ palette: { mode: "dark" } });

const muiPalette = (muiTheme: typeof muiLightTheme) => ({
  background: muiTheme.palette.background.default,
  foreground: muiTheme.palette.text.primary,
  card: muiTheme.palette.background.paper,
  "card-foreground": muiTheme.palette.text.primary,
  popover: muiTheme.palette.background.paper,
  "popover-foreground": muiTheme.palette.text.primary,
  primary: muiTheme.palette.primary.main,
  "primary-foreground": muiTheme.palette.primary.contrastText,
  secondary: muiTheme.palette.secondary.main,
  "secondary-foreground": muiTheme.palette.secondary.contrastText,
  muted: muiTheme.palette.action.hover,
  "muted-foreground": muiTheme.palette.text.secondary,
  accent: muiTheme.palette.action.selected,
  "accent-foreground": muiTheme.palette.text.primary,
  border: muiTheme.palette.divider,
  input: muiTheme.palette.divider,
  ring: muiTheme.palette.primary.main,
  destructive: muiTheme.palette.error.main,
  "destructive-foreground": muiTheme.palette.error.contrastText,
});

const palette = {
  light: muiPalette(muiLightTheme),
  dark: muiPalette(muiDarkTheme),
} as const;

export const theme = defineTheme({
  colors: palette,
  radius: `${muiLightTheme.shape.borderRadius}px`,
  typography: {
    fontFamily: muiLightTheme.typography.fontFamily,
    monoFontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
});

export { muiLightTheme, muiDarkTheme };

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
  size,
  pending,
  disabled,
  type = "button",
  leadingIcon,
  trailingIcon,
  onPress,
  elementRef,
  ...props
}) => (
  <MuiButton
    {...contentProps(props)}
    ref={elementRef}
    type={type}
    variant={
      emphasis === "outline"
        ? "outlined"
        : emphasis === "ghost"
          ? "text"
          : "contained"
    }
    color={muiColor(intent)}
    size={muiSize(size)}
    disabled={disabled || pending}
    startIcon={pending ? <CircularProgress size={16} /> : leadingIcon}
    endIcon={trailingIcon}
    onClick={(event) => onPress?.(event)}
  >
    {children}
  </MuiButton>
);

const IconButton: DesignSystemComponents["IconButton"] = ({
  label,
  icon,
  intent,
  pending,
  disabled,
  size,
  onPress,
  elementRef,
  ...props
}) => (
  <MuiIconButton
    {...contentProps(props)}
    ref={elementRef}
    aria-label={label}
    color={muiColor(intent)}
    size={muiSize(size)}
    disabled={disabled || pending}
    onClick={(event) => onPress?.(event)}
  >
    {pending ? <CircularProgress size={16} /> : icon}
  </MuiIconButton>
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
  list,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}) => (
  <MuiTextField
    {...contentProps(props)}
    label={label}
    helperText={errorMessage ?? description}
    error={invalid}
    value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    onBlur={onBlur}
    onFocus={onFocus}
    onKeyDown={onKeyDown}
    inputRef={inputRef}
    slotProps={{
      htmlInput: { list },
      input: {
        startAdornment: leadingContent ? (
          <InputAdornment position="start">{leadingContent}</InputAdornment>
        ) : undefined,
        endAdornment: trailingContent ? (
          <InputAdornment position="end">{trailingContent}</InputAdornment>
        ) : undefined,
      },
    }}
  />
);

const TextArea: DesignSystemComponents["TextArea"] = ({
  value,
  onChange,
  label,
  description,
  errorMessage,
  invalid,
  textAreaRef,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}) => (
  <MuiTextField
    {...contentProps(props)}
    label={label}
    helperText={errorMessage ?? description}
    error={invalid}
    multiline
    value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    onBlur={onBlur}
    onFocus={onFocus}
    onKeyDown={onKeyDown}
    inputRef={textAreaRef}
  />
);

const Spinner: DesignSystemComponents["Spinner"] = ({
  label,
  size,
  ...props
}) => (
  <CircularProgress
    {...contentProps(props)}
    size={size === "compact" ? 16 : size === "large" ? 28 : 20}
    aria-label={label}
    role={label ? "status" : undefined}
  />
);

const Skeleton: DesignSystemComponents["Skeleton"] = ({
  width,
  height,
  shape = "rectangle",
  ...props
}) => (
  <MuiSkeleton
    {...contentProps(props)}
    variant={
      shape === "circle"
        ? "circular"
        : shape === "line"
          ? "text"
          : "rectangular"
    }
    width={width}
    height={height}
    aria-hidden="true"
  />
);

const Status: DesignSystemComponents["Status"] = ({
  children,
  tone = "neutral",
  icon,
  size,
  ...props
}) => (
  <Chip
    {...contentProps(props)}
    icon={icon as ReactElement | undefined}
    label={children}
    size={size === "compact" ? "small" : "medium"}
    color={
      tone === "danger"
        ? "error"
        : tone === "success"
          ? "success"
          : tone === "warning"
            ? "warning"
            : tone === "info"
              ? "info"
              : "default"
    }
  />
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
    <Paper
      {...contentProps(props)}
      component={as}
      elevation={elevation === "none" ? 0 : elevation === "medium" ? 4 : 1}
      sx={{
        p:
          padding === "none"
            ? 0
            : padding === "compact"
              ? 1.5
              : padding === "spacious"
                ? 3
                : 2,
      }}
      onClick={(event: ReactMouseEvent<HTMLElement>) => onPress?.(event)}
      onKeyDown={onKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {children}
    </Paper>
  );
};

const Avatar: DesignSystemComponents["Avatar"] = ({
  name,
  src,
  fallback,
  size,
  status,
  imageRef,
  ...props
}) => {
  const avatar = (
    <MuiAvatar
      {...contentProps(props)}
      ref={imageRef}
      src={src ?? undefined}
      alt={name}
      sx={{
        width: size === "compact" ? 28 : size === "large" ? 48 : 36,
        height: size === "compact" ? 28 : size === "large" ? 48 : 36,
      }}
    >
      {fallback ?? name.slice(0, 2).toUpperCase()}
    </MuiAvatar>
  );
  if (!status) return avatar;
  return (
    <Badge
      color={
        status === "online"
          ? "success"
          : status === "busy"
            ? "error"
            : status === "away"
              ? "warning"
              : "default"
      }
      variant="dot"
    >
      {avatar}
    </Badge>
  );
};

const overlayContainer = (portalContainer?: Element | null) =>
  portalContainer ?? undefined;

const Tooltip: DesignSystemComponents["Tooltip"] = ({
  trigger,
  content,
  open,
  defaultOpen,
  onOpenChange,
  delayMs,
  disabled,
  placement = "top",
  portalContainer,
  ...props
}) => (
  <MuiTooltip
    {...contentProps(props)}
    title={content}
    open={disabled ? false : open}
    onOpen={() => onOpenChange?.(true)}
    onClose={() => onOpenChange?.(false)}
    enterDelay={delayMs}
    placement={placement}
    disableHoverListener={disabled}
    slotProps={{ popper: { container: overlayContainer(portalContainer) } }}
  >
    {trigger}
  </MuiTooltip>
);

function menuItems(
  items: readonly MenuItem[],
  onAction: (id: DesignSystemKey) => void,
  close: () => void,
  closeOnAction: boolean,
): ReactNode {
  return items.map((item) =>
    item.children?.length ? (
      <MuiMenuItem
        key={item.id}
        disabled={item.disabled}
        selected={item.selected}
        onClick={() => {
          onAction(item.id);
          if (closeOnAction) close();
        }}
      >
        {item.icon}
        {item.label}
      </MuiMenuItem>
    ) : (
      <MuiMenuItem
        key={item.id}
        disabled={item.disabled}
        selected={item.selected}
        onClick={() => {
          onAction(item.id);
          if (closeOnAction) close();
        }}
      >
        {item.icon}
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          {item.label}
        </Box>
        {item.shortcut}
      </MuiMenuItem>
    ),
  );
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
  const anchorRef = useRef<HTMLElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const triggerWithClick = trigger as ReactElement<{
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  }>;
  const wrappedTrigger = cloneElement(triggerWithClick, {
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      anchorRef.current = event.currentTarget;
      triggerWithClick.props.onClick?.(event);
      setOpen(true);
    },
  });
  return (
    <>
      <span
        ref={(node) => {
          anchorRef.current ??= node;
        }}
      >
        {wrappedTrigger}
      </span>
      <MuiMenu
        open={isOpen}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        container={overlayContainer(props.portalContainer)}
      >
        {sections
          ? sections.flatMap((section) =>
              menuItems(
                section.items,
                onAction,
                () => setOpen(false),
                closeOnAction,
              ),
            )
          : items
            ? menuItems(items, onAction, () => setOpen(false), closeOnAction)
            : null}
      </MuiMenu>
    </>
  );
};

const Popover: DesignSystemComponents["Popover"] = ({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  dismissible = true,
  initialFocusRef,
  restoreFocusRef,
  ...props
}) => {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? internalOpen;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isOpen) initialFocusRef?.current?.focus();
      else restoreFocusRef?.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [initialFocusRef, isOpen, restoreFocusRef]);
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const triggerWithClick = trigger as ReactElement<{
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  }>;
  const wrappedTrigger = cloneElement(triggerWithClick, {
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      anchorRef.current = event.currentTarget;
      triggerWithClick.props.onClick?.(event);
      setOpen(true);
    },
  });
  return (
    <>
      <span
        ref={(node) => {
          anchorRef.current ??= node;
        }}
      >
        {wrappedTrigger}
      </span>
      <MuiPopover
        open={isOpen}
        anchorEl={anchorRef.current}
        onClose={() => {
          if (dismissible) setOpen(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        container={overlayContainer(props.portalContainer)}
      >
        <Box sx={{ p: 1 }} {...contentProps(props)}>
          {children}
        </Box>
      </MuiPopover>
    </>
  );
};

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
  const { className, style, ...accessibleProps } = contentProps(props);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (open) initialFocusRef?.current?.focus();
      else restoreFocusRef?.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, initialFocusRef, restoreFocusRef]);
  return (
    <MuiDialog
      {...accessibleProps}
      open={open}
      container={overlayContainer(portalContainer)}
      disableAutoFocus={Boolean(initialFocusRef)}
      disableRestoreFocus={Boolean(restoreFocusRef)}
      slotProps={{
        paper: {
          className,
          style,
        },
        transition: {
          onEntered: () => initialFocusRef?.current?.focus(),
          onExited: () => restoreFocusRef?.current?.focus(),
        },
      }}
      onClose={(_event, reason) => {
        if (
          dismissible ||
          (reason !== "backdropClick" && reason !== "escapeKeyDown")
        )
          onOpenChange(false);
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {description ? (
          <Typography color="text.secondary" sx={{ mb: 1 }}>
            {description}
          </Typography>
        ) : null}
        {children}
      </DialogContent>
      {footer ? <DialogActions>{footer}</DialogActions> : null}
    </MuiDialog>
  );
};

const Picker: DesignSystemComponents["Picker"] = ({
  options,
  value,
  onChange,
  label,
  description,
  errorMessage,
  placeholder,
  open,
  onOpenChange,
  loading,
  required,
  disabled,
  invalid,
  pickerRef,
  portalContainer,
  ...props
}) => (
  <FormControl
    fullWidth
    required={required}
    disabled={disabled}
    error={invalid}
    {...contentProps(props)}
  >
    {label ? <InputLabel>{label}</InputLabel> : null}
    <MuiSelect
      ref={pickerRef as never}
      label={label}
      value={value == null ? "" : String(value)}
      displayEmpty
      open={open}
      onOpen={() => onOpenChange?.(true)}
      onClose={() => onOpenChange?.(false)}
      onChange={(event) =>
        onChange(
          options.find((option) => String(option.value) === event.target.value)
            ?.value ?? null,
        )
      }
      MenuProps={{ container: overlayContainer(portalContainer) }}
      renderValue={(selected) =>
        selected
          ? options.find((option) => String(option.value) === String(selected))
              ?.label
          : (placeholder ?? "Select")
      }
    >
      {loading ? (
        <MuiMenuItem value="" disabled>
          Loading…
        </MuiMenuItem>
      ) : (
        options.map((option) => (
          <MuiMenuItem
            key={String(option.value)}
            value={String(option.value)}
            disabled={option.disabled}
          >
            {option.icon}
            {option.label}
          </MuiMenuItem>
        ))
      )}
    </MuiSelect>
    {errorMessage ? (
      <Typography color="error" variant="caption">
        {errorMessage}
      </Typography>
    ) : description ? (
      <Typography color="text.secondary" variant="caption">
        {description}
      </Typography>
    ) : null}
  </FormControl>
);

const Checkbox: DesignSystemComponents["Checkbox"] = ({
  checked,
  onChange,
  label,
  description,
  indeterminate,
  required,
  disabled,
  invalid,
  inputRef,
  ...props
}) => (
  <FormControl
    error={invalid}
    required={required}
    disabled={disabled}
    {...contentProps(props)}
  >
    <FormControlLabel
      control={
        <MuiCheckbox
          checked={checked}
          indeterminate={indeterminate}
          slotProps={{
            input: {
              ref: inputRef as unknown as Ref<HTMLInputElement>,
              role: "checkbox",
              "aria-invalid": invalid || undefined,
            },
          }}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
      label={label ?? description}
    />
  </FormControl>
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
  <FormControlLabel
    {...contentProps(props)}
    control={
      <MuiSwitch
        checked={checked}
        disabled={disabled}
        slotProps={{
          input: {
            ref: inputRef as unknown as Ref<HTMLInputElement>,
            role: "switch",
          },
        }}
        onChange={(event) => onChange(event.target.checked)}
      />
    }
    label={label ?? description}
  />
);

const Tabs: DesignSystemComponents["Tabs"] = ({
  items,
  value,
  onChange,
  orientation,
  ...props
}) => (
  <Box {...contentProps(props)}>
    <MuiTabs
      value={value}
      orientation={orientation}
      onChange={(_event, next) => onChange(next)}
    >
      {items.map((item) => (
        <Tab
          key={item.value}
          value={item.value}
          label={item.label}
          icon={item.icon as ReactElement | undefined}
          iconPosition={item.icon ? "start" : undefined}
          disabled={item.disabled}
        />
      ))}
    </MuiTabs>
    {items.find((item) => item.value === value)?.content}
  </Box>
);

export const designSystem = defineDesignSystem({
  name: "Material UI",
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
