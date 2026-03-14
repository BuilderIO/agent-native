import type { Deck } from "@/context/DeckContext";
import { slide1, slide2, slide3, slide4, slide5, slide6, slide7 } from "./builderFMDSlides1";
import { slide8, slide9, slide10, slide11, slide12, slide13, slide14 } from "./builderFMDSlides2";
import { slide15, slide16, slide17, slide18, slide19, slide20, slide21 } from "./builderFMDSlides3";

export function createBuilderFMDDeck(): Deck {
  return {
    id: "builder-fmd",
    title: "Builder FMD",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slides: [
      slide1,
      slide2,
      slide3,
      slide4,
      slide5,
      slide6,
      slide7,
      slide8,
      slide9,
      slide10,
      slide11,
      slide12,
      slide13,
      slide14,
      slide15,
      slide16,
      slide17,
      slide18,
      slide19,
      slide20,
      slide21,
    ],
  };
}
