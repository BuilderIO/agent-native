declare const Buffer: {
  from(
    data: string,
    encoding?: BufferEncoding,
  ): {
    toString(encoding?: BufferEncoding): string;
  };
};

type BufferEncoding = "base64url" | "utf8" | "utf-8";

declare const process: {
  env: Record<string, string | undefined>;
};
