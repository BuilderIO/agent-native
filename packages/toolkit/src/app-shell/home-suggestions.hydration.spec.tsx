// @vitest-environment happy-dom

import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createHomeSuggestionOrder,
  createHomeSuggestionRandom,
  HomeSuggestionSeedProvider,
  pickHomeSuggestions,
  useHomeSuggestionSeed,
  useHomeSuggestionSeedForHome,
} from "./home-suggestions.js";

const generalPool = {
  general: Array.from({ length: 8 }, (_, index) => ({
    id: `general-${index}`,
    label: `General prompt ${index}`,
  })),
};

const rolePools = {
  general: generalPool.general.map((suggestion, index) => ({
    ...suggestion,
    id: `slot-${index + 1}`,
  })),
  design: generalPool.general.map((suggestion, index) => ({
    ...suggestion,
    id: `slot-${index + 1}`,
    label: `Role prompt ${index}`,
  })),
};

describe("home suggestion seed hydration", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("keeps the shell seed after the shell is replaced during hydration", () => {
    const shell = document.createElement("div");
    shell.innerHTML =
      '<section data-home-suggestion-app-id="design" data-home-suggestion-seed="123"></section>';
    document.body.append(shell);

    const firstMount = renderHook(() =>
      useHomeSuggestionSeedForHome(true, "design"),
    );
    expect(firstMount.result.current).toBe(123);
    const shellPicks = pickHomeSuggestions(
      generalPool,
      null,
      createHomeSuggestionRandom(firstMount.result.current),
    );
    expect(
      sessionStorage.getItem("agent-native:home-suggestion-seed:design"),
    ).toBe("123");

    firstMount.unmount();
    shell.remove();

    const hydratedMount = renderHook(() =>
      useHomeSuggestionSeedForHome(true, "design"),
    );
    expect(hydratedMount.result.current).toBe(123);
    expect(
      pickHomeSuggestions(
        generalPool,
        null,
        createHomeSuggestionRandom(hydratedMount.result.current),
      ),
    ).toEqual(shellPicks);
  });

  it("hands the shell's ordered slots to a role pool after hydration", () => {
    const seed = 123;
    const order = createHomeSuggestionOrder(
      rolePools.general.length,
      createHomeSuggestionRandom(seed),
    );
    const shellPicks = pickHomeSuggestions(
      rolePools,
      "general",
      createHomeSuggestionRandom(seed),
      order,
    );
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(HomeSuggestionSeedProvider, { seed, children });
    const hydrated = renderHook(
      () => {
        const hydratedSeed = useHomeSuggestionSeed();
        return pickHomeSuggestions(
          rolePools,
          "design",
          createHomeSuggestionRandom(hydratedSeed),
        );
      },
      { wrapper },
    );

    expect(hydrated.result.current.map(({ id }) => id)).toEqual(
      shellPicks.map(({ id }) => id),
    );
    expect(hydrated.result.current.map(({ label }) => label)).toEqual(
      shellPicks.map(
        ({ id }) => `Role prompt ${Number(id.slice("slot-".length)) - 1}`,
      ),
    );
  });

  it("uses the matching app seed when Design and Slides shells share a document", () => {
    const shells = document.createElement("div");
    shells.innerHTML = [
      '<section data-home-suggestion-app-id="design" data-home-suggestion-seed="123"></section>',
      '<section data-home-suggestion-app-id="slides" data-home-suggestion-seed="456"></section>',
    ].join("");
    document.body.append(shells);

    const design = renderHook(() =>
      useHomeSuggestionSeedForHome(true, "design"),
    );
    const slides = renderHook(() =>
      useHomeSuggestionSeedForHome(true, "slides"),
    );

    expect(design.result.current).toBe(123);
    expect(slides.result.current).toBe(456);
  });
});
