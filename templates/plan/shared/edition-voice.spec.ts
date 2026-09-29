import { describe, expect, it } from "vitest";

import {
  pickEditionVoice,
  selectableEditionVoices,
  type VoiceLike,
} from "./edition-voice.js";

const v = (
  name: string,
  lang: string,
  extra: Partial<VoiceLike> = {},
): VoiceLike => ({ name, lang, localService: true, ...extra });

describe("pickEditionVoice", () => {
  it("prefers a premium voice over the platform default", () => {
    const picked = pickEditionVoice(
      [v("Albert", "en-US", { default: true }), v("Ava (Premium)", "en-US")],
      "en-US",
    );
    expect(picked?.name).toBe("Ava (Premium)");
  });

  it("never picks a macOS novelty voice, even as the only default", () => {
    expect(
      pickEditionVoice([v("Zarvox", "en-US", { default: true })], "en-US"),
    ).toBeNull();
    expect(pickEditionVoice([v("Bad News", "en-US")], "en-US")).toBeNull();
    // Including when the vendor appends a qualifier.
    expect(
      pickEditionVoice([v("Fred (Enhanced)", "en-US")], "en-US"),
    ).toBeNull();
  });

  it("prefers a network voice over a bundled compact one", () => {
    const picked = pickEditionVoice(
      [
        v("Samantha", "en-US", { default: true }),
        v("Google US English", "en-US", { localService: false }),
      ],
      "en-US",
    );
    expect(picked?.name).toBe("Google US English");
  });

  it("falls back to the same language before giving up", () => {
    const picked = pickEditionVoice([v("Daniel", "en-GB")], "en-US");
    expect(picked?.name).toBe("Daniel");
  });

  it("returns null rather than reading English in another language's voice", () => {
    expect(pickEditionVoice([v("Zuzana", "cs-CZ")], "en-US")).toBeNull();
  });

  it("exact locale beats same-language when quality is equal", () => {
    const picked = pickEditionVoice(
      [v("Daniel", "en-GB"), v("Samantha", "en-US")],
      "en-US",
    );
    expect(picked?.name).toBe("Samantha");
  });
});

describe("selectableEditionVoices", () => {
  it("offers same-language voices best-first and drops novelty ones", () => {
    const list = selectableEditionVoices(
      [
        v("Zarvox", "en-US"),
        v("Samantha", "en-US", { default: true }),
        v("Ava (Premium)", "en-US"),
        v("Zuzana", "cs-CZ"),
      ],
      "en-US",
    );
    expect(list.map((x) => x.name)).toEqual(["Ava (Premium)", "Samantha"]);
  });
});
