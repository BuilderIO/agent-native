import { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";

export function hashBlock(block: any): string {
  if (!block || !block.type) return "";

  const type = block.type;
  const data = block[type] || {};

  // Create a deterministic representation for comparison
  const repr: any = { type };

  // Common properties to compare
  if (data.rich_text) {
    repr.rich_text = data.rich_text.map((rt: any) => {
      const annotations: any = {};
      if (rt.annotations) {
        for (const [key, value] of Object.entries(rt.annotations)) {
          if (value && value !== false && value !== "default")
            annotations[key] = true;
        }
      }
      return {
        content: rt.text?.content || "",
        link: rt.text?.link?.url || rt.href || null,
        annotations,
      };
    });
  }

  if (type === "to_do") {
    repr.checked = data.checked || false;
  } else if (type === "code") {
    repr.language = data.language || "plain text";
  } else if (["image", "video", "file", "pdf"].includes(type)) {
    if (data.type && data[data.type]) {
      repr.url = data[data.type].url;
    } else if (data.external) {
      repr.url = data.external.url;
    } else if (data.file) {
      repr.url = data.file.url;
    }
  } else if (type === "equation") {
    repr.expression = data.expression || "";
  } else if (type === "bookmark") {
    repr.url = data.url || "";
  } else if (type === "callout") {
    repr.icon = data.icon || null;
    repr.color = data.color || "default";
  } else if (
    type === "heading_1" ||
    type === "heading_2" ||
    type === "heading_3"
  ) {
    repr.is_toggleable = data.is_toggleable || false;
    repr.color = data.color || "default";
  } else if (
    type === "bulleted_list_item" ||
    type === "numbered_list_item" ||
    type === "paragraph" ||
    type === "quote"
  ) {
    repr.color = data.color || "default";
  }

  return JSON.stringify(repr);
}

export type DiffOperation =
  | { type: "keep"; oldIndex: number; newIndex: number }
  | { type: "update"; oldIndex: number; newIndex: number }
  | { type: "insert"; newIndex: number }
  | { type: "delete"; oldIndex: number };

export function computeBlockDiff(
  oldBlocks: any[],
  newBlocks: any[],
): DiffOperation[] {
  const oldHashes = oldBlocks.map(hashBlock);
  const newHashes = newBlocks.map(hashBlock);

  const m = oldHashes.length;
  const n = newHashes.length;

  const c = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldHashes[i - 1] === newHashes[j - 1]) {
        c[i][j] = c[i - 1][j - 1] + 1;
      } else {
        c[i][j] = Math.max(c[i - 1][j], c[i][j - 1]);
      }
    }
  }

  const ops: any[] = [];
  let i = m,
    j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldHashes[i - 1] === newHashes[j - 1]) {
      ops.push({ type: "keep", oldIndex: i - 1, newIndex: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || c[i][j - 1] >= c[i - 1][j])) {
      ops.push({ type: "insert", newIndex: j - 1 });
      j--;
    } else if (i > 0 && (j === 0 || c[i][j - 1] < c[i - 1][j])) {
      ops.push({ type: "delete", oldIndex: i - 1 });
      i--;
    }
  }

  ops.reverse();

  // Coalescence optimization
  const coalescedOps: DiffOperation[] = [];
  let pendingDeletes: number[] = [];
  let pendingInserts: number[] = [];

  const flush = () => {
    while (pendingDeletes.length > 0 && pendingInserts.length > 0) {
      let matched = false;
      for (let di = 0; di < pendingDeletes.length; di++) {
        for (let ii = 0; ii < pendingInserts.length; ii++) {
          const oIdx = pendingDeletes[di];
          const nIdx = pendingInserts[ii];
          if (oldBlocks[oIdx].type === newBlocks[nIdx].type) {
            coalescedOps.push({
              type: "update",
              oldIndex: oIdx,
              newIndex: nIdx,
            });
            pendingDeletes.splice(di, 1);
            pendingInserts.splice(ii, 1);
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (!matched) break;
    }

    for (const oldIndex of pendingDeletes) {
      coalescedOps.push({ type: "delete", oldIndex });
    }
    for (const newIndex of pendingInserts) {
      coalescedOps.push({ type: "insert", newIndex });
    }
    pendingDeletes = [];
    pendingInserts = [];
  };

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "keep") {
      flush();
      coalescedOps.push(op);
    } else if (op.type === "delete") {
      pendingDeletes.push(op.oldIndex);
    } else if (op.type === "insert") {
      pendingInserts.push(op.newIndex);
    }
  }
  flush();

  return coalescedOps;
}
