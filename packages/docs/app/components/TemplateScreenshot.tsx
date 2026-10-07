import { BuilderImage } from "./builder-image";
import type { TEMPLATE_SCREENSHOTS } from "./template-screenshots";

type TemplateScreenshotProps = {
  alt: string;
  className?: string;
  sizes: string;
  variants: (typeof TEMPLATE_SCREENSHOTS)[keyof typeof TEMPLATE_SCREENSHOTS];
};

export function TemplateScreenshot({
  alt,
  className = "",
  sizes,
  variants,
}: TemplateScreenshotProps) {
  return (
    <>
      <BuilderImage
        src={variants.dark}
        alt={alt}
        sizes={sizes}
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        className={`theme-img-dark absolute inset-0 block h-full w-full object-cover object-center transition-opacity group-hover:opacity-90 ${className}`}
      />
      <BuilderImage
        src={variants.light}
        alt=""
        aria-hidden="true"
        sizes={sizes}
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        className={`theme-img-light absolute inset-0 block h-full w-full object-cover object-center transition-opacity group-hover:opacity-90 ${className}`}
      />
    </>
  );
}
