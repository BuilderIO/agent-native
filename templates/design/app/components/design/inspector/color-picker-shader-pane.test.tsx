// @vitest-environment happy-dom

/**
 * The Shader paint's pane inside the picker: a search, "Created by you" with
 * Create with AI, the preset grid; then, for the shader on the element, its
 * preset select, a menu to edit its code or remove it, and its controls.
 */

import {
  applyShaderToHtml,
  listShaderMounts,
  newShaderId,
} from "@shared/shader-fills";
import { GLSL_SHADER_PRESETS } from "@shared/shader-presets";
import { act, createRef, useState, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  applied: [] as Array<{ name: string; params: Record<string, unknown> }>,
  sendToDesignAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mocks.callAction(...args),
  useActionMutation: (name: string) => ({
    mutateAsync: (params: Record<string, unknown>) => {
      mocks.applied.push({ name, params });
      return Promise.resolve({
        fileId: "file_1",
        updatedAt: "2026-07-06T00:00:00.000Z",
      });
    },
  }),
  useActionQuery: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, string>) => {
    const found = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enUS,
      );
    if (typeof found !== "string") throw new Error(`Missing i18n key ${key}`);
    return found.replace(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? "");
  },
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: (...args: unknown[]) =>
    mocks.sendToDesignAgentChat(...args),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import type { RenderNestedColorPicker } from "./color-picker-nested";
import {
  ShaderPane,
  type ShaderPaneController,
} from "./color-picker-shader-pane";

const FIGMA_PRESETS = [
  "Mesh Gradient",
  "Glowing Wave",
  "Water Caustics",
  "Fractal Noise",
  "Clouds",
  "Nebula",
  "Moiré",
  "Concentric Rings",
  "Pattern Grid",
];

const BASE_HTML =
  '<html><body><div data-agent-native-node-id="hero"></div></body></html>';
const mesh = GLSL_SHADER_PRESETS.find(
  (preset) => preset.name === "mesh-gradient",
)!;
const SHADER_ID = newShaderId();
const WITH_SHADER = applyShaderToHtml(BASE_HTML, {
  nodeId: "hero",
  def: {
    id: SHADER_ID,
    name: mesh.label,
    mode: "fill",
    glsl: mesh.glsl,
    uniforms: mesh.uniforms,
  },
  fallbackColor: "#ff9a9e",
}).html;

const last = <T,>(items: readonly T[]): T | undefined =>
  items[items.length - 1];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let controllerRef: MutableRefObject<ShaderPaneController | null>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  mocks.applied.length = 0;
  mocks.sendToDesignAgentChat.mockReset();
  mocks.callAction.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  controllerRef =
    createRef<ShaderPaneController | null>() as MutableRefObject<ShaderPaneController | null>;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount({
  html,
  onEditCode,
  onRemoved = vi.fn(),
  renderColorPicker,
}: {
  html: string;
  onEditCode?: (shaderId: string) => void;
  onRemoved?: () => void;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  mocks.callAction.mockImplementation((name: string) => {
    if (name === "read-source-file") {
      return Promise.resolve({
        content: html,
        versionHash: "v1",
        fileId: "file_1",
      });
    }
    throw new Error(`unexpected callAction: ${name}`);
  });
  act(() =>
    root.render(
      <TooltipProvider delayDuration={0}>
        <ShaderPane
          context={{
            designId: "design_1",
            fileId: "file_1",
            content: html,
            nodeId: "hero",
            onEditCode,
          }}
          disabled={false}
          controllerRef={controllerRef}
          renderColorPicker={renderColorPicker}
          onRemoved={onRemoved}
        />
      </TooltipProvider>,
    ),
  );
  return { onRemoved };
}

const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.textContent === label,
  );

