/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches matching context from the API.
 * If editing a deck, returns deck metadata and current slide content.
 * If on the list view, returns the deck list.
 *
 * Usage:
 *   pnpm script view-screen
 */

import { parseArgs } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "See what the user is currently looking at on screen. Returns navigation state, deck list or current deck/slide details. Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

async function fetchDecks(): Promise<any[]> {
  try {
    const port = process.env.PORT || "8080";
    const res = await fetch(`http://localhost:${port}/api/decks`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function fetchDeck(id: string): Promise<any | null> {
  try {
    const port = process.env.PORT || "8080";
    const res = await fetch(`http://localhost:${port}/api/decks/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function run(_args: Record<string, string>): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = navigation as any;

  if (nav?.deckId) {
    // User is editing a specific deck
    const deck = await fetchDeck(nav.deckId);
    if (deck) {
      const deckData =
        typeof deck.data === "string" ? JSON.parse(deck.data) : deck.data;
      const slides = deckData?.slides || [];
      const slideIndex = nav.slideIndex ?? 0;
      const currentSlide = slides[slideIndex] || null;

      screen.deck = {
        id: deck.id,
        title: deck.title || deckData?.title,
        slideCount: slides.length,
        currentSlideIndex: slideIndex,
        currentSlide: currentSlide
          ? {
              id: currentSlide.id,
              layout: currentSlide.layout ?? null,
              content: currentSlide.content,
            }
          : null,
      };
    }
  } else {
    // User is on the deck list
    const decks = await fetchDecks();
    screen.deckList = {
      count: decks.length,
      decks: decks.map((d: any) => {
        const data = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
        return {
          id: d.id,
          title: d.title || data?.title,
          slideCount: data?.slides?.length ?? 0,
          updatedAt: d.updatedAt ?? d.updated_at,
        };
      }),
    };
  }

  if (Object.keys(screen).length === 0) {
    return "No application state found. Is the app running?";
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  const result = await run(args);

  try {
    const parsed = JSON.parse(result);
    const nav = parsed.navigation;
    if (nav?.deckId) {
      const slideCount = parsed.deck?.slideCount ?? "?";
      const slideIdx = parsed.deck?.currentSlideIndex ?? 0;
      console.error(
        `Editing deck: ${nav.deckId} (slide ${slideIdx + 1}/${slideCount})`,
      );
    } else {
      const count = parsed.deckList?.count ?? 0;
      console.error(`Deck list view — ${count} deck(s)`);
    }
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}
