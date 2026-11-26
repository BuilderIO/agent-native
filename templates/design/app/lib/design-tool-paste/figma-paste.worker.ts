import {
  decodeFigmaClipboardFrames,
  type DecodedFigmaClipboard,
} from "@shared/figma-clipboard-decode";

export interface FigmaPasteWorkerRequest {
  bytes: Uint8Array;
}

export type FigmaPasteWorkerResponse =
  | { ok: true; result: DecodedFigmaClipboard }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<FigmaPasteWorkerRequest>) => {
  let response: FigmaPasteWorkerResponse;
  try {
    response = {
      ok: true,
      result: decodeFigmaClipboardFrames(event.data.bytes),
    };
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
