import { injectDocumentMarkup } from "@agent-native/core/shared";
import { expect, it } from "vitest";

import {
  appendContentSizeReporter,
  CONTENT_SIZE_REPORT_BRIDGE,
} from "./content-size-report";
import { appendHitTestResponder, hitTestResponderMarkup } from "./hit-test";

const tweakBridge = "<script data-tweak>tweak()</script>";

it("injects the static preview bridges in one pass exactly as chained injections do", () => {
  const documents = [
    `<!doctype html><html><head></head><body><div data-agent-native-node-id="a">x</div></body></html>`,
    `<html><body><script>const end = "</body>";</script><!-- </body> --><p>y</p></body></html>`,
    `<html><head></head><div>no body close</div></html>`,
    `<div>fragment without document tags</div>`,
  ];
  for (const content of documents) {
    const chained = appendContentSizeReporter(
      appendHitTestResponder(
        injectDocumentMarkup(content, tweakBridge),
        content,
      ),
    );
    const single = injectDocumentMarkup(
      content,
      tweakBridge +
        hitTestResponderMarkup(content) +
        CONTENT_SIZE_REPORT_BRIDGE,
    );
    expect(single).toBe(chained);
  }
});
