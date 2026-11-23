export class ResponseDiagnostics {
  private pending = new Set<Promise<void>>();

  record(
    read: () => Promise<unknown>,
    report: (body: unknown) => void,
    onError: () => void,
  ) {
    const pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const body = await Promise.race([
          Promise.resolve()
            .then(read)
            .catch(() => undefined),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), 2000);
          }),
        ]);
        report(body);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })().catch(onError);
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
  }

  async drain() {
    await Promise.all(this.pending);
  }
}
