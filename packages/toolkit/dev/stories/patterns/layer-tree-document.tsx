import { useState } from "react";

import {
  LayerTree,
  type LayerRecord,
} from "../../../src/ui/base-ui/layer-tree.js";

export function LargeDocumentPanel({
  windowed = true,
  nested = false,
}: {
  windowed?: boolean;
  nested?: boolean;
}) {
  const [items, setItems] = useState<LayerRecord[]>(() => {
    if (nested)
      return Array.from({ length: 10_000 }, (_, i) => ({
        id: String(i),
        name: "Group " + (i + 1),
        parentId: i === 0 ? null : String(i - 1),
        container: true,
      }));
    return Array.from({ length: 100 }, (_, g) => {
      const group = "Section " + (g + 1);
      return [
        { id: group, name: group, parentId: null, container: true },
        ...Array.from({ length: 99 }, (_, i) => ({
          id: group + "/" + i,
          name: "Layer " + (i + 1),
          parentId: group,
        })),
      ];
    }).flat();
  });
  return (
    <div className="max-w-80">
      <LayerTree
        aria-label="Document layers"
        viewportHeight={windowed ? 384 : undefined}
        style={{ height: 384, overflowY: "auto" }}
        items={items}
        defaultExpanded={items
          .filter((item) => item.container)
          .map((item) => item.id)}
        onItemsChange={setItems}
        getActionLabel={(action, item) =>
          action[0].toUpperCase() + action.slice(1) + " " + item.name
        }
      />
    </div>
  );
}
