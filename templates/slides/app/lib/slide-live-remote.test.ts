// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { applyRemoteHtmlUnderEdit } from "./slide-live-remote";

const stamp = (n: number) => `data-src-i="s.1:${n}"`;
const box = (
  n: number,
  id: string,
  text: string,
  style = "left: 100px; top: 100px;",
) =>
  `<div data-slide-object-id="${id}" style="${style}" ${stamp(n)}>${text}</div>`;
const slide = (...children: string[]) =>
  `<div class="fmd-slide" ${stamp(0)}>${children.join("")}</div>`;

function mount(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function startEditing(root: HTMLElement, id: string) {
  const edited = root.querySelector<HTMLElement>(
    `[data-slide-object-id="${id}"]`,
  )!;
  edited.setAttribute("contenteditable", "true");
  return edited;
}

describe("applyRemoteHtmlUnderEdit", () => {
  it("shows another object's saved text without replacing the edited element", () => {
    const prev = slide(box(1, "a", "Alpha"), box(2, "b", "Beta"));
    const next = slide(box(1, "a", "Alpha"), box(2, "b", "Beta by remote"));
    const root = mount(prev);
    const edited = startEditing(root, "a");
    edited.firstChild!.nodeValue = "Alpha typed";
    const editedText = edited.firstChild;

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("applied");

    expect(root.querySelector('[data-slide-object-id="b"]')!.textContent).toBe(
      "Beta by remote",
    );
    expect(root.querySelector('[data-slide-object-id="a"]')).toBe(edited);
    expect(edited.firstChild).toBe(editedText);
    expect(edited.textContent).toBe("Alpha typed");
  });

  it("applies style changes per declaration and keeps the live-only ones", () => {
    const prev = slide(box(1, "a", "Alpha"), box(2, "b", "Beta"));
    const next = slide(
      box(1, "a", "Alpha"),
      box(2, "b", "Beta", "left: 400px; top: 100px;"),
    );
    const root = mount(prev);
    const other = root.querySelector<HTMLElement>(
      '[data-slide-object-id="b"]',
    )!;
    other.style.setProperty("contain", "size");
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("applied");

    expect(other.style.left).toBe("400px");
    expect(other.style.top).toBe("100px");
    expect(other.style.getPropertyValue("contain")).toBe("size");
  });

  it("applies an attribute change to an ancestor of the edited element", () => {
    const prev = slide(box(1, "a", "Alpha"));
    const next = prev.replace(
      `class="fmd-slide"`,
      `class="fmd-slide" data-theme="light"`,
    );
    const root = mount(prev);
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("applied");

    expect(root.querySelector(".fmd-slide")!.getAttribute("data-theme")).toBe(
      "light",
    );
    expect(root.querySelector('[data-slide-object-id="a"]')).toBe(edited);
  });

  it("applies only the class delta and does not restore a class the live canvas dropped", () => {
    const withClass = (n: number, id: string, classes: string) =>
      `<div class="${classes}" data-slide-object-id="${id}" ${stamp(n)}>${id}</div>`;
    const prev = slide(box(1, "a", "Alpha"), withClass(2, "b", "x y"));
    const next = slide(box(1, "a", "Alpha"), withClass(2, "b", "x y z"));
    const root = mount(prev);
    const edited = startEditing(root, "a");
    const other = root.querySelector<HTMLElement>(
      '[data-slide-object-id="b"]',
    )!;

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("applied");
    expect(other.className).toBe("x y z");

    const live = mount(prev);
    const liveEdited = startEditing(live, "a");
    const liveOther = live.querySelector<HTMLElement>(
      '[data-slide-object-id="b"]',
    )!;
    liveOther.classList.remove("y");

    expect(applyRemoteHtmlUnderEdit(live, liveEdited, prev, next)).toBe(
      "unsupported",
    );
    expect(liveOther.className).toBe("x");
  });

  it("does not route a delta by a stamp that names more than one live element", () => {
    const twin = (text: string) =>
      `<b ${stamp(2)}>${text}</b><b ${stamp(2)}>${text}</b>`;
    const prev = slide(box(1, "a", "Alpha"), twin("Bold"));
    const next = slide(box(1, "a", "Alpha"), twin("Bold by remote"));
    const root = mount(prev);
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe(
      "unsupported",
    );
    expect(root.querySelectorAll("b")[0].textContent).toBe("Bold");
  });

  it("keeps an empty class attribute the remote kept and drops one it removed", () => {
    const withClass = (n: number, id: string, attr: string) =>
      `<div ${attr} data-slide-object-id="${id}" ${stamp(n)}>${id}</div>`;
    const prev = slide(box(1, "a", "Alpha"), withClass(2, "b", 'class="x"'));

    const kept = mount(prev);
    const keptNext = slide(box(1, "a", "Alpha"), withClass(2, "b", 'class=""'));
    expect(
      applyRemoteHtmlUnderEdit(kept, startEditing(kept, "a"), prev, keptNext),
    ).toBe("applied");
    expect(
      kept.querySelector('[data-slide-object-id="b"]')!.getAttribute("class"),
    ).toBe("");

    const dropped = mount(prev);
    const droppedNext = slide(box(1, "a", "Alpha"), withClass(2, "b", ""));
    expect(
      applyRemoteHtmlUnderEdit(
        dropped,
        startEditing(dropped, "a"),
        prev,
        droppedNext,
      ),
    ).toBe("applied");
    expect(
      dropped
        .querySelector('[data-slide-object-id="b"]')!
        .hasAttribute("class"),
    ).toBe(false);
  });

  it("preserves live-only classes when the remote removes the class attribute", () => {
    const withClass = (n: number, id: string, attr: string) =>
      `<div ${attr} data-slide-object-id="${id}" ${stamp(n)}>${id}</div>`;
    const prev = slide(box(1, "a", "Alpha"), withClass(2, "b", 'class="x y"'));
    const next = slide(box(1, "a", "Alpha"), withClass(2, "b", ""));
    const root = mount(prev);
    const other = root.querySelector<HTMLElement>(
      '[data-slide-object-id="b"]',
    )!;
    other.classList.add("live-only");
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("applied");
    expect(other.getAttribute("class")).toBe("live-only");
  });

  it("does not apply a change to text outside every element", () => {
    const prev = `Intro${slide(box(1, "a", "Alpha"), box(2, "b", "Beta"))}`;
    const next = `Intro by remote${slide(box(1, "a", "Alpha"), box(2, "b", "Beta by remote"))}`;
    const root = mount(prev);
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe(
      "unsupported",
    );
    expect(root.firstChild?.nodeValue).toBe("Intro");
    expect(root.querySelector('[data-slide-object-id="b"]')!.textContent).toBe(
      "Beta",
    );
  });

  it("reports an overlap and writes nothing when the edited text changed too", () => {
    const prev = slide(box(1, "a", "Alpha"), box(2, "b", "Beta"));
    const next = slide(
      box(1, "a", "Alpha by remote"),
      box(2, "b", "Beta by remote"),
    );
    const root = mount(prev);
    const edited = startEditing(root, "a");
    edited.firstChild!.nodeValue = "Alpha typed";

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("overlap");

    expect(root.querySelector('[data-slide-object-id="b"]')!.textContent).toBe(
      "Beta",
    );
    expect(edited.textContent).toBe("Alpha typed");
  });

  it("reports an overlap when only the edited element's attributes changed", () => {
    const prev = slide(box(1, "a", "Alpha"));
    const next = slide(box(1, "a", "Alpha", "left: 900px; top: 100px;"));
    const root = mount(prev);
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe("overlap");
    expect(edited.style.left).toBe("100px");
  });

  it("does not apply a change that adds or removes elements", () => {
    const prev = slide(box(1, "a", "Alpha"));
    const next = slide(box(1, "a", "Alpha"), box(2, "b", "Beta"));
    const root = mount(prev);
    const edited = startEditing(root, "a");

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe(
      "unsupported",
    );
    expect(root.querySelector('[data-slide-object-id="b"]')).toBeNull();
  });

  it("does not overwrite an element the live canvas already changed", () => {
    const prev = slide(box(1, "a", "Alpha"), box(2, "b", "Beta"));
    const next = slide(box(1, "a", "Alpha"), box(2, "b", "Beta by remote"));
    const root = mount(prev);
    const edited = startEditing(root, "a");
    root.querySelector('[data-slide-object-id="b"]')!.firstChild!.nodeValue =
      "Beta locally";

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe(
      "unsupported",
    );
    expect(root.querySelector('[data-slide-object-id="b"]')!.textContent).toBe(
      "Beta locally",
    );
  });

  it("applies nothing from a delta it cannot fully apply", () => {
    const prev = slide(
      box(1, "a", "Alpha"),
      box(2, "b", "Beta"),
      box(3, "c", "Gamma"),
    );
    const next = slide(
      box(1, "a", "Alpha"),
      box(2, "b", "Beta by remote"),
      box(3, "c", "Gamma by remote"),
    );
    const root = mount(prev);
    const edited = startEditing(root, "a");
    root.querySelector('[data-slide-object-id="c"]')!.firstChild!.nodeValue =
      "Gamma locally";

    expect(applyRemoteHtmlUnderEdit(root, edited, prev, next)).toBe(
      "unsupported",
    );
    expect(root.querySelector('[data-slide-object-id="b"]')!.textContent).toBe(
      "Beta",
    );
  });
});
