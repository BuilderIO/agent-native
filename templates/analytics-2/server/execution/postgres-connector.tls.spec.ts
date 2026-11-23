import { Duplex, PassThrough } from "node:stream";

import type postgres from "postgres";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  acceptPostgresFixtureTls,
  createPostgresFixtureTls,
  fixtureTlsHost,
} from "./postgres-connector-test-tls.js";
import { createPostgresConnector } from "./postgres-connector.js";

const transport = vi.hoisted(() => ({
  socket: vi.fn<() => Duplex>(),
}));

vi.mock("postgres", async (importOriginal) => {
  const { default: client } = await importOriginal<{
    default: typeof postgres;
  }>();
  return {
    default: (options: postgres.Options<Record<string, never>>) => {
      const settings = { ...options, socket: transport.socket };
      return client(settings);
    },
  };
});

let fixture: Awaited<ReturnType<typeof createPostgresFixtureTls>>;

beforeAll(async () => {
  fixture = await createPostgresFixtureTls();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const port = 45_432;

function validate(
  host: string,
  caCertificate?: string,
  managedCertificate?: string,
) {
  vi.stubEnv(
    "ANALYTICS2_POSTGRES_READ_ENDPOINTS",
    JSON.stringify([{ host, port, certificate: managedCertificate }]),
  );

  const upstream = new PassThrough();
  const downstream = new PassThrough();
  const client = Duplex.from({ readable: downstream, writable: upstream });
  const server = Duplex.from({ readable: upstream, writable: downstream });
  transport.socket.mockReturnValue(client);
  acceptPostgresFixtureTls(server, fixture.context, (tls) => {
    tls.once("data", () => {
      const fields = Buffer.from(
        "SFATAL\0C28P01\0MAuthentication rejected\0\0",
      );
      const header = Buffer.alloc(5);
      header.write("E");
      header.writeInt32BE(4 + fields.length, 1);
      tls.end(Buffer.concat([header, fields]));
    });
  });

  return createPostgresConnector(
    {
      host,
      port,
      database: "tls_fixture",
      username: "fixture_reader",
      password: "fixture-password",
      caCertificate,
    },
    () => {},
  ).validate();
}

it("reaches Postgres authentication with the fixture CA after SSLRequest", async () => {
  await expect(validate(fixtureTlsHost)).rejects.toThrow(
    "warehouse_tls_unverified",
  );
  await expect(validate(fixtureTlsHost, fixture.certificate)).rejects.toThrow(
    "warehouse_query_denied",
  );
});

it("still checks the endpoint IP when the connection trusts the CA", async () => {
  await expect(validate("127.0.0.2", fixture.certificate)).rejects.toThrow(
    "warehouse_tls_unverified",
  );
});

it("uses the managed CA when a connection also supplies a CA", async () => {
  await expect(
    validate(fixtureTlsHost, "untrusted-test-ca", fixture.certificate),
  ).rejects.toThrow("warehouse_query_denied");
});
