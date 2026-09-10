import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cacheStatusHasHit,
  contentTypeMatches,
  isSameOriginUrl,
  probeUrl,
} from "./check-production-cache-contract.mjs";

const cacheHeaders = (cacheStatus: string) => ({
  "cache-control": "public, max-age=3600, stale-while-revalidate=604800",
  "cdn-cache-control": "public, max-age=3600, stale-while-revalidate=604800",
  "cache-status": cacheStatus,
});

const htmlProbe = {
  pathname: "/apps",
  contentType: "text/html",
  requireRepeatHit: true,
};

function queuedFetch(responses: Response[]) {
  let calls = 0;
  const fetchImpl = async () => {
    const response = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return response.clone();
  };
  return { fetchImpl, calls: () => calls };
}

describe("production cache contract probe helpers", () => {
  it("recognizes hits and successful stale revalidation without false positives", () => {
    assert.equal(cacheStatusHasHit('"Netlify Durable"; hit; ttl=599'), true);
    assert.equal(cacheStatusHasHit('"Netlify Edge"; hit; ttl=599'), true);
    assert.equal(
      cacheStatusHasHit('"Netlify Edge"; fwd=stale; fwd-status=304; stored'),
      true,
    );
    assert.equal(cacheStatusHasHit('"Netlify Edge"; fwd=stale; stored'), false);
    assert.equal(
      cacheStatusHasHit(
        '"Netlify Edge"; fwd=stale; fwd-status=200, "Netlify Origin"; fwd-status=304',
      ),
      false,
    );
    assert.equal(
      cacheStatusHasHit('"Netlify Edge"; detail="fwd=stale; fwd-status=304"'),
      false,
    );
    assert.equal(
      cacheStatusHasHit(
        '"Edge\\\\"; fwd=stale; fwd-status=200, "Netlify Origin"; fwd-status=304',
      ),
      false,
    );
    assert.equal(
      cacheStatusHasHit('"Netlify Durable"; fwd=vary-miss; stored'),
      false,
    );
    assert.equal(cacheStatusHasHit('"Netlify Edge"; fwd=miss; stored'), false);
  });

  it("matches the exact media type used by HTML and React Router data", () => {
    assert.equal(
      contentTypeMatches("text/html; charset=UTF-8", "text/html"),
      true,
    );
    assert.equal(contentTypeMatches("text/x-script", "text/x-script"), true);
    assert.equal(
      contentTypeMatches("text/plain; charset=UTF-8", [
        "text/x-script",
        "text/plain",
      ]),
      true,
    );
    assert.equal(contentTypeMatches("text/htmlish", "text/html"), false);
    assert.equal(
      contentTypeMatches("application/json", "text/x-script"),
      false,
    );
  });

  it("allows only bounded same-origin HTTPS redirects", () => {
    assert.equal(
      isSameOriginUrl(
        "https://www.agent-native.com/apps",
        "www.agent-native.com",
      ),
      true,
    );
    assert.equal(
      isSameOriginUrl(
        "https://www.agent-native.com:443/apps",
        "www.agent-native.com",
      ),
      true,
    );
    assert.equal(
      isSameOriginUrl(
        "https://user:pass@www.agent-native.com/apps",
        "www.agent-native.com",
      ),
      false,
    );
    assert.equal(
      isSameOriginUrl(
        "http://www.agent-native.com/apps",
        "www.agent-native.com",
      ),
      false,
    );
    assert.equal(
      isSameOriginUrl("https://evil.example/apps", "www.agent-native.com"),
      false,
    );
  });

  it("follows a same-origin redirect and reports full-chain timing", async () => {
    const { fetchImpl, calls } = queuedFetch([
      new Response("", {
        status: 302,
        headers: { location: "https://www.agent-native.com/apps/" },
      }),
      new Response("<html>cached</html>", {
        status: 200,
        headers: {
          ...cacheHeaders('"Netlify Edge"; hit; ttl=599'),
          "content-type": "text/html; charset=UTF-8",
          "netlify-cdn-cache-control": "public, max-age=3600",
          "server-timing": "origin;dur=4",
        },
      }),
      new Response("<html>cached</html>", {
        status: 200,
        headers: {
          ...cacheHeaders('"Netlify Edge"; hit; ttl=599'),
          "content-type": "text/html; charset=UTF-8",
        },
      }),
    ]);

    const result = await probeUrl("www.agent-native.com", htmlProbe, fetchImpl);

    assert.equal(result.outcome, "ok");
    assert.equal(calls(), 3);
    assert.match(result.detail, /redirects=1/);
    assert.match(result.detail, /ttfb=\d+ms/);
    assert.match(result.detail, /total=\d+ms/);
    assert.match(
      result.detail,
      /netlify-cdn-cache-control=public, max-age=3600/,
    );
    assert.match(result.detail, /server-timing=origin;dur=4/);
  });

  it("rejects an empty body and an unrelated content type", async () => {
    const wrongType = queuedFetch([
      new Response("{}", {
        status: 200,
        headers: {
          ...cacheHeaders('"Netlify Edge"; hit; ttl=599'),
          "content-type": "application/json",
        },
      }),
    ]);
    const wrongTypeResult = await probeUrl(
      "www.agent-native.com",
      { ...htmlProbe, requireRepeatHit: false },
      wrongType.fetchImpl,
    );
    assert.equal(wrongTypeResult.outcome, "violation");
    assert.match(wrongTypeResult.detail, /expected content-type text\/html/);

    const emptyBody = queuedFetch([
      new Response("", {
        status: 200,
        headers: {
          ...cacheHeaders('"Netlify Edge"; hit; ttl=599'),
          "content-type": "text/html",
        },
      }),
    ]);
    const emptyBodyResult = await probeUrl(
      "www.agent-native.com",
      { ...htmlProbe, requireRepeatHit: false },
      emptyBody.fetchImpl,
    );
    assert.equal(emptyBodyResult.outcome, "violation");
    assert.match(emptyBodyResult.detail, /response body is empty/);
  });

  it("reports a slow cache miss sequence instead of silently passing", async () => {
    const miss = () =>
      new Response("<html>origin</html>", {
        status: 200,
        headers: {
          ...cacheHeaders('"Netlify Edge"; fwd=miss; stored'),
          "content-type": "text/html",
        },
      });
    const { fetchImpl, calls } = queuedFetch([miss(), miss(), miss(), miss()]);

    const result = await probeUrl("www.agent-native.com", htmlProbe, fetchImpl);

    assert.equal(result.outcome, "violation");
    assert.equal(calls(), 4);
    assert.match(result.detail, /did not report a cache hit/);
  });

  it("marks repeated origin failures inconclusive", async () => {
    const { fetchImpl, calls } = queuedFetch([
      new Response("<html>origin</html>", {
        status: 200,
        headers: {
          ...cacheHeaders('"Netlify Edge"; fwd=miss; stored'),
          "content-type": "text/html",
        },
      }),
      new Response("upstream failed", { status: 500 }),
    ]);

    const result = await probeUrl("www.agent-native.com", htmlProbe, fetchImpl);

    assert.equal(result.outcome, "inconclusive");
    assert.equal(calls(), 2);
    assert.match(result.detail, /repeat origin\/redirect failure/);
  });

  it("uses the Netlify policy and rejects an uncacheable repeat", async () => {
    const response = (extra: Record<string, string> = {}) =>
      new Response("<html>page</html>", {
        headers: {
          ...cacheHeaders('"Netlify Edge"; hit; ttl=599'),
          "content-type": "text/html",
          ...extra,
        },
      });
    const shortPolicy = queuedFetch([
      response({ "netlify-cdn-cache-control": "public, max-age=30" }),
    ]);
    assert.equal(
      (await probeUrl("www.agent-native.com", htmlProbe, shortPolicy.fetchImpl))
        .outcome,
      "violation",
    );
    const badRepeat = queuedFetch([
      response(),
      response({ "cache-control": "no-store" }),
    ]);
    assert.equal(
      (await probeUrl("www.agent-native.com", htmlProbe, badRepeat.fetchImpl))
        .outcome,
      "violation",
    );
  });
});
