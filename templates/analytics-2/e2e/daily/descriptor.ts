import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

const root = resolve(import.meta.dirname, "../../../..");
export const descriptorPath = resolve(
  root,
  ".tmp/analytics-daily/descriptor.json",
);
const localUrl = (value: string, protocol: string) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === protocol &&
    url.hostname === "127.0.0.1" &&
    !!url.port &&
    !url.username &&
    !url.password
  );
};
const tempPath = (value: string) => {
  const suffix = relative(resolve(root, ".tmp"), resolve(value));
  return (
    isAbsolute(value) &&
    suffix !== "" &&
    suffix !== ".." &&
    !suffix.startsWith(`..${sep}`) &&
    !isAbsolute(suffix)
  );
};
const schema = z
  .object({
    base: z.string().refine((value) => {
      if (!localUrl(value, "http:")) return false;
      const url = new URL(value);
      return (
        Number(url.port) >= 1024 &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    }),
    fake: z.string().refine((value) => localUrl(value, "http:")),
    cookiePath: z.string().refine(tempPath),
    warmFile: z.string().refine(tempPath),
  })
  .strict();
export function readDescriptor() {
  return parseDescriptor(JSON.parse(readFileSync(descriptorPath, "utf8")));
}

export function parseDescriptor(value: unknown) {
  return schema.parse(value);
}
