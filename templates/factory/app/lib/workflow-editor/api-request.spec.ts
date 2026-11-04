import { describe, expect, it } from "vitest";

import { argsForOperation } from "@/components/workflow-canvas/inspector/OperationFields";
import { WORKFLOW_CATALOG } from "@/components/workflow/workflow-catalog";

import {
  activeOptions,
  annotateApiRequestIssues,
  API_REQUEST_OPTIONS,
  apiRequestOperationFor,
  apiRequestOperations,
  apiRequestProblems,
  apiRequestShape,
  applyCurlImport,
  authenticationOf,
  availableOptions,
  fitsRows,
  hasEmptyPath,
  hasLeftOut,
  isPlainBinding,
  leftOutOf,
  objectOf,
  optionBlock,
  optionName,
  pathOfUrl,
  pathProblem,
  paginationOf,
  paginationValue,
  paramsEnabled,
  reconcileRows,
  requestPathOf,
  rowProblems,
  rowsMatch,
  rowsOf,
  splitQueryFromPath,
  withAuthentication,
  withFieldsToKeep,
  withOption,
  withoutOption,
  withParams,
  withParamsEnabled,
  withSplitPath,
  type ApiRequestArgs,
  type ApiRequestShape,
  type ParamRow,
} from "./api-request";
import { parseCurlImport } from "./curl-import";
import { defaultArgs } from "./defaults";
import { createWorkflowEditor } from "./editor";
import {
  workflowGraphSchema,
  workflowNodeSchema,
  type WorkflowNode,
} from "./engine";

const github = apiRequestOperationFor(WORKFLOW_CATALOG, "github");
const posthog = apiRequestOperationFor(WORKFLOW_CATALOG, "posthog");

function shapeOf(def: typeof github): ApiRequestShape {
  const shape = apiRequestShape(def);
  if (!shape) throw new Error("not an API request operation");
  return shape;
}

const shape = shapeOf(github);
const fixed = (value: unknown) => ({ mode: "fixed" as const, value });

let counter = 0;
const nextId = () => `row${(counter += 1)}`;
const row = (name: string, value: string): ParamRow => ({
  id: nextId(),
  name,
  value,
});

function lookup(operation: string, args: ApiRequestArgs): WorkflowNode {
  return workflowNodeSchema.parse({
    id: "n1",
    name: "n1",
    kind: "lookup",
    position: { x: 0, y: 0 },
    settings: { operation, args },
  });
}

describe("the operations the form serves", () => {
  it("is every provider's apiRequest lookup and nothing else", () => {
    const defs = apiRequestOperations(WORKFLOW_CATALOG);
    expect(defs.length).toBeGreaterThanOrEqual(11);
    for (const def of defs) {
      expect(def.id).toBe(`${def.provider}.apiRequest`);
      expect(def.nodeKinds).toEqual(["lookup"]);
      expect(def.effect).toBe("read");
    }
    expect(apiRequestShape(WORKFLOW_CATALOG.get("slack.postMessage"))).toBe(
      undefined,
    );
    expect(apiRequestShape(undefined)).toBe(undefined);
  });

  it("reads the connection's placeholders from the operation, per provider", () => {
    expect(shapeOf(posthog).placeholders).toEqual(["projectId"]);
    expect(shape.placeholders).toEqual([]);
  });
});

