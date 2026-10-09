import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const bridgeSource = readFileSync(
  new URL("./editor-chrome.bridge.ts", import.meta.url),
  "utf8",
);

function compileObserverHelper<T extends (...args: any[]) => any>(
  name: string,
  nextFunction: string,
): T {
  const start = bridgeSource.indexOf(`function ${name}(`);
  const next = bridgeSource.indexOf(`function ${nextFunction}(`, start);
  const end = bridgeSource.lastIndexOf("\n", next);
  if (start < 0 || end < 0) {
    throw new Error(`Could not isolate ${name} from the bridge source`);
  }
  return new Function(
    `${ts.transpile(bridgeSource.slice(start, end), { target: ts.ScriptTarget.ES2020 })}; return ${name};`,
  )() as T;
}

type FakeElement = {
  id: string;
  parentElement: FakeElement | null;
};

type ObserverOptions = {
  attributes: boolean;
  attributeFilter: string[];
  childList: boolean;
  subtree: boolean;
};

type FakeObserver = {
  observe: (target: FakeElement, options: ObserverOptions) => void;
};

describe("measurement ancestor observer scope", () => {
  it("observes each ancestor through the document root without a subtree", () => {
    const documentElement: FakeElement = {
      id: "html",
      parentElement: null,
    };
    const body: FakeElement = { id: "body", parentElement: documentElement };
    const screenRoot: FakeElement = {
      id: "screen-root",
      parentElement: body,
    };
    const distantContainer: FakeElement = {
      id: "distant-container",
      parentElement: screenRoot,
    };
    const measurementParent: FakeElement = {
      id: "measurement-parent",
      parentElement: distantContainer,
    };
    const observe =
      vi.fn<(target: FakeElement, options: ObserverOptions) => void>();
    const observer: FakeObserver = { observe };
    const measurementAncestorMutationTargets = compileObserverHelper<
      (
        measurementParent: FakeElement | null,
        documentElement: FakeElement | null,
      ) => FakeElement[]
    >("measurementAncestorMutationTargets", "observeMeasurementAncestorChain");

    const ancestors = measurementAncestorMutationTargets(
      measurementParent,
      documentElement,
    );
    const observeMeasurementAncestorChain = compileObserverHelper<
      (observer: FakeObserver, ancestors: FakeElement[]) => FakeElement[]
    >("observeMeasurementAncestorChain", "syncOverlayObservers");
    observeMeasurementAncestorChain(observer, ancestors);

    expect(ancestors.map((element) => element.id)).toEqual([
      "distant-container",
      "screen-root",
      "body",
      "html",
    ]);
    expect(observe.mock.calls).toEqual(
      ancestors.map((ancestor) => [
        ancestor,
        {
          attributes: true,
          attributeFilter: ["class", "style"],
          childList: true,
          subtree: false,
        },
      ]),
    );
  });

  it("observes only the document root when the measurement parent is body", () => {
    const documentElement: FakeElement = {
      id: "html",
      parentElement: null,
    };
    const body: FakeElement = { id: "body", parentElement: documentElement };
    const observe =
      vi.fn<(target: FakeElement, options: ObserverOptions) => void>();
    const observer: FakeObserver = { observe };
    const measurementAncestorMutationTargets = compileObserverHelper<
      (
        measurementParent: FakeElement | null,
        documentElement: FakeElement | null,
      ) => FakeElement[]
    >("measurementAncestorMutationTargets", "observeMeasurementAncestorChain");

    const ancestors = measurementAncestorMutationTargets(body, documentElement);
    const observeMeasurementAncestorChain = compileObserverHelper<
      (observer: FakeObserver, ancestors: FakeElement[]) => FakeElement[]
    >("observeMeasurementAncestorChain", "syncOverlayObservers");
    observeMeasurementAncestorChain(observer, ancestors);

    expect(ancestors.map((element) => element.id)).toEqual(["html"]);
    expect(observe).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: false,
    });
  });
});
