import { getAspectRatioDims, type AspectRatio } from "./aspect-ratios";

const LISTING_FRAME_RATIO = 16 / 9;

export function getDeckListingPreviewFrameStyle(aspectRatio?: AspectRatio) {
  const dimensions = getAspectRatioDims(aspectRatio);
  const isListingRatio =
    dimensions.width / dimensions.height >= LISTING_FRAME_RATIO;

  return {
    aspectRatio: `${dimensions.width} / ${dimensions.height}`,
    height: "100%",
    width: isListingRatio ? "100%" : "auto",
  };
}