describe("what the form writes", () => {
  // Compared against the operation as the catalog declares it, so a renamed
  // or retyped field fails here instead of saving something the engine
  // never reads.
  const fieldType = (name: string) =>
    github?.fields.find((field) => field.name === name)?.type;

  it("uses only the operation's own field names, with the types it declares", () => {
    let args: ApiRequestArgs = defaultArgs(github!);
    args = withAuthentication(shape, args, "none");
    args = withParamsEnabled(shape, args, "query", true);
    args = withParams(shape, args, "query", { state: "open" });
    args = withParamsEnabled(shape, args, "headers", true);
    args = withParams(shape, args, "headers", { "X-Request-Id": "a" });
    for (const option of API_REQUEST_OPTIONS) {
      args = withOption(shape, args, option);
    }
    const names = new Set(github?.fields.map((field) => field.name));
    for (const name of Object.keys(args)) expect(names.has(name)).toBe(true);

    const written = (name: string | undefined) => {
      const binding = name === undefined ? undefined : args[name];
      expect(binding?.mode).toBe("fixed");
      return binding?.mode === "fixed" ? binding.value : undefined;
    };
    expect(fieldType(shape.fields.path)).toBe("string");
    expect(typeof written(shape.fields.path)).toBe("string");
    expect(fieldType(shape.fields.auth!)).toBe("enum");
    expect(
      github?.fields.find((field) => field.name === shape.fields.auth)?.enum,
    ).toContain(written(shape.fields.auth));
    for (const role of ["query", "headers", "pagination"] as const) {
      expect(fieldType(shape.fields[role]!)).toBe("json");
      expect(typeof written(shape.fields[role])).toBe("object");
    }
    expect(fieldType(shape.fields.timeoutSeconds!)).toBe("number");
    expect(typeof written(shape.fields.timeoutSeconds)).toBe("number");
    expect(fieldType(shape.fields.includeStatus!)).toBe("boolean");
    expect(written(shape.fields.includeStatus)).toBe(true);
    const keep = optionName(shape, "fieldsToKeep");
    expect(keep).toBeDefined();
    args = withFieldsToKeep(shape, args, ["number", "user.login"]);
    expect(fieldType(keep!)).toBe("json");
    expect(written(keep)).toEqual(["number", "user.login"]);
  });

  it("produces a node the catalog's own checks accept", () => {
    let args: ApiRequestArgs = defaultArgs(github!);
    args = { ...args, [shape.fields.path]: fixed("repos/acme/web/issues") };
    args = withParamsEnabled(shape, args, "query", true);
    args = withParams(shape, args, "query", { state: "open" });
    args = withOption(shape, args, "timeout");
    expect(apiRequestProblems(shape, args)).toEqual([]);
    expect(() => lookup("github.apiRequest", args)).not.toThrow();
  });

  it("starts a new step with only the path, which is the one field with no default", () => {
    expect(Object.keys(defaultArgs(github!))).toEqual([shape.fields.path]);
  });
});

describe("authentication", () => {
  it("is the provider's own sign-in unless the step says none", () => {
    const args = defaultArgs(github!);
    expect(authenticationOf(shape, args)).toBe("provider");
    const none = withAuthentication(shape, args, "none");
    expect(authenticationOf(shape, none)).toBe("none");
    expect(
      authenticationOf(shape, withAuthentication(shape, none, "provider")),
    ).toBe("provider");
    expect(
      shape.fields.auth! in withAuthentication(shape, none, "provider"),
    ).toBe(false);
  });
});

describe("query parameter and header rows", () => {
  it("makes one row per parameter and repeats the name of a list", () => {
    const rows = rowsOf({ state: "open", labels: ["a", "b"], page: 2 }, nextId);
    expect(rows.map(({ name, value }) => [name, value])).toEqual([
      ["state", "open"],
      ["labels", "a"],
      ["labels", "b"],
      ["page", "2"],
    ]);
    expect(rowsOf("not an object", nextId)).toEqual([]);
    expect(rowsOf(undefined, nextId)).toEqual([]);
  });

  it("saves rows as an object and leaves out a row with no name", () => {
    const rows = [row("state", "open"), row("", "stray"), row("label", "a")];
    expect(objectOf("query", rows)).toEqual({ state: "open", label: "a" });
  });

  it("turns a repeated query name into a list, and keeps the last of a repeated header", () => {
    const rows = [row("label", "a"), row("label", "b")];
    expect(objectOf("query", rows)).toEqual({ label: ["a", "b"] });
    expect(objectOf("headers", rows)).toEqual({ label: "b" });
  });

  it("knows the rows already say what is saved, so its own echo does not rebuild them", () => {
    const rows = [row("per_page", "50")];
    expect(rowsMatch("query", rows, { per_page: 50 })).toBe(true);
    expect(rowsMatch("query", rows, { per_page: 60 })).toBe(false);
    expect(rowsMatch("query", [], {})).toBe(true);
  });

  it("keeps a saved object that does not fit rows in the JSON editor", () => {
    expect(fitsRows(undefined)).toBe(true);
    expect(fitsRows({ a: "x", b: 2, c: true, d: ["x", 1] })).toBe(true);
    expect(fitsRows({ a: { nested: 1 } })).toBe(false);
    expect(fitsRows({ a: [{ n: 1 }] })).toBe(false);
    expect(fitsRows(["a"])).toBe(false);
    expect(fitsRows("a")).toBe(false);
    expect(fitsRows(null)).toBe(false);
  });

  it("turns a section on with an empty object and off by removing it", () => {
    const on = withParamsEnabled(shape, defaultArgs(github!), "query", true);
    expect(paramsEnabled(shape, on, "query")).toBe(true);
    expect(on[shape.fields.query!]).toEqual(fixed({}));
    expect(withParamsEnabled(shape, on, "query", true)).toBe(on);
    expect(
      paramsEnabled(
        shape,
        withParamsEnabled(shape, on, "query", false),
        "query",
      ),
    ).toBe(false);
  });

  it("flags a denied header, a repeated header and a name that is not one", () => {
    const rows = [
      row("Authorization", "x"),
      row("X-Trace", "a"),
      row("x-trace", "b"),
      row("bad name", "c"),
      row("", "orphan"),
      row("", ""),
    ];
    const problems = rowProblems("headers", rows);
    expect(problems.get(rows[0]!.id)).toEqual({
      code: "header_denied",
      part: "denied",
    });
    expect(problems.has(rows[1]!.id)).toBe(false);
    expect(problems.get(rows[2]!.id)).toEqual({
      code: "invalid_header",
      part: "duplicate",
    });
    expect(problems.get(rows[3]!.id)).toEqual({
      code: "invalid_header",
      part: "name",
    });
    expect(problems.get(rows[4]!.id)?.part).toBe("nameMissing");
    expect(problems.has(rows[5]!.id)).toBe(false);
  });

  it("flags a query name with characters the engine refuses, and a value with a line break", () => {
    const rows = [
      row("a b", "1"),
      row("ok", "line\nbreak"),
      row("fine", "{{ settings.x }}"),
    ];
    const problems = rowProblems("query", rows);
    expect(problems.get(rows[0]!.id)).toEqual({
      code: "invalid_query",
      part: "name",
    });
    expect(problems.get(rows[1]!.id)).toEqual({
      code: "invalid_query",
      part: "value",
    });
    expect(problems.has(rows[2]!.id)).toBe(false);
  });
});

