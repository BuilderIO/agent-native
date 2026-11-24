import { Slot } from "@radix-ui/react-slot";
import {
  createContext,
  cloneElement,
  forwardRef,
  isValidElement,
  useContext,
  type ReactNode,
  type ReactElement,
  type ComponentType,
  type HTMLAttributes,
  type Ref,
  type ComponentPropsWithRef,
} from "react";

import type {
  NavigationEntry,
  ShellContentOwner,
  ShellEffect,
  ShellIdentity,
  ShellModel,
  SidebarPartProps,
} from "./contracts.js";

export interface ShellMenuControlProps extends HTMLAttributes<HTMLElement> {
  ref?: Ref<HTMLElement>;
  entry: NavigationEntry;
  ownerKey?: string | undefined;
  disabled: boolean;
  /** Compose the existing menu primitive onto this control; do not add another control. */
  children: ReactElement;
}
export interface ShellGeneratedOwnerProps {
  identity: ShellIdentity;
  /** Generated opener/header controls, for the retained owner's leading/header position. */
  header: ReactNode;
  /** Generated descendants and retained content, already ordered and visibility-controlled. */
  children: ReactNode;
}
export interface ShellMenuEditorProps extends Omit<
  ComponentPropsWithRef<"input">,
  "value" | "onChange" | "children"
> {
  entry: NavigationEntry;
  value: string;
  onValueChange: (value: string) => void;
}
export interface ShellNavigationOwnerProps {
  children: (scope: SidebarPartProps & { host: ShellHost }) => ReactNode;
}
export interface ShellHost {
  /** App-owned symbol components. Unknown keys keep the point and expose a fallback marker. */
  symbols?: Readonly<Record<string, ComponentType<{ className?: string }>>>;
  navigationOwners?: Readonly<
    Record<string, ComponentType<ShellNavigationOwnerProps>>
  >;
  menuEditors?: Readonly<Record<string, ComponentType<ShellMenuEditorProps>>>;
  generatedOwners?: Readonly<
    Record<string, ComponentType<ShellGeneratedOwnerProps>>
  >;
  menuControls?: Readonly<Record<string, ComponentType<ShellMenuControlProps>>>;
  pathname: string;
  navigate?: (effect: Extract<ShellEffect, { kind: "navigate" }>) => void;
  close?: (surface: "mobile" | "peek" | "menu") => void;
  slots?: Readonly<Record<string, ReactNode>>;
  labels?: {
    navigation?: string;
    retry?: string;
    reorder?: (name: string) => string;
  };
}
const HostContext = createContext<ShellHost>({ pathname: "/" });
/** Slots contain page/custom bodies, never navigation decisions or row markup. */
export function ShellHostProvider({
  value,
  children,
}: {
  value: ShellHost;
  children: ReactNode;
}) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}
export const useShellHost = () => useContext(HostContext);
export function ShellContent({ content }: { content: ShellContentOwner }) {
  const { slots } = useShellHost();
  if (slots && Object.hasOwn(slots, content.key))
    return (
      <div
        data-shell-slot={content.key}
        data-shell-owner={content.owner}
        data-shell-reason={"reason" in content ? content.reason : undefined}
        className="contents"
      >
        {slots[content.key]}
      </div>
    );
  if (content.owner === "model" || content.owner === "kit") return null;
  throw new Error(
    `Missing shell content slot: ${content.key} (${content.owner})`,
  );
}

const ShellMenuControlTarget = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement> & {
    element: ReactElement<HTMLAttributes<HTMLElement>>;
  }
>(({ element, children, ...props }, ref) => (
  <Slot {...props} ref={ref}>
    {cloneElement(element, {
      ...(props.id !== undefined && Object.hasOwn(element.props, "id")
        ? { id: props.id }
        : {}),
      ...(props["aria-expanded"] !== undefined &&
      Object.hasOwn(element.props, "aria-expanded")
        ? { "aria-expanded": props["aria-expanded"] }
        : {}),
      ...(props["aria-haspopup"] !== undefined &&
      Object.hasOwn(element.props, "aria-haspopup")
        ? { "aria-haspopup": props["aria-haspopup"] }
        : {}),
      ...(props["aria-controls"] !== undefined &&
      Object.hasOwn(element.props, "aria-controls")
        ? { "aria-controls": props["aria-controls"] }
        : {}),
      children,
    })}
  </Slot>
));
ShellMenuControlTarget.displayName = "ShellMenuControlTarget";

