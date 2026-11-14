// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseStackTrace, StackTrace, type StackFrame } from "./stack-trace.js";

const NODE_CRASH = [
  "stdout:",
  "starting",
  "",
  "stderr:",
  "file:///tmp/run/sandbox.mjs:1",
  "function f(){ return x.y }",
  "              ^",
  "",
  "ReferenceError: x is not defined",
  "    at f (file:///tmp/run/sandbox.mjs:1:15)",
  "    at file:///tmp/run/sandbox.mjs:2:1",
  "    at ModuleJob.run (node:internal/modules/esm/module_job:569:25)",
  "    at async node:internal/modules/esm/loader:650:26",
  "    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:105:5)",
  "",
  "Node.js v26.12.1",
].join("\n");

const PYTHON_CRASH = [
  "Traceback (most recent call last):",
  '  File "/work/app.py", line 4, in <module>',
  "    main()",
  '  File "/usr/lib/python3.12/json/__init__.py", line 346, in loads',
  "    return _default_decoder.decode(s)",
  "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
].join("\n");

describe("parseStackTrace", () => {
  it("finds a Node stack inside other output", () => {
    const trace = parseStackTrace(NODE_CRASH)!;
    expect(trace.error).toBe("ReferenceError: x is not defined");
    expect(trace.whole).toBe(false);
    expect(trace.text.split("\n")).toHaveLength(6);
    expect(trace.frames[0]).toEqual({
      text: "at f (file:///tmp/run/sandbox.mjs:1:15)",
      name: "f",
      file: "file:///tmp/run/sandbox.mjs",
      line: 1,
      column: 15,
      internal: false,
    });
    expect(trace.frames[1]).toMatchObject({
      file: "file:///tmp/run/sandbox.mjs",
      line: 2,
      internal: false,
    });
    expect(trace.frames[1]?.name).toBeUndefined();
    expect(trace.frames.slice(2).map((frame) => frame.internal)).toEqual([
      true,
      true,
      true,
    ]);
    expect(trace.frames[4]?.name).toBe("asyncRunEntryPointWithESMLoader");
  });

  it("reads a Python traceback, marking the standard library", () => {
    const trace = parseStackTrace(PYTHON_CRASH)!;
    expect(trace.error).toBe(
      "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    );
    expect(trace.whole).toBe(true);
    expect(
      trace.frames.map((frame) => [frame.file, frame.line, frame.internal]),
    ).toEqual([
      ["/work/app.py", 4, false],
      ["/usr/lib/python3.12/json/__init__.py", 346, true],
    ]);
  });

  it("finds nothing in output without frames", () => {
    expect(parseStackTrace("stdout:\nok\n\nstderr:\ndone")).toBeUndefined();
    expect(parseStackTrace("Unhandled error: boom")).toBeUndefined();
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("StackTrace", () => {
  it("titles the error and folds the framework frames after the caller's", async () => {
    const opened: StackFrame[] = [];
    await act(async () =>
      root.render(
        <StackTrace
          trace={NODE_CRASH}
          defaultOpen
          onFilePathClick={(frame) => opened.push(frame)}
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      "button.agentkit-disclosure-summary",
    )!;
    expect(trigger.textContent).toBe("ReferenceError: x is not defined");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      container
        .querySelector('[data-slot="trace-line"]')
        ?.getAttribute("data-trace-status"),
    ).toBe("error");

    const own = Array.from(
      container.querySelectorAll(
        ".agentkit-stack-trace-body > ol > .agentkit-stack-frame",
      ),
      (frame) => frame.textContent,
    );
    expect(own).toEqual(["fsandbox.mjs:1:15", "sandbox.mjs:2:1"]);
    expect(
      container
        .querySelector(".agentkit-stack-frame-location")
        ?.getAttribute("title"),
    ).toBe("file:///tmp/run/sandbox.mjs:1:15");
    const folded = container.querySelector(".agentkit-stack-frames-folded");
    expect(folded?.querySelector("button")?.textContent).toBe(
      "3 framework frames",
    );
    // Folded frames stay findable in the page.
    expect(
      folded
        ?.querySelector('[data-slot="trace-collapsible-content"]')
        ?.getAttribute("hidden"),
    ).toBe("until-found");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          "button.agentkit-stack-frame-location",
        )
        ?.click(),
    );
    expect(opened.map((frame) => frame.line)).toEqual([1]);
  });

  it("copies only the trace", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await act(async () => root.render(<StackTrace trace={NODE_CRASH} />));
    const copy = container.querySelector<HTMLButtonElement>(
      ".agentkit-stack-trace-actions button",
    )!;
    expect(copy.getAttribute("aria-label")).toBe("Copy stack trace");
    await act(async () => {
      copy.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(parseStackTrace(NODE_CRASH)!.text);
  });

  it("renders nothing for text without a stack", async () => {
    await act(async () => root.render(<StackTrace trace="all good" />));
    expect(container.innerHTML).toBe("");
  });
});
