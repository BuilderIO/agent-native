export class PublicServerError extends Error {
  readonly publicMessage: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.publicMessage = message;
  }
}
