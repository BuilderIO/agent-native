import {
  cloneElement,
  createElement,
  useEffect,
  type CSSProperties,
  type ElementType,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import type { DesignSystemComponents } from "../../design-system/types.js";

const css = {
  control: {
    border: "1px solid rgb(80 80 90)",
    borderRadius: 6,
    background: "rgb(250 250 252)",
    color: "rgb(20 20 24)",
    padding: "6px 10px",
    font: "inherit",
  } satisfies CSSProperties,
  overlay: {
    position: "fixed",
    inset: "20% auto auto 20%",
    zIndex: 120,
    border: "1px solid rgb(80 80 90)",
    borderRadius: 8,
    background: "white",
    color: "black",
    padding: 12,
  } satisfies CSSProperties,
  stack: {
    display: "grid",
    gap: 6,
  } satisfies CSSProperties,
};

function portal(content: ReactElement, container?: Element | null) {
  return container
    ? createPortal(content, container)
    : createPortal(content, document.body);
}

export const cssInJsFixtureAdapter: DesignSystemComponents = {
  ActionButton: ({
    children,
    leadingIcon,
    trailingIcon,
    pending,
    disabled,
    onPress,
    elementRef,
    style,
    ...props
  }) => (
    <button
      {...props}
      ref={elementRef}
      disabled={disabled || pending}
      onClick={(event) => onPress?.(event)}
      style={{ ...css.control, ...style }}
    >
      {pending ? "Waiting" : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  ),
  IconButton: ({
    label,
    icon,
    pending,
    disabled,
    onPress,
    elementRef,
    style,
    ...props
  }) => (
    <button
      {...props}
      ref={elementRef}
      aria-label={label}
      disabled={disabled || pending}
      onClick={(event) => onPress?.(event)}
      style={{ ...css.control, ...style }}
    >
      {pending ? "Waiting" : icon}
    </button>
  ),
  TextField: ({
    value,
    onChange,
    label,
    description,
    errorMessage,
    inputRef,
    leadingContent,
    trailingContent,
    style,
    onKeyDown,
    ...props
  }) => (
    <label style={{ ...css.stack, ...style }}>
      {label}
      <span>
        {leadingContent}
        <input
          {...props}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          style={css.control}
        />
        {trailingContent}
      </span>
      {errorMessage ?? description}
    </label>
  ),
  TextArea: ({
    value,
    onChange,
    label,
    description,
    errorMessage,
    textAreaRef,
    style,
    onKeyDown,
    ...props
  }) => (
    <label style={{ ...css.stack, ...style }}>
      {label}
      <textarea
        {...props}
        ref={textAreaRef}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        style={css.control}
      />
      {errorMessage ?? description}
    </label>
  ),
  Spinner: ({ label, size: _size, ...props }) => (
    <span {...props} role={label ? "status" : undefined} aria-label={label}>
      Loading
    </span>
  ),
  Skeleton: ({ width, height, shape: _shape, style, ...props }) => (
    <span
      {...props}
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        background: "silver",
        ...style,
      }}
    />
  ),
  Status: ({ children, icon, tone: _tone, size: _size, ...props }) => (
    <span {...props}>
      {icon}
      {children}
    </span>
  ),
  Surface: ({
    children,
    as = "div",
    interactive,
    onPress,
    elevation: _elevation,
    padding: _padding,
    style,
    ...props
  }) => {
    const Element = as as ElementType;
    return (
      <Element
        {...props}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onPress}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (interactive && (event.key === "Enter" || event.key === " "))
            onPress?.(event);
        }}
        style={{ border: "1px solid gray", padding: 8, ...style }}
      >
        {children}
      </Element>
    );
  },
  Avatar: ({
    name,
    src,
    fallback,
    imageRef,
    size: _size,
    status: _status,
    ...props
  }) => (
    <span {...props}>
      {src ? (
        <img ref={imageRef} src={src} alt={name} />
      ) : (
        (fallback ?? name.slice(0, 2))
      )}
    </span>
  ),
  Tooltip: ({
    trigger,
    content,
    open,
    defaultOpen,
    disabled,
    portalContainer,
  }) => (
    <>
      {trigger}
      {!disabled && (open ?? defaultOpen)
        ? portal(
            <div role="tooltip" style={css.overlay}>
              {content}
            </div>,
            portalContainer,
          )
        : null}
    </>
  ),
  Menu: ({
    trigger,
    items = [],
    sections = [],
    open,
    defaultOpen,
    onAction,
    portalContainer,
  }) => (
    <>
      {trigger}
      {(open ?? defaultOpen)
        ? portal(
            <div role="menu" style={css.overlay}>
              {[...items, ...sections.flatMap((section) => section.items)].map(
                (item) => (
                  <button
                    key={item.id}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => onAction(item.id)}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            portalContainer,
          )
        : null}
    </>
  ),
  Popover: ({ trigger, children, open, defaultOpen, portalContainer }) => (
    <>
      {trigger}
      {(open ?? defaultOpen)
        ? portal(
            <div role="dialog" style={css.overlay}>
              {children}
            </div>,
            portalContainer,
          )
        : null}
    </>
  ),
  Dialog: ({
    open,
    title,
    description,
    children,
    footer,
    trigger,
    portalContainer,
    initialFocusRef,
    restoreFocusRef,
  }) => {
    useEffect(() => {
      if (open) initialFocusRef?.current?.focus();
      return () => restoreFocusRef?.current?.focus();
    }, [initialFocusRef, open, restoreFocusRef]);
    return (
      <>
        {trigger}
        {open
          ? portal(
              <div role="dialog" aria-modal="true" style={css.overlay}>
                <h2>{title}</h2>
                {description ? <p>{description}</p> : null}
                {children}
                {footer}
              </div>,
              portalContainer,
            )
          : null}
      </>
    );
  },
  Picker: ({
    options,
    value,
    onChange,
    label,
    open,
    portalContainer,
    ...props
  }) => (
    <label>
      {label}
      <button
        {...props}
        role="combobox"
        aria-expanded={open}
        style={css.control}
      >
        {options.find((option) => option.value === value)?.label ?? "Choose"}
      </button>
      {open
        ? portal(
            <div role="listbox" style={css.overlay}>
              {options.map((option) => (
                <button
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onClick={() => onChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            portalContainer,
          )
        : null}
    </label>
  ),
  Checkbox: ({ checked, onChange, label, inputRef, ...props }) => (
    <button
      {...props}
      ref={inputRef}
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={css.control}
    >
      {label}
    </button>
  ),
  Switch: ({ checked, onChange, label, inputRef, ...props }) => (
    <button
      {...props}
      ref={inputRef}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={css.control}
    >
      {label}
    </button>
  ),
  Tabs: ({ items, value, onChange, orientation }) => (
    <div>
      <div role="tablist" aria-orientation={orientation}>
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={item.value === value}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) =>
        item.value === value ? (
          <div key={item.value} role="tabpanel">
            {item.content}
          </div>
        ) : null,
      )}
    </div>
  ),
};

export function CloneTrigger({ trigger }: { trigger: ReactElement }) {
  return cloneElement(trigger);
}
