// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TemplateLandingFaq } from "./TemplateLandingFaq";

const ITEMS = [
  {
    id: "first",
    question: "First question",
    answer: "First answer",
  },
  {
    id: "second",
    question: "Second question",
    answer: "Second answer",
  },
  {
    id: "third",
    question: "Third question",
    answer: "Third answer",
  },
];

function renderFaq() {
  return render(
    <TemplateLandingFaq
      idPrefix="test-faq"
      eyebrow="FAQs"
      title="Common questions"
      items={ITEMS}
    />,
  );
}

afterEach(cleanup);

describe("TemplateLandingFaq", () => {
  it("opens the first item by default", () => {
    renderFaq();

    expect(
      screen
        .getByRole("button", { name: "First question" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      document
        .getElementById("test-faq-first-panel")
        ?.getAttribute("aria-hidden"),
    ).toBe("false");
  });

  it("lets the current item close", () => {
    renderFaq();

    const firstTrigger = screen.getByRole("button", {
      name: "First question",
    });
    fireEvent.click(firstTrigger);

    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      document
        .getElementById("test-faq-first-panel")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("keeps only one item open", () => {
    renderFaq();

    const firstTrigger = screen.getByRole("button", {
      name: "First question",
    });
    const secondTrigger = screen.getByRole("button", {
      name: "Second question",
    });
    fireEvent.click(secondTrigger);

    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(secondTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-expanded") === "true"),
    ).toHaveLength(1);
  });

  it("wires stable trigger and panel IDs into labelled regions", () => {
    renderFaq();

    const faqRegion = screen.getByRole("region", {
      name: "Common questions",
    });
    const firstTrigger = screen.getByRole("button", {
      name: "First question",
    });
    const firstPanel = document.getElementById("test-faq-first-panel");

    expect(faqRegion.tagName).toBe("SECTION");
    expect(firstTrigger.id).toBe("test-faq-first-trigger");
    expect(firstTrigger.getAttribute("aria-controls")).toBe(
      "test-faq-first-panel",
    );
    expect(firstPanel?.getAttribute("role")).toBe("region");
    expect(firstPanel?.getAttribute("aria-labelledby")).toBe(
      "test-faq-first-trigger",
    );
    expect(firstTrigger.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
