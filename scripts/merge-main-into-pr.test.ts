import { describe, expect, it } from "vitest";

import {
  decide,
  EXIT,
  mergeMainIntoPr,
  type Deps,
} from "./merge-main-into-pr.ts";

const state = (mergeable: string, mergeStateStatus: string) => ({
  mergeable,
  mergeStateStatus,
  headRefOid: "abc",
  baseRefName: "main",
});

describe("merge-main-into-pr decide", () => {
  it("allows a conflicting PR", () => {
    expect(decide(state("CONFLICTING", "DIRTY"))).toEqual({ allowed: true });
  });

  it("allows a dirty merge state", () => {
    expect(decide(state("MERGEABLE", "DIRTY"))).toEqual({ allowed: true });
  });

  it("refuses a PR that is only behind main", () => {
    const d = decide(state("MERGEABLE", "BEHIND"));
    expect(d.allowed).toBe(false);
  });

  it("refuses a green or blocked PR with no conflict", () => {
    expect(decide(state("MERGEABLE", "CLEAN")).allowed).toBe(false);
    expect(decide(state("MERGEABLE", "BLOCKED")).allowed).toBe(false);
  });

  it("refuses while mergeability is unknown instead of guessing", () => {
    const d = decide({ ...state("UNKNOWN", "UNKNOWN"), baseRefName: "" });
    expect(d).toMatchObject({ allowed: false });
    expect(d.allowed === false && d.reason).toMatch(/UNKNOWN/);
  });

  it("refuses a conflicting PR whose base is not main", () => {
    const d = decide({
      ...state("CONFLICTING", "DIRTY"),
      baseRefName: "integrate",
    });
    expect(d.allowed === false && d.reason).toMatch(/integrate/);
  });
});

describe("merge-main-into-pr exit codes", () => {
  const conflicting = state("CONFLICTING", "DIRTY");
  const make = (over: Partial<Deps> & { unmerged?: string } = {}) => {
    const logs: string[] = [];
    const deps: Deps = {
      readState: () => conflicting,
      run: (args) => {
        if (args[1] === "status") return { status: 0, stdout: "" };
        if (args[1] === "rev-parse") return { status: 0, stdout: "abc" };
        if (args[1] === "diff")
          return { status: 0, stdout: over.unmerged ?? "" };
        return { status: 0, stdout: "" };
      },
      merge: () => 0,
      log: (m) => logs.push(m),
      ...over,
    };
    return { deps, logs };
  };

  it("exits 0 on a clean merge", () => {
    expect(mergeMainIntoPr(["1"], make().deps)).toBe(EXIT.ok);
  });

  it("exits 0 for --check on a conflicting PR without touching git", () => {
    const { deps } = make({
      run: () => {
        throw new Error("git must not run");
      },
    });
    expect(mergeMainIntoPr(["1", "--check"], deps)).toBe(EXIT.ok);
  });

  it("exits 1 only when unmerged paths remain", () => {
    const { deps } = make({ merge: () => 1, unmerged: "a.ts\nb.ts" });
    expect(mergeMainIntoPr(["1"], deps)).toBe(EXIT.conflicts);
  });

  it("exits 4 when git merge fails with no unresolved conflicts", () => {
    const { deps } = make({ merge: () => 128 });
    expect(mergeMainIntoPr(["1"], deps)).toBe(EXIT.mergeFailed);
  });

  it("exits 5 when the GitHub query throws (gh or JSON failure)", () => {
    const { deps, logs } = make({
      readState: () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    expect(mergeMainIntoPr(["1"], deps)).toBe(EXIT.githubFailed);
    expect(logs[0]).toMatch(/github query failed/);
  });

  it("exits 3 when there is no conflict", () => {
    const { deps } = make({ readState: () => state("MERGEABLE", "BEHIND") });
    expect(mergeMainIntoPr(["1"], deps)).toBe(EXIT.refused);
  });

  it("exits 2 on usage, dirty tree, wrong HEAD and fetch failure", () => {
    expect(mergeMainIntoPr([], make().deps)).toBe(EXIT.precondition);
    const dirty = make({
      run: (a) => ({ status: 0, stdout: a[1] === "status" ? " M x" : "abc" }),
    });
    expect(mergeMainIntoPr(["1"], dirty.deps)).toBe(EXIT.precondition);
    let merged = false;
    const statusFailed = make({
      run: (a) => ({
        status: a[1] === "status" ? 128 : 0,
        stdout: a[1] === "rev-parse" ? "abc" : "",
      }),
      merge: () => {
        merged = true;
        return 0;
      },
    });
    expect(mergeMainIntoPr(["1"], statusFailed.deps)).toBe(EXIT.precondition);
    expect(merged).toBe(false);
    const wrongHead = make({
      run: (a) => ({ status: 0, stdout: a[1] === "status" ? "" : "zzz" }),
    });
    expect(mergeMainIntoPr(["1"], wrongHead.deps)).toBe(EXIT.precondition);
    const noFetch = make({
      run: (a) =>
        a[1] === "fetch"
          ? { status: 1, stdout: "" }
          : { status: 0, stdout: a[1] === "rev-parse" ? "abc" : "" },
    });
    expect(mergeMainIntoPr(["1"], noFetch.deps)).toBe(EXIT.precondition);
  });

  it("excludes agent bookkeeping paths from the clean-tree check", () => {
    const seen: string[][] = [];
    const { deps } = make({
      run: (a) => {
        seen.push(a);
        return { status: 0, stdout: a[1] === "rev-parse" ? "abc" : "" };
      },
    });
    mergeMainIntoPr(["1"], deps);
    expect(seen[0].join(" ")).toContain(":(top,exclude)learnings.md");
  });
});