async function openMenu() {
  const trigger = button("More")!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

const lastWrittenHtml = () =>
  (last(mocks.applied)?.params.edit as { content: string } | undefined)
    ?.content;

describe("browsing", () => {
  it("lists every shader fill from the design in the presets grid, Mesh Gradient first", () => {
    mount({ html: BASE_HTML });

    const labels = FIGMA_PRESETS.map((label) => button(label));
    expect(labels.every(Boolean)).toBe(true);
    const grid = labels[0]!.parentElement!;
    expect(FIGMA_PRESETS.every((label) => grid.contains(button(label)!))).toBe(
      true,
    );
    // Effects are not fills.
    for (const effect of ["Film Grain", "Halftone", "Scanlines"]) {
      expect(button(effect)).toBeUndefined();
    }
    expect(container.textContent).toContain("Created by you");
    expect(container.textContent).toContain("Presets");
    expect(
      container.querySelector('input[aria-label="Search shaders"]'),
    ).not.toBeNull();
  });

  it("Create with AI sends the canned prompt through the agent chat, with the target as context", () => {
    mount({ html: BASE_HTML });

    act(() => button("Create with AI")!.click());

    expect(mocks.sendToDesignAgentChat).toHaveBeenCalledTimes(1);
    const sent = mocks.sendToDesignAgentChat.mock.calls[0]![0] as {
      message: string;
      context: string;
      submit: boolean;
    };
    expect(sent.message).toBe(
      "Create a custom shader fill for the selected element.",
    );
    expect(sent.context).toContain(
      "target nodeId (data-agent-native-node-id): hero",
    );
    expect(sent.context).toContain("mode: fill");
    expect(sent.submit).toBe(false);
    expect(mocks.applied).toHaveLength(0);
  });

  it("applies a picked preset to the element through the source edit action", async () => {
    mount({ html: BASE_HTML });

    await act(async () => button("Clouds")!.click());

    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0]!.name).toBe("apply-source-edit");
    const written = lastWrittenHtml()!;
    const mounts = listShaderMounts(written);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatchObject({ nodeId: "hero", mode: "fill" });
    expect(written).toContain("data-an-shader-fill");
  });

  it("narrows the presets by the search", () => {
    mount({ html: BASE_HTML });
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search shaders"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "nebula");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(button("Nebula")).toBeDefined();
    expect(button("Clouds")).toBeUndefined();
    expect(container.textContent).not.toContain("Create with AI");
  });
});

