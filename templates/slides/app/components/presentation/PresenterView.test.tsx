// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) => {
    const messages: Record<string, string> = {
      "presentation.nextSlide": "Next slide",
      "presentation.previousSlide": "Previous slide",
      "presentation.voiceNavigationStart": "Start voice navigation",
      "presentation.voiceNavigationStop": "Stop voice navigation",
      "presentation.voiceNavigationNextCommand": "Next slide",
      "presentation.voiceNavigationPreviousCommand": "Previous slide",
      "presentation.voiceNavigationHint":
        "Say “{{next}}” or “{{previous}}” to navigate.",
      "presentation.voiceNavigationListening":
        "Listening for “{{next}}” or “{{previous}}”.",
      "presentation.voiceNavigationUnavailable":
        "Voice navigation is unavailable in this browser.",
      "presentation.voiceNavigationError":
        "Voice navigation stopped. Check microphone access and try again.",
    };
    return Object.entries(values ?? {}).reduce(
      (message, [name, value]) => message.replaceAll(`{{${name}}}`, value),
      messages[key] ?? key,
    );
  },
  useLocale: () => ({ locale: "en-US" }),
}));

const transcriptionMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  getIncompleteReason: vi.fn(() => null),
  setTranscript: undefined as ((value: string) => void) | undefined,
  setIsActive: undefined as ((value: boolean) => void) | undefined,
  requestedLanguage: "",
}));

vi.mock(
  "@agent-native/core/client/transcription/use-live-transcription",
  async () => {
    const React = await import("react");
    return {
      useLiveTranscription: ({ lang }: { lang: string }) => {
        const [isActive, setIsActive] = React.useState(false);
        const [transcript, setTranscript] = React.useState("");
        transcriptionMock.setIsActive = setIsActive;
        transcriptionMock.setTranscript = setTranscript;
        transcriptionMock.requestedLanguage = lang;
        transcriptionMock.start.mockImplementation(() => setIsActive(true));
        transcriptionMock.stop.mockImplementation(() => setIsActive(false));
        return {
          supported: true,
          isActive,
          transcript,
          interimText: "",
          start: transcriptionMock.start,
          stop: transcriptionMock.stop,
          getIncompleteReason: transcriptionMock.getIncompleteReason,
        };
      },
    };
  },
);

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div
      data-testid={`rendered-${slide.id}`}
      dangerouslySetInnerHTML={{ __html: slide.content }}
    />
  ),
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));

// A stand-in for BroadcastChannel with its delivery rule: a message reaches every
// other open channel of the same name, and never the channel that sent it.
const bus = vi.hoisted(() => {
  type Message = { type: string; [key: string]: unknown };
  class FakeChannel {
    onmessage: ((event: { data: Message }) => void) | null = null;
    closed = false;
    posted: Message[] = [];
    constructor(
      readonly name: string,
      private readonly peers: FakeChannel[],
    ) {
      peers.push(this);
    }
    postMessage(message: Message) {
      this.posted.push(message);
      for (const peer of this.peers) {
        if (peer !== this && !peer.closed && peer.name === this.name) {
          peer.onmessage?.({ data: message });
        }
      }
    }
    close() {
      this.closed = true;
    }
  }
  const peers: FakeChannel[] = [];
  return {
    peers,
    open: (name: string) => new FakeChannel(name, peers),
  };
});

vi.mock("./present-channel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./present-channel")>()),
  openPresentChannel: (deckId: string) => bus.open(`slides-present:${deckId}`),
}));

import PresentationView from "./PresentationView";
import PresenterView from "./PresenterView";

const revealSlide = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

const slides = [
  { id: "plain", content: "", layout: "content" },
  {
    id: "reveal",
    content: revealSlide,
    layout: "content",
    animations: [
      {
        id: "body",
        elementIndex: 0,
        elementPath: [0],
        byParagraph: true,
        type: "fade",
      },
    ],
  },
  { id: "after", content: "", layout: "content" },
] as unknown as Slide[];

function paragraphStates(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-pstep]"))
    .sort(
      (a, b) =>
        Number(a.getAttribute("data-pstep")) -
        Number(b.getAttribute("data-pstep")),
    )
    .map((element) => element.getAttribute("data-pstep-state") ?? "");
}

function visibility(states: string[]): boolean[] {
  return states.map((state) => state !== "hidden");
}

function clickNext(container: HTMLElement) {
  fireEvent.click(
    within(container).getByRole("button", { name: "Next slide" }),
  );
}

function commandsPosted(channel: { posted: { type: string }[] }) {
  return channel.posted.filter((message) => message.type === "command");
}

beforeEach(() => {
  bus.peers.splice(0);
  transcriptionMock.start.mockClear();
  transcriptionMock.stop.mockClear();
  transcriptionMock.getIncompleteReason.mockReturnValue(null);
});

afterEach(() => cleanup());