describe("going between rows and JSON", () => {
  it("keeps a denied header through the object and back, and still refuses it", () => {
    const rows = [row("Authorization", "x"), row("Accept", "y")];
    const saved = objectOf("headers", rows);
    expect(Object.keys(saved)).toEqual(["Authorization", "Accept"]);
    const back = rowsOf(saved, nextId);
    expect(back.map((entry) => entry.name)).toEqual([
      "Authorization",
      "Accept",
    ]);
    expect(rowProblems("headers", back).get(back[0]!.id)).toEqual({
      code: "header_denied",
      part: "denied",
    });
    // The JSON editor shows the same object, so the refusal names the header there too.
    const withHeaders = withParams(
      shape,
      withParamsEnabled(shape, defaultArgs(github!), "headers", true),
      "headers",
      saved,
    );
    expect(apiRequestProblems(shape, withHeaders)).toContainEqual({
      field: "headers",
      code: "header_denied",
      name: "Authorization",
    });
  });

  it("reads a denied header typed in JSON into a row, where it is refused rather than dropped", () => {
    const rows = reconcileRows(
      "headers",
      [],
      { Authorization: "x", Accept: "y" },
      nextId,
    );
    expect(rows.map((entry) => entry.name)).toEqual([
      "Authorization",
      "Accept",
    ]);
    expect(rowProblems("headers", rows).size).toBe(1);
  });

  it("keeps rows the object cannot hold when the object is read back as the rows wrote it", () => {
    const rows = [
      row("X-Trace", "a"),
      row("X-Trace", "b"),
      row("", "no name yet"),
    ];
    const saved = objectOf("headers", rows);
    // Reading the object alone would leave one row of the three.
    expect(rowsOf(saved, nextId)).toHaveLength(1);
    expect(reconcileRows("headers", rows, saved, nextId)).toBe(rows);
  });

  it("reads the object as it stands once something else wrote it, dropping only rows that JSON no longer holds", () => {
    const rows = [row("Authorization", "x"), row("Accept", "y")];
    const typed = { Accept: "application/json" };
    expect(
      reconcileRows("headers", rows, typed, nextId).map((entry) => [
        entry.name,
        entry.value,
      ]),
    ).toEqual([["Accept", "application/json"]]);
  });
});

