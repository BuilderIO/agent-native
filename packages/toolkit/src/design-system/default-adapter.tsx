import { IconSearch } from "@tabler/icons-react";
import {
  createElement,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar.js";
import { Badge } from "../ui/badge.js";
import { ButtonBase } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Checkbox as DefaultCheckboxPrimitive } from "../ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Input } from "../ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Skeleton as DefaultSkeletonPrimitive } from "../ui/skeleton.js";
import { Spinner as DefaultSpinnerPrimitive } from "../ui/spinner.js";
import { Switch as DefaultSwitchPrimitive } from "../ui/switch.js";
import {
  Tabs as DefaultTabsPrimitive,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import type { DesignSystemComponents, MenuItem } from "./types.js";

function buttonVariant(
  intent: "primary" | "neutral" | "danger" = "neutral",
  emphasis: "solid" | "outline" | "ghost" = "solid",
) {
  if (emphasis === "ghost") return "ghost" as const;
  if (emphasis === "outline") return "outline" as const;
  if (intent === "primary") return "default" as const;
  if (intent === "danger") return "destructive" as const;
  return "secondary" as const;
}

function buttonSize(size: "compact" | "default" | "large" = "default") {
  if (size === "compact") return "sm" as const;
  if (size === "large") return "lg" as const;
  return "default" as const;
}

const DefaultActionButton: DesignSystemComponents["ActionButton"] = ({
  children,
  intent,
  emphasis,
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
  <ButtonBase
    {...props}
    ref={elementRef}
    type={type}
    variant={buttonVariant(intent, emphasis)}
    size={buttonSize(size)}
    disabled={disabled || pending}
    onClick={(event) => onPress?.(event)}
  >
    {pending ? <DefaultSpinnerPrimitive aria-hidden="true" /> : leadingIcon}
    {children}
    {trailingIcon}
  </ButtonBase>
);

const DefaultIconButton: DesignSystemComponents["IconButton"] = ({
  label,
  icon,
  intent,
  emphasis = "ghost",
  size,
  pending,
  disabled,
  type = "button",
  onPress,
  elementRef,
  ...props
}) => (
  <ButtonBase
    {...props}
    ref={elementRef}
    type={type}
    variant={buttonVariant(intent, emphasis)}
    size="icon"
    disabled={disabled || pending}
    onClick={(event) => onPress?.(event)}
    aria-label={label}
    data-size={size}
  >
    {pending ? <DefaultSpinnerPrimitive aria-hidden="true" /> : icon}
  </ButtonBase>
);

function FieldShell({
  label,
  description,
  errorMessage,
  className,
  style,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <label className={cn("grid gap-1.5", className)} style={style}>
      {label ? <span className="text-sm font-medium">{label}</span> : null}
      {children}
      {errorMessage ? (
        <span className="text-xs text-destructive" role="alert">
          {errorMessage}
        </span>
      ) : description ? (
        <span className="text-xs text-muted-foreground">{description}</span>
      ) : null}
    </label>
  );
}

const DefaultTextField: DesignSystemComponents["TextField"] = ({
  value,
  onChange,
  label,
  description,
  errorMessage,
  invalid,
  inputRef,
  leadingContent,
  trailingContent,
  className,
  style,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}) => (
  <FieldShell
    label={label}
    description={description}
    errorMessage={errorMessage}
    className={className}
    style={style}
  >
    <div className="flex items-center gap-2">
      {leadingContent}
      <Input
        {...props}
        ref={inputRef}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      {trailingContent}
    </div>
  </FieldShell>
);

const DefaultTextArea: DesignSystemComponents["TextArea"] = ({
  value,
  onChange,
  label,
  description,
  errorMessage,
  invalid,
  textAreaRef,
  className,
  style,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}) => (
  <FieldShell
    label={label}
    description={description}
    errorMessage={errorMessage}
    className={className}
    style={style}
  >
    <Textarea
      {...props}
      ref={textAreaRef}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    />
  </FieldShell>
);

const DefaultSpinner: DesignSystemComponents["Spinner"] = ({
  label,
  size,
  ...props
}) => (
  <DefaultSpinnerPrimitive
    {...props}
    aria-label={label}
    data-size={size}
    role={label ? "status" : undefined}
  />
);

const DefaultSkeleton: DesignSystemComponents["Skeleton"] = ({
  width,
  height,
  shape = "rectangle",
  style,
  ...props
}) => (
  <DefaultSkeletonPrimitive
    {...props}
    aria-hidden="true"
    style={{ width, height, ...style }}
    data-shape={shape}
  />
);

const DefaultStatus: DesignSystemComponents["Status"] = ({
  children,
  tone = "neutral",
  icon,
  size,
  ...props
}) => (
  <Badge
    {...props}
    variant={tone === "danger" ? "destructive" : "secondary"}
    data-tone={tone}
    data-size={size}
  >
    {icon}
    {children}
  </Badge>
);

const DefaultSurface: DesignSystemComponents["Surface"] = ({
  children,
  as = "div",
  elevation = "low",
  padding = "default",
  interactive,
  onPress,
  className,
  ...props
}) => {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPress?.(event);
  };
  const elementProps = {
    ...props,
    className: cn(
      "rounded-lg border bg-card text-card-foreground",
      elevation === "none" && "shadow-none",
      elevation === "low" && "shadow-sm",
      elevation === "medium" && "shadow-md",
      padding === "compact" && "p-3",
      padding === "default" && "p-4",
      padding === "spacious" && "p-6",
      interactive && "cursor-pointer",
      className,
    ),
    onClick: (event: ReactMouseEvent<HTMLElement>) => onPress?.(event),
    onKeyDown,
    role: interactive ? "button" : undefined,
    tabIndex: interactive ? 0 : undefined,
    children,
  };
  if (as === "div") return <Card {...elementProps} />;
  return createElement(as, elementProps);
};

const DefaultAvatar: DesignSystemComponents["Avatar"] = ({
  name,
  src,
  fallback,
  size,
  status,
  imageRef,
  ...props
}) => (
  <Avatar {...props} data-size={size} data-status={status}>
    {src ? <AvatarImage ref={imageRef} src={src} alt={name} /> : null}
    <AvatarFallback>
      {fallback ?? name.slice(0, 2).toUpperCase()}
    </AvatarFallback>
  </Avatar>
);

const DefaultTooltip: DesignSystemComponents["Tooltip"] = ({
  trigger,
  content,
  open,
  defaultOpen,
  onOpenChange,
  delayMs,
  disabled,
  portalContainer,
  placement = "top",
  align = "center",
  collisionPadding,
  className,
  style,
}) => {
  if (disabled) return trigger;
  return (
    <TooltipProvider delayDuration={delayMs}>
      <Tooltip
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
      >
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          container={portalContainer}
          side={placement}
          align={align}
          collisionPadding={collisionPadding}
          className={className}
          style={style}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

function DefaultMenuItems({
  items,
  onAction,
}: {
  items: readonly MenuItem[];
  onAction: (id: string | number) => void;
}) {
  return items.map((item) =>
    item.children?.length ? (
      <DropdownMenuSub key={item.id}>
        <DropdownMenuSubTrigger disabled={item.disabled}>
          {item.icon}
          {item.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DefaultMenuItems items={item.children} onAction={onAction} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem
        key={item.id}
        disabled={item.disabled}
        onSelect={() => onAction(item.id)}
        className={item.intent === "danger" ? "text-destructive" : undefined}
      >
        {item.icon}
        <span className="min-w-0 flex-1">{item.label}</span>
        {item.shortcut ? (
          <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
        ) : null}
      </DropdownMenuItem>
    ),
  );
}

const DefaultMenu: DesignSystemComponents["Menu"] = ({
  trigger,
  items,
  sections,
  open,
  defaultOpen,
  onOpenChange,
  onAction,
  portalContainer,
  placement = "bottom",
  align = "start",
  collisionPadding,
  className,
  style,
}) => (
  <DropdownMenu
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={onOpenChange}
  >
    <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
    <DropdownMenuContent
      container={portalContainer}
      side={placement}
      align={align}
      collisionPadding={collisionPadding}
      className={className}
      style={style}
    >
      {sections ? (
        sections.map((section, index) => (
          <div key={section.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {section.label ? (
              <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
            ) : null}
            <DefaultMenuItems items={section.items} onAction={onAction} />
          </div>
        ))
      ) : items ? (
        <DefaultMenuItems items={items} onAction={onAction} />
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);

const DefaultPopover: DesignSystemComponents["Popover"] = ({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  modal,
  dismissible = true,
  portalContainer,
  placement = "bottom",
  align = "center",
  collisionPadding,
  className,
  style,
}) => (
  <Popover
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={onOpenChange}
    modal={modal}
  >
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent
      container={portalContainer}
      side={placement}
      align={align}
      collisionPadding={collisionPadding}
      className={className}
      style={style}
      onEscapeKeyDown={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (!dismissible) event.preventDefault();
      }}
    >
      {children}
    </PopoverContent>
  </Popover>
);

const DefaultDialog: DesignSystemComponents["Dialog"] = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  trigger,
  size = "medium",
  dismissible = true,
  closeLabel,
  initialFocusRef,
  restoreFocusRef,
  portalContainer,
  className,
  style,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
    <DialogContent
      container={portalContainer}
      hideClose={!dismissible}
      closeLabel={closeLabel}
      className={className}
      style={style}
      data-size={size}
      onOpenAutoFocus={(event) => {
        if (!initialFocusRef?.current) return;
        event.preventDefault();
        initialFocusRef.current.focus();
      }}
      onCloseAutoFocus={(event) => {
        if (!restoreFocusRef?.current) return;
        event.preventDefault();
        restoreFocusRef.current.focus();
      }}
      onEscapeKeyDown={(event) => {
        if (!dismissible) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      {children}
      {footer ? <DialogFooter>{footer}</DialogFooter> : null}
    </DialogContent>
  </Dialog>
);

const DefaultPicker: DesignSystemComponents["Picker"] = ({
  mode,
  options,
  value,
  onChange,
  label,
  description,
  errorMessage,
  placeholder,
  searchValue = "",
  onSearchChange,
  open,
  onOpenChange,
  emptyContent,
  loadingContent,
  loading,
  required,
  disabled,
  invalid,
  pickerRef,
  portalContainer,
  className,
  style,
  ...props
}) => {
  const selected = options.find((option) => option.value === value);
  const filtered =
    mode === "combobox" && searchValue
      ? options.filter((option) =>
          [option.textValue, option.label, ...(option.keywords ?? [])]
            .filter((part): part is string => typeof part === "string")
            .join(" ")
            .toLowerCase()
            .includes(searchValue.toLowerCase()),
        )
      : options;

  if (mode === "select") {
    return (
      <FieldShell
        label={label}
        description={description}
        errorMessage={errorMessage}
        className={className}
        style={style}
      >
        <Select
          value={value == null ? undefined : String(value)}
          open={open}
          onOpenChange={onOpenChange}
          onValueChange={(next) => {
            const option = options.find(
              (candidate) => String(candidate.value) === next,
            );
            onChange(option?.value ?? null);
          }}
          required={required}
          disabled={disabled}
        >
          <SelectTrigger
            {...props}
            ref={pickerRef as Ref<HTMLButtonElement>}
            aria-invalid={invalid || undefined}
          >
            <SelectValue placeholder={placeholder}>
              {selected?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent container={portalContainer}>
            {loading
              ? loadingContent
              : options.length
                ? options.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={String(option.value)}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </SelectItem>
                  ))
                : emptyContent}
          </SelectContent>
        </Select>
      </FieldShell>
    );
  }

  return (
    <FieldShell
      label={label}
      description={description}
      errorMessage={errorMessage}
      className={className}
      style={style}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <ButtonBase
            ref={pickerRef as Ref<HTMLButtonElement>}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
          >
            {selected?.label ?? placeholder}
          </ButtonBase>
        </PopoverTrigger>
        <PopoverContent container={portalContainer} className="w-72 p-2">
          <label className="flex items-center gap-2 border-b px-2 pb-2">
            <IconSearch className="size-4 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(event) => onSearchChange?.(event.currentTarget.value)}
              className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
            />
          </label>
          <div className="max-h-64 overflow-auto py-1" role="listbox">
            {loading
              ? loadingContent
              : filtered.length
                ? filtered.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      disabled={option.disabled}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => {
                        onChange(option.value);
                        onOpenChange?.(false);
                      }}
                    >
                      {option.icon}
                      <span>{option.label}</span>
                    </button>
                  ))
                : emptyContent}
          </div>
        </PopoverContent>
      </Popover>
    </FieldShell>
  );
};

const DefaultCheckbox: DesignSystemComponents["Checkbox"] = ({
  checked,
  onChange,
  label,
  description,
  indeterminate,
  inputRef,
  ...props
}) => (
  <label className="flex items-start gap-2">
    <DefaultCheckboxPrimitive
      {...props}
      ref={inputRef}
      checked={indeterminate ? "indeterminate" : checked}
      onCheckedChange={(next) => onChange(next === true)}
    />
    {label || description ? (
      <span className="grid gap-0.5">
        {label ? <span className="text-sm">{label}</span> : null}
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    ) : null}
  </label>
);

const DefaultSwitch: DesignSystemComponents["Switch"] = ({
  checked,
  onChange,
  label,
  description,
  inputRef,
  ...props
}) => (
  <label className="flex items-start gap-2">
    <DefaultSwitchPrimitive
      {...props}
      ref={inputRef}
      checked={checked}
      onCheckedChange={onChange}
    />
    {label || description ? (
      <span className="grid gap-0.5">
        {label ? <span className="text-sm">{label}</span> : null}
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    ) : null}
  </label>
);

const DefaultTabs: DesignSystemComponents["Tabs"] = ({
  items,
  value,
  onChange,
  orientation,
  activationMode,
  className,
  style,
  ...props
}) => (
  <DefaultTabsPrimitive
    {...props}
    value={String(value)}
    onValueChange={(next) => {
      const item = items.find((candidate) => String(candidate.value) === next);
      if (item) onChange(item.value);
    }}
    orientation={orientation}
    activationMode={activationMode}
    className={className}
    style={style}
  >
    <TabsList>
      {items.map((item) => (
        <TabsTrigger
          key={item.value}
          value={String(item.value)}
          disabled={item.disabled}
        >
          {item.icon}
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
    {items.map((item) => (
      <TabsContent key={item.value} value={String(item.value)}>
        {item.content}
      </TabsContent>
    ))}
  </DefaultTabsPrimitive>
);

export const defaultDesignSystemComponents: DesignSystemComponents = {
  ActionButton: DefaultActionButton,
  IconButton: DefaultIconButton,
  TextField: DefaultTextField,
  TextArea: DefaultTextArea,
  Spinner: DefaultSpinner,
  Skeleton: DefaultSkeleton,
  Status: DefaultStatus,
  Surface: DefaultSurface,
  Avatar: DefaultAvatar,
  Tooltip: DefaultTooltip,
  Menu: DefaultMenu,
  Popover: DefaultPopover,
  Dialog: DefaultDialog,
  Picker: DefaultPicker,
  Checkbox: DefaultCheckbox,
  Switch: DefaultSwitch,
  Tabs: DefaultTabs,
};
