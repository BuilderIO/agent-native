import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export default async function main(_args: string[]) {
  const deckPath = join(process.cwd(), "data/decks/gtm-3x.json");
  const deck = JSON.parse(readFileSync(deckPath, "utf-8"));

  // 1. Change deck title
  deck.title = "3X Go-To-Market";
  console.log("Updated deck title to '3X Go-To-Market'");

  // 2. Update title slide text
  const slide1 = deck.slides.find((s: any) => s.id === "gtm-01");
  if (slide1) {
    slide1.content = slide1.content.replace(
      "3X Go-To-Market<br/>with AI",
      "3X Go-To-Market",
    );
    console.log("Updated slide 1 title text");
  }

  // 3. Remove border-radius from image on slide 3 (gtm-04)
  const slide3 = deck.slides.find((s: any) => s.id === "gtm-04");
  if (slide3) {
    slide3.content = slide3.content.replace(
      "border-radius: 12px; filter:",
      "filter:",
    );
    console.log("Removed border-radius from slide 3 image");
  }

  // 4. Remove "Access to APIs" from slide 4 (gtm-05) "Like Claude on the web" section
  const slide4 = deck.slides.find((s: any) => s.id === "gtm-05");
  if (slide4) {
    // Remove the "Access to APIs" bullet
    slide4.content = slide4.content.replace(
      /<div style="display: flex; align-items: baseline; gap: 12px; font-size: 18px; color: rgba\(255,255,255,0\.75\); font-family: 'Poppins', sans-serif;"><span style="color: #00E5FF; font-size: 8px; position: relative; top: -3px;">&#x25CF;<\/span>Access to APIs<\/div>\s*/,
      "",
    );
    console.log("Removed 'Access to APIs' from slide 4");
  }

  // 5. Remove slide 5 (gtm-06)
  deck.slides = deck.slides.filter((s: any) => s.id !== "gtm-06");
  console.log("Removed slide 5 (gtm-06)");

  deck.updatedAt = new Date().toISOString();
  writeFileSync(deckPath, JSON.stringify(deck, null, 2));
  console.log("All edits applied!");
}
