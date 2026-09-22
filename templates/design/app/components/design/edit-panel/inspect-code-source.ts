import type { ElementProvenance } from "@shared/source-mode";

export interface InspectCodeSourceLocation {
  /**
   * Path exactly as reported by the runtime. This can be project-relative on
   * ordinary Vite URLs, so it must not automatically become a vscode:// link.
   */
  filePath: string;
  /** Absolute paths are safe to expose through the local-editor deep link. */
  absolutePath?: string;
  line?: number;
  column?: number;
  componentName?: string;
  method?: ElementProvenance["method"];
  owner?: {
    filePath: string;
    line?: number;
    column?: number;
    componentName?: string;
    key?: string;
    method?: ElementProvenance["ownerMethod"];
  };
}

interface InspectableElement {
  tagName: string;
  id?: string;
  classes: string[];
  provenance?: ElementProvenance;
}

function isAbsoluteSourcePath(filePath: string): boolean {
  return (
    filePath.startsWith("/") ||
    filePath.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  );
}

/**
 * Preserve the live bridge's compiler/debug provenance for the inspector.
 * A missing file remains unavailable; a React 19 debug-stack line remains
 * explicitly labelled as runtime-transformed instead of being presented as an
 * authored JSX position.
 */
export function inspectCodeSourceLocation(
  provenance: ElementProvenance | null | undefined,
): InspectCodeSourceLocation | null {
  if (!provenance) return null;
  const filePath = provenance.sourceFile?.trim();
  if (!filePath) return null;

  const ownerFilePath = provenance.ownerSourceFile?.trim();
  return {
    filePath,
    ...(isAbsoluteSourcePath(filePath) ? { absolutePath: filePath } : {}),
    ...(provenance.line ? { line: provenance.line } : {}),
    ...(provenance.column ? { column: provenance.column } : {}),
    ...(provenance.component ? { componentName: provenance.component } : {}),
    ...(provenance.method ? { method: provenance.method } : {}),
    ...(ownerFilePath
      ? {
          owner: {
            filePath: ownerFilePath,
            ...(provenance.ownerLine ? { line: provenance.ownerLine } : {}),
            ...(provenance.ownerColumn
              ? { column: provenance.ownerColumn }
              : {}),
            ...(provenance.ownerComponentName
              ? { componentName: provenance.ownerComponentName }
              : {}),
            ...(provenance.ownerKey ? { key: provenance.ownerKey } : {}),
            ...(provenance.ownerMethod
              ? { method: provenance.ownerMethod }
              : {}),
          },
        }
      : {}),
  };
}

export function inspectCodeDataForElement(
  element: InspectableElement,
  html: string | null | undefined,
) {
  return {
    html,
    tagName: element.tagName,
    id: element.id,
    classes: element.classes,
    sourceLocation: inspectCodeSourceLocation(element.provenance),
  };
}