// A shader the agent wrote for this design: not one of the presets.
const AI_GLSL = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform vec3 u_tint;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(u_tint * (0.5 + 0.5 * sin(u_time * u_speed + uv.x)), 1.0);
}`;
const AI_ID = "an-shader-aurora01";
const AI_DEF = {
  id: AI_ID,
  name: "Aurora Drift",
  mode: "fill" as const,
  glsl: AI_GLSL,
  uniforms: {
    u_speed: {
      type: "float" as const,
      value: 1,
      min: 0,
      max: 4,
      step: 0.01,
      label: "Speed",
    },
    u_tint: { type: "color" as const, value: "#4f2d8f", label: "Base" },
  },
};
const THREE_NODES =
  '<html><body><div data-agent-native-node-id="hero"></div><div data-agent-native-node-id="aside"></div><div data-agent-native-node-id="footer"></div></body></html>';
const WITH_AI_ELSEWHERE = applyShaderToHtml(THREE_NODES, {
  nodeId: "aside",
  def: AI_DEF,
  fallbackColor: "#4f2d8f",
}).html;
const stampedMesh = {
  id: newShaderId(),
  name: mesh.label,
  mode: "fill" as const,
  glsl: mesh.glsl,
  uniforms: mesh.uniforms,
};
const WITH_AI_AND_PRESET_ELSEWHERE = applyShaderToHtml(WITH_AI_ELSEWHERE, {
  nodeId: "footer",
  def: stampedMesh,
}).html;

/** The "Created by you" section: its heading, the Create with AI card, and the shaders after it. */
const createdByYou = () =>
  Array.from(container.querySelectorAll("section")).find((section) =>
    section.textContent?.includes("Created by you"),
  )!;

describe("Created by you", () => {
  it("lists a shader the agent made for this design, after Create with AI", () => {
    mount({ html: WITH_AI_ELSEWHERE });

    const section = createdByYou();
    const labels = Array.from(section.querySelectorAll("button")).map(
      (item) => item.getAttribute("aria-label") ?? item.textContent,
    );
    expect(labels).toEqual(["Create with AI", "Aurora Drift"]);
  });

  it("does not list a preset that was applied somewhere else in the design", () => {
    mount({ html: WITH_AI_AND_PRESET_ELSEWHERE });

    expect(createdByYou().textContent).toContain("Aurora Drift");
    expect(createdByYou().textContent).not.toContain("Mesh Gradient");
    // It is still a preset to pick, once.
    expect(
      Array.from(container.querySelectorAll("button")).filter(
        (item) => item.getAttribute("aria-label") === "Mesh Gradient",
      ),
    ).toHaveLength(1);
  });

  it("lists a preset whose code was edited: it is the user's now", () => {
    const edited = applyShaderToHtml(THREE_NODES, {
      nodeId: "footer",
      def: {
        ...stampedMesh,
        glsl: stampedMesh.glsl.replace(
          "void main() {",
          "// tweaked\nvoid main() {",
        ),
      },
    }).html;
    mount({ html: edited });

    expect(createdByYou().textContent).toContain("Mesh Gradient");
  });

  it("is only the Create with AI card while the design has no shaders of its own", () => {
    mount({ html: BASE_HTML });

    const section = createdByYou();
    expect(section.querySelectorAll("button")).toHaveLength(1);
    expect(section.textContent).toContain("Create with AI");
  });

  it("applies the picked one to the selected element", async () => {
    mount({ html: WITH_AI_ELSEWHERE });

    await act(async () => button("Aurora Drift")!.click());

    expect(mocks.applied).toHaveLength(1);
    const mounts = listShaderMounts(lastWrittenHtml()!);
    expect(
      mounts.map((item) => `${item.nodeId}:${item.shaderId}`).sort(),
    ).toEqual([`aside:${AI_ID}`, `hero:${AI_ID}`]);
  });
});

describe("a shader on the element", () => {
  it("shows its controls under the paint row, in place of the browser", () => {
    mount({ html: WITH_SHADER });

    expect(button("Clouds")).toBeUndefined();
    expect(button("Create with AI")).toBeUndefined();
    const select = container.querySelector('[role="combobox"]');
    expect(select?.textContent).toBe("Mesh Gradient");
    for (const color of ["Color 1", "Color 2", "Color 3", "Color 4"]) {
      expect(
        container.querySelector(`input[aria-label="${color} hex"]`),
      ).not.toBeNull();
    }
    for (const knob of ["Drift", "Blend"]) {
      expect(
        container.querySelector(`[aria-label="${knob}"] [role="slider"]`),
      ).not.toBeNull();
    }
  });

  it("shows Edit code as in beta: disabled, with a tooltip, and it opens nothing", async () => {
    const onEditCode = vi.fn();
    mount({ html: WITH_SHADER, onEditCode });

    const menu = await openMenu();
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Edit code",
      "Remove shader",
    ]);
    const editCode = items[0]!;
    expect(editCode.getAttribute("aria-disabled")).toBe("true");
    expect(editCode.hasAttribute("data-disabled")).toBe(true);

    await act(async () => editCode.click());
    expect(onEditCode).not.toHaveBeenCalled();
    expect(mocks.applied).toHaveLength(0);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    // The item takes no pointer events itself, so the tooltip sits on its wrapper.
    await act(async () => {
      editCode.parentElement!.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "In beta",
    );
  });

  it("has no Edit code when the editor cannot open code", async () => {
    mount({ html: WITH_SHADER });

    const menu = await openMenu();
    expect(
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
        (item) => item.textContent,
      ),
    ).toEqual(["Remove shader"]);
  });

  it("removes the shader from the element and returns the fill to Solid", async () => {
    const { onRemoved } = mount({ html: WITH_SHADER });

    const menu = await openMenu();
    await act(async () =>
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent === "Remove shader")!
        .click(),
    );

    expect(mocks.applied).toHaveLength(1);
    expect(listShaderMounts(lastWrittenHtml()!)).toHaveLength(0);
    expect(lastWrittenHtml()).not.toMatch(/data-an-shader-fill=/);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("exposes the shader to the picker so leaving the Shader paint can take it off", async () => {
    mount({ html: WITH_SHADER });
    expect(controllerRef.current?.hasShader()).toBe(true);

    await act(async () => {
      await controllerRef.current!.remove();
    });

    expect(listShaderMounts(lastWrittenHtml()!)).toHaveLength(0);
  });

  it("knows there is nothing to take off while browsing", () => {
    mount({ html: BASE_HTML });
    expect(controllerRef.current?.hasShader()).toBe(false);
  });

  it("opens the picker beside the panel for a color, as opaque sRGB", () => {
    const requests: Array<Parameters<RenderNestedColorPicker>[0]> = [];
    mount({
      html: WITH_SHADER,
      renderColorPicker: (request) => {
        requests.push(request);
        return <div data-testid="nested" />;
      },
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Color 2 Edit color"]',
        )!
        .click(),
    );

    const request = last(requests)!;
    expect(request.css).toBe("#a18cd1");
    expect(request.opaqueSrgb).toBe(true);
    expect(
      request.anchor.contains(
        container.querySelector('input[aria-label="Color 2 hex"]'),
      ),
    ).toBe(true);
  });

  it("writes a color from the nested picker as #rrggbb, dropping any opacity it was given", async () => {
    const requests: Array<Parameters<RenderNestedColorPicker>[0]> = [];
    mount({
      html: WITH_SHADER,
      renderColorPicker: (request) => {
        requests.push(request);
        return null;
      },
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Color 1 Edit color"]',
        )!
        .click(),
    );

    await act(async () => last(requests)!.onCommit("rgba(0, 255, 0, 0.5)"));

    expect(mocks.applied).toHaveLength(1);
    expect(lastWrittenHtml()).toContain("#00ff00");
    expect(lastWrittenHtml()).not.toContain("rgba(0, 255, 0");
  });

  it("does not write a color that is not one", async () => {
    const requests: Array<Parameters<RenderNestedColorPicker>[0]> = [];
    mount({
      html: WITH_SHADER,
      renderColorPicker: (request) => {
        requests.push(request);
        return null;
      },
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Color 1 Edit color"]',
        )!
        .click(),
    );

    await act(async () => last(requests)!.onCommit("not a color"));

    expect(mocks.applied).toHaveLength(0);
  });
});

/**
 * Like `mount`, but the editor behind it keeps the HTML: a write lands in what
 * the pane reads next, as it does in the real editor.
 */
function mountLive(initial: string) {
  let current = initial;
  mocks.callAction.mockImplementation((name: string) => {
    if (name === "read-source-file") {
      return Promise.resolve({
        content: current,
        versionHash: "v1",
        fileId: "file_1",
      });
    }
    throw new Error(`unexpected callAction: ${name}`);
  });
  function Editor() {
    const [content, setContent] = useState(initial);
    return (
      <TooltipProvider>
        <ShaderPane
          context={{
            designId: "design_1",
            fileId: "file_1",
            content,
            nodeId: "hero",
            onApplied: (_fileId, next) => {
              current = next;
              setContent(next);
            },
          }}
          disabled={false}
          controllerRef={controllerRef}
          onRemoved={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  act(() => root.render(<Editor />));
}

const pane = () =>
  container.querySelector<HTMLElement>("[data-shader-pane]")?.dataset
    .shaderPane;
const presetSelect = () =>
  container.querySelector<HTMLElement>('[role="combobox"]');

describe("which of the pane's views shows", () => {
  it("is the browser while the element has no shader: search, Created by you, Create with AI and the presets", () => {
    mount({ html: BASE_HTML });

    expect(pane()).toBe("browse");
    expect(
      container.querySelector('input[aria-label="Search shaders"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Created by you");
    expect(button("Create with AI")).toBeDefined();
    expect(button("Mesh Gradient")).toBeDefined();
    expect(presetSelect()).toBeNull();
  });

  it("is the controls of the element's own shader, not the browser, once it has one", () => {
    mount({ html: WITH_SHADER });

    expect(pane()).toBe("controls");
    expect(button("Create with AI")).toBeUndefined();
    expect(
      container.querySelector('input[aria-label="Search shaders"]'),
    ).toBeNull();
    expect(presetSelect()?.textContent).toBe("Mesh Gradient");
  });

  it("switches from the browser to the picked shader's controls", async () => {
    mountLive(BASE_HTML);
    expect(pane()).toBe("browse");

    await act(async () => button("Nebula")!.click());

    expect(pane()).toBe("controls");
    expect(presetSelect()?.textContent).toBe("Nebula");
  });

  it("shows Custom for a shader that is not a preset, with the controls that shader exposes", () => {
    mount({
      html: applyShaderToHtml(BASE_HTML, {
        nodeId: "hero",
        def: AI_DEF,
        fallbackColor: "#4f2d8f",
      }).html,
    });

    expect(pane()).toBe("controls");
    expect(presetSelect()?.textContent).toBe("Custom");
    // Its own uniforms, by its own labels: a color and a slider, no Drift or Blend.
    expect(
      container.querySelector('input[aria-label="Base hex"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Speed"] [role="slider"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Drift"]')).toBeNull();
  });

  it("shows Custom for a preset whose code was edited", () => {
    const edited = applyShaderToHtml(BASE_HTML, {
      nodeId: "hero",
      def: {
        ...stampedMesh,
        glsl: stampedMesh.glsl.replace(
          "void main() {",
          "// tweaked\nvoid main() {",
        ),
      },
      fallbackColor: "#ff9a9e",
    }).html;
    mount({ html: edited });

    expect(presetSelect()?.textContent).toBe("Custom");
  });

  it("says so when the element points at a shader whose code is not in the design, and still lets it go", async () => {
    const dangling = BASE_HTML.replace(
      'data-agent-native-node-id="hero"',
      `data-agent-native-node-id="hero" data-an-shader-fill="${AI_ID}"`,
    );
    mount({ html: dangling });

    expect(pane()).toBe("missing");
    expect(container.textContent).toContain("code is missing");
    expect(button("Create with AI")).toBeUndefined();

    await act(async () => button("Remove shader")!.click());
    expect(lastWrittenHtml()).not.toContain("data-an-shader-fill");
  });

  it("clears the search once a preset is picked, so the preset select still lists them all", async () => {
    mountLive(BASE_HTML);
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search shaders"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "nebula");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Nebula")!.click());

    await act(async () => {
      presetSelect()!.focus();
      presetSelect()!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(FIGMA_PRESETS));
  });
});

/**
 * What the agent really writes for "Create with AI". It has no way to run the
 * apply helper from chat, so it hand-writes the whole thing into the screen
 * HTML: the definition block, the element's attributes (the skill documents the
 * overrides in single quotes, since the JSON holds double quotes), and a private
 * runtime of its own under the framework's marker.
 */
const CANOPY_ID = "an-shader-canopy-01";
const CANOPY_BLOCK = `<script type="application/x-agent-native-shader" data-shader-id="${CANOPY_ID}" data-shader-name="Citrus Canopy" data-shader-mode="fill">
/*! an-shader v1
{
  "uniforms": {
    "u_base": { "type": "color", "value": "#173c35", "label": "Forest" },
    "u_citrus": { "type": "color", "value": "#d8df91", "label": "Citrus" },
    "u_coral": { "type": "color", "value": "#d78069", "label": "Coral" },
    "u_speed": { "type": "float", "value": 0.22, "min": 0, "max": 1, "step": 0.01, "label": "Drift speed" },
    "u_glow": { "type": "float", "value": 0.82, "min": 0, "max": 1.5, "step": 0.01, "label": "Glow" }
  }
}
*/
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_base;
uniform vec3 u_citrus;
uniform vec3 u_coral;
uniform float u_speed;
uniform float u_glow;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 color = mix(u_base, u_citrus, uv.x * u_glow * sin(u_time * u_speed));
  gl_FragColor = vec4(mix(color, u_coral, uv.y * 0.3), 1.0);
}
</script>`;
const PRIVATE_RUNTIME = `<script data-agent-native-shader-runtime data-runtime-version="1">
(() => { document.querySelectorAll('[data-an-shader-fill]').forEach(() => { /* a private WebGL loop */ }); })();
</script>`;
const HAND_WRITTEN = `<html><body><div data-agent-native-node-id="hero" data-an-shader-fill="${CANOPY_ID}" data-an-shader-uniforms='{"u_speed":0.5,"u_glow":1.1}' style="background-color: #173c35"></div>
${CANOPY_BLOCK}
${PRIVATE_RUNTIME}
</body></html>`;

const numberField = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("a shader the agent wrote into the HTML by hand", () => {
  it("has a control for every knob its manifest declares, under the labels it gave them", () => {
    mount({ html: HAND_WRITTEN });

    expect(pane()).toBe("controls");
    expect(presetSelect()?.textContent).toBe("Custom");
    for (const color of ["Forest", "Citrus", "Coral"]) {
      expect(
        container.querySelector(`input[aria-label="${color} hex"]`),
      ).not.toBeNull();
    }
    for (const knob of ["Drift speed", "Glow"]) {
      expect(
        container.querySelector(`[aria-label="${knob}"] [role="slider"]`),
      ).not.toBeNull();
    }
  });

  it("shows the values the agent put on the element, in the single quotes the skill documents", () => {
    mount({ html: HAND_WRITTEN });

    expect(numberField("Drift speed value").value).toBe("0.5");
    expect(numberField("Glow value").value).toBe("1.1");
  });

  it("writes a change next to the values the agent set, and moves the live canvas", async () => {
    mountLive(HAND_WRITTEN);
    const frame = document.createElement("iframe");
    const posted: unknown[] = [];
    Object.defineProperty(frame, "contentWindow", {
      value: { postMessage: (message: unknown) => posted.push(message) },
    });
    document.body.append(frame);

    const glow = numberField("Glow value");
    await act(async () => typeInto(glow, "1.3"));
    await act(async () => {
      glow.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    frame.remove();

    expect(posted).toContainEqual({
      type: "glsl-shader-set-uniform",
      filter: { shaderId: CANOPY_ID, nodeId: "hero" },
      name: "u_glow",
      value: 1.3,
    });
    const written = lastWrittenHtml()!;
    expect(listShaderMounts(written)[0]?.values).toMatchObject({
      u_glow: 1.3,
      u_speed: 0.5,
    });
  });

  it("falls back to a readable name for a knob that has no label", () => {
    const unlabeled = HAND_WRITTEN.replace(
      /"u_speed": \{[^}]*\}/,
      '"uDrift": { "type": "float", "value": 0.3 }',
    )
      .replace(
        /"u_glow": \{[^}]*\}/,
        '"u_glow_amount": { "type": "float", "value": 0.4 }',
      )
      .replace(/uniform float u_speed;/, "uniform float uDrift;")
      .replace(/uniform float u_glow;/, "uniform float u_glow_amount;");
    mount({ html: unlabeled });

    for (const knob of ["Drift", "Glow amount"]) {
      expect(
        container.querySelector(`[aria-label="${knob}"] [role="slider"]`),
      ).not.toBeNull();
    }
  });
});
