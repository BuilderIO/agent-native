import { describe, expect, it } from "vitest";

import { ancV1BytesToHex } from "./canonical.js";
import {
  inspectAncV1ExportArchive,
  openAncV1ExportArchive,
  sealAncV1ExportArchive,
} from "./export-archive.js";

const bytes = (length: number, value: number) =>
  new Uint8Array(length).fill(value);

describe("anc/v1 independently decryptable export archive", () => {
  it("round-trips exact migration evidence under a recovery-derived subkey", async () => {
    const plaintext = new TextEncoder().encode(
      '{"documents":[{"title":"private sentinel"}]}',
    );
    const encoded = await sealAncV1ExportArchive({
      vaultId: bytes(16, 0x11),
      exportId: bytes(16, 0x22),
      createdAt: 1_800_000_000_000,
      sourceSnapshotHash: bytes(32, 0x33),
      objectCount: 2,
      plaintext,
      recoveryRoot: bytes(32, 0x44),
      nonce: bytes(24, 0x55),
    });
    expect(ancV1BytesToHex(encoded)).toBe(
      "aa0166616e632f7631025011111111111111111111111111111111036e6578706f72742d61726368697665041b000001a3185c50000550222222222222222222222222222222221901cc582033333333333333333333333333333333333333333333333333333333333333331901cd021901ce5820edbe86d937b96e76706b0a2d7cd3a01421f58f1a117e4c3ad4aa31abc2b86eed1901cf58185555555555555555555555555555555555555555555555551901d0583c487f09bb05418b4b1e25c3dcffaaf4ddd7c44a03bfe11e151efc168f31329904751ef618f351c32260ac4c34373e662fd2faaefd95f00c5f92c08f8c",
    );
    expect(new TextDecoder().decode(encoded)).not.toContain("private sentinel");
    expect(inspectAncV1ExportArchive(encoded)).toMatchObject({
      createdAt: 1_800_000_000_000,
      objectCount: 2,
    });
    const opened = await openAncV1ExportArchive({
      encoded,
      expectedVaultId: bytes(16, 0x11),
      recoveryRoot: bytes(32, 0x44),
    });
    expect(new TextDecoder().decode(opened.plaintext)).toContain(
      "private sentinel",
    );
    expect(opened.sourceSnapshotHash).toEqual(bytes(32, 0x33));
  });

  it("rejects wrong recovery material, wrong vault, and tampering", async () => {
    const input = {
      vaultId: bytes(16, 0x11),
      exportId: bytes(16, 0x22),
      createdAt: 1_800_000_000_000,
      sourceSnapshotHash: bytes(32, 0x33),
      objectCount: 1,
      plaintext: bytes(64, 0x66),
      recoveryRoot: bytes(32, 0x44),
      nonce: bytes(24, 0x55),
    };
    const encoded = await sealAncV1ExportArchive(input);
    await expect(
      openAncV1ExportArchive({
        encoded,
        expectedVaultId: bytes(16, 0x11),
        recoveryRoot: bytes(32, 0x45),
      }),
    ).rejects.toThrow("export archive verification failed");
    await expect(
      openAncV1ExportArchive({
        encoded,
        expectedVaultId: bytes(16, 0x12),
        recoveryRoot: bytes(32, 0x44),
      }),
    ).rejects.toThrow("export archive verification failed");
    const tampered = encoded.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(
      openAncV1ExportArchive({
        encoded: tampered,
        expectedVaultId: bytes(16, 0x11),
        recoveryRoot: bytes(32, 0x44),
      }),
    ).rejects.toThrow("export archive verification failed");
  });

  it("snapshots and erases caller-owned secret working copies without mutating inputs", async () => {
    const recoveryRoot = bytes(32, 0x44);
    const plaintext = bytes(64, 0x66);
    const encoded = await sealAncV1ExportArchive({
      vaultId: bytes(16, 0x11),
      exportId: bytes(16, 0x22),
      createdAt: 1,
      sourceSnapshotHash: bytes(32, 0x33),
      objectCount: 1,
      plaintext,
      recoveryRoot,
      nonce: bytes(24, 0x55),
    });
    expect(recoveryRoot).toEqual(bytes(32, 0x44));
    expect(plaintext).toEqual(bytes(64, 0x66));
    const openRoot = bytes(32, 0x44);
    await openAncV1ExportArchive({
      encoded,
      expectedVaultId: bytes(16, 0x11),
      recoveryRoot: openRoot,
    });
    expect(openRoot).toEqual(bytes(32, 0x44));
  });
});
