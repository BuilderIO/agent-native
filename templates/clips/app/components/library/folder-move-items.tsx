import { useT } from "@agent-native/core/client/i18n";
import type { ComponentType, ReactNode } from "react";

import type { BulkMoveTarget } from "./bulk-action-toolbar";

interface MenuItemProps {
  children?: ReactNode;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
}

interface MenuContainerProps {
  children?: ReactNode;
  className?: string;
}

/** The dropdown or context menu primitives to render folder rows with. */
export interface FolderMenuParts {
  Item: ComponentType<MenuItemProps>;
  Separator: ComponentType;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<MenuContainerProps>;
  SubContent: ComponentType<MenuContainerProps>;
}

interface FolderNode {
  target: BulkMoveTarget;
  children: FolderNode[];
}

// Targets arrive flattened depth-first with a `depth`; the library root has
// no depth and never has children.
function buildFolderTree(targets: BulkMoveTarget[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const stack: { depth: number; node: FolderNode }[] = [];
  for (const target of targets) {
    const node: FolderNode = { target, children: [] };
    if (target.id === null) {
      roots.push(node);
      continue;
    }
    const depth = target.depth ?? 0;
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    (parent ? parent.node.children : roots).push(node);
    stack.push({ depth, node });
  }
  return roots;
}

export function FolderMoveItems({
  parts,
  targets,
  disabled,
  onMove,
}: {
  parts: FolderMenuParts;
  targets: BulkMoveTarget[];
  disabled?: boolean;
  onMove: (folderId: string | null) => void;
}) {
  const t = useT();
  const { Item, Separator, Sub, SubTrigger, SubContent } = parts;

  const renderMoveRow = (
    key: string,
    target: BulkMoveTarget,
    label: ReactNode,
  ) => (
    <Item
      key={key}
      disabled={target.disabled || disabled}
      onSelect={() => onMove(target.id)}
    >
      <span className="truncate">{label}</span>
      {target.disabled ? (
        <span className="ms-auto text-xs text-muted-foreground">
          {t("clipsFinalRaw.current")}
        </span>
      ) : null}
    </Item>
  );

  const renderNode = (node: FolderNode, index: number): ReactNode => {
    const key = node.target.id ?? `root-${index}`;
    if (node.children.length === 0) {
      return renderMoveRow(key, node.target, node.target.name);
    }
    return (
      <Sub key={key}>
        <SubTrigger>
          <span className="truncate">{node.target.name}</span>
        </SubTrigger>
        <SubContent className="w-64">
          {renderMoveRow(
            `${key}-here`,
            node.target,
            t("clipsFinalRaw.moveHere"),
          )}
          <Separator />
          {node.children.map(renderNode)}
        </SubContent>
      </Sub>
    );
  };

  return <>{buildFolderTree(targets).map(renderNode)}</>;
}
