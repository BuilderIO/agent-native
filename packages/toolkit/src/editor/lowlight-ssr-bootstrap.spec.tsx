import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

import { createDocumentRequestHandler } from "@agent-native/core/server/entry-server";
import React from "react";
import type { EntryContext, RouterContextProvider } from "react-router";
import { build } from "vite";
import { expect, it } from "vitest";

it("runs the streamed bootstrap before Lowlight initializes without Object.hasOwn", async () => {
  function Document() {
    return (
      <html>
        <head>
          <link rel="modulepreload" href="/assets/root.js" />
        </head>
        <body>
          <script type="module" src="/assets/entry.js" />
        </body>
      </html>
    );
  }

  const handler = createDocumentRequestHandler(Document);
  const response = await handler(
    new Request("https://content.test/"),
    200,
    new Headers(),
    { isSpaMode: false } as EntryContext,
    {} as RouterContextProvider,
  );
  const html = await response.text();

  const entry = fileURLToPath(
    new URL("../../lowlight-proof-entry.js", import.meta.url),
  );
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "lowlight-proof-entry",
        resolveId(id) {
          if (id === entry) return id;
        },
        load(id) {
          if (id === entry)
            return `
          import { createLowlight } from "lowlight";
          import javascript from "highlight.js/lib/languages/javascript";
          const lowlight = createLowlight({ javascript });
          globalThis.highlighted = lowlight.highlight("javascript", "const answer = 42").children.length > 0;
        `;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: entry, output: { format: "iife" } },
    },
  });
  if (Array.isArray(result) || !("output" in result))
    throw new Error("Expected one Lowlight bundle");
  const chunk = result.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Missing Lowlight bundle");

  const withoutBootstrap = createContext({});
  runInContext("delete Object.hasOwn", withoutBootstrap);
  expect(() => runInContext(chunk.code, withoutBootstrap)).toThrow(
    /Object\.hasOwn is not a function/,
  );

  const browser = createContext({});
  runInContext("delete Object.hasOwn", browser);
  let bootstrapIndex = -1;
  let moduleIndex = -1;
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (match[1].includes("data-agent-native-has-own-bootstrap")) {
      bootstrapIndex = match.index;
      runInContext(match[2], browser);
    } else if (match[1].includes('type="module"')) {
      moduleIndex = match.index;
      runInContext(chunk.code, browser);
    }
  }
  expect(browser.highlighted).toBe(true);
  expect(bootstrapIndex).toBeGreaterThan(-1);
  expect(bootstrapIndex).toBeLessThan(html.indexOf('rel="modulepreload"'));
  expect(bootstrapIndex).toBeLessThan(moduleIndex);
});