describe("options", () => {
  it("lists what is set, with a status switch counted only while it is on", () => {
    let args = defaultArgs(github!);
    expect(activeOptions(shape, args)).toEqual([]);
    args = withOption(shape, args, "timeout");
    args = withOption(shape, args, "includeStatus");
    expect(activeOptions(shape, args)).toEqual(["timeout", "includeStatus"]);
    args = withOption(shape, args, "includeStatus", false);
    expect(activeOptions(shape, args)).toEqual(["timeout"]);
    expect(activeOptions(shape, withoutOption(shape, args, "timeout"))).toEqual(
      [],
    );
  });

  it("lets paging and status each rule out the other", () => {
    const paged = withOption(shape, defaultArgs(github!), "pagination");
    expect(optionBlock(shape, paged, "includeStatus")).toBe("pagination_on");
    expect(optionBlock(shape, paged, "timeout")).toBe(undefined);
    const status = withOption(shape, defaultArgs(github!), "includeStatus");
    expect(optionBlock(shape, status, "pagination")).toBe("status_on");
  });

  it("starts paging with the page limit the engine defaults to and nothing else", () => {
    const args = withOption(shape, defaultArgs(github!), "pagination");
    expect(
      paginationOf(
        args[optionName(shape, "pagination")!]?.mode === "fixed"
          ? (args[optionName(shape, "pagination")!] as { value: unknown }).value
          : undefined,
      ),
    ).toEqual({
      cursorPath: "",
      cursorParam: "",
      itemsPath: "",
      maxPages: 3,
    });
  });

  it("leaves an empty items path and an empty page limit out of the saved paging", () => {
    expect(
      paginationValue({
        cursorPath: "next",
        cursorParam: "after",
        itemsPath: "",
        maxPages: undefined,
      }),
    ).toEqual({ cursorPath: "next", cursorParam: "after" });
    expect(
      paginationValue({
        cursorPath: "next",
        cursorParam: "after",
        itemsPath: "data",
        maxPages: 2,
      }),
    ).toEqual({
      cursorPath: "next",
      cursorParam: "after",
      itemsPath: "data",
      maxPages: 2,
    });
  });

  it("shows a field set from upstream by the generic control instead of dropping it", () => {
    const args: ApiRequestArgs = {
      [shape.fields.timeoutSeconds!]: {
        mode: "path",
        path: "settings.timeout",
      },
    };
    expect(isPlainBinding(args, shape.fields.timeoutSeconds)).toBe(false);
    expect(isPlainBinding(args, shape.fields.query)).toBe(true);
    expect(activeOptions(shape, args)).toEqual(["timeout"]);
  });
});

