import { describe, expect, it } from "vitest";

import {
  parseCurlImport,
  type CurlImportIssue,
  type CurlImportProvider,
  type CurlImportResult,
} from "./curl-import";

const PROVIDERS: CurlImportProvider[] = [
  { id: "github", baseUrl: "https://api.github.com" },
  { id: "slack", baseUrl: "https://slack.com/api" },
  { id: "stripe", baseUrl: "https://api.stripe.com" },
  { id: "jira", baseUrl: "https://example-team.atlassian.net" },
  { id: "notion", baseUrl: "https://api.notion.com" },
];

type Imported = Extract<CurlImportResult, { ok: true }>;

function imported(
  command: string,
  providers: readonly CurlImportProvider[] = PROVIDERS,
): Imported {
  const result = parseCurlImport(command, providers);
  if (!result.ok) {
    throw new Error(`expected an import, got ${result.reason}`);
  }
  return result;
}

function failure(
  command: string,
  providers: readonly CurlImportProvider[] = PROVIDERS,
) {
  const result = parseCurlImport(command, providers);
  if (result.ok) throw new Error("expected a failure, got an import");
  return result;
}

function issue(code: CurlImportIssue["code"], detail?: string) {
  return detail === undefined ? { code } : { code, detail };
}

describe("recognizing a curl command", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(failure("").reason).toBe("not_curl");
    expect(failure("  \n\t ").reason).toBe("not_curl");
  });

  it("rejects a command that is not curl", () => {
    expect(failure("wget https://api.github.com/user").reason).toBe("not_curl");
    expect(failure("https://api.github.com/user").reason).toBe("not_curl");
  });

  it("accepts a leading shell prompt", () => {
    expect(imported("$ curl https://api.github.com/user").path).toBe("user");
    expect(failure("$ $ curl https://api.github.com/user").reason).toBe(
      "not_curl",
    );
  });

  it("accepts curl.exe, in any letter case", () => {
    expect(imported("curl.exe https://api.github.com/user").provider).toBe(
      "github",
    );
    expect(imported("CURL.EXE https://api.github.com/user").provider).toBe(
      "github",
    );
  });

  it("reports an unterminated quote of every kind", () => {
    expect(failure("curl 'https://api.github.com/user").reason).toBe(
      "unterminated_quote",
    );
    expect(failure('curl -H "Accept: x https://api.github.com').reason).toBe(
      "unterminated_quote",
    );
    expect(failure("curl $'https://api.github.com/user").reason).toBe(
      "unterminated_quote",
    );
  });
});

