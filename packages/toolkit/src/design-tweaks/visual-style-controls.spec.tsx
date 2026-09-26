// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VisualColorPicker,
  VisualScrubInput,
  VisualSegmentedControl,
  parseScrubExpression,
  parseScrubRelativeExpression,
} from "./visual-style-controls.js";

describe("visual style controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses replacement and appended math without treating a leading operator as relative", () => {
    expect(parseScrubExpression("-5", 100)?.value).toBe(-5);
    expect(parseScrubExpression("+5", 100)?.value).toBe(5);
    expect(parseScrubExpression("*2", 10)).toBeNull();
    expect(parseScrubExpression("10px*2", 10, { unit: "px" })?.value).toBe(20);
    expect(parseScrubExpression("(10+5)*2", 0, { unit: "px" })?.value).toBe(30);
    expect(parseScrubExpression("2^3", 0)?.value).toBe(8);
    expect(parseScrubExpression("-2^2", 0)?.value).toBe(-4);
    expect(parseScrubExpression("-(2+3)", 0)?.value).toBe(-5);
    expect(parseScrubExpression("2^-2", -5)).toBeNull();
    expect(parseScrubExpression("2^(-2)", -5)?.value).toBe(0.25);
    expect(parseScrubExpression("(x/2)+6", 10)?.value).toBe(11);
    expect(parseScrubRelativeExpression("Mixed+100", 10)?.value).toBe(110);
    expect(
      parseScrubRelativeExpression(
        "Valores mixtos+100",
        10,
        {},
        "Valores mixtos",
      )?.value,
    ).toBe(110);
    expect(parseScrubExpression("1 2+", 0)).toBeNull();
    expect(parseScrubExpression("1+2+", 0)).toBeNull();
    expect(parseScrubExpression("1(2)", 0)).toBeNull();
  });

  it.each([false, true])(
    "only emits mixed-token math for consumers that support it (enabled=%s)",
    (allowRelativeExpressions) => {
      const onChange = vi.fn();
      act(() => {
        root.render(
          <VisualScrubInput
            label="Width"
            value={10}
            unit="px"
            mixed
            mixedLabel="Valores mixtos"
            {...(allowRelativeExpressions ? { allowRelativeExpressions } : {})}
            onChange={onChange}
          />,
        );
      });

      const input = container.querySelector<HTMLInputElement>("input")!;
      act(() => input.focus());
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, "Valores mixtos+100");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });

      if (!allowRelativeExpressions) {
        expect(onChange).not.toHaveBeenCalled();
        expect(input.value).toBe("Valores mixtos");
        return;
      }
      expect(onChange).toHaveBeenCalledWith(
        110,
        expect.objectContaining({
          source: "commit",
          relativeExpression: expect.objectContaining({
            expression: "Mixed+100",
            unit: "px",
          }),
        }),
      );
    },
  );

  it("starts a base-rate scrub when Option-drag begins on the numeric input", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <VisualScrubInput label="Width" value={10} onChange={onChange} />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    const dragContainer = container.firstElementChild as HTMLDivElement;
    dragContainer.setPointerCapture = vi.fn();
    dragContainer.releasePointerCapture = vi.fn();
    const pointer = (
      type: string,
      clientX: number,
      altKey: boolean,
    ): PointerEvent =>
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 1,
        clientX,
        button: 0,
        altKey,
      }) as unknown as PointerEvent;

    act(() => input.dispatchEvent(pointer("pointerdown", 0, true)));
    act(() => dragContainer.dispatchEvent(pointer("pointermove", 10, true)));
    expect(onChange).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        source: "scrub",
        phase: "preview",
        altKey: true,
      }),
    );
    act(() => dragContainer.dispatchEvent(pointer("pointerup", 10, true)));
    expect(onChange).toHaveBeenLastCalledWith(
      20,
      expect.objectContaining({
        source: "scrub",
        phase: "commit",
        altKey: true,
      }),
    );
    expect(dragContainer.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("restores the pointerdown value and cancels instead of committing on pointercancel", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <VisualScrubInput label="Width" value={10} onChange={onChange} />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    const dragContainer = container.firstElementChild as HTMLDivElement;
    dragContainer.setPointerCapture = vi.fn();
    dragContainer.hasPointerCapture = vi.fn(() => true);
    dragContainer.releasePointerCapture = vi.fn();
    const pointer = (type: string, clientX: number): PointerEvent =>
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 1,
        clientX,
        button: 0,
        altKey: true,
      }) as unknown as PointerEvent;

    act(() => input.dispatchEvent(pointer("pointerdown", 0)));
    act(() => dragContainer.dispatchEvent(pointer("pointermove", 10)));
    act(() => dragContainer.dispatchEvent(pointer("pointercancel", 10)));

    expect(onChange.mock.calls).toEqual([
      [20, expect.objectContaining({ source: "scrub", phase: "preview" })],
      [10, expect.objectContaining({ source: "scrub", phase: "preview" })],
      [10, expect.objectContaining({ source: "scrub", phase: "cancel" })],
    ]);
    expect(onChange.mock.calls[1]?.[1]).not.toHaveProperty("altKey");
    expect(onChange.mock.calls[2]?.[1]).not.toHaveProperty("altKey");
    expect(onChange).not.toHaveBeenCalledWith(
      20,
      expect.objectContaining({ phase: "commit" }),
    );
    expect(dragContainer.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(input.value).toBe("10");
  });

  it("restores the source text for a canceled scrub of a keyword-backed field", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({ accepted: false as const }));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={1.5}
          textValue="normal"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    const dragContainer = container.firstElementChild as HTMLDivElement;
    dragContainer.setPointerCapture = vi.fn();
    dragContainer.hasPointerCapture = vi.fn(() => true);
    dragContainer.releasePointerCapture = vi.fn();
    const pointer = (type: string, clientX: number): PointerEvent =>
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 2,
        clientX,
        button: 0,
        altKey: true,
      }) as unknown as PointerEvent;

    act(() => input.dispatchEvent(pointer("pointerdown", 0)));
    act(() => dragContainer.dispatchEvent(pointer("pointermove", 10)));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={18}
          textValue="18px"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });
    act(() => dragContainer.dispatchEvent(pointer("pointercancel", 10)));

    expect(onTextCommit).toHaveBeenNthCalledWith(
      1,
      "normal",
      expect.objectContaining({ source: "scrub", phase: "preview" }),
    );
    expect(onTextCommit).toHaveBeenNthCalledWith(
      2,
      "normal",
      expect.objectContaining({ source: "scrub", phase: "cancel" }),
    );
    expect(input.value).toBe("normal");
    const textCommitCalls = onTextCommit.mock.calls as unknown as Array<
      [string, Record<string, unknown>]
    >;
    expect(textCommitCalls[0]?.[1]).not.toHaveProperty("altKey");
    expect(textCommitCalls[1]?.[1]).not.toHaveProperty("altKey");
  });

  it("shows an honest mixed color instead of the fallback color", () => {
    act(() => {
      root.render(
        <VisualColorPicker
          label="Color"
          value="#000000"
          mixed
          mixedLabel="Mixed colors"
          onChange={() => {}}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Color"]',
    );
    expect(trigger?.textContent).toContain("Mixed colors");
    expect(trigger?.querySelector("span")?.style.background).toContain(
      "conic-gradient",
    );
  });

  it("uses opaque white and soft gray for transparent checkerboards", () => {
    act(() => {
      root.render(
        <VisualColorPicker
          label="Color"
          value="transparent"
          onChange={() => {}}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Color"]',
    );
    const checker = trigger?.querySelector("span");
    expect(checker?.style.backgroundColor).toBe("#ffffff");
    expect(checker?.style.background).toContain("conic-gradient");
    expect(checker?.style.background).toContain("#e5e5e5");
    expect(checker?.style.background).toContain("#ffffff");
    expect(checker?.style.background).not.toContain("transparent");
  });

  it("renders the filled color trigger without an outer border", () => {
    act(() => {
      root.render(
        <VisualColorPicker
          label="Fill"
          value="#609ff8"
          variant="filled"
          onChange={() => {}}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Fill"]',
    );
    expect(trigger?.classList.contains("border-0")).toBe(true);
    expect(trigger?.classList.contains("border")).toBe(false);
    expect(trigger?.className).toContain("bg-muted/80");
  });

  it("uses the numeric value after a mixed scrub field receives focus", () => {
    act(() => {
      root.render(
        <VisualScrubInput
          label="Width"
          value={24}
          unit="px"
          mixed
          mixedLabel="Mixed values"
          onChange={() => {}}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("Mixed values");

    act(() => input?.focus());
    expect(input?.value).toBe("24px");
  });

  it("commits on Enter and keeps focus for the next field keystroke", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <VisualScrubInput
          label="Weight"
          value={1}
          unit="px"
          onChange={onChange}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "2*3px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onChange).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ source: "commit" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("data-design-history-hotkeys")).toBe("true");
  });

  it("releases focus on Enter when the consumer opts in", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <VisualScrubInput
          label="Width"
          value={1}
          unit="px"
          blurOnEnter
          onChange={onChange}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "2*3px");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onChange).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ source: "commit" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it("commits opt-in raw text once without emitting a numeric change", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({
      accepted: true as const,
      displayValue: "150%",
    }));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={1.5}
          textValue="Auto"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "150%");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onTextCommit).toHaveBeenCalledTimes(1);
    expect(onTextCommit).toHaveBeenCalledWith(
      "150%",
      expect.objectContaining({ source: "commit", expression: "150%" }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("150%");
  });

  it("acknowledges a unit-only text update when the numeric value is unchanged", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({
      accepted: true as const,
      displayValue: "10em",
    }));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Width"
          value={10}
          textValue="10px"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "10em");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    act(() => {
      root.render(
        <VisualScrubInput
          label="Width"
          value={10}
          textValue="10em"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    expect(onTextCommit).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("10em");
  });

  it("allows explicit raw text on mixed selections but ignores the unchanged mixed label", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({
      accepted: true as const,
      displayValue: "150%",
    }));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={1.5}
          mixed
          mixedLabel="Mixed"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("Mixed");
    act(() => input.focus());
    expect(input.value).toBe("Mixed");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onTextCommit).not.toHaveBeenCalled();

    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "150%");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onTextCommit).toHaveBeenCalledTimes(1);
    expect(onTextCommit).toHaveBeenCalledWith(
      "150%",
      expect.objectContaining({ source: "commit" }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("150%");

    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={2}
          mixed
          mixedLabel="Mixed"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });
    expect(input.value).toBe("150%");
  });

  it("keeps numeric keyboard edits numeric in an opt-in text field", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({
      accepted: true as const,
      displayValue: "2",
    }));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={1}
          textValue="Auto"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(input.value).toBe("2");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ source: "keyboard" }),
    );
    expect(onTextCommit).not.toHaveBeenCalled();
  });

  it("restores authoritative text after rejection and Escape", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({ accepted: false as const }));
    act(() => {
      root.render(
        <VisualScrubInput
          label="Line height"
          value={1.5}
          textValue="Auto"
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "invalid");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(input.value).toBe("Auto");

    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "150%");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onTextCommit).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("Auto");
  });

  it("lets an accepted raw commit supersede an unacknowledged numeric commit", () => {
    const onChange = vi.fn();
    const onTextCommit = vi.fn(() => ({
      accepted: true as const,
      displayValue: "150%",
    }));
    const renderInput = (value: number, textValue: string) =>
      root.render(
        <VisualScrubInput
          label="Line height"
          value={value}
          textValue={textValue}
          blurOnEnter
          onChange={onChange}
          onTextCommit={onTextCommit}
        />,
      );
    act(() => renderInput(1, "Auto"));

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ source: "keyboard" }),
    );
    expect(input.value).toBe("2");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "150%");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(input.value).toBe("150%");

    act(() => renderInput(2, "Auto"));
    expect(input.value).toBe("150%");
    act(() => renderInput(1, "normal"));

    expect(input.value).toBe("normal");
    expect(onTextCommit).toHaveBeenCalledTimes(1);
  });

  it("cancels a draft on Escape without committing it", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <VisualScrubInput
          label="Weight"
          value={1}
          unit="px"
          onChange={onChange}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "8");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe("1px");
  });

  it("supports a compact icon prefix without removing the accessible label", () => {
    const TestIcon = ({
      className,
      "aria-hidden": ariaHidden,
    }: {
      className?: string;
      "aria-hidden"?: boolean;
    }) => (
      <svg
        data-testid="scrub-icon"
        className={className}
        aria-hidden={ariaHidden}
      />
    );

    act(() => {
      root.render(
        <VisualScrubInput
          label="Corner radius"
          value={12}
          unit="px"
          icon={TestIcon}
          prefix="icon"
          onChange={() => {}}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input");
    const label = container.querySelector<HTMLLabelElement>("label");
    expect(label?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(label?.className).toContain("w-8");
    expect(label?.querySelector("span")?.textContent).toBe("Corner radius");
    expect(label?.querySelector("span")?.className).toContain("sr-only");
    expect(label?.htmlFor).toBe(input?.id);
  });

  it("keeps labels single-line while the numeric input fills the remaining row", () => {
    act(() => {
      root.render(
        <VisualScrubInput
          label="A long numeric property label"
          value={12}
          onChange={() => {}}
        />,
      );
    });

    const row = container.querySelector("div");
    const label = container.querySelector("label");
    const input = container.querySelector("input");
    expect(row?.className).toContain("min-w-0");
    expect(label?.className).toContain("whitespace-nowrap");
    expect(label?.querySelector("span")?.className).toContain("truncate");
    expect(input?.className).toContain("w-0");
    expect(input?.className).toContain("flex-1");
  });

  it("leaves every segment unselected for a mixed value", () => {
    act(() => {
      root.render(
        <VisualSegmentedControl
          options={[
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
          ]}
          value={null}
          onChange={() => {}}
        />,
      );
    });

    expect(
      container.querySelectorAll(".bg-accent.text-foreground"),
    ).toHaveLength(0);
  });
});
