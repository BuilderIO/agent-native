/**
 * OS- or operator-owned custody for vault root keys.
 *
 * `loadVaultKey` transfers ownership of the returned buffer to the caller. The
 * caller will zero it after copying or when the broker locks. `storeVaultKey`
 * only borrows its input for the duration of the call; implementations must not
 * retain that buffer.
 */
export interface KeyCustodyAdapter {
  initialize(): Promise<void>;
  loadVaultKey(vaultId: string): Promise<Uint8Array | null>;
  storeVaultKey(vaultId: string, key: Uint8Array): Promise<void>;
  deleteVaultKey(vaultId: string): Promise<void>;
  close(): Promise<void>;
}
