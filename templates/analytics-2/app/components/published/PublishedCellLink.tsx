import { useEffect, useRef, useState } from "react";

import { parseCellLinkHash } from "@/lib/cell-link";

/**
 * Brings the cell a copied link names into view on the published app, once the
 * cells have rendered and again when the address changes on the same page. A
 * link naming a cell that is not shown, or a malformed fragment, does nothing.
 */
export function PublishedCellLink({
  projectId,
  cellIds,
}: {
  projectId: string;
  cellIds: readonly string[];
}) {
  const [target, setTarget] = useState(() =>
    parseCellLinkHash(window.location.hash),
  );
  const restored = useRef<string | null>(null);
  useEffect(() => {
    const read = () => setTarget(parseCellLinkHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (target === null) {
      restored.current = null;
      return;
    }
    const key = `${projectId}:${target}`;
    if (restored.current === key || !cellIds.includes(target)) return;
    restored.current = key;
    document
      .querySelector<HTMLElement>(
        `[data-published-cell="${CSS.escape(target)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }, [target, cellIds, projectId]);
  return null;
}
