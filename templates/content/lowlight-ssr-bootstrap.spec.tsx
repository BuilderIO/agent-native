import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

import React from "react";
import type { EntryContext, RouterContextProvider } from "react-router";
import { build } from "vite";
import { expect, it } from "vitest";

import { createDocumentRequestHandler } from "../../packages/core/src/server/entry-server";

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
    new URL("../../packages/toolkit/src/editor/extensions.ts", import.meta.url),
  );
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: entry,
        preserveEntrySignatures: "strict",
        output: { format: "iife", name: "ToolkitEditor" },
      },
    },
  });
  if (Array.isArray(result) || !("output" in result))
    throw new Error("Expected one Lowlight bundle");
  const chunk = result.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Missing Lowlight bundle");

  const withoutBootstrap = createContext({
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  runInContext("delete Object.hasOwn", withoutBootstrap);
  expect(() => runInContext(chunk.code, withoutBootstrap)).toThrow(
    /Object\.hasOwn is not a function/,
  );

  const browser = createContext({
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  runInContext("delete Object.hasOwn", browser);
  const nativeBrowser = createContext({
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  runInContext("globalThis.originalHasOwn = Object.hasOwn", nativeBrowser);
  let bootstrapIndex = -1;
  let moduleIndex = -1;
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (match[1].includes("data-agent-native-has-own-bootstrap")) {
      bootstrapIndex = match.index;
      runInContext(match[2], browser);
      runInContext(match[2], nativeBrowser);
    } else if (match[1].includes('type="module"')) {
      moduleIndex = match.index;
      runInContext(chunk.code, browser);
    }
  }
  expect(
    runInContext(
      `ToolkitEditor.createSharedEditorExtensions()
        .find(extension => extension.name === "codeBlock")
        .options.lowlight.highlight("javascript", "const answer = 42")
        .children.length > 0`,
      browser,
    ),
  ).toBe(true);
  expect(runInContext("Object.hasOwn === originalHasOwn", nativeBrowser)).toBe(
    true,
  );
  expect(bootstrapIndex).toBeGreaterThan(-1);
  expect(bootstrapIndex).toBeLessThan(html.indexOf('rel="modulepreload"'));
  expect(bootstrapIndex).toBeLessThan(moduleIndex);
});
