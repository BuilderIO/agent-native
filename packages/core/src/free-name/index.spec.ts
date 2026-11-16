import { describe, expect, it } from "vitest";

import { isActionContractError, NoWriteError } from "../action.js";
import {
  isFreeNameFor,
  isNameTaken,
  NAME_TAKEN_ERROR_CODE,
  nextFreeName,
} from "./index.js";
import { nameTaken } from "./server.js";

describe("nextFreeName", () => {
  it("keeps a free name as it is", () => {
    expect(nextFreeName("home.html", new Set(["about.html"]))).toBe(
      "home.html",
    );
  });

  it("numbers a taken name before its extension, from 2", () => {
    expect(nextFreeName("home.html", new Set(["home.html"]))).toBe(
      "home-2.html",
    );
    expect(
      nextFreeName(
        "home.html",
        new Set(["home.html", "home-2.html", "home-3.html"]),
      ),
    ).toBe("home-4.html");
  });

  it("skips a gap only when the gap is taken", () => {
    expect(
      nextFreeName("home.html", new Set(["home.html", "home-3.html"])),
    ).toBe("home-2.html");
  });

  it("numbers the end of a name with no extension, or only a leading dot", () => {
    expect(nextFreeName("README", new Set(["README"]))).toBe("README-2");
    expect(nextFreeName(".env", new Set([".env"]))).toBe(".env-2");
  });

  it("numbers only the last extension", () => {
    expect(nextFreeName("app.test.ts", new Set(["app.test.ts"]))).toBe(
      "app.test-2.ts",
    );
  });

  it("asks a function when the taken names aren't a set", () => {
    const asked: string[] = [];
    const name = nextFreeName("x.css", (candidate) => {
      asked.push(candidate);
      return candidate !== "x-3.css";
    });
    expect(name).toBe("x-3.css");
    expect(asked).toEqual(["x.css", "x-2.css", "x-3.css"]);
  });

  it("compares names exactly, the way a unique index does", () => {
    expect(nextFreeName("Home.html", new Set(["home.html"]))).toBe("Home.html");
  });
});

describe("isFreeNameFor", () => {
  it("accepts the name itself and the names nextFreeName picks for it", () => {
    expect(isFreeNameFor("home.html", "home.html")).toBe(true);
    expect(isFreeNameFor("home-2.html", "home.html")).toBe(true);
    expect(isFreeNameFor("home-12.html", "home.html")).toBe(true);
    expect(isFreeNameFor("README-2", "README")).toBe(true);
  });

  it("refuses other names", () => {
    for (const name of [
      "home-1.html",
      "home-02.html",
      "home-.html",
      "home-2.css",
      "home-x.html",
      "homepage.html",
      "about-2.html",
      "home-2-2.html",
    ]) {
      expect(isFreeNameFor(name, "home.html"), name).toBe(false);
    }
  });
});

describe("nameTaken", () => {
  it("is a 409 that names the taken name and carries a free one", () => {
    const error = nameTaken("screen", "home.html", "home-2.html");
    expect(isActionContractError(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: NAME_TAKEN_ERROR_CODE,
      statusCode: 409,
      details: { name: "home.html", suggestion: "home-2.html" },
    });
    expect(error.message).toContain('"home.html" already exists');
    expect(error.message).toContain('"home-2.html"');
    expect(error).not.toBeInstanceOf(NoWriteError);
  });

  it("says nothing was written when asked to", () => {
    const error = nameTaken("file", "a.css", "a-2.css", { noWrite: true });
    expect(error).toBeInstanceOf(NoWriteError);
    expect(error).toMatchObject({ errorCode: NAME_TAKEN_ERROR_CODE });
    expect(error.statusCode).toBe(409);
  });
});

describe("isNameTaken", () => {
  it("recognizes the refusal however it arrived", () => {
    expect(isNameTaken(nameTaken("file", "a.css", "a-2.css"))).toBe(true);
    // As an app's own fetch rebuilds it from the response body.
    const rebuilt = Object.assign(new Error("taken"), {
      errorCode: "name_taken",
      details: { name: "a.css", suggestion: "a-2.css" },
    });
    expect(isNameTaken(rebuilt)).toBe(true);
  });

  it("refuses other errors and a refusal without its names", () => {
    expect(isNameTaken(new Error("name_taken"))).toBe(false);
    expect(isNameTaken({ errorCode: "name_taken" })).toBe(false);
    expect(
      isNameTaken({ errorCode: "name_taken", details: { name: "a.css" } }),
    ).toBe(false);
    expect(
      isNameTaken({
        errorCode: "save_conflict",
        details: { name: "a", suggestion: "b" },
      }),
    ).toBe(false);
    expect(isNameTaken(null)).toBe(false);
  });
});
