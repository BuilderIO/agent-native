import { Fragment, type ComponentProps, type Key, type ReactNode } from "react";

import { cn } from "../../utils.js";
import { Heading } from "./heading.js";
import {
  Inspector,
  InspectorContent,
  InspectorHeader,
  InspectorSection,
  InspectorSectionHeader,
} from "./inspector.js";

export interface DesignPropertyInspectorProps extends ComponentProps<
  typeof Inspector
> {
  /** Workspace-level actions, displayed independently of the current selection. */
  collaboration?: ReactNode;
  /** Reset transient field and popover state when the inspected objects change. */
  selectionKey?: Key;
  /** Keep locked properties inspectable while preserving selection actions and export. */
  readOnly?: boolean;
  /** Selection identity and actions, such as its element type and code preview. */
  selection?: ReactNode;
  /** Consumer-owned instance controls between the selection and property groups. */
  component?: ReactNode;
  /** Standard groups render in document inspection order; omit groups that do not apply. */
  sections?: Partial<
    Record<
      | "position"
      | "layout"
      | "appearance"
      | "typography"
      | "fill"
      | "stroke"
      | "effects"
      | "responsive"
      | "export",
      ReactNode
    >
  >;
}

/** A slot-based inspector for design documents. Keep document values and undo history in the host.
 * @import import { DesignPropertyInspector } from "@agent-native/toolkit/ui/base-ui/design-property-inspector";
 */
export function DesignPropertyInspector({
  collaboration,
  selectionKey,
  readOnly,
  selection,
  component,
  sections,
  children,
  className,
  ...props
}: DesignPropertyInspectorProps) {
  const properties = (
    <>
      {component}
      {(
        [
          "position",
          "layout",
          "appearance",
          "typography",
          "fill",
          "stroke",
          "effects",
          "responsive",
        ] as const
      ).map((key) => (
        <Fragment key={key}>{sections?.[key]}</Fragment>
      ))}
    </>
  );
  return (
    <Inspector
      {...props}
      className={cn("design-property-inspector", className)}
    >
      {collaboration && (
        <InspectorHeader className="design-property-inspector-collaboration">
          {collaboration}
        </InspectorHeader>
      )}
      {selection}
      <Fragment key={selectionKey}>
        {readOnly ? (
          <fieldset className="design-property-inspector-locked" disabled>
            {properties}
          </fieldset>
        ) : (
          properties
        )}
        {sections?.export}
      </Fragment>
      {children}
    </Inspector>
  );
}

export interface DesignSelectionHeaderProps extends ComponentProps<
  typeof InspectorHeader
> {
  actions?: ReactNode;
}
/** Element or selection heading with trailing contextual actions.
 * @import import { DesignSelectionHeader } from "@agent-native/toolkit/ui/base-ui/design-property-inspector";
 */
export function DesignSelectionHeader({
  children,
  actions,
  className,
  ...props
}: DesignSelectionHeaderProps) {
  return (
    <InspectorHeader
      {...props}
      className={cn("design-property-inspector-selection", className)}
    >
      {children}
      {actions}
    </InspectorHeader>
  );
}

export interface DesignPropertySectionProps extends Omit<
  ComponentProps<typeof InspectorSection>,
  "title"
> {
  title: ReactNode;
  actions?: ReactNode;
}
/** A compact property group with an optional body and trailing controls.
 * @import import { DesignPropertySection } from "@agent-native/toolkit/ui/base-ui/design-property-inspector";
 */
export function DesignPropertySection({
  title,
  actions,
  children,
  className,
  ...props
}: DesignPropertySectionProps) {
  return (
    <InspectorSection
      {...props}
      className={cn("design-property-inspector-section", className)}
    >
      <InspectorSectionHeader>
        <Heading as="h3" textStyle="label">
          {title}
        </Heading>
        {actions}
      </InspectorSectionHeader>
      {children != null && <InspectorContent>{children}</InspectorContent>}
    </InspectorSection>
  );
}

export {
  DesignSelectionProperties,
  type DesignSelectionPropertiesProps,
  type DesignLayerGeometry,
  type DesignLayerIdentity,
} from "./design-selection-properties.js";