describe("checks that mirror the engine's refusals", () => {
  const args = (over: Record<string, unknown>): ApiRequestArgs =>
    Object.fromEntries(
      Object.entries(over).map(([name, value]) => [name, fixed(value)]),
    );

  it("refuses a full URL in the path, with the fix offered by the form", () => {
    expect(pathProblem("https://api.github.com/repos/a/b", [])).toEqual({
      field: "path",
      code: "full_url_refused",
    });
    expect(pathProblem("//api.github.com/repos", [])).toEqual({
      field: "path",
      code: "full_url_refused",
    });
  });

  it("names why a path is unsafe", () => {
    const reason = (text: string) => {
      const problem = pathProblem(text, []);
      return problem?.code === "unsafe_path_value" ? problem.reason : undefined;
    };
    expect(reason("repos?state=open")).toBe("query");
    expect(reason("repos#top")).toBe("fragment");
    expect(reason("repos/{owner}")).toBe("placeholder");
    expect(reason("repos/../secrets")).toBe("segment");
    expect(reason("a//b")).toBe("segment");
  });

  it("accepts the connection's placeholder as a whole segment and leaves a path with a hole to a run", () => {
    expect(
      pathProblem("api/projects/{projectId}/insights", ["projectId"]),
    ).toBe(undefined);
    expect(pathProblem("repos/{{ settings.repo }}/issues", [])).toBe(undefined);
    expect(pathProblem("repos/acme/web/issues", [])).toBe(undefined);
  });

  it("refuses an empty path as a run would, with invalid_field", () => {
    expect(pathProblem("  ", [])).toEqual({
      field: "path",
      code: "invalid_field",
    });
    expect(apiRequestProblems(shape, {})).toEqual([
      { field: "path", code: "invalid_field" },
    ]);
    expect(apiRequestProblems(shape, defaultArgs(github!))).toEqual([
      { field: "path", code: "invalid_field" },
    ]);
  });

  it("names a denied header and a header that is not valid", () => {
    expect(
      apiRequestProblems(
        shape,
        args({
          [shape.fields.path]: "x",
          [shape.fields.headers!]: { Authorization: "a" },
        }),
      ),
    ).toContainEqual({
      field: "headers",
      code: "header_denied",
      name: "Authorization",
    });
    expect(
      apiRequestProblems(
        shape,
        args({
          [shape.fields.path]: "x",
          [shape.fields.headers!]: { "bad name": "a" },
        }),
      ),
    ).toContainEqual({ field: "headers", code: "invalid_header" });
  });

  it("flags a query that is not an object of text and numbers", () => {
    expect(
      apiRequestProblems(
        shape,
        args({
          [shape.fields.path]: "x",
          [shape.fields.query!]: { nested: { a: 1 } },
        }),
      ),
    ).toContainEqual({ field: "query", code: "invalid_query" });
    expect(
      apiRequestProblems(
        shape,
        args({ [shape.fields.path]: "x", [shape.fields.query!]: ["a"] }),
      ),
    ).toContainEqual({ field: "query", code: "invalid_query" });
  });

  it("flags a timeout outside 1 to 60 seconds", () => {
    for (const value of [0, 61, "30"]) {
      expect(
        apiRequestProblems(
          shape,
          args({
            [shape.fields.path]: "x",
            [shape.fields.timeoutSeconds!]: value,
          }),
        ),
      ).toContainEqual({ field: "timeoutSeconds", code: "invalid_timeout" });
    }
    expect(
      apiRequestProblems(
        shape,
        args({ [shape.fields.path]: "x", [shape.fields.timeoutSeconds!]: 30 }),
      ),
    ).toEqual([]);
  });

  it("names the part of the paging that is missing or wrong", () => {
    const part = (value: unknown) => {
      const found = apiRequestProblems(
        shape,
        args({ [shape.fields.path]: "x", [shape.fields.pagination!]: value }),
      ).find((problem) => problem.field === "pagination");
      return found?.field === "pagination" ? found.part : undefined;
    };
    expect(part({ cursorPath: "next", cursorParam: "", maxPages: 3 })).toBe(
      "cursorParam",
    );
    expect(part({ cursorPath: "", cursorParam: "after" })).toBe("cursorPath");
    expect(part({ cursorPath: "a", cursorParam: "b", itemsPath: "x y" })).toBe(
      "itemsPath",
    );
    expect(part({ cursorPath: "a", cursorParam: "b", maxPages: 9 })).toBe(
      "maxPages",
    );
    expect(part("nope")).toBe("shape");
    expect(part({ cursorPath: "a", cursorParam: "b", maxPages: 2 })).toBe(
      undefined,
    );
  });

  it("flags the status switch kept beside paging, which the engine refuses", () => {
    let both = args({ [shape.fields.path]: "x" });
    both = withOption(shape, both, "pagination");
    both = withOption(shape, both, "includeStatus");
    expect(apiRequestProblems(shape, both)).toContainEqual({
      field: "includeStatus",
      code: "incompatible_fields",
    });
    expect(
      apiRequestProblems(shape, withoutOption(shape, both, "pagination")),
    ).toEqual([]);
  });

  it("does not judge a value that holds a {{ }} hole, which only a run can fill", () => {
    expect(
      apiRequestProblems(
        shape,
        args({
          [shape.fields.path]: "repos/{{ settings.repo }}",
          [shape.fields.query!]: { q: "{{ settings.q }}", bad: { n: 1 } },
        }),
      ),
    ).toEqual([]);
  });
});

