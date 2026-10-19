// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import {
  filterNativeExportSelection,
  resolveNativeExportSelection,
} from "./native-export-selection";

afterEach(() => document.body.replaceChildren());
it("excludes unselected paint while retaining the selected native coverage and isolation", () => {
  document.body.innerHTML =
    '<div data-agent-native-node-id="wave"></div><svg data-agent-native-node-id="glass"><path fill-rule="evenodd" d="M0 0H100V100H0ZM30 30V70H70V30Z"/></svg><canvas></canvas><div data-agent-native-node-id="overlap"></div>';
  const [wave, glass, canvas, overlap] = Array.from(document.body.children);
  const coverage = { clipId: "glass-hole-coverage" };
  const fullBackdropInputs = [
    { node: wave!, nativeInstanceId: "wave-fill" },
    { node: overlap! },
  ];
  const receiver = {
    node: canvas!,
    nativeInstanceId: "glass-effect",
    groupClips: [coverage],
    isolationPath: [{ id: "glass", opacity: 1 }],
  };
  const scene = [
    ...fullBackdropInputs,
    receiver,
    { node: document.documentElement },
  ];
  const selected = resolveNativeExportSelection(document, ["glass"])!;
  const output = filterNativeExportSelection(scene, selected, (id) =>
    id === "glass-effect" ? glass! : wave!,
  );
  expect(output).toEqual([receiver]);
  expect(output[0]).toBe(receiver);
  expect(receiver.groupClips[0]).toBe(coverage);
  expect(fullBackdropInputs).toHaveLength(2);
});
it("does not invent an empty successful selection for missing or duplicate authored nodes", () => {
  expect(() => resolveNativeExportSelection(document, ["missing"])).toThrow(
    expect.objectContaining({ code: "composition-selection-stale" }),
  );
  document.body.innerHTML =
    '<div data-agent-native-node-id="duplicate"></div><div data-agent-native-node-id="duplicate"></div>';
  expect(() => resolveNativeExportSelection(document, ["duplicate"])).toThrow(
    expect.objectContaining({ code: "composition-selection-stale" }),
  );
});
