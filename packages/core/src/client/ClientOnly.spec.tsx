// @vitest-environment happy-dom

import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClientOnly } from "./ClientOnly.js";

describe("ClientOnly", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("hands off the SSR fallback before the first browser paint", async () => {
    const app = (
      <ClientOnly fallback={<div data-testid="loading" />}>
        <div data-testid="content">App</div>
      </ClientOnly>
    );
    container.innerHTML = renderToString(app);

    const root = hydrateRoot(container, app);
    // Let hydration's scheduled work commit without flushSync, which would
    // also drain passive effects and make the old implementation pass.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector('[data-testid="loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();

    root.unmount();
  });
});
