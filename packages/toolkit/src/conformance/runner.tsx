import {
  createElement,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { DESIGN_SYSTEM_CONTRACT_VERSION } from "../design-system/types.js";
import type { DesignSystemComponents } from "../design-system/types.js";
import type {
  DesignSystemConformanceCategory,
  DesignSystemConformanceCheckResult,
  DesignSystemConformanceReport,
  RunDesignSystemConformanceOptions,
} from "./types.js";
import { assertDesignSystemContractVersion } from "./version.js";

interface MountedProbe {
  container: HTMLDivElement;
  root: Root;
}

interface CheckContext {
  components: DesignSystemComponents;
  document: Document;
  mount(element: ReactElement): MountedProbe;
  unmount(probe: MountedProbe): void;
  settle(): Promise<void>;
}

interface ConformanceCheck {
  id: string;
  category: DesignSystemConformanceCategory;
  components: readonly (keyof DesignSystemComponents)[];
  run(context: CheckContext): void | Promise<void>;
}

const contractComponentNames = [
  "ActionButton",
  "IconButton",
  "TextField",
  "TextArea",
  "Spinner",
  "Skeleton",
  "Status",
  "Surface",
  "Avatar",
  "Tooltip",
  "Menu",
  "Popover",
  "Dialog",
  "Picker",
  "Checkbox",
  "Switch",
  "Tabs",
] as const satisfies readonly (keyof DesignSystemComponents)[];

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function dispatch(element: Element, event: Event): void {
  flushSync(() => element.dispatchEvent(event));
}

function click(element: Element, document: Document): void {
  for (const type of ["pointerdown", "mousedown"]) {
    dispatch(
      element,
      new document.defaultView!.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  }
  dispatch(
    element,
    new document.defaultView!.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
}

function keydown(element: Element, key: string, document: Document): void {
  dispatch(
    element,
    new document.defaultView!.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof element.ownerDocument.defaultView!.HTMLTextAreaElement
      ? element.ownerDocument.defaultView!.HTMLTextAreaElement.prototype
      : element.ownerDocument.defaultView!.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    element,
    value,
  );
  dispatch(
    element,
    new element.ownerDocument.defaultView!.Event("input", {
      bubbles: true,
      cancelable: true,
    }),
  );
}

function elementWithText(document: Document, selector: string, text: string) {
  return [...document.querySelectorAll(selector)].find((element) =>
    element.textContent?.includes(text),
  );
}

const checks: readonly ConformanceCheck[] = [
  {
    id: "contract.components",
    category: "contract",
    components: contractComponentNames,
    run: ({ components }) => {
      for (const name of contractComponentNames) {
        invariant(
          typeof components[name] === "function",
          `${name} must be supplied as a React component.`,
        );
      }
    },
  },
  {
    id: "leaf.action-button",
    category: "leaf",
    components: ["ActionButton"],
    run: ({ components, document, mount, unmount }) => {
      let presses = 0;
      const probe = mount(
        <components.ActionButton
          intent="danger"
          emphasis="outline"
          size="compact"
          onPress={() => presses++}
        >
          Remove
        </components.ActionButton>,
      );
      const button = probe.container.querySelector("button");
      invariant(button, "ActionButton must render an operable button.");
      click(button, document);
      invariant(presses === 1, "ActionButton must call onPress once.");
      unmount(probe);
    },
  },
  {
    id: "leaf.icon-button",
    category: "leaf",
    components: ["IconButton"],
    run: ({ components, document, mount, unmount }) => {
      let presses = 0;
      const probe = mount(
        <components.IconButton
          label="Close panel"
          icon={<span aria-hidden="true">x</span>}
          onPress={() => presses++}
        />,
      );
      const button = probe.container.querySelector(
        'button[aria-label="Close panel"]',
      );
      invariant(
        button,
        "IconButton must expose its label as an accessible name.",
      );
      click(button, document);
      invariant(presses === 1, "IconButton must call onPress once.");
      unmount(probe);
    },
  },
  {
    id: "leaf.text-field",
    category: "leaf",
    components: ["TextField"],
    run: ({ components, mount, unmount }) => {
      let value = "";
      const probe = mount(
        <components.TextField
          aria-label="Project name"
          value={value}
          onChange={(next) => (value = next)}
        />,
      );
      const field = probe.container.querySelector("input");
      invariant(field, "TextField must render an input.");
      input(field, "Atlas");
      invariant(value === "Atlas", "TextField must report string values.");
      unmount(probe);
    },
  },
  {
    id: "leaf.text-area",
    category: "leaf",
    components: ["TextArea"],
    run: ({ components, mount, unmount }) => {
      let value = "";
      const probe = mount(
        <components.TextArea
          aria-label="Notes"
          value={value}
          onChange={(next) => (value = next)}
        />,
      );
      const field = probe.container.querySelector("textarea");
      invariant(field, "TextArea must render a textarea.");
      input(field, "Conformant");
      invariant(value === "Conformant", "TextArea must report string values.");
      unmount(probe);
    },
  },
  {
    id: "leaf.progress-and-placeholder",
    category: "leaf",
    components: ["Spinner", "Skeleton"],
    run: ({ components, mount, unmount }) => {
      const probe = mount(
        <>
          <components.Spinner label="Loading records" size="compact" />
          <components.Skeleton width={48} height={12} shape="line" />
        </>,
      );
      invariant(
        probe.container.querySelector('[role="status"]'),
        "A labeled Spinner must expose status semantics.",
      );
      invariant(
        probe.container.querySelector('[aria-hidden="true"]'),
        "Skeleton must be hidden from assistive technology.",
      );
      unmount(probe);
    },
  },
  {
    id: "leaf.status-surface-avatar",
    category: "leaf",
    components: ["Status", "Surface", "Avatar"],
    run: ({ components, document, mount, unmount }) => {
      let presses = 0;
      const probe = mount(
        <>
          <components.Status tone="success">Connected</components.Status>
          <components.Surface interactive onPress={() => presses++}>
            Open workspace
          </components.Surface>
          <components.Avatar name="Ada Lovelace" fallback="AL" />
        </>,
      );
      invariant(
        probe.container.textContent?.includes("Connected"),
        "Status must render its content.",
      );
      const surface = elementWithText(
        document,
        '[role="button"]',
        "Open workspace",
      );
      invariant(
        surface,
        "An interactive Surface must expose button semantics.",
      );
      keydown(surface, "Enter", document);
      invariant(
        presses === 1,
        "An interactive Surface must support keyboard press.",
      );
      invariant(
        probe.container.textContent?.includes("AL"),
        "Avatar must render a fallback when no image is supplied.",
      );
      unmount(probe);
    },
  },
  {
    id: "behavior.tooltip",
    category: "behavior",
    components: ["Tooltip"],
    run: async ({ components, document, mount, settle, unmount }) => {
      const portal = document.createElement("div");
      portal.dataset.conformancePortal = "true";
      document.body.appendChild(portal);
      const probe = mount(
        <components.Tooltip
          trigger={<button>Help</button>}
          content="Helpful context"
          open
          portalContainer={portal}
        />,
      );
      await settle();
      invariant(
        portal.textContent?.includes("Helpful context"),
        "Tooltip must honor controlled open and portalContainer.",
      );
      unmount(probe);
      portal.remove();
    },
  },
  {
    id: "behavior.menu",
    category: "behavior",
    components: ["Menu"],
    run: async ({ components, document, mount, settle, unmount }) => {
      let selected: string | number | undefined;
      const probe = mount(
        <components.Menu
          trigger={<button>Actions</button>}
          items={[{ id: "archive", label: "Archive" }]}
          open
          onAction={(id) => (selected = id)}
        />,
      );
      await settle();
      const item = elementWithText(document, '[role="menuitem"]', "Archive");
      invariant(item, "Menu must render open items with menuitem semantics.");
      click(item, document);
      invariant(selected === "archive", "Menu must report selected item ids.");
      unmount(probe);
    },
  },
  {
    id: "behavior.popover",
    category: "behavior",
    components: ["Popover"],
    run: async ({ components, document, mount, settle, unmount }) => {
      const portal = document.createElement("div");
      portal.dataset.conformancePortal = "true";
      document.body.appendChild(portal);
      const probe = mount(
        <components.Popover
          trigger={<button>Details</button>}
          open
          portalContainer={portal}
        >
          Popover details
        </components.Popover>,
      );
      await settle();
      invariant(
        portal.textContent?.includes("Popover details"),
        "Popover must honor controlled open and portalContainer.",
      );
      unmount(probe);
      portal.remove();
    },
  },
  {
    id: "behavior.dialog",
    category: "behavior",
    components: ["Dialog"],
    run: async ({ components, document, mount, settle, unmount }) => {
      const portal = document.createElement("div");
      portal.dataset.conformancePortal = "true";
      document.body.appendChild(portal);
      const probe = mount(
        <components.Dialog
          open
          onOpenChange={() => {}}
          title="Edit project"
          portalContainer={portal}
        >
          <input aria-label="Project title" />
        </components.Dialog>,
      );
      await settle();
      invariant(
        portal.querySelector('[role="dialog"]'),
        "Dialog must expose dialog semantics.",
      );
      invariant(
        portal.textContent?.includes("Edit project"),
        "Dialog must expose its title and honor portalContainer.",
      );
      unmount(probe);
      portal.remove();
    },
  },
  {
    id: "behavior.picker",
    category: "behavior",
    components: ["Picker"],
    run: async ({ components, document, mount, settle, unmount }) => {
      let value: string | null = null;
      const probe = mount(
        <components.Picker
          mode="select"
          aria-label="Owner"
          options={[{ value: "ada", label: "Ada" }]}
          value={value}
          onChange={(next) => (value = next)}
          open
        />,
      );
      await settle();
      const option = elementWithText(document, '[role="option"]', "Ada");
      invariant(option, "An open Picker must expose options.");
      click(option, document);
      invariant(value === "ada", "Picker must report option values.");
      unmount(probe);
    },
  },
  {
    id: "behavior.checkbox-switch",
    category: "behavior",
    components: ["Checkbox", "Switch"],
    run: ({ components, document, mount, unmount }) => {
      let checked = false;
      let switched = false;
      const probe = mount(
        <>
          <components.Checkbox
            aria-label="Include archived"
            checked={checked}
            onChange={(next) => (checked = next)}
          />
          <components.Switch
            aria-label="Notifications"
            checked={switched}
            onChange={(next) => (switched = next)}
          />
        </>,
      );
      const checkbox = probe.container.querySelector('[role="checkbox"]');
      const toggle = probe.container.querySelector('[role="switch"]');
      invariant(checkbox, "Checkbox must expose checkbox semantics.");
      invariant(toggle, "Switch must expose switch semantics.");
      click(checkbox, document);
      click(toggle, document);
      invariant(
        checked && switched,
        "Checkbox and Switch must report state changes.",
      );
      unmount(probe);
    },
  },
  {
    id: "behavior.tabs",
    category: "behavior",
    components: ["Tabs"],
    run: ({ components, document, mount, unmount }) => {
      let value = "first";
      const probe = mount(
        <components.Tabs
          value={value}
          onChange={(next) => (value = next)}
          items={[
            { value: "first", label: "First", content: "One" },
            { value: "second", label: "Second", content: "Two" },
          ]}
        />,
      );
      const second = elementWithText(document, '[role="tab"]', "Second");
      invariant(second, "Tabs must expose tab semantics.");
      click(second, document);
      invariant(value === "second", "Tabs must report selected values.");
      unmount(probe);
    },
  },
  {
    id: "overlay.portal-and-z-index-stacking",
    category: "overlay-interoperability",
    components: ["Dialog", "Popover", "Menu", "Tooltip", "Picker"],
    run: async ({ components, document, mount, settle, unmount }) => {
      const radixHost = document.createElement("div");
      radixHost.dataset.hostedOverlay = "radix";
      radixHost.dataset.conformancePortal = "true";
      radixHost.style.zIndex = "40";
      document.body.appendChild(radixHost);
      const customerOverlayLayer = document.createElement("div");
      customerOverlayLayer.dataset.designSystemOverlayLayer = "true";
      customerOverlayLayer.dataset.conformancePortal = "true";
      customerOverlayLayer.style.position = "relative";
      customerOverlayLayer.style.zIndex = "50";
      document.body.appendChild(customerOverlayLayer);
      const probe = mount(
        <components.Dialog
          open
          onOpenChange={() => {}}
          title="Stacking probe"
          portalContainer={customerOverlayLayer}
        >
          Overlay content
        </components.Dialog>,
      );
      await settle();
      invariant(
        customerOverlayLayer.querySelector('[role="dialog"]'),
        "Behavior adapters must portal into the supplied stacking layer so they can interoperate with Radix-hosted surfaces.",
      );
      invariant(
        Number(customerOverlayLayer.style.zIndex) >
          Number(radixHost.style.zIndex),
        "The supplied design-system portal layer must be able to stack above an existing hosted overlay.",
      );
      unmount(probe);
      customerOverlayLayer.remove();
      radixHost.remove();
    },
  },
  {
    id: "overlay.focus-interoperability",
    category: "overlay-interoperability",
    components: ["Dialog", "Popover"],
    run: async ({ components, document, mount, settle, unmount }) => {
      function FocusProbe() {
        const [open, setOpen] = useState(true);
        const initialFocusRef = useRef<HTMLInputElement>(null);
        const restoreFocusRef = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button ref={restoreFocusRef}>Hosted trigger</button>
            <components.Dialog
              open={open}
              onOpenChange={setOpen}
              title="Focus probe"
              initialFocusRef={initialFocusRef}
              restoreFocusRef={restoreFocusRef}
            >
              <input ref={initialFocusRef} aria-label="Initial focus" />
              <button onClick={() => setOpen(false)}>Close probe</button>
            </components.Dialog>
          </>
        );
      }
      const probe = mount(<FocusProbe />);
      await settle();
      const initial = document.querySelector<HTMLInputElement>(
        'input[aria-label="Initial focus"]',
      );
      invariant(initial, "Dialog must render its initial focus target.");
      invariant(
        document.activeElement === initial,
        "Dialog must honor initialFocusRef across adapter overlay implementations.",
      );
      const close = elementWithText(document, "button", "Close probe");
      invariant(close, "Focus probe close control did not render.");
      click(close, document);
      await settle();
      invariant(
        document.activeElement?.textContent === "Hosted trigger",
        "Dialog must restore focus to a hosted trigger after its native overlay closes.",
      );
      unmount(probe);
    },
  },
];

export const DESIGN_SYSTEM_CONFORMANCE_CHECKS = checks.map(
  ({ id, category, components }) => ({ id, category, components }),
);

export async function runDesignSystemConformance({
  adapterName = "custom adapter",
  components,
  contractVersion,
  document: suppliedDocument,
}: RunDesignSystemConformanceOptions): Promise<DesignSystemConformanceReport> {
  const document = suppliedDocument ?? globalThis.document;
  if (!document?.body || !document.defaultView) {
    throw new Error(
      "runDesignSystemConformance requires a browser-like document, such as Playwright, jsdom, or happy-dom.",
    );
  }

  const results: DesignSystemConformanceCheckResult[] = [];
  try {
    assertDesignSystemContractVersion(contractVersion);
    results.push({
      id: "contract.version-policy",
      category: "contract",
      components: [],
      passed: true,
    });
  } catch (error) {
    results.push({
      id: "contract.version-policy",
      category: "contract",
      components: [],
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const mounted = new Set<MountedProbe>();
  const context: CheckContext = {
    components,
    document,
    mount(element) {
      const container = document.createElement("div");
      container.dataset.conformanceRoot = "true";
      document.body.appendChild(container);
      const root = createRoot(container);
      const probe = { container, root };
      mounted.add(probe);
      flushSync(() => root.render(element));
      return probe;
    },
    unmount(probe) {
      if (!mounted.delete(probe)) return;
      flushSync(() => probe.root.unmount());
      probe.container.remove();
    },
    async settle() {
      await new Promise<void>((resolve) =>
        document.defaultView!.setTimeout(resolve, 0),
      );
    },
  };

  for (const check of checks) {
    try {
      await check.run(context);
      results.push({
        id: check.id,
        category: check.category,
        components: check.components,
        passed: true,
      });
    } catch (error) {
      results.push({
        id: check.id,
        category: check.category,
        components: check.components,
        passed: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      for (const probe of [...mounted]) context.unmount(probe);
      document
        .querySelectorAll("[data-radix-popper-content-wrapper]")
        .forEach((element) => element.remove());
      document
        .querySelectorAll('[data-conformance-portal="true"]')
        .forEach((element) => element.remove());
    }
  }

  const report: DesignSystemConformanceReport = {
    adapterName,
    contractVersion: DESIGN_SYSTEM_CONTRACT_VERSION,
    passed: results.every((result) => result.passed),
    results,
  };
  return report;
}

export async function assertDesignSystemConformance(
  options: RunDesignSystemConformanceOptions,
): Promise<DesignSystemConformanceReport> {
  const report = await runDesignSystemConformance(options);
  if (!report.passed) {
    const { DesignSystemConformanceError } = await import("./types.js");
    throw new DesignSystemConformanceError(report);
  }
  return report;
}

export function renderDesignSystemConformanceFixture(
  components: DesignSystemComponents,
): ReactNode {
  return createElement(components.Status, {
    tone: "info",
    children: "Adapter loaded",
  });
}
