function computeLCSOps(oldBlocks: any[], newBlocks: any[]) {
  function hashBlock(b: any) {
    const type = b.type;
    return JSON.stringify({ type, content: b[type] });
  }

  const m = oldBlocks.length;
  const n = newBlocks.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (hashBlock(oldBlocks[i - 1]) === hashBlock(newBlocks[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const ops: any[] = [];

  while (i > 0 && j > 0) {
    if (hashBlock(oldBlocks[i - 1]) === hashBlock(newBlocks[j - 1])) {
      ops.push({ type: "keep", oldIndex: i - 1, newIndex: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      ops.push({ type: "delete", oldIndex: i - 1 });
      i--;
    } else {
      ops.push({ type: "insert", newIndex: j - 1 });
      j--;
    }
  }

  while (i > 0) {
    ops.push({ type: "delete", oldIndex: i - 1 });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "insert", newIndex: j - 1 });
    j--;
  }
  
  ops.reverse();

  // Optimize adjacent delete + insert of same type into update
  for (let k = 0; k < ops.length - 1; k++) {
    if (ops[k].type === "delete" && ops[k+1].type === "insert") {
      if (oldBlocks[ops[k].oldIndex].type === newBlocks[ops[k+1].newIndex].type) {
        ops[k] = { type: "update", oldIndex: ops[k].oldIndex, newIndex: ops[k+1].newIndex };
        ops.splice(k+1, 1);
      }
    } else if (ops[k].type === "insert" && ops[k+1].type === "delete") {
      if (newBlocks[ops[k].newIndex].type === oldBlocks[ops[k+1].oldIndex].type) {
        ops[k] = { type: "update", oldIndex: ops[k+1].oldIndex, newIndex: ops[k].newIndex };
        ops.splice(k+1, 1);
      }
    }
  }

  return ops;
}

const old = [
  { type: "p", p: "A" },
  { type: "p", p: "B" },
  { type: "p", p: "C" }
];
const newB = [
  { type: "p", p: "A" },
  { type: "p", p: "B2" },
  { type: "p", p: "C" },
  { type: "p", p: "D" }
];

console.log(computeLCSOps(old, newB));
