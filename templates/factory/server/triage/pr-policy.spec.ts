import { describe, expect, it } from "vitest";

import {
  decidePullRequestGovernance,
  detectOwnerOwnedArea,
  hasCurrentBlockingPullRequestReview,
  hasCurrentPullRequestApproval,
  hasActiveCredibleSafetyFinding,
  isDocsOnly,
  isUltraScaryChange,
} from "./pr-policy.js";

const cleanInternalBug = {
  author: "builder-engineer",
  authorId: 1,
  repository: "BuilderIO/agent-native",
  changedFiles: ["packages/core/src/triage/fix.ts"],
  clearBug: true,
  productUxImplications: false,
  checksPassed: true,
  reviewFeedbackHandled: true,
  blockingReviewStatesClean: true,
  safetyFindingsClean: true,
  openNonDraft: true,
  internalBuilderMember: true,
  factoryTriggered: true,
};

describe("pull-request governance", () => {
  it("approves but never merges a clean internal Factory bug fix", () => {
    expect(decidePullRequestGovernance(cleanInternalBug)).toMatchObject({
      ownerOwnedArea: null,
      ownerException: null,
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("keeps non-owner-managed app work manual", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        repository: "BuilderIO/content",
        changedFiles: ["templates/content/app/routes/index.tsx"],
      }),
    ).toMatchObject({
      ownerOwnedArea: "content",
      ownerException: null,
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("allows a verified internal author through ordinary check and review uncertainty", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksPassed: false,
        reviewFeedbackHandled: false,
        blockingReviewStatesClean: true,
      }),
    ).toMatchObject({
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("never approves partial CI evidence even for a verified internal author", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksCoverage: "partial",
      }),
    ).toMatchObject({
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("applies the verified Liam exception across ordinary UX gates", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        changedFiles: ["templates/design/app/pages/DesignEditor.tsx"],
        clearBug: false,
        productUxImplications: true,
        checksPassed: false,
        reviewFeedbackHandled: false,
        blockingReviewStatesClean: true,
      }),
    ).toMatchObject({
      trustException: "liamdebeasi",
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("keeps the Liam exception behind membership and governance safety gates", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        changedFiles: ["templates/design/app/pages/DesignEditor.tsx"],
        clearBug: false,
        productUxImplications: true,
        internalBuilderMember: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        changedFiles: [".agents/skills/review-prs/SKILL.md"],
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        clearBug: false,
        productUxImplications: true,
        blockingReviewStatesClean: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        repository: "BuilderIO/other-repo",
        clearBug: false,
        productUxImplications: true,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        clearBug: false,
        productUxImplications: true,
        factoryTriggered: false,
      }).autoApprove,
    ).toBe(false);
    expect(isUltraScaryChange(["nested/AGENTS.md"])).toBe(true);
    expect(isUltraScaryChange([".agents/skills/other/SKILL.md"])).toBe(true);
    expect(isUltraScaryChange([".github/actions/checkout/action.yml"])).toBe(
      true,
    );
    expect(isUltraScaryChange(["package.json"])).toBe(true);
    expect(isUltraScaryChange(["pnpm-lock.yaml"])).toBe(true);
    expect(isUltraScaryChange(["turbo.json"])).toBe(true);
    expect(
      isUltraScaryChange(["templates/factory/server/triage/pr-policy.ts"]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/actions/govern-factory-pull-request.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/lib/require-workspace-member.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/lib/require-workspace-member.spec.ts",
      ]),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "No security issues found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "No security vulnerabilities were identified.",
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "Authentication middleware does not enforce tenant isolation.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            author: "reviewer",
            state: "commented",
            body: "Authentication is secure but this endpoint has an SSRF vulnerability.",
            observedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            author: "reviewer",
            state: "commented",
            body: "This endpoint has an SSRF vulnerability.",
            observedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            author: "reviewer",
            state: "commented",
            body: "Nit: rename this variable.",
            observedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "This change enables XSS." }],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "CSP allows attacker-controlled inline scripts.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "No content security policy vulnerabilities were found.",
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "No CSP vulnerabilities were found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "No CSP issues found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "No HTML sanitization issues were found.",
          },
        ],
        [],
      ),
    ).toBe(false);
    for (const body of [
      "No HTML sanitization vulnerability was found.",
      "No sanitizer vulnerability was found.",
      "The sanitizer vulnerability was fixed.",
      "The sanitizer's vulnerability was fixed.",
      "No API token vulnerabilities were found.",
      "No untrusted HTML issues were found.",
      "No OAuth redirect issues were found.",
      "No CORS issues were found.",
      "No authentication bypass vulnerabilities were found.",
      "No authentication issues were found.",
      "No authorization issues were found.",
      "No XSS, CSRF, or authentication vulnerabilities were found.",
      "No XSS was found.",
      "XSS, CSRF, and authentication vulnerabilities were fixed.",
      "CSP and authorization vulnerabilities were fixed.",
      "User-controlled HTML is rendered safely into the DOM.",
      "Untrusted HTML is rendered into the DOM only after escaping.",
      "Untrusted input is assigned to innerHTML only after proper escaping.",
      "User-controlled HTML is passed to dangerouslySetInnerHTML only after sanitization.",
      "User-controlled HTML is sanitized before it is rendered to the DOM.",
      "User-controlled HTML is escaped before it is assigned to innerHTML.",
      "Untrusted HTML is encoded before it reaches dangerouslySetInnerHTML.",
      "Untrusted SVG is sanitized before being assigned to innerHTML.",
      "Untrusted SVG with onload=alert(1) is sanitized before being assigned to innerHTML.",
      "User-controlled SVG has onload attribute but handler is removed by sanitization before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but the handler is removed by sanitization before insertion.",
      "User-provided SVG onload handler is set to null before insertion into the DOM.",
      "No user-controlled SVG onload handler sets document.cookie to an attacker endpoint.",
      "No user-controlled SVG onload handler sets window.location.href to an attacker-controlled page.",
      "No user-controlled SVG onload handler assigns window.location.href to an attacker-controlled page.",
      "No user-controlled SVG onload handler changes window.location.href to an attacker-controlled page.",
      "User-controlled HTML is sanitized and then rendered to the DOM.",
      "No XSS was found; user-controlled HTML is rendered safely into the DOM.",
      "This change reduces prompt tokens by 500.",
    ]) {
      expect(
        hasActiveCredibleSafetyFinding([{ state: "commented", body }], []),
        body,
      ).toBe(false);
    }
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "The CSP and authentication bypass are safe.",
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "No API key vulnerabilities were found.",
          },
        ],
        [],
      ),
    ).toBe(false);
    for (const body of [
      "The API token is exposed in client output.",
      "An API key is leaked to logs.",
      "The webhook token is returned to an untrusted caller.",
      "A token leaked to client output.",
      "Token exposed to untrusted callers.",
      "GitHub token leaked to logs.",
      "The user password is sent to the client.",
      "This renders user-controlled HTML without escaping through innerHTML.",
      "Untrusted input is assigned to innerHTML.",
      "User-supplied HTML is assigned to innerHTML.",
      "Attacker-provided markup is passed to dangerouslySetInnerHTML.",
      "The UI uses dangerouslySetInnerHTML with attacker-controlled markup.",
      "HTML from the PR body is inserted directly into the DOM.",
      "HTML is rendered unescaped from an untrusted source.",
      "User-controlled markup can execute JavaScript in the page.",
      "Attacker can inject markup that executes JavaScript.",
      "Attacker can inject HTML into the DOM, which executes JavaScript.",
      "User input is reflected into the DOM without encoding.",
      "User-controlled HTML is rendered into the DOM unsanitized.",
      "The renderer puts unescaped user-controlled content in the DOM.",
      "An attacker-controlled value is passed to HTML rendering without escaping.",
      "User-generated HTML is assigned to innerHTML.",
      "Attacker-injected HTML is passed to dangerouslySetInnerHTML.",
      "Untrusted user HTML is passed to dangerouslySetInnerHTML.",
      "Malicious HTML reaches dangerouslySetInnerHTML.",
      "HTML supplied by a user is assigned to innerHTML.",
      "HTML from the PR description reaches dangerouslySetInnerHTML.",
      "HTML from the request body is passed to dangerouslySetInnerHTML.",
      "Request-body HTML is assigned to innerHTML.",
      "The API response HTML is assigned to innerHTML.",
      "The comment HTML is assigned to innerHTML.",
      "DangerouslySetInnerHTML receives arbitrary HTML.",
      "Arbitrary markup is inserted into the DOM.",
      "External HTML is assigned to innerHTML.",
      "Third-party HTML is passed to dangerouslySetInnerHTML.",
      "Remote HTML reaches dangerouslySetInnerHTML.",
      "Uploaded HTML is inserted into the DOM.",
      "Webhook HTML is passed to innerHTML.",
      "User-supplied SVG is assigned to innerHTML.",
      "Attacker-controlled SVG reaches dangerouslySetInnerHTML.",
      "Untrusted SVG markup reaches innerHTML.",
      "Malicious SVG runs script via innerHTML.",
      "Attacker-controlled SVG with onload=alert(1) executes when previewed.",
      "User-controlled SVG includes an onload handler that executes in the browser.",
      "Attacker-controlled SVG contains an onload=alert(1) payload.",
      "User-supplied SVG includes an onerror=alert(document.cookie) handler.",
      "Attacker-controlled SVG has an onload handler that calls alert(1).",
      "User-supplied SVG has an onerror handler invoking alert(document.cookie).",
      "User-provided SVG has an onload attribute that calls alert(1).",
      "Untrusted SVG onload attribute invokes alert(1).",
      "Attacker-controlled SVG onload attribute leaks the session cookie.",
      "User-supplied SVG with an onload event attribute exfiltrates credentials.",
      "User-supplied SVG onload event can exfiltrate cookies.",
      "User-supplied SVG onload event evaluates attacker-controlled JavaScript.",
      "User-supplied SVG onload event uses eval(document.cookie).",
      "User-controlled SVG onload handler performs a fetch of document.cookie to an attacker-controlled endpoint.",
      "User-controlled SVG onload handler sets document.cookie to an attacker endpoint.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page.",
      "Untrusted SVG onload handler assigns window.location.href to an attacker-controlled page.",
      "Untrusted SVG onload handler changes window.location.href to an attacker-controlled page.",
      "Untrusted SVG onload handler is removed by sanitization before insertion, but another onload handler sets window.location.href to an attacker-controlled page and is not removed before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but another onload handler is removed by sanitization before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but the handler is not removed before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but it isn't removed before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but it wasn't removed before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but it doesn't get removed before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but it fails to be removed before insertion.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but it is removed after insertion before execution.",
      "Untrusted SVG onload handler sets window.location.href to an attacker-controlled page, but the unrelated preview record is removed by sanitization before insertion.",
      "No user-controlled SVG onload handler sets document.cookie, but another handler exfiltrates the session token.",
      "No user-controlled SVG onload handler sets document.cookie, but the handler executes alert(1).",
      "No user-controlled SVG onload handler sets window.location.href to an attacker-controlled page, but the handler executes alert(1).",
      "Attacker-controlled SVG onload event posts document.cookie to an external endpoint.",
      "User-controlled SVG onload handler stores document.cookie at an attacker endpoint.",
      "Attacker-controlled SVG onload event mutates the parent document.",
      "Unsanitized markup is passed to innerHTML.",
      "Unescaped markup reaches dangerouslySetInnerHTML.",
      "User-controlled HTML is safely rendered into the DOM but is not properly escaped.",
      "User-controlled HTML renders safely into the DOM; it is actually not escaped.",
      "The UI renders user input safely, however the HTML is not escaped before insertion.",
      "The HTML renders safely into DOM, but no proper escaping is applied to user input.",
      "The patch safely renders a static preview. It also passes untrusted HTML through dangerouslySetInnerHTML.",
      "The app safely renders a preview. The review issue is that untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview is rendered safely, but untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview is rendered safely; user-controlled HTML is passed to dangerouslySetInnerHTML.",
      "The app safely renders a preview, although untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview renders safely, and user-controlled HTML reaches dangerouslySetInnerHTML.",
      "The preview renders safely and user-controlled HTML reaches dangerouslySetInnerHTML.",
      "User-controlled HTML renders safely into the DOM and is also passed to dangerouslySetInnerHTML.",
      "The preview renders safely, yet untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview renders safely, though untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview renders safely, untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview renders safely — user-controlled HTML reaches dangerouslySetInnerHTML.",
      "The preview renders safely – user-controlled HTML reaches dangerouslySetInnerHTML.",
      "The preview path renders safely: user-controlled HTML reaches dangerouslySetInnerHTML.",
      "A separate preview renders safely (the live path is different): untrusted HTML reaches dangerouslySetInnerHTML.",
      "The preview is rendered safely / user-controlled HTML reaches dangerouslySetInnerHTML.",
      "User-controlled HTML is rendered safely in preview, but the original untrusted HTML is passed to dangerouslySetInnerHTML.",
      "User-controlled HTML is rendered safely in preview; however, the original untrusted HTML is passed to dangerouslySetInnerHTML.",
      "User-controlled HTML is rendered safely in preview, but the original source value is passed to dangerouslySetInnerHTML.",
      "Untrusted HTML is rendered without escaping, so scripts can run.",
      "The Markdown renderer permits event-handler attributes.",
      "OAuth callback accepts arbitrary redirect URLs.",
      "CORS permits untrusted origins.",
      "Open redirect lets an attacker steal tokens.",
    ]) {
      expect(
        hasActiveCredibleSafetyFinding([{ state: "commented", body }], []),
        body,
      ).toBe(true);
    }
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "The authentication bypass is safe." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "The HTML sanitizer allows event-handler attributes.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "No issues found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "CSP is safe\nAuthentication bypass permits access.",
          },
        ],
        [],
      ),
    ).toBe(true);
    for (const body of [
      "No CSP issues found, authentication bypass permits access.",
      "No CSP issues found and authentication bypass permits access.",
      "No CSP issues found as authentication bypass permits access.",
      "No CSP issues found except authentication bypass permits access.",
      "No CSP issues found although authentication bypass permits access.",
      "No CSP issues found though authentication bypass permits access.",
      "No CSP issues found despite authentication bypass permits access.",
      "No issues found, authentication bypass permits access.",
      "No issues found and authentication bypass permits access.",
      "No issues found as authentication bypass permits access.",
      "No issues found except authentication bypass permits access.",
      "No issues except an authentication bypass vulnerability was found.",
      "CSP is safe, authentication bypass permits access.",
      "No CSP issues found, authentication bypass permits access.",
      "No authentication issues, API token is exposed, and a CSP vulnerability was found.",
      "No auth issue, one API token was leaked, and a CSP vulnerability was found.",
      "CSP vulnerability found, authentication bypass is safe.",
      "An authentication bypass remains, unrelated CSP issues were resolved.",
      "CSP vulnerability remains and auth issue was a false positive.",
      "The CSP vulnerability remains and the auth issue was a false positive.",
    ]) {
      expect(
        hasActiveCredibleSafetyFinding([{ state: "commented", body }], []),
      ).toBe(true);
    }
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "approved", body: "No XSS or CSRF vulnerabilities found." }],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "The SSRF vulnerability is not fixed." }],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "There is no authorization." }],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            author: "reviewer",
            state: "commented",
            body: "This endpoint has an SSRF vulnerability.",
            observedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            author: "reviewer",
            state: "approved",
            body: "Resolved.",
            observedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "Authorization is not enforced on this endpoint.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      hasActiveCredibleSafetyFinding(
        [
          {
            state: "commented",
            body: "The previous authorization issue is resolved, but this endpoint has an SSRF vulnerability.",
          },
        ],
        [],
      ),
    ).toBe(true);
    expect(
      isUltraScaryChange(["templates/factory/server/triage/github-client.ts"]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/triage/ai-services-git.ts",
        "templates/factory/server/triage/pr-monitor.ts",
        "templates/factory/actions/ingest-github-observation.ts",
        "templates/factory/actions/reconcile-triage-run.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/actions/approve-factory-item.ts",
        "templates/factory/actions/start-builder-for-item.ts",
      ]),
    ).toBe(true);
    expect(
      isUltraScaryChange([
        "templates/factory/server/plugins/agent-chat.ts",
        "templates/factory/server/triage/builder-executor.ts",
      ]),
    ).toBe(true);
  });

  it("keeps active safety findings blocking", () => {
    expect(
      hasActiveCredibleSafetyFinding(
        [{ state: "commented", body: "This bypasses tenant isolation." }],
        [],
      ),
    ).toBe(true);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "liamdebeasi",
        authorId: 2721089,
        safetyFindingsClean: false,
      }).autoApprove,
    ).toBe(false);
  });

  it("does not trust an owner username without verified membership", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "3mdistal",
        changedFiles: ["templates/content/app/routes/index.tsx"],
        clearBug: false,
        checksPassed: false,
        reviewFeedbackHandled: false,
        internalBuilderMember: false,
      }),
    ).toMatchObject({
      ownerException: null,
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("applies the current owner exceptions within their configured scopes", () => {
    const cases = [
      {
        author: "3mdistal",
        changedFiles: [
          "templates/content/app/routes/index.tsx",
          "packages/core/src/client/action.ts",
        ],
        ownerException: "alice-content",
        ownerOwnedArea: "content",
      },
      {
        author: "NKoech123",
        changedFiles: [
          "templates/slides/app/routes/index.tsx",
          "packages/core/src/client/action.ts",
        ],
        ownerException: "nick-slides",
        ownerOwnedArea: null,
      },
      {
        author: "enzoames",
        changedFiles: ["templates/factory/actions/run.ts"],
        ownerException: "enzo-factory",
        ownerOwnedArea: null,
      },
      {
        author: "sidmohanty11",
        changedFiles: ["templates/design/app/routes/index.tsx"],
        ownerException: "sid-design",
        ownerOwnedArea: "design",
      },
      {
        author: "shomix",
        changedFiles: [
          "templates/design/app/pages/DesignEditor.tsx",
          "packages/core/src/client/action.ts",
        ],
        ownerException: "shomix",
        ownerOwnedArea: "design",
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        decidePullRequestGovernance({
          ...cleanInternalBug,
          author: testCase.author,
          authorId:
            testCase.author === "shomix"
              ? 100691266
              : cleanInternalBug.authorId,
          changedFiles: testCase.changedFiles,
          clearBug: false,
          productUxImplications: true,
          checksPassed: false,
          reviewFeedbackHandled: false,
        }),
      ).toMatchObject({
        ownerException: testCase.ownerException,
        ownerOwnedArea: testCase.ownerOwnedArea,
        autoApprove: true,
        autoMerge: false,
      });
    }
  });

  it("keeps the Shomix exception behind its identity, safety, and review gates", () => {
    const shomixPullRequest = {
      ...cleanInternalBug,
      author: "Shomix",
      authorId: 100691266,
      changedFiles: [
        "templates/factory/server/lib/factory-automation-preview.ts",
      ],
      clearBug: false,
      productUxImplications: true,
    };

    expect(decidePullRequestGovernance(shomixPullRequest)).toMatchObject({
      ownerException: "shomix",
      autoApprove: true,
      autoMerge: false,
    });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        authorId: 1,
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        repository: "BuilderIO/other-repo",
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        internalBuilderMember: false,
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        safetyFindingsClean: false,
      }).autoApprove,
    ).toBe(false);
    const htmlSinkFinding = hasActiveCredibleSafetyFinding(
      [
        {
          state: "commented",
          body: "The preview renders safely, and user-controlled HTML reaches dangerouslySetInnerHTML.",
        },
      ],
      [],
    );
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        safetyFindingsClean: !htmlSinkFinding,
      }).autoApprove,
    ).toBe(false);
    for (const body of [
      "User-supplied SVG is assigned to innerHTML.",
      "Attacker-controlled SVG reaches dangerouslySetInnerHTML.",
      "Untrusted SVG markup reaches innerHTML.",
      "Malicious SVG runs script via innerHTML.",
      "Attacker-controlled SVG with onload=alert(1) executes when previewed.",
      "User-controlled SVG includes an onload handler that executes in the browser.",
      "Attacker-controlled SVG contains an onload=alert(1) payload.",
      "User-supplied SVG includes an onerror=alert(document.cookie) handler.",
      "Attacker-controlled SVG has an onload handler that calls alert(1).",
      "User-supplied SVG has an onerror handler invoking alert(document.cookie).",
      "User-provided SVG has an onload attribute that calls alert(1).",
      "Untrusted SVG onload attribute invokes alert(1).",
      "Attacker-controlled SVG onload attribute leaks the session cookie.",
      "User-supplied SVG with an onload event attribute exfiltrates credentials.",
      "User-supplied SVG onload event can exfiltrate cookies.",
      "User-supplied SVG onload event evaluates attacker-controlled JavaScript.",
      "User-supplied SVG onload event uses eval(document.cookie).",
      "User-controlled SVG onload handler performs a fetch of document.cookie to an attacker-controlled endpoint.",
      "Attacker-controlled SVG onload event posts document.cookie to an external endpoint.",
      "User-controlled SVG onload handler stores document.cookie at an attacker endpoint.",
      "Attacker-controlled SVG onload event mutates the parent document.",
      "Unsanitized markup is passed to innerHTML.",
      "Unescaped markup reaches dangerouslySetInnerHTML.",
    ]) {
      const hasFinding = hasActiveCredibleSafetyFinding(
        [{ state: "commented", body }],
        [],
      );
      expect(hasFinding, body).toBe(true);
      expect(
        decidePullRequestGovernance({
          ...shomixPullRequest,
          safetyFindingsClean: !hasFinding,
        }).autoApprove,
        body,
      ).toBe(false);
    }
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        blockingReviewStatesClean: false,
      }).autoApprove,
    ).toBe(false);
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        changedFiles: [".agents/skills/review-prs/SKILL.md"],
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        changedFiles: [
          "templates/factory/actions/govern-factory-pull-request.ts",
        ],
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    expect(
      decidePullRequestGovernance({
        ...shomixPullRequest,
        changedFiles: [
          "templates/factory/server/lib/require-workspace-member.ts",
        ],
      }),
    ).toMatchObject({ ownerException: null, autoApprove: false });
    for (const path of [
      "packages/core/src/client/mcp-apps/McpAppRenderer.tsx",
      "packages/core/src/mcp/embed-app.ts",
      "packages/core/src/mcp/mount-mcp.ts",
      "packages/core/src/mcp/build-server.ts",
      "packages/core/src/mcp/oauth-route.ts",
      "packages/core/src/mcp/oauth-token.ts",
      "packages/core/src/mcp-client/oauth-routes.ts",
      "packages/core/src/mcp-client/oauth-flow-cookie.ts",
      "packages/core/src/server/embed-session.ts",
      "packages/core/src/server/embed-route.ts",
      "packages/core/src/server/embedded.ts",
      "packages/core/src/client/embed-auth.ts",
      "packages/core/src/client/embed.ts",
      "packages/core/src/client/IframeEmbed.tsx",
      "packages/core/src/client/AgentNativeEmbedded.tsx",
      "packages/core/src/client/mcp-app-host.ts",
      "packages/core/src/shared/embed-auth.ts",
      "packages/core/src/shared/mcp-embed-headers.ts",
      "packages/core/src/client/blocks/library/sanitize-html.ts",
      "packages/core/src/authorization/check-action.ts",
      "packages/core/src/authorization/action-access-runtime.ts",
      "packages/core/src/org/membership.ts",
      "packages/core/src/org/workspace-app-access.ts",
      "packages/core/src/org/app-roles.ts",
      "packages/core/src/org/actions/offboard-member.ts",
      "packages/core/src/org/actions/set-app-member-roles.ts",
      "packages/core/src/org/actions/set-workspace-app-access.ts",
      "packages/core/src/sharing/access.ts",
      "packages/core/src/mcp/connect-route.ts",
      "packages/core/src/mcp/connect-store.ts",
      "packages/core/src/mcp/approval-store.ts",
      "packages/core/src/mcp/actions/service-token-access.ts",
      "packages/core/src/mcp/actions/create-org-service-token.ts",
      "packages/core/src/mcp/actions/revoke-org-service-token.ts",
      "packages/core/src/agent/tool-approval-store.ts",
      "packages/core/src/agent/actions/set-tool-approval-policy.ts",
      "packages/core/src/workspace-connections/actions/upsert-workspace-user-group.ts",
      "packages/core/src/db/schema.ts",
      "templates/factory/server/db/schema.ts",
      "templates/analytics/server/db/schema-monitoring.ts",
      "templates/analytics/server/db/schema-errors.ts",
      "packages/core/src/scripts/db/schema.ts",
      "packages/core/src/scripts/db/wipe-leaked-builder-keys.ts",
      "packages/core/src/server/csrf.ts",
      "packages/core/src/server/csrf.spec.ts",
      "packages/core/src/server/csrf-plugin-ordering.integration.spec.ts",
      "packages/core/src/server/cors-origins.ts",
      ".github/dependabot.yml",
      "packages/core/src/server/short-lived-token.ts",
      "packages/core/src/server/realtime-token.ts",
      "packages/core/src/integrations/internal-token.ts",
      "packages/core/src/org/context.ts",
      "packages/core/src/org/federation.ts",
      "packages/core/src/email-catalog/authorize.ts",
      "packages/core/src/guards/no-unscoped-queries.ts",
      "packages/core/src/mcp/server.ts",
      "packages/core/src/mcp-client/manager.ts",
      "packages/core/src/embedding/bridge.ts",
      "packages/core/src/client/ApiKeySettings.tsx",
      "packages/core/src/client/MCPClientManager.ts",
      "packages/core/src/server/CSRFPlugin.ts",
      "packages\\core\\src\\client\\ApiKeySettings.tsx",
      "packages/core/src/extensions/url-safety.ts",
      "packages/core/src/extensions/fetch-tool.ts",
      "packages/core/src/extensions/html-shell.ts",
      "packages/core/src/extensions/routes.ts",
      "packages/core/src/client/extensions/iframe-bridge.ts",
      "packages/core/src/client/extensions/AgentNativeExtensionFrame.tsx",
      "packages/core/src/client/extensions/InlineExtensionFrame.tsx",
      "packages/core/src/db-admin/routes.ts",
      "packages/core/src/db-admin/operations.ts",
      "packages/core/src/triggers/webhook.ts",
      "packages/core/src/triggers/webhook-store.ts",
      "packages/core/src/triggers/dispatcher.ts",
      "packages/core/src/triggers/dispatcher.spec.ts",
      "packages/core/src/triggers/condition-evaluator.ts",
      "packages/core/src/triggers/actions/manage-automation.ts",
      "packages/core/src/triggers/actions/manage-automation.spec.ts",
      "packages/core/src/jobs/frontmatter.ts",
      "packages/core/src/jobs/frontmatter.spec.ts",
      "packages/core/src/jobs/run-now.ts",
      "packages/core/src/jobs/run-now.spec.ts",
      "packages/core/src/jobs/background-automation-runner.ts",
      "packages/core/src/jobs/scheduler.ts",
      "packages/core/src/automations/service.ts",
      "packages/core/src/automations/service.spec.ts",
      "packages/core/src/notifications/store.ts",
      "packages/core/src/notifications/store.spec.ts",
      "packages/core/src/notifications/channels.ts",
      "packages/core/src/notifications/channels.spec.ts",
      "packages/core/src/notifications/actions.ts",
      "packages/core/src/automation/index.ts",
      "packages/core/src/automation/index.spec.ts",
      "packages/core/src/server/collab-plugin.ts",
      "packages/core/src/server/collab-plugin.spec.ts",
      "packages/core/src/server/origin-allowlist.ts",
      "packages/core/src/server/prompts/framework-core-compact.ts",
      "packages/core/src/guards/no-unscoped-queries.spec.ts",
      "packages/core/src/server/prompts/framework-core.ts",
      "packages/core/src/server/prompts/shared-rules.ts",
      "packages/core/src/server/builder-browser.ts",
      "packages/core/src/server/core-routes-plugin.ts",
      "packages/core/src/server/core-routes-plugin.spec.ts",
      "packages/core/src/server/open-route.ts",
      "packages/core/src/server/open-route.spec.ts",
      "packages/core/src/server/agent-chat/browser-team-tools.ts",
      "packages/core/src/server/agent-chat/browser-team-tools.spec.ts",
      "packages/core/src/browser-context/index.ts",
      "packages/core/src/client/host-bridge.ts",
      "packages/core/src/client/frame.ts",
      "packages/core/src/client/builder-frame.ts",
      "packages/core/src/client/blocks/library/html.config.ts",
      "packages/core/src/client/blocks/library/html.tsx",
      "packages/core/src/client/blocks/library/diagram.tsx",
      "packages/core/src/client/blocks/library/wireframe.tsx",
      "packages/core/src/server/agent-chat-plugin.ts",
      "packages/core/src/server/builder-preview-relay.spec.ts",
      "packages/core/src/server/action-routes.ts",
      "packages/core/src/server/action-routes.spec.ts",
      "packages/core/src/server/hosted-harness-policy.ts",
      "packages/core/src/server/hosted-harness-policy.spec.ts",
      "packages/core/src/cli/workspace-skill-policy.ts",
      "packages/core/src/shared/password-policy.ts",
      "packages/core/src/shared/framework-route-prefix.spec.ts",
      "packages/core/src/triggers/routes.ts",
      "packages/core/src/collab/routes.ts",
      "packages/core/src/collab/struct-routes.ts",
      "packages/core/src/notifications/routes.ts",
      "templates/mail/app/lib/sanitize-html.ts",
      "templates/slides/app/lib/sanitize-slide-html.ts",
      "templates/design/shared/capture-sanitize.ts",
      "templates/design/shared/capture-sanitize.spec.ts",
      "templates/brain/server/lib/capture-sanitization.ts",
      "templates/brain/server/lib/capture-sanitization.test.ts",
      "templates/brain/actions/resanitize-captures.ts",
      "templates/brain/actions/resanitize-captures.spec.ts",
      "templates/plan/app/components/plan/wireframe/sanitize-html.spec.ts",
      "templates/calendar/app/lib/sanitize-description.ts",
      "templates/calendar/app/lib/sanitize-description.test.ts",
      "templates/analytics/app/components/Markdown.tsx",
      "templates/factory/server/lib/require-factory-automation.ts",
      "templates/factory/server/lib/require-factory-automation.spec.ts",
      "templates/factory/server/lib/factory-automation-resources.ts",
      "templates/factory/server/lib/factory-automation-resources.spec.ts",
      "templates/factory/server/lib/factory-automation-caller.ts",
      "templates/factory/server/lib/factory-automation-config.ts",
      "templates/factory/server/lib/factory-automation-config.spec.ts",
      "templates/factory/server/lib/factory-automation-history.ts",
      "templates/factory/server/lib/factory-automation-history.spec.ts",
      "templates/factory/server/lib/factory-automation-repair.ts",
      "templates/factory/server/lib/factory-scope.ts",
      "templates/factory/server/lib/factory-scope-id.spec.ts",
      "templates/factory/server/lib/factory-scope-config-row.spec.ts",
      "templates/factory/server/lib/factory-scope-automation-display.spec.ts",
      "templates/factory/server/lib/github-repository.ts",
      "templates/factory/server/lib/github-repository.spec.ts",
      "templates/factory/server/lib/pr-babysit-prompt.ts",
      "templates/factory/server/lib/pr-babysit-prompt.spec.ts",
      "templates/factory/server/lib/slack-feedback-prompt.ts",
      "templates/factory/server/lib/factory-config-reconcile.ts",
      "templates/factory/server/lib/factory-config-reconcile.spec.ts",
      "templates/factory/server/lib/factory-poll-cursors.ts",
      "templates/factory/server/lib/factory-audit-report.ts",
      "templates/factory/server/lib/factory-audit-report.spec.ts",
      "templates/factory/server/lib/audit-cursor.ts",
      "templates/factory/server/lib/audit-cursor.spec.ts",
      "templates/factory/server/lib/source-reaction.ts",
      "templates/factory/server/lib/source-reaction.spec.ts",
      "templates/factory/server/lib/safe-http-url.ts",
      "templates/factory/server/lib/safe-http-url.spec.ts",
      "templates/factory/app/lib/safe-http-url.ts",
      "templates/factory/app/lib/safe-http-url.spec.ts",
      "templates/factory/server/plugins/factory-scheduler-job.ts",
      "templates/factory/server/plugins/factory-scheduler-job.spec.ts",
      "templates/factory/server/factory-graph/contracts.ts",
      "templates/factory/server/factory-graph/contracts.spec.ts",
      "templates/factory/server/factory-graph/store.ts",
      "templates/factory/actions/govern-factory-pull-request.ts",
      "templates/factory/actions/govern-factory-pull-request.spec.ts",
      "templates/factory/actions/create-factory.ts",
      "templates/factory/actions/create-factory.spec.ts",
      "templates/factory/actions/babysit-factory-pull-request.ts",
      "templates/factory/actions/babysit-factory-pull-request.spec.ts",
      "templates/factory/actions/propose-pr-babysit-status.ts",
      "templates/factory/actions/run-factory-automation.ts",
      "templates/factory/actions/run-factory-automation.spec.ts",
      "templates/factory/actions/save-factory-automation.ts",
      "templates/factory/actions/save-factory-automation.spec.ts",
      "templates/factory/actions/create-factory-automation.ts",
      "templates/factory/actions/create-factory-automation.spec.ts",
      "templates/factory/actions/restore-factory-automation-version.ts",
      "templates/factory/actions/get-factory-automation-version.ts",
      "templates/factory/actions/list-factory-automation-versions.ts",
      "templates/factory/actions/list-factory-automations.ts",
      "templates/factory/actions/list-factory-automations.spec.ts",
      "templates/factory/actions/delete-factory-automation-version.ts",
      "templates/factory/actions/save-factory-graph.ts",
      "templates/factory/actions/get-factory-graph.ts",
      "templates/factory/actions/list-factory-graph-versions.ts",
      "templates/factory/actions/get-factory-graph-version.ts",
      "templates/factory/actions/restore-factory-graph-version.ts",
      "templates/factory/actions/factory-graph-history.spec.ts",
      "templates/factory/actions/get-triage-config.ts",
      "templates/factory/actions/get-triage-config.spec.ts",
      "templates/factory/actions/save-triage-config.ts",
      "templates/factory/actions/get-triage-item.ts",
      "templates/factory/actions/list-triage-items.ts",
      "templates/factory/actions/list-triage-items.spec.ts",
      "templates/factory/actions/list-factory-comments.ts",
      "templates/factory/actions/list-triage-rules.ts",
      "templates/factory/actions/save-triage-rule.ts",
      "templates/factory/actions/evaluate-triage-item.ts",
      "templates/factory/actions/provider-api-request.ts",
      "templates/factory/server/lib/provider-api.ts",
      "templates/factory/actions/poll-github-sources.ts",
      "templates/factory/actions/poll-github-sources.spec.ts",
      "templates/factory/actions/poll-slack-channel.ts",
      "templates/factory/actions/poll-slack-channel.spec.ts",
      "templates/factory/actions/poll-sentry-errors.ts",
      "templates/factory/actions/dispatch-factory-item.ts",
      "templates/factory/actions/dispatch-factory-item.spec.ts",
      "templates/factory/actions/list-factory-audit.ts",
      "templates/factory/actions/get-slack-feedback-context.ts",
      "templates/factory/actions/get-factory-automation-health.ts",
      "templates/factory/actions/list-factory-automation-templates.ts",
      "templates/factory/server/triage/sentry-client.ts",
      "templates/factory/server/triage/sentry-client.spec.ts",
      "templates/factory/server/triage/slack-client.ts",
      "templates/factory/server/triage/slack-client.spec.ts",
      "templates/factory/server/triage/slack-poller.ts",
      "templates/factory/server/triage/slack-poller.spec.ts",
      "templates/factory/server/triage/babysit-evidence.ts",
      "templates/factory/server/triage/babysit-evidence.spec.ts",
      "templates/factory/server/triage/babysit-recommendation.ts",
      "templates/factory/server/triage/babysit-recommendation.spec.ts",
      "templates/factory/server/triage/babysit-thread-closure.ts",
      "templates/factory/server/triage/babysit-thread-closure.spec.ts",
      "templates/factory/server/triage/pr-babysit-terminal.ts",
      "templates/factory/server/triage/review-state.ts",
      "templates/factory/server/triage/review-state.spec.ts",
      "templates/factory/server/triage/slack-review-window.ts",
      "templates/factory/server/triage/slack-review-window.spec.ts",
      "templates/factory/server/triage/contracts.ts",
      "templates/factory/server/triage/guards.ts",
      "templates/factory/server/triage/audit.ts",
      "templates/factory/server/triage/babysit-audit-details.ts",
      "templates/factory/server/triage/babysit-queue.ts",
      "templates/factory/server/triage/babysit-queue.spec.ts",
      "templates/factory/server/triage/metadata.ts",
      "templates/factory/server/triage/metadata.spec.ts",
      "templates/factory/server/triage/github-client.spec.ts",
      "templates/factory/server/triage/github-ingestion.spec.ts",
      "templates/factory/server/triage/pr-monitor.spec.ts",
      "templates/content/scripts/migrate-production.ts",
      "templates/forms/db/schema.ts",
      "templates/forms/scripts/db/reset-database.ts",
      "templates/forms/actions/update-user-role.ts",
      "templates/forms/server/csrf-protection.ts",
      "templates/design/app/lib/figma-svg-copy.ts",
      "templates/design/app/pages/design-editor/commands/pasted-svg.ts",
      "templates/plan/server/plan-content.ts",
      "templates/design/server/routes/api/qa-figma-import-assets/[assetId].get.ts",
      "packages/core/src/client/chat/markdown-renderer.tsx",
      "packages/docs/app/components/MarkdownRenderer.tsx",
      "templates/slides/app/components/deck/SlideRenderer.tsx",
      ".claude/settings.json",
      "scripts/hooks/file-lease.mjs",
      "templates/forms/actions/delete-form.ts",
      "templates/clips/actions/delete-recording-permanent.ts",
      "templates/tasks/actions/bulk-delete-tasks.ts",
      "templates/tasks/actions/bulk-delete-tasks.test.ts",
      "templates/tasks/actions/bulk-delete-inbox-items.ts",
      "templates/tasks/actions/bulk-delete-inbox-items.test.ts",
      "templates/content/actions/migrate-content-database-rows.ts",
      "templates/content/actions/migrate-content-database-rows.db.test.ts",
      "templates/design/actions/migrate-board-objects-to-file.ts",
      "templates/design/actions/migrate-board-objects-to-file.spec.ts",
      ".github/CODEOWNERS",
      ".github/dependabot.yml",
      "scripts/guard-no-drizzle-push.mjs",
      "scripts/guard-trusted-acceptance-workflow.ts",
      "scripts/guard-trusted-acceptance-workflow.spec.ts",
      "templates/calendar/amplify.yml",
      "packages/creative-context/src/server/safe-native-preview.ts",
      "packages/creative-context/src/connectors/rendered-page.ts",
      "packages/recap-cli/src/recap.ts",
    ]) {
      expect(isUltraScaryChange([path])).toBe(true);
      expect(
        decidePullRequestGovernance({
          ...shomixPullRequest,
          changedFiles: [path],
        }),
      ).toMatchObject({ ownerException: null, autoApprove: false });
    }
    for (const path of [
      "templates/forms/app/schemas/lead.ts",
      "templates/factory/server/lib/factory-automation-preview.ts",
      "templates/factory/server/lib/factory-automation-preview.spec.ts",
      "templates/factory/server/lib/factory-automation-plan.ts",
      "templates/factory/server/lib/factory-automation-plan.spec.ts",
      "packages/core/src/guards/no-raw-colors.ts",
      "templates/slides/app/components/editor/PromptDialog.tsx",
      "templates/tasks/app/components/shared/DeleteItemDialog.tsx",
    ]) {
      expect(isUltraScaryChange([path])).toBe(false);
      expect(
        decidePullRequestGovernance({
          ...shomixPullRequest,
          changedFiles: [path],
        }),
      ).toMatchObject({ ownerException: "shomix", autoApprove: true });
    }
  });

  it("requires complete check evidence while allowing the internal-member exception", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksPassed: false,
        checksCoverage: "complete",
      }).autoApprove,
    ).toBe(true);
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        checksPassed: false,
        checksCoverage: "partial",
      }).autoApprove,
    ).toBe(false);
  });

  it("applies the verified docs-only exception", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "bwreid",
        changedFiles: ["docs/review.md", ".changeset/docs-review.md"],
        clearBug: false,
        productUxImplications: true,
        checksPassed: false,
        reviewFeedbackHandled: false,
      }),
    ).toMatchObject({
      ownerException: "docs-only",
      autoApprove: true,
      autoMerge: false,
    });
  });

  it("does not treat source artifacts as docs-only MDX", () => {
    expect(isDocsOnly(["templates/plan/plan.mdx"])).toBe(false);
    expect(isDocsOnly(["templates/tasks/docs/features/f1-tasks.mdx"])).toBe(
      true,
    );
  });

  it("keeps ultra-scary paths manual despite a verified owner", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        author: "3mdistal",
        changedFiles: [
          "templates/content/app/routes/index.tsx",
          "packages/core/src/auth/session.ts",
        ],
        clearBug: false,
        productUxImplications: false,
      }),
    ).toMatchObject({
      ownerException: null,
      autoApprove: false,
      autoMerge: false,
    });
  });

  it("does not treat a product or UX change as a clear-bug approval", () => {
    expect(
      decidePullRequestGovernance({
        ...cleanInternalBug,
        productUxImplications: true,
      }).autoApprove,
    ).toBe(false);
  });

  it("recognizes app-labelled reports but not a generic Clips URL", () => {
    expect(detectOwnerOwnedArea(["Design Generation: broken export"])).toBe(
      "design",
    );
    expect(
      detectOwnerOwnedArea(["https://clips.agent-native.com/feedback"]),
    ).toBeNull();
    expect(detectOwnerOwnedArea(["apps/content/src/routes/index.tsx"])).toBe(
      "content",
    );
  });

  it("recognizes a current approval but not a later dismissal", () => {
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "commented",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "dismissed",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(false);
    expect(
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            commitSha: "old-head",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "new-head",
      ),
    ).toBe(false);
    expect(() =>
      hasCurrentPullRequestApproval(
        [
          {
            author: "reviewer",
            state: "approved",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toThrow("missing a commit SHA");
  });

  it("preserves active changes requests across comments", () => {
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "changes_requested",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "approved",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(false);
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "changes_requested",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "commented",
            commitSha: "head-1",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "pending",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentBlockingPullRequestReview(
        [
          {
            author: "reviewer",
            state: "changes_requested",
            commitSha: "head-1",
            observedAt: "2026-08-19T10:00:00Z",
          },
          {
            author: "reviewer",
            state: "approved",
            commitSha: "old-head",
            observedAt: "2026-08-19T11:00:00Z",
          },
        ],
        "head-1",
      ),
    ).toBe(true);
  });
});
