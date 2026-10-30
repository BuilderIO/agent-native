import { callAction } from "@agent-native/core/client/hooks";
import { setGoogleFontCatalogLoader } from "@agent-native/toolkit/design-tweaks/google-fonts";

// Read lazily: the toolkit asks only when a font picker opens or a canvas
// names a family outside its built-in snapshot.
setGoogleFontCatalogLoader(async () => {
  const { fonts } = await callAction(
    "list-google-fonts",
    {},
    { method: "GET" },
  );
  return fonts;
});