describe("the fixes the form offers", () => {
  it("keeps only the path of a typed URL, below the provider's base URL on the same host", () => {
    expect(
      pathOfUrl(
        "https://slack.com/api/users.info?user=U1&token=abc",
        "https://slack.com/api",
      ),
    ).toEqual({
      path: "users.info",
      query: { user: "U1" },
      dropped: ["token"],
    });
    expect(
      pathOfUrl(
        "https://api.github.com/repos/a%20b/c",
        "https://api.github.com",
      ),
    ).toEqual({
      path: "repos/a b/c",
      query: {},
      dropped: [],
    });
    expect(
      pathOfUrl("//other.example/x/y", "https://api.github.com")?.path,
    ).toBe("x/y");
    expect(pathOfUrl("not a url")).toBe(undefined);
  });

  it("moves a query string out of the path and drops the fragment", () => {
    expect(
      splitQueryFromPath("repos/a/b/issues?state=open&labels=x&labels=y#top"),
    ).toEqual({
      path: "repos/a/b/issues",
      query: { state: "open", labels: ["x", "y"] },
      dropped: [],
    });
    expect(splitQueryFromPath("repos")).toBe(undefined);
  });

  it("adds the moved parameters to those already saved, the new value winning a name", () => {
    const base = withParams(
      shape,
      withParamsEnabled(shape, defaultArgs(github!), "query", true),
      "query",
      { state: "closed", per_page: "5" },
    );
    const next = withSplitPath(shape, base, {
      path: "repos/a/b/issues",
      query: { state: "open" },
      dropped: [],
    });
    expect(next[shape.fields.path]).toEqual(fixed("repos/a/b/issues"));
    expect(next[shape.fields.query!]).toEqual(
      fixed({ state: "open", per_page: "5" }),
    );
  });
});

describe("importing a cURL command", () => {
  const providers = [
    { id: "github", baseUrl: "https://api.github.com" },
    { id: "slack", baseUrl: "https://slack.com/api" },
  ];

  it("sets the provider, path, query and headers and nothing from before", () => {
    const parsed = parseCurlImport(
      "curl 'https://api.github.com/repos/a/b/issues?state=open' -H 'Accept: application/json' -H 'Authorization: Bearer x'",
      providers,
    );
    if (!parsed.ok) throw new Error("expected the import to succeed");
    const applied = applyCurlImport(WORKFLOW_CATALOG, parsed);
    expect(applied?.operation).toBe("github.apiRequest");
    const args = applied?.args ?? {};
    expect(args[shape.fields.path]).toEqual(fixed("repos/a/b/issues"));
    expect(args[shape.fields.query!]).toEqual(fixed({ state: "open" }));
    expect(args[shape.fields.headers!]).toEqual(
      fixed({ Accept: "application/json" }),
    );
    expect(Object.keys(args).sort()).toEqual(
      [shape.fields.path, shape.fields.query!, shape.fields.headers!].sort(),
    );
    expect(args[shape.fields.timeoutSeconds!]).toBe(undefined);
  });

  it("names what was left out, by name, and never by value", () => {
    const parsed = parseCurlImport(
      "curl -u me:secret -X GET https://slack.com/api/users.list -H 'Cookie: a=b' -H 'Host: x' -d a=b -L",
      providers,
    );
    if (!parsed.ok) throw new Error("expected the import to succeed");
    const left = leftOutOf(parsed.issues);
    expect(left.credentials).toEqual(expect.arrayContaining(["-u", "Cookie"]));
    expect(left.headers).toEqual(["Host"]);
    expect(left.bodies).toEqual(["-d"]);
    expect(left.flags).toEqual(["-L"]);
    expect(hasLeftOut(left)).toBe(true);
    expect(JSON.stringify(left)).not.toContain("secret");
  });

  it("reports nothing left out for a clean command", () => {
    const parsed = parseCurlImport(
      "curl https://api.github.com/user",
      providers,
    );
    if (!parsed.ok) throw new Error("expected the import to succeed");
    expect(hasLeftOut(leftOutOf(parsed.issues))).toBe(false);
  });

  it("does not import a command for a provider the catalog has no API request for", () => {
    expect(
      applyCurlImport(WORKFLOW_CATALOG, {
        ok: true,
        provider: "linear",
        path: "x",
        query: {},
        headers: {},
        issues: [],
      }),
    ).toBe(undefined);
  });
});

describe("the card", () => {
  const op = "github.apiRequest";

  it("shows the typed path, an expression as written, and nothing for a step with no path", () => {
    const typed = lookup(op, { [shape.fields.path]: fixed(" repos/a/b ") });
    expect(requestPathOf(typed, WORKFLOW_CATALOG)).toBe("repos/a/b");
    const read = lookup(op, {
      [shape.fields.path]: { mode: "path", path: "settings.repoPath" },
    });
    expect(requestPathOf(read, WORKFLOW_CATALOG)).toBe(
      "{{ settings.repoPath }}",
    );
    expect(
      requestPathOf(lookup(op, defaultArgs(github!)), WORKFLOW_CATALOG),
    ).toBe("");
  });

  it("is not an API request when the step runs any other operation or kind", () => {
    const other = lookup("slack.userInfo", {});
    expect(requestPathOf(other, WORKFLOW_CATALOG)).toBe(undefined);
    expect(hasEmptyPath(other, WORKFLOW_CATALOG)).toBe(false);
  });

  it("flags an empty path and clears the flag once one is typed", () => {
    expect(
      hasEmptyPath(lookup(op, defaultArgs(github!)), WORKFLOW_CATALOG),
    ).toBe(true);
    expect(hasEmptyPath(lookup(op, {}), WORKFLOW_CATALOG)).toBe(true);
    expect(
      hasEmptyPath(
        lookup(op, { [shape.fields.path]: fixed("user") }),
        WORKFLOW_CATALOG,
      ),
    ).toBe(false);
  });
});

