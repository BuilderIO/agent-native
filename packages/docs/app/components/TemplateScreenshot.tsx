import { BuilderImage } from "./builder-image";
import type { TEMPLATE_SCREENSHOTS } from "./template-screenshots";

type TemplateScreenshotProps = {
  alt: string;
  className?: string;
  sizes: string;
  variants: (typeof TEMPLATE_SCREENSHOTS)[keyof typeof TEMPLATE_SCREENSHOTS];
  zoom?: number;
};

export function TemplateScreenshot({
  alt,
  className = "",
  sizes,
  variants,
  zoom = 1,
}: TemplateScreenshotProps) {
  const imageStyle = zoom === 1 ? undefined : { transform: `scale(${zoom})` };

  return (
    <>
      <BuilderImage
        src={variants.dark}
        alt={alt}
        sizes={sizes}
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        style={imageStyle}
        className={`theme-img-dark relative h-full w-full object-cover object-center transition-[opacity,transform] group-hover:opacity-90 ${className}`}
      />
      <BuilderImage
        src={variants.light}
        alt=""
        aria-hidden="true"
        sizes={sizes}
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        style={imageStyle}
        className={`theme-img-light absolute inset-0 h-full w-full object-cover object-center transition-[opacity,transform] group-hover:opacity-90 ${className}`}
      />
    </>
  );
}
