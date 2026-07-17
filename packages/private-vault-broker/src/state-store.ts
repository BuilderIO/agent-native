/**
 * Encrypted local broker state. Implementations must never persist plaintext
 * keys and must copy, rather than retain, buffers passed to `write`.
 */
export interface BrokerStateStore {
  initialize(): Promise<void>;
  read(namespace: string, key: string): Promise<Uint8Array | null>;
  write(namespace: string, key: string, value: Uint8Array): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  close(): Promise<void>;
}