describe("the problems the editor lists", () => {
  // Real issues from the editor's own validator, so the field name the
  // annotation looks for is the one the validator writes.
  function issuesFor(args: ApiRequestArgs) {
    const editor = createWorkflowEditor({
      graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
      catalog: WORKFLOW_CATALOG,
    });
    const trigger = editor.addNode("trigger");
    if (!trigger.ok) throw new Error("no trigger");
    const added = editor.addNode("lookup", {
      operationId: "github.apiRequest",
      after: { node: trigger.node.id, port: "out" },
    });
    if (!added.ok) throw new Error("no lookup");
    const updated = editor.updateNodeSettings(added.node.id, {
      operation: "github.apiRequest",
      args,
    });
    if (!updated.ok) throw new Error("settings refused");
    const graph = editor.getSnapshot().graph;
    return {
      nodeId: added.node.id,
      annotated: annotateApiRequestIssues(
        graph,
        WORKFLOW_CATALOG,
        editor.validate().issues,
      ),
    };
  }

  it("attaches the typed problem to the validator's field_type_mismatch, whatever order the fields were added in", () => {
    const { annotated, nodeId } = issuesFor({
      [shape.fields.timeoutSeconds!]: fixed(120),
      [shape.fields.path]: fixed("https://api.github.com/repos"),
      [shape.fields.headers!]: fixed({ Authorization: "x" }),
    });
    const problems = annotated
      .filter((issue) => issue.nodeId === nodeId)
      .flatMap((issue) => (issue.apiProblem ? [issue.apiProblem] : []));
    expect(problems).toEqual(
      expect.arrayContaining([
        { field: "path", code: "full_url_refused" },
        { field: "headers", code: "header_denied", name: "Authorization" },
        { field: "timeoutSeconds", code: "invalid_timeout" },
      ]),
    );
    expect(
      annotated.filter((issue) => issue.code === "field_type_mismatch"),
    ).toHaveLength(3);
  });

  it("adds a missing-field issue for a step with no path, which the validator lets through", () => {
    const { annotated, nodeId } = issuesFor(defaultArgs(github!));
    expect(
      annotated.filter(
        (issue) =>
          issue.nodeId === nodeId && issue.code === "missing_required_field",
      ),
    ).toEqual([
      {
        code: "missing_required_field",
        nodeId,
        apiProblem: { field: "path", code: "invalid_field" },
      },
    ]);
  });

  it("adds nothing for a step that is fine, and leaves the validator's other issues as they were", () => {
    const { annotated, nodeId } = issuesFor({
      [shape.fields.path]: fixed("repos/acme/web"),
    });
    expect(annotated.some((issue) => issue.apiProblem !== undefined)).toBe(
      false,
    );
    expect(annotated.filter((issue) => issue.nodeId === nodeId)).toEqual([
      { code: "port_leads_nowhere", nodeId, port: "out" },
    ]);
  });
});

