// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearNativeAuthoredOpacityIfUnsuppressed,
  readNativeAuthoredPaint,
} from "./native-authored-paint";

const ATTRIBUTES = [
  "data-an-native-fill-suppressed",
  "data-an-native-text-suppressed",
  "data-an-native-layer-suppressed",
  "data-an-native-scene-suppressed",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("authored native paint snapshot", () => {
  it("reads one immutable unsuppressed box and text snapshot with Fill and Layer on the same target", () => {
    const target = document.createElement("div");
    document.body.append(target);
    for (const attribute of ATTRIBUTES) target.setAttribute(attribute, "");
    const observed: string[][] = [];
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if (element !== target) throw new Error("Wrong authored target");
      observed.push(
        ATTRIBUTES.filter((attribute) => target.hasAttribute(attribute)),
      );
      return {
        opacity: "0.65",
        backgroundColor: "rgba(10, 20, 30, 0.5)",
        backgroundImage: "none",
        borderTopColor: "rgb(1, 2, 3)",
        borderRightColor: "rgb(4, 5, 6)",
        borderBottomColor: "rgb(7, 8, 9)",
        borderLeftColor: "rgb(10, 11, 12)",
        borderImageSource: "none",
        color: "rgb(30, 40, 50)",
        getPropertyValue: (property: string) =>
          property === "-webkit-text-fill-color" ? "rgb(60, 70, 80)" : "",
      } as CSSStyleDeclaration;
    });
    const snapshot = readNativeAuthoredPaint(target);
    expect(observed).toEqual([[]]);
    expect(snapshot).toMatchObject({
      opacity: 0.65,
      backgroundColor: "rgba(10, 20, 30, 0.5)",
      borderRightColor: "rgb(4, 5, 6)",
      color: "rgb(30, 40, 50)",
      textFillColor: "rgb(60, 70, 80)",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const attribute of ATTRIBUTES)
      expect(target.hasAttribute(attribute)).toBe(true);
  });

  it("refreshes authored opacity through scene suppression on consecutive frames", () => {
    const target = document.createElement("div");
    document.body.append(target);
    target.setAttribute("data-an-native-scene-suppressed", "");
    let authoredOpacity = "0.5";
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      expect(element).toBe(target);
      expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(
        false,
      );
      return {
        opacity: authoredOpacity,
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "none",
        borderTopColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        borderImageSource: "none",
        color: "rgb(0, 0, 0)",
        getPropertyValue: () => "",
      } as unknown as CSSStyleDeclaration;
    });
    expect(readNativeAuthoredPaint(target).opacity).toBe(0.5);
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    authoredOpacity = "0.25";
    expect(readNativeAuthoredPaint(target).opacity).toBe(0.25);
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
  });

  it("retains the shared authored opacity until both Fill and Layer suppression end", () => {
    const target = document.createElement("div");
    target.setAttribute("data-an-native-authored-opacity", "0.65");
    target.setAttribute("data-an-native-fill-suppressed", "");
    target.setAttribute("data-an-native-layer-suppressed", "");
    target.removeAttribute("data-an-native-fill-suppressed");
    clearNativeAuthoredOpacityIfUnsuppressed(target);
    expect(target.getAttribute("data-an-native-authored-opacity")).toBe("0.65");
    target.setAttribute("data-an-native-fill-suppressed", "");
    target.removeAttribute("data-an-native-layer-suppressed");
    clearNativeAuthoredOpacityIfUnsuppressed(target);
    expect(target.getAttribute("data-an-native-authored-opacity")).toBe("0.65");
    target.removeAttribute("data-an-native-fill-suppressed");
    target.setAttribute("data-an-native-scene-suppressed", "");
    clearNativeAuthoredOpacityIfUnsuppressed(target);
    expect(target.getAttribute("data-an-native-authored-opacity")).toBe("0.65");
    target.removeAttribute("data-an-native-scene-suppressed");
    clearNativeAuthoredOpacityIfUnsuppressed(target);
    expect(target.hasAttribute("data-an-native-authored-opacity")).toBe(false);
  });

  it("restores exactly the flags present before an unreadable or invalid style", () => {
    const target = document.createElement("div");
    document.body.append(target);
    target.setAttribute(ATTRIBUTES[0], "");
    target.setAttribute(ATTRIBUTES[2], "");
    const getStyle = vi.spyOn(window, "getComputedStyle");
    getStyle.mockImplementation(() => {
      throw new Error("unreadable CSS");
    });
    expect(() => readNativeAuthoredPaint(target)).toThrow("unreadable CSS");
    expect(
      ATTRIBUTES.map((attribute) => target.hasAttribute(attribute)),
    ).toEqual([true, false, true, false]);
    getStyle.mockImplementation(
      () => ({ opacity: "not-a-number" }) as CSSStyleDeclaration,
    );
    expect(() => readNativeAuthoredPaint(target)).toThrowError(
      expect.objectContaining({ code: "source-opacity-invalid" }),
    );
    expect(
      ATTRIBUTES.map((attribute) => target.hasAttribute(attribute)),
    ).toEqual([true, false, true, false]);
  });
});
