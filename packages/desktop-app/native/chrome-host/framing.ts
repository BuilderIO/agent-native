const MAX_CHROME_TO_HOST_BYTES = 64 * 1024 * 1024;
const MAX_HOST_TO_CHROME_BYTES = 1024 * 1024;

export class NativeMessageDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (size > MAX_CHROME_TO_HOST_BYTES) {
        throw new Error("Chrome native message exceeds the 64 MB input limit.");
      }
      if (this.buffer.length < size + 4) break;
      const body = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      messages.push(JSON.parse(body.toString("utf8")) as unknown);
    }
    return messages;
  }

  finish(): void {
    if (this.buffer.length !== 0) {
      throw new Error("Chrome native message ended with a partial frame.");
    }
  }
}

export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_HOST_TO_CHROME_BYTES) {
    throw new Error("Native host response exceeds Chrome's 1 MB output limit.");
  }
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}