describe("PresenterView with an audience", () => {
  it("steps the audience once and the presenter once for one press", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [audienceChannel, presenterChannel] = bus.peers;

    clickNext(presenter.container);

    expect(within(audience.container).getByText("2 / 3")).toBeTruthy();
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
    ]);
    expect(commandsPosted(audienceChannel!)).toEqual([]);
  });

  it("never re-sends the audience's state as a command", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    render(<PresenterView slides={slides} deckId="deck-1" />);
    const [audienceChannel, presenterChannel] = bus.peers;

    // The presenter opened, said hello, and heard the audience's state back.
    expect(presenterChannel?.posted.map((message) => message.type)).toEqual([
      "hello",
    ]);
    expect(commandsPosted(audienceChannel!)).toEqual([]);
    expect(within(audience.container).getByText("1 / 3")).toBeTruthy();
  });

  it("shows the audience's build state at the same step on the presenter's current slide", () => {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);

    clickNext(presenter.container);
    expect(paragraphStates(presenter.container)).toEqual([
      "hidden",
      "hidden",
      "hidden",
    ]);

    clickNext(presenter.container);
    expect(visibility(paragraphStates(presenter.container))).toEqual(
      visibility(paragraphStates(audience.container)),
    );
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      false,
      false,
    ]);

    clickNext(presenter.container);
    expect(visibility(paragraphStates(presenter.container))).toEqual(
      visibility(paragraphStates(audience.container)),
    );
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("PresenterView after the audience leaves", () => {
  function openAudienceAndPresenter() {
    const audience = render(
      <MemoryRouter>
        <PresentationView slides={slides} deckId="deck-1" />
      </MemoryRouter>,
    );
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [audienceChannel] = bus.peers;
    return { audience, presenter, audienceChannel: audienceChannel! };
  }

  it("moves itself on the presenter's keys once the audience window closes", () => {
    const { audience, presenter, audienceChannel } = openAudienceAndPresenter();
    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();

    window.dispatchEvent(new Event("pagehide"));
    audience.unmount();

    expect(audienceChannel.posted).toContainEqual({ type: "bye" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
  });

  it("moves itself on the presenter's keys once the audience leaves for the editor", () => {
    const { audience, presenter, audienceChannel } = openAudienceAndPresenter();

    audience.unmount();

    expect(audienceChannel.posted).toContainEqual({ type: "bye" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
  });
});

describe("PresenterView without an audience", () => {
  it("moves itself once per press and says so to no one", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [presenterChannel] = bus.peers;

    clickNext(presenter.container);

    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toHaveLength(1);
  });

  it("reveals each build step on a press before the slide advances, as the audience does", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      false,
      false,
      false,
    ]);

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      false,
      false,
    ]);

    clickNext(presenter.container);
    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      true,
      true,
    ]);

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("3 / 3")).toBeTruthy();
  });

  it("keeps Next enabled on the last slide while its builds remain", () => {
    const presenter = render(
      <PresenterView
        slides={[slides[0], slides[1]] as Slide[]}
        deckId="deck-1"
      />,
    );
    const next = within(presenter.container).getByRole("button", {
      name: "Next slide",
    }) as HTMLButtonElement;

    clickNext(presenter.container);
    expect(within(presenter.container).getByText("2 / 2")).toBeTruthy();
    expect(next.disabled).toBe(false);

    clickNext(presenter.container);
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      false,
      false,
    ]);
    clickNext(presenter.container);
    clickNext(presenter.container);
    expect(next.disabled).toBe(true);
  });

  it("lands a prev press on the earlier slide fully built, as the audience does", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);

    // plain -> reveal (three builds) -> after.
    for (let press = 0; press < 5; press++) clickNext(presenter.container);
    expect(within(presenter.container).getByText("3 / 3")).toBeTruthy();

    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Previous slide",
      }),
    );
    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(visibility(paragraphStates(presenter.container))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps word boundaries and advances for split speech with no whitespace", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const [presenterChannel] = bus.peers;

    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Start voice navigation",
      }),
    );
    expect(transcriptionMock.start).toHaveBeenCalledTimes(1);
    expect(transcriptionMock.requestedLanguage).toBe("en-US");

    act(() => transcriptionMock.setTranscript?.("Next"));
    act(() => transcriptionMock.setTranscript?.("Nextslide."));

    expect(within(presenter.container).getByText("2 / 3")).toBeTruthy();
    expect(commandsPosted(presenterChannel!)).toEqual([
      { type: "command", command: "next" },
    ]);
  });

  it("leaves Space available to activate the focused voice button", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    const button = within(presenter.container).getByRole("button", {
      name: "Start voice navigation",
    });
    button.focus();

    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();
  });

  it("ignores narration that only mentions the next slide", () => {
    const presenter = render(<PresenterView slides={slides} deckId="deck-1" />);
    fireEvent.click(
      within(presenter.container).getByRole("button", {
        name: "Start voice navigation",
      }),
    );

    act(() =>
      transcriptionMock.setTranscript?.("The next slide explains the idea."),
    );

    expect(within(presenter.container).getByText("1 / 3")).toBeTruthy();
  });
});