describe("quoting", () => {
  it("keeps single-quoted text literal, backslashes included", () => {
    const result = imported(
      String.raw`curl -H 'X-Note: a\nb "c" $HOME' https://api.github.com/user`,
    );
    expect(result.headers).toEqual({ "X-Note": String.raw`a\nb "c" $HOME` });
  });

  it("unescapes double quotes, backslashes, dollars, and backticks only", () => {
    const result = imported(
      'curl -H "X-Note: say \\"hi\\" \\\\ \\$5 \\x \\`tick" https://api.github.com/user',
    );
    expect(result.headers).toEqual({
      "X-Note": 'say "hi" \\ $5 \\x `tick',
    });
  });

  it("reads ANSI-C quotes", () => {
    const result = imported(
      String.raw`curl -H $'X-Note: a\tb\x41\101é\'' $'https://api.github.com/user'`,
    );
    expect(result.headers).toEqual({ "X-Note": "a\tbAAé'" });
    expect(result.path).toBe("user");
  });

  it("drops a header whose value would smuggle a line break", () => {
    const result = imported(
      String.raw`curl -H $'X-Note: a\r\nInjected: yes' https://api.github.com/user`,
    );
    expect(result.headers).toEqual({});
    expect(result.issues).toContainEqual(issue("flag_ignored", "header"));
  });

  it("honors unquoted backslash escapes", () => {
    expect(
      imported(String.raw`curl https://api.github.com/search\?q=1`).query,
    ).toEqual({ q: "1" });
  });

  it("joins a multi-line command at backslash-newline", () => {
    const result = imported(
      [
        "curl -L \\",
        "  -H 'Accept: application/vnd.github+json' \\",
        "  https://api.github.com/repos/octocat/hello-world \\",
        "  -H 'X-GitHub-Api-Version: 2022-11-28'",
      ].join("\n"),
    );
    expect(result.path).toBe("repos/octocat/hello-world");
    expect(result.headers).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  it("joins at backslash plus a Windows line ending", () => {
    const result = imported(
      "curl \\\r\n  -H 'Accept: x' \\\r\n  https://api.github.com/user",
    );
    expect(result.headers).toEqual({ Accept: "x" });
    expect(result.path).toBe("user");
  });

  it("treats tabs and bare newlines as spaces", () => {
    const result = imported(
      "curl\t-H\n'Accept: x'\nhttps://api.github.com/user",
    );
    expect(result.headers).toEqual({ Accept: "x" });
  });

  it("stops at a pipe and skips redirections", () => {
    expect(
      imported("curl -s https://api.github.com/user | jq .name").issues,
    ).toEqual([issue("flag_ignored", "-s")]);
    expect(
      imported("curl https://api.github.com/user > out.json 2>&1").issues,
    ).toEqual([]);
    expect(imported("curl https://api.github.com/user; echo done").path).toBe(
      "user",
    );
  });

  it("keeps a lone ampersand inside an unquoted URL", () => {
    expect(
      imported("curl https://api.github.com/search?q=a&page=2").query,
    ).toEqual({ q: "a", page: "2" });
  });

  it("ignores a trailing comment", () => {
    expect(
      imported("curl https://api.github.com/user # who am i").issues,
    ).toEqual([]);
  });
});

describe("flag syntax", () => {
  it("reads attached short values, long = values, and combined short flags", () => {
    const result = imported(
      "curl -sSL -H'Accept: x' --header=X-Trace:1 -XGET https://api.github.com/user",
    );
    expect(result.headers).toEqual({ Accept: "x", "X-Trace": "1" });
    expect(result.issues).toEqual([
      issue("flag_ignored", "-s"),
      issue("flag_ignored", "-S"),
      issue("flag_ignored", "-L"),
    ]);
  });

  it("lets a value flag end a combined cluster", () => {
    const result = imported("curl -sH 'Accept: x' https://api.github.com/user");
    expect(result.headers).toEqual({ Accept: "x" });
  });

  it("consumes the value of flags that take one", () => {
    const result = imported(
      "curl -o out.json -m 10 -A agent -e https://ref.example --connect-timeout 5 --retry 2 -x proxy:8080 --cacert ca.pem https://api.github.com/user",
    );
    expect(result.provider).toBe("github");
    expect(result.issues.map((entry) => entry.detail)).toEqual([
      "-o",
      "-m",
      "-A",
      "-e",
      "--connect-timeout",
      "--retry",
      "-x",
      "--cacert",
    ]);
  });

  it("ignores unknown flags, consuming the value of an = form", () => {
    const result = imported(
      "curl --made-up=https://elsewhere.example --no-keepalive https://api.github.com/user",
    );
    expect(result.issues).toEqual([
      issue("flag_ignored", "--made-up"),
      issue("flag_ignored", "--no-keepalive"),
    ]);
  });

  it("prefers --url, and reads words after -- as positional", () => {
    expect(imported("curl --url https://api.github.com/user").path).toBe(
      "user",
    );
    expect(imported("curl --url=https://api.github.com/user").path).toBe(
      "user",
    );
    expect(imported("curl -s -- https://api.github.com/user").path).toBe(
      "user",
    );
  });

  it("flags a second positional URL instead of dropping it silently", () => {
    const result = imported(
      "curl https://api.github.com/user https://api.github.com/zen",
    );
    expect(result.path).toBe("user");
    expect(result.issues).toEqual([issue("flag_ignored", "extra-url")]);
  });

  it("reads only the first request of a --next chain", () => {
    const result = imported(
      "curl https://api.github.com/user --next -X POST https://api.github.com/x",
    );
    expect(result.path).toBe("user");
    expect(result.issues).toEqual([issue("flag_ignored", "--next")]);
  });

  it("reports each repeated issue once", () => {
    const result = imported("curl -s -s -s https://api.github.com/user");
    expect(result.issues).toEqual([issue("flag_ignored", "-s")]);
  });

  it("has no URL when only flags are given", () => {
    expect(failure("curl -s -H 'Accept: x'").reason).toBe("no_url");
    expect(failure("curl").reason).toBe("no_url");
  });
});

describe("the URL", () => {
  it("rejects http and names the scheme problem", () => {
    expect(failure("curl http://api.github.com/user").reason).toBe("not_https");
  });

  it("rejects other schemes, schemeless hosts, and garbage", () => {
    expect(failure("curl ftp://api.github.com/user").reason).toBe(
      "invalid_url",
    );
    expect(failure("curl api.github.com/user").reason).toBe("invalid_url");
    expect(failure("curl 'https://'").reason).toBe("invalid_url");
    expect(failure("curl 'https://exa mple.com/x'").reason).toBe("invalid_url");
  });

  it("rejects a URL that would expand a variable or command", () => {
    expect(failure("curl https://api.github.com/users/$USER").reason).toBe(
      "invalid_url",
    );
    expect(
      failure('curl "https://api.github.com/repos/${OWNER}/repo"').reason,
    ).toBe("invalid_url");
    expect(failure("curl https://api.github.com/$(whoami)").reason).toBe(
      "invalid_url",
    );
    expect(failure("curl https://api.github.com/`whoami`").reason).toBe(
      "invalid_url",
    );
  });

  it("keeps a dollar sign that single quotes make literal", () => {
    const result = imported(
      "curl 'https://api.notion.com/v1/search?$filter=a&$top=2'",
    );
    expect(result.query).toEqual({ $filter: "a", $top: "2" });
  });

  it("reports an invalid URL before a non-GET method", () => {
    expect(failure("curl -X POST 'https://'").reason).toBe("invalid_url");
    expect(failure("curl -X POST").reason).toBe("no_url");
  });

  it("drops the fragment", () => {
    const result = imported("curl 'https://api.github.com/user#section'");
    expect(result.path).toBe("user");
  });

  it("drops embedded credentials and reports the URL part, not the value", () => {
    const result = imported(
      "curl https://fake-user:fake-password@api.github.com/user",
    );
    expect(result.path).toBe("user");
    expect(result.issues).toEqual([
      issue("credential_dropped", "url-userinfo"),
    ]);
  });
});

describe("matching a provider", () => {
  it("compares the host without regard to letter case", () => {
    expect(imported("curl https://API.GitHub.COM/user").provider).toBe(
      "github",
    );
  });

  it("fails with unknown_host when no provider owns the host", () => {
    expect(failure("curl https://api.example.org/user").reason).toBe(
      "unknown_host",
    );
    expect(failure("curl https://api.github.com/user", []).reason).toBe(
      "unknown_host",
    );
  });

  it("treats the default port as absent and any other port as a different host", () => {
    expect(imported("curl https://api.github.com:443/user").provider).toBe(
      "github",
    );
    expect(failure("curl https://api.github.com:8443/user").reason).toBe(
      "unknown_host",
    );
    const local = [{ id: "local", baseUrl: "https://dev.example.com:8443" }];
    expect(imported("curl https://dev.example.com:8443/x", local).path).toBe(
      "x",
    );
    expect(failure("curl https://dev.example.com/x", local).reason).toBe(
      "unknown_host",
    );
  });

  it("strips a base URL path prefix on a segment boundary", () => {
    expect(imported("curl https://slack.com/api/conversations.list").path).toBe(
      "conversations.list",
    );
    expect(imported("curl https://slack.com/api").path).toBe("");
    expect(imported("curl https://slack.com/api/").path).toBe("");
    expect(
      failure("curl https://slack.com/apix/conversations.list").reason,
    ).toBe("unknown_host");
    expect(failure("curl https://slack.com/other").reason).toBe("unknown_host");
  });

  it("ignores a trailing slash on the base URL", () => {
    const providers = [{ id: "v2", baseUrl: "https://example.com/api/v2/" }];
    expect(
      imported("curl https://example.com/api/v2/users", providers).path,
    ).toBe("users");
  });

  it("prefers the longest matching prefix when providers share a host", () => {
    const providers = [
      { id: "wide", baseUrl: "https://example.com" },
      { id: "api", baseUrl: "https://example.com/api" },
      { id: "v2", baseUrl: "https://example.com/api/v2" },
    ];
    const v2 = imported("curl https://example.com/api/v2/users", providers);
    expect([v2.provider, v2.path]).toEqual(["v2", "users"]);
    const api = imported("curl https://example.com/api/v3/users", providers);
    expect([api.provider, api.path]).toEqual(["api", "v3/users"]);
    const wide = imported("curl https://example.com/apiary/users", providers);
    expect([wide.provider, wide.path]).toEqual(["wide", "apiary/users"]);
  });

  it("lets the first provider win when two share a base URL", () => {
    const providers = [
      { id: "first", baseUrl: "https://example.com/api" },
      { id: "second", baseUrl: "https://example.com/api" },
    ];
    expect(imported("curl https://example.com/api/x", providers).provider).toBe(
      "first",
    );
  });

  it("skips a provider whose base URL is not a URL", () => {
    const providers = [
      { id: "broken", baseUrl: "not a url" },
      { id: "github", baseUrl: "https://api.github.com" },
    ];
    expect(
      imported("curl https://api.github.com/user", providers).provider,
    ).toBe("github");
  });

  it("keeps percent-encoding as written and returns an empty path for the root", () => {
    expect(
      imported("curl https://api.github.com/repos/a%2Fb/contents/x%20y").path,
    ).toBe("repos/a%2Fb/contents/x%20y");
    expect(imported("curl https://api.github.com").path).toBe("");
    expect(imported("curl https://api.github.com/").path).toBe("");
    expect(imported("curl https://api.github.com//user").path).toBe("user");
  });
});

describe("the query", () => {
  it("reads the URL's query string, decoding plus signs and escapes", () => {
    const result = imported(
      "curl 'https://api.github.com/search/issues?q=is%3Aopen+label%3Abug&per%5Fpage=5&empty=&bare'",
    );
    expect(result.query).toEqual({
      q: "is:open label:bug",
      per_page: "5",
      empty: "",
      bare: "",
    });
  });

  it("turns repeated keys into a list, in order", () => {
    const result = imported(
      "curl 'https://api.github.com/issues?labels=a&sort=updated&labels=b&labels=c'",
    );
    expect(result.query).toEqual({
      labels: ["a", "b", "c"],
      sort: "updated",
    });
    expect(Object.keys(result.query)).toEqual(["labels", "sort"]);
  });

  it("keeps a prototype-looking key as plain data", () => {
    const result = imported("curl 'https://api.github.com/x?__proto__=1'");
    expect(Object.getPrototypeOf(result.query)).toBe(Object.prototype);
    expect(Object.keys(result.query)).toEqual(["__proto__"]);
  });

  it("turns -G with --data-urlencode into query parameters", () => {
    const result = imported(
      "curl -G https://slack.com/api/search.messages --data-urlencode 'query=in:#general from:@ann' --data-urlencode count=5",
    );
    expect(result.query).toEqual({
      query: "in:#general from:@ann",
      count: "5",
    });
    expect(result.issues).toEqual([]);
  });

  it("splits -d pieces on & under --get and decodes them like a query string", () => {
    const result = imported(
      "curl --get https://api.github.com/search/code -d 'q=hello+world&per_page=1' --data-raw page=2",
    );
    expect(result.query).toEqual({
      q: "hello world",
      per_page: "1",
      page: "2",
    });
  });

  it("appends -G data after the URL's own query", () => {
    const result = imported(
      "curl -G 'https://api.github.com/issues?state=open' -d state=closed -d page=2",
    );
    expect(result.query).toEqual({ state: ["open", "closed"], page: "2" });
  });

  it("ignores a -G piece that has no name, with the flag as detail", () => {
    const result = imported(
      "curl -G https://api.github.com/issues -d flagonly -d '{\"a\":1}' --data-urlencode plain --data-urlencode @notes.txt --data-urlencode 'file@notes.txt' -d @body.json",
    );
    expect(result.query).toEqual({});
    expect(result.issues).toEqual([
      issue("body_ignored", "-d"),
      issue("body_ignored", "--data-urlencode"),
    ]);
  });

  it("drops query parameters that carry a credential, by name", () => {
    const result = imported(
      "curl 'https://slack.com/api/conversations.list?limit=5&token=fake-token-123&api_key=fake-key&author=ann'",
    );
    expect(result.query).toEqual({ limit: "5", author: "ann" });
    expect(result.issues).toEqual([
      issue("credential_dropped", "token"),
      issue("credential_dropped", "api_key"),
    ]);
  });
});

describe("the method", () => {
  it("accepts an explicit GET in any case and form", () => {
    expect(imported("curl -X GET https://api.github.com/user").ok).toBe(true);
    expect(imported("curl -X get https://api.github.com/user").ok).toBe(true);
    expect(imported("curl --request=GET https://api.github.com/user").ok).toBe(
      true,
    );
  });

  it("refuses every other method", () => {
    for (const method of ["POST", "put", "PATCH", "DELETE", "PROPFIND"]) {
      const result = failure(`curl -X ${method} https://api.github.com/x`);
      expect(result.reason).toBe("method_not_get");
      expect(result.issues).toEqual([issue("method_not_get", "-X")]);
    }
  });

  it("refuses HEAD however it is asked for", () => {
    expect(failure("curl -I https://api.github.com/user").reason).toBe(
      "method_not_get",
    );
    expect(failure("curl --head https://api.github.com/user").reason).toBe(
      "method_not_get",
    );
    expect(failure("curl -X HEAD https://api.github.com/user").reason).toBe(
      "method_not_get",
    );
  });

  it("refuses data, form, upload, and json without -G, naming the flag", () => {
    const cases: Array<[string, string]> = [
      ["-d a=1", "-d"],
      ["--data-raw a=1", "--data-raw"],
      ["--data-urlencode a=1", "--data-urlencode"],
      ["-F file=@a.txt", "-F"],
      ["--form a=1", "--form"],
      ["-T a.txt", "-T"],
      ["--json '{}'", "--json"],
    ];
    for (const [flags, flag] of cases) {
      const result = failure(`curl ${flags} https://api.github.com/x`);
      expect(result.reason).toBe("method_not_get");
      expect(result.issues).toEqual([issue("method_not_get", flag)]);
    }
  });

  it("refuses form and upload even with -G", () => {
    expect(failure("curl -G -F a=1 https://api.github.com/x").reason).toBe(
      "method_not_get",
    );
    expect(failure("curl -G -T a.txt https://api.github.com/x").reason).toBe(
      "method_not_get",
    );
  });

  it("reports a non-GET method even when the host is unknown", () => {
    expect(failure("curl -X POST https://api.example.org/x").reason).toBe(
      "method_not_get",
    );
    expect(failure("curl -d a=1 https://api.example.org/x").reason).toBe(
      "method_not_get",
    );
  });

  it("keeps an explicit GET and drops the body it carries", () => {
    const result = imported(
      "curl -X GET https://api.github.com/search -d '{\"q\":1}' -F a=1",
    );
    expect(result.issues).toEqual([
      issue("body_ignored", "-d"),
      issue("body_ignored", "-F"),
    ]);
  });
});

describe("headers", () => {
  it("keeps the written casing and the last value of a repeated name", () => {
    const result = imported(
      "curl -H 'accept: text/plain' -H 'X-Trace: 1' -H 'Accept: application/json' https://api.github.com/user",
    );
    expect(result.headers).toEqual({
      "X-Trace": "1",
      Accept: "application/json",
    });
  });

  it("trims names and values", () => {
    const result = imported(
      "curl -H '  Accept :   application/json  ' https://api.github.com/user",
    );
    expect(result.headers).toEqual({ Accept: "application/json" });
  });

  it("drops credential headers, reporting only their names", () => {
    const result = imported(
      [
        "curl https://api.github.com/user",
        "-H 'Authorization: Bearer fake-token-123'",
        "-H 'Proxy-Authorization: Basic fake-password'",
        "-H 'Cookie: session=fake-cookie'",
        "-H 'X-Api-Key: fake-key'",
        "-H 'apikey: fake-key'",
        "-H 'X-CSRF-Token: fake-csrf'",
        "-H 'X-Client-Secret: fake-secret'",
        "-H 'Accept: application/json'",
      ].join(" "),
    );
    expect(result.headers).toEqual({ Accept: "application/json" });
    expect(result.issues).toEqual([
      issue("credential_dropped", "Authorization"),
      issue("credential_dropped", "Proxy-Authorization"),
      issue("credential_dropped", "Cookie"),
      issue("credential_dropped", "X-Api-Key"),
      issue("credential_dropped", "apikey"),
      issue("credential_dropped", "X-CSRF-Token"),
      issue("credential_dropped", "X-Client-Secret"),
    ]);
  });

  it("drops a header whose value is an auth scheme, whatever its name", () => {
    const result = imported(
      "curl -H 'X-Forwarded-For-User: Bearer fake-token-123' https://api.github.com/user",
    );
    expect(result.headers).toEqual({});
    expect(result.issues).toEqual([
      issue("credential_dropped", "X-Forwarded-For-User"),
    ]);
  });

  it("drops transport headers", () => {
    const result = imported(
      [
        "curl https://api.github.com/user",
        "-H 'Host: elsewhere.example'",
        "-H 'Content-Length: 0'",
        "-H 'Connection: keep-alive'",
        "-H 'Transfer-Encoding: chunked'",
        "-H 'Accept-Encoding: gzip'",
        "-H 'Expect: 100-continue'",
        "-H 'Upgrade: websocket'",
      ].join(" "),
    );
    expect(result.headers).toEqual({});
    expect(result.issues).toEqual([
      issue("header_dropped", "Host"),
      issue("header_dropped", "Content-Length"),
      issue("header_dropped", "Connection"),
      issue("header_dropped", "Transfer-Encoding"),
      issue("header_dropped", "Accept-Encoding"),
      issue("header_dropped", "Expect"),
      issue("header_dropped", "Upgrade"),
    ]);
  });

  it("ignores a header without a colon or with an empty value", () => {
    const result = imported(
      "curl -H 'fake-token-123' -H 'Accept:' -H '@headers.txt' https://api.github.com/user",
    );
    expect(result.headers).toEqual({});
    expect(result.issues).toEqual([issue("flag_ignored", "header")]);
  });

  it("keeps harmless headers a GET step may need", () => {
    const result = imported(
      "curl -H 'User-Agent: octo-app' -H 'Notion-Version: 2022-06-28' -H 'X-GitHub-Api-Version: 2022-11-28' https://api.github.com/user",
    );
    expect(result.headers).toEqual({
      "User-Agent": "octo-app",
      "Notion-Version": "2022-06-28",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });
});

describe("credential flags", () => {
  it("drops -u, -b, --oauth2-bearer, and --aws-sigv4 by flag name", () => {
    const result = imported(
      "curl -u fake-user:fake-password -b 'session=fake-cookie' --oauth2-bearer fake-token-123 --aws-sigv4 aws:amz:us-east-1:s3 https://api.github.com/user",
    );
    expect(result.issues).toEqual([
      issue("credential_dropped", "-u"),
      issue("credential_dropped", "-b"),
      issue("credential_dropped", "--oauth2-bearer"),
      issue("credential_dropped", "--aws-sigv4"),
    ]);
    expect(result.provider).toBe("github");
  });

  it("drops the long and attached forms too", () => {
    const result = imported(
      "curl --user=fake-user:fake-password --cookie=fake-cookie -ufake-user:fake-password https://api.github.com/user",
    );
    expect(result.issues).toEqual([
      issue("credential_dropped", "--user"),
      issue("credential_dropped", "--cookie"),
      issue("credential_dropped", "-u"),
    ]);
  });

  it("never lets a credential value reach the result", () => {
    const secrets = ["fake-token-123", "fake-password", "fake-cookie"];
    const command = [
      "curl -X GET",
      "-u fake-user:fake-password",
      "-b 'session=fake-cookie'",
      "-H 'Authorization: Bearer fake-token-123'",
      "-H 'X-Note: Bearer fake-token-123'",
      "--oauth2-bearer fake-token-123",
      "--aws-sigv4 fake-password",
      "--made-up=fake-token-123",
      "-d @fake-cookie",
      "'https://fake-user:fake-password@api.github.com/user?token=fake-token-123&api_key=fake-cookie&ok=1#fake-cookie'",
    ].join(" ");
    const result = parseCurlImport(command, PROVIDERS);
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("fake-user");
  });

  it("never lets a credential value reach a failure either", () => {
    const failures = [
      "curl -H 'Authorization: Bearer fake-token-123' -X POST https://api.github.com/x",
      "curl -u fake-user:fake-password https://api.example.org/x",
      "curl -b fake-cookie 'https://fake-user:fake-password@api.github.com/x y'",
      "curl -H 'Authorization: Bearer fake-token-123' 'https://api.github.com/x",
    ];
    for (const command of failures) {
      const serialized = JSON.stringify(parseCurlImport(command, PROVIDERS));
      expect(serialized).not.toContain("fake-token-123");
      expect(serialized).not.toContain("fake-password");
      expect(serialized).not.toContain("fake-cookie");
    }
  });
});

describe("documentation examples", () => {
  it("imports a GitHub example", () => {
    const result = imported(
      [
        "curl -L \\",
        "  -H 'Accept: application/vnd.github+json' \\",
        "  -H 'Authorization: Bearer <YOUR-TOKEN>' \\",
        "  -H 'X-GitHub-Api-Version: 2022-11-28' \\",
        "  https://api.github.com/repos/OWNER/REPO/issues?state=open&labels=bug",
      ].join("\n"),
    );
    expect(result).toEqual({
      ok: true,
      provider: "github",
      path: "repos/OWNER/REPO/issues",
      query: { state: "open", labels: "bug" },
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      issues: [
        issue("flag_ignored", "-L"),
        issue("credential_dropped", "Authorization"),
      ],
    });
  });

  it("imports a Slack example", () => {
    const result = imported(
      'curl -H "Authorization: Bearer xoxb-fake-token" "https://slack.com/api/conversations.history?channel=C0FAKE&limit=3"',
    );
    expect(result).toEqual({
      ok: true,
      provider: "slack",
      path: "conversations.history",
      query: { channel: "C0FAKE", limit: "3" },
      headers: {},
      issues: [issue("credential_dropped", "Authorization")],
    });
  });

  it("imports a Slack example that sends its filters with -G", () => {
    const result = imported(
      "curl -G https://slack.com/api/conversations.list -H 'Authorization: Bearer xoxb-fake-token' -d types=public_channel -d limit=2",
    );
    expect(result.path).toBe("conversations.list");
    expect(result.query).toEqual({ types: "public_channel", limit: "2" });
  });

  it("imports a Stripe example", () => {
    const result = imported(
      "curl https://api.stripe.com/v1/customers?limit=3 \\\n  -u sk_test_FAKEFAKE:",
    );
    expect(result).toEqual({
      ok: true,
      provider: "stripe",
      path: "v1/customers",
      query: { limit: "3" },
      headers: {},
      issues: [issue("credential_dropped", "-u")],
    });
  });

  it("imports a Stripe example that sends filters with -G", () => {
    const result = imported(
      "curl -G https://api.stripe.com/v1/charges -u sk_test_FAKEFAKE: -d limit=3 -d customer=cus_FAKE",
    );
    expect(result.query).toEqual({ limit: "3", customer: "cus_FAKE" });
  });

  it("imports a Jira example", () => {
    const result = imported(
      [
        "curl --request GET",
        "--url 'https://example-team.atlassian.net/rest/api/3/issue/PROJ-1?fields=summary,status'",
        "--user 'me@example.com:<api_token>'",
        "--header 'Accept: application/json'",
      ].join(" \\\n  "),
    );
    expect(result).toEqual({
      ok: true,
      provider: "jira",
      path: "rest/api/3/issue/PROJ-1",
      query: { fields: "summary,status" },
      headers: { Accept: "application/json" },
      issues: [issue("credential_dropped", "--user")],
    });
  });

  it("imports a Notion example", () => {
    const result = imported(
      [
        "curl 'https://api.notion.com/v1/blocks/fake-block-id/children?page_size=100'",
        "-H 'Authorization: Bearer '\"$NOTION_API_KEY\"''",
        "-H 'Notion-Version: 2022-06-28'",
      ].join(" \\\n  "),
    );
    expect(result).toEqual({
      ok: true,
      provider: "notion",
      path: "v1/blocks/fake-block-id/children",
      query: { page_size: "100" },
      headers: { "Notion-Version": "2022-06-28" },
      issues: [issue("credential_dropped", "Authorization")],
    });
  });

  it("imports a Windows curl.exe example with double quotes", () => {
    const result = imported(
      'curl.exe -s -H "Accept: application/vnd.github+json" -H "Authorization: Bearer fake-token-123" "https://api.github.com/user/repos?per_page=2"',
    );
    expect(result.provider).toBe("github");
    expect(result.query).toEqual({ per_page: "2" });
    expect(result.headers).toEqual({ Accept: "application/vnd.github+json" });
  });
});