describe("fields to keep", () => {
  const keepName = optionName(shape, "fieldsToKeep")!;
  const base = (): ApiRequestArgs => ({
    ...defaultArgs(github!),
    [shape.fields.path]: fixed("repos/acme/web/pulls"),
  });

  it("is an option of every provider's API request, written under the operation's own field name", () => {
    expect(keepName).toBe("fieldsToKeep");
    for (const def of apiRequestOperations(WORKFLOW_CATALOG)) {
      const own = shapeOf(def);
      expect(availableOptions(own)).toContain("fieldsToKeep");
      const field = def.fields.find(
        (candidate) => candidate.name === optionName(own, "fieldsToKeep"),
      );
      expect(field?.type).toBe("json");
      expect(field?.required).toBeFalsy();
    }
  });

  it("writes the chips as a list of text, and nothing at all when there are none", () => {
    const set = withFieldsToKeep(shape, base(), ["number", "user.login"]);
    expect(set[keepName]).toEqual(fixed(["number", "user.login"]));
    expect(activeOptions(shape, set)).toEqual(["fieldsToKeep"]);
    const cleared = withFieldsToKeep(shape, set, []);
    expect(keepName in cleared).toBe(false);
    expect(activeOptions(shape, cleared)).toEqual([]);
  });

  it("goes with the options, and the other options leave it alone", () => {
    let args = withFieldsToKeep(shape, base(), ["number"]);
    args = withOption(shape, args, "timeout");
    expect(withoutOption(shape, args, "timeout")[keepName]).toEqual(
      fixed(["number"]),
    );
    expect(keepName in withoutOption(shape, args, "fieldsToKeep")).toBe(false);
  });

  it("is kept when the step moves to another provider's API request", () => {
    const args = withFieldsToKeep(shape, base(), ["number", "user.login"]);
    const other = apiRequestOperationFor(WORKFLOW_CATALOG, "slack")!;
    expect(argsForOperation(other, args)[keepName]).toEqual(
      fixed(["number", "user.login"]),
    );
  });

  it("is kept when a cURL command is imported, which resets the rest of the step", () => {
    const parsed = parseCurlImport("curl https://slack.com/api/users.list", [
      { id: "slack", baseUrl: "https://slack.com/api" },
    ]);
    if (!parsed.ok) throw new Error("expected the import to succeed");
    let current = withFieldsToKeep(shape, base(), ["members.id"]);
    current = withOption(shape, current, "timeout");
    const applied = applyCurlImport(WORKFLOW_CATALOG, parsed, current);
    expect(applied?.args[keepName]).toEqual(fixed(["members.id"]));
    expect(applied?.args[shape.fields.timeoutSeconds!]).toBe(undefined);
    // With nothing to keep, an import adds nothing.
    expect(
      keepName in
        (applyCurlImport(WORKFLOW_CATALOG, parsed, base())?.args ?? {}),
    ).toBe(false);
  });

  it("flags a list the server would refuse, by the first thing wrong with it", () => {
    const problem = (value: unknown) =>
      apiRequestProblems(shape, { ...base(), [keepName]: fixed(value) }).find(
        (entry) => entry.field === "fieldsToKeep",
      );
    expect(problem(["number", "user.login"])).toBe(undefined);
    expect(problem([])).toEqual({
      field: "fieldsToKeep",
      code: "invalid_fields_to_keep",
      reason: "empty",
    });
    expect(problem("number")).toMatchObject({ reason: "shape" });
    expect(problem(["ok", "a..b"])).toEqual({
      field: "fieldsToKeep",
      code: "invalid_fields_to_keep",
      reason: "segment",
      path: "a..b",
    });
    expect(problem(["a", "a"])).toMatchObject({
      reason: "duplicate",
      path: "a",
    });
    expect(problem(["__proto__"])).toMatchObject({ reason: "reserved" });
  });

  it("does not judge a list that holds a {{ }} hole, which only a run can fill", () => {
    expect(
      apiRequestProblems(shape, {
        ...base(),
        [keepName]: fixed(["{{ settings.field }}", "a..b"]),
      }),
    ).toEqual([]);
  });

  it("words the validator's refusal of the list from its typed code", () => {
    const editor = createWorkflowEditor({
      graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
      catalog: WORKFLOW_CATALOG,
    });
    const trigger = editor.addNode("trigger");
    if (!trigger.ok) throw new Error("no trigger");
    const added = editor.addNode("lookup", {
      operationId: "github.apiRequest",
      after: { node: trigger.node.id, port: "out" },
    });
    if (!added.ok) throw new Error("no lookup");
    const set = editor.updateNodeSettings(added.node.id, {
      operation: "github.apiRequest",
      args: { ...base(), [keepName]: fixed(["number", "bad..path"]) },
    });
    if (!set.ok) throw new Error("settings refused");
    const annotated = annotateApiRequestIssues(
      editor.getSnapshot().graph,
      WORKFLOW_CATALOG,
      editor.validate().issues,
    );
    expect(
      annotated.find((issue) => issue.apiProblem?.field === "fieldsToKeep")
        ?.apiProblem,
    ).toEqual({
      field: "fieldsToKeep",
      code: "invalid_fields_to_keep",
      reason: "segment",
      path: "bad..path",
    });
  });
});
