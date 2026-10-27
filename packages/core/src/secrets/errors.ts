import type { SecretScope } from "./register.js";

export class AppSecretDecryptionError extends Error {
  readonly errorCode = "app_secret_unreadable";
  readonly #ref?: { scope: SecretScope; scopeId: string };

  constructor(ref?: { scope: SecretScope; scopeId: string }) {
    super("A saved connection could not be decrypted.");
    this.name = "AppSecretDecryptionError";
    this.#ref = ref;
  }

  get scope(): SecretScope | undefined {
    return this.#ref?.scope;
  }

  get scopeId(): string | undefined {
    return this.#ref?.scopeId;
  }
}
