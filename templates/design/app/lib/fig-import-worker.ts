
import { createFigImportSession } from "./fig-import-worker-session";

export type FigImportWorkerRequest =
  | { id: number; type: "prepare"; file: File }
  | { id: number; type: "render"; selection?: ReadonlySet<string> };

export type FigImportWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const session = createFigImportSession();

function respond(response: FigImportWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(response, { transfer });
}

self.onmessage = async (event: MessageEvent<FigImportWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "prepare") {
      respond({
        id: request.id,
        ok: true,
        result: await session.prepare(request.file),
      });
      return;
    }
    const rendered = session.render(request.selection);
    const images = rendered.images.map((image) => ({
      ...image,
      bytes: image.bytes.slice(),
    }));
    respond(
      { id: request.id, ok: true, result: { ...rendered, images } },
      images.map((image) => image.bytes.buffer),
    );
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