export function ShellMenuControl({
  entry,
  ownerKey,
  disabled,
  children,
  ref,
  ...controlProps
}: ShellMenuControlProps) {
  const host = useShellHost();
  if (!isValidElement<HTMLAttributes<HTMLElement>>(children))
    throw new Error("Shell menu owner requires one generated control");
  const control = (
    <ShellMenuControlTarget {...controlProps} element={children} ref={ref}>
      {children.props.children}
    </ShellMenuControlTarget>
  );
  if (ownerKey === undefined) return control;
  const Owner =
    host.menuControls && Object.hasOwn(host.menuControls, ownerKey)
      ? host.menuControls[ownerKey]
      : undefined;
  if (!Owner) throw new Error(`Missing shell menu owner: ${ownerKey}`);
  if (
    entry.search ||
    entry.choices ||
    typeof entry.binding?.value === "string" ||
    entry.rename?.editing.value
  )
    throw new Error(`Unsupported shell menu control: ${entry.id}`);
  return (
    <Owner entry={entry} disabled={disabled}>
      {control}
    </Owner>
  );
}

/** Both looks use the same optional controller seam; it adds no DOM or row identity. */
export function ShellGeneratedOwner({
  ownerKey,
  identity,
  header,
  children,
}: ShellGeneratedOwnerProps & { ownerKey?: string | undefined }) {
  const host = useShellHost();
  if (ownerKey === undefined)
    return (
      <>
        {header}
        {children}
      </>
    );
  const Owner =
    host.generatedOwners && Object.hasOwn(host.generatedOwners, ownerKey)
      ? host.generatedOwners[ownerKey]
      : undefined;
  if (!Owner) throw new Error(`Missing shell generated owner: ${ownerKey}`);
  return (
    <Owner identity={identity} header={header}>
      {children}
    </Owner>
  );
}
export function shellFrameAttributes(frame: ShellModel["frame"]) {
  return {
    ...(frame.identity
      ? {
          "data-rid": frame.identity.id,
          "data-rid-key": frame.identity.entityKey,
          "data-rid-container": frame.identity.containerId,
        }
      : {}),
    "data-pointer-cursors": frame.preferences?.pointerCursors
      ? "true"
      : undefined,
    "data-underline-links": frame.preferences?.underlineLinks
      ? "true"
      : undefined,
  };
}

/** The retained collection supplies its native editor; no second filter controller. */
export function ShellMenuEditor({
  ownerKey,
  ...props
}: ShellMenuEditorProps & { ownerKey: string }) {
  const host = useShellHost();
  const Editor =
    host.menuEditors && Object.hasOwn(host.menuEditors, ownerKey)
      ? host.menuEditors[ownerKey]
      : undefined;
  if (!Editor) throw new Error(`Missing shell menu editor: ${ownerKey}`);
  return <Editor {...props} />;
}
export function ShellNavigationScope({
  ownerKey,
  children,
}: {
  ownerKey: string;
  children: (scope: SidebarPartProps) => ReactNode;
}) {
  const host = useShellHost();
  const Owner =
    host.navigationOwners && Object.hasOwn(host.navigationOwners, ownerKey)
      ? host.navigationOwners[ownerKey]
      : undefined;
  if (!Owner) throw new Error(`Missing shell navigation owner: ${ownerKey}`);
  return (
    <Owner>
      {({ host: scopedHost, ...scope }) => (
        <ShellHostProvider
          value={{
            ...scopedHost,
            close: (surface) => {
              if (surface === "mobile") host.close?.(surface);
              scopedHost.close?.(surface);
            },
          }}
        >
          {children(scope)}
        </ShellHostProvider>
      )}
    </Owner>
  );
}
