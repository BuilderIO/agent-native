export class AppSecretDecryptionError extends Error {
  readonly errorCode = "app_secret_unreadable";

  constructor() {
    super("A saved connection could not be decrypted.");
    this.name = "AppSecretDecryptionError";
  }
}
