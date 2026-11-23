import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { TLSSocket, createSecureContext, type SecureContext } from "node:tls";

export const fixtureTlsHost = "127.0.0.1";

export async function createPostgresFixtureTls() {
  const dir = await mkdtemp(join(tmpdir(), "analytics-postgres-tls-"));
  const keyFile = join(dir, "key.pem");
  const certFile = join(dir, "cert.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-sha256",
        "-subj",
        `/CN=${fixtureTlsHost}`,
        "-addext",
        `subjectAltName=IP:${fixtureTlsHost}`,
        "-keyout",
        keyFile,
        "-out",
        certFile,
      ],
      { stdio: "ignore" },
    );
    const [key, certificate] = await Promise.all([
      readFile(keyFile),
      readFile(certFile, "utf8"),
    ]);
    return {
      certificate,
      context: createSecureContext({ key, cert: certificate }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function acceptPostgresFixtureTls(
  socket: Duplex,
  secureContext: SecureContext,
  onSecure: (socket: TLSSocket) => void,
) {
  let request = Buffer.alloc(0);
  const handshake = (chunk: Buffer) => {
    request = Buffer.concat([request, chunk]);
    if (request.length < 8) return;
    socket.removeListener("data", handshake);
    if (
      request.length !== 8 ||
      request.readUInt32BE(0) !== 8 ||
      request.readUInt32BE(4) !== 80_877_103
    ) {
      socket.destroy();
      return;
    }
    socket.write("S");
    const tls = new TLSSocket(socket, { isServer: true, secureContext });
    tls.on("error", () => tls.destroy());
    tls.once("secure", () => onSecure(tls));
  };
  socket.on("data", handshake);
}
