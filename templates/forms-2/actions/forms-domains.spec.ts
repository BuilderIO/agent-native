import { resolveTxt } from "node:dns/promises";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { simpleFormBlocks } from "../shared/form-model/fixtures.js";
import {
  as,
  owner,
  startTestDb,
  stopTestDb,
  stranger,
} from "./_test-context.js";
import addDomain from "./add-domain.js";
import createForm from "./create-form.js";
import deleteDomain from "./delete-domain.js";
import getDomainForm from "./get-domain-form.js";
import listDomains from "./list-domains.js";
import mapDomainForm from "./map-domain-form.js";
import publishForm from "./publish-form.js";
import unmapDomainForm from "./unmap-domain-form.js";
import verifyDomain from "./verify-domain.js";

vi.mock("node:dns/promises", () => ({ resolveTxt: vi.fn() }));
const lookup = vi.mocked(resolveTxt);

const dnsError = (code: string) =>
  Object.assign(new Error(code), { code }) as Error;

describe("custom domains", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(() => lookup.mockReset());

  it("keeps two users without an org out of each other's domains", async () => {
    const soloA = { userEmail: "solo-a@example.test" };
    const soloB = { userEmail: "solo-b@example.test" };
    const domain = await as(soloA, () =>
      addDomain.run({ host: "forms.solo-a.example.test" }),
    );
    const seen = (await as(soloB, () => listDomains.run({}))).domains;
    expect(seen.map((d) => d.id)).not.toContain(domain.id);
    await expect(
      as(soloB, () => deleteDomain.run({ id: domain.id })),
    ).rejects.toThrow();
    const own = (await as(soloA, () => listDomains.run({}))).domains;
    expect(own.map((d) => d.id)).toContain(domain.id);
  });

  it("adds a pending domain with a CNAME and a TXT record", async () => {
    const domain = await as(owner, () =>
      addDomain.run({ host: " https://Forms.Example.test/path " }),
    );
    expect(domain.host).toBe("forms.example.test");
    expect(domain.status).toBe("pending");
    expect(domain.records.map((record) => record.type)).toEqual([
      "CNAME",
      "TXT",
    ]);
    const txt = domain.records[1];
    expect(txt?.name).toBe("_forms-verify.forms.example.test");
    expect(txt?.value).toMatch(/^forms-verify=[0-9a-f]{32}$/);
  });

  it("refuses a bad host and a duplicate host", async () => {
    await expect(
      as(owner, () => addDomain.run({ host: "nodots" })),
    ).rejects.toMatchObject({ errorCode: "invalid_input" });
    await expect(
      as(stranger, () => addDomain.run({ host: "forms.example.test" })),
    ).rejects.toMatchObject({ errorCode: "conflict" });
  });

  it("stays pending without a DNS answer and never verifies on a lookup failure", async () => {
    const [domain] = (await as(owner, () => listDomains.run({}))).domains;
    if (!domain) throw new Error("domain missing");
    lookup.mockRejectedValueOnce(dnsError("ENOTFOUND"));
    const missing = await as(owner, () => verifyDomain.run({ id: domain.id }));
    expect(missing).toMatchObject({ check: "no_record" });
    expect(missing.domain.status).toBe("pending");

    lookup.mockRejectedValueOnce(dnsError("ETIMEOUT"));
    const failed = await as(owner, () => verifyDomain.run({ id: domain.id }));
    expect(failed).toMatchObject({ check: "lookup_failed" });
    expect(failed.domain.status).toBe("pending");

    lookup.mockResolvedValueOnce([["forms-verify=wrong"]]);
    const wrong = await as(owner, () => verifyDomain.run({ id: domain.id }));
    expect(wrong.domain.status).toBe("pending");
  });

  it("serves a mapped published form only on a verified domain", async () => {
    const [domain] = (await as(owner, () => listDomains.run({}))).domains;
    if (!domain) throw new Error("domain missing");
    const { id: formId } = await as(owner, () => createForm.run({}));
    await as(owner, () =>
      publishForm.run({ id: formId, blocks: simpleFormBlocks("Mapped") }),
    );
    await expect(
      as(owner, () =>
        mapDomainForm.run({ domainId: domain.id, formId, slug: "survey" }),
      ),
    ).rejects.toMatchObject({ errorCode: "conflict" });

    const token = domain.records[1]?.value ?? "";
    lookup.mockResolvedValueOnce([[token.slice(0, 20), token.slice(20)]]);
    const verified = await as(owner, () => verifyDomain.run({ id: domain.id }));
    expect(verified).toMatchObject({ check: "found" });
    expect(verified.domain.status).toBe("verified");

    await as(owner, () =>
      mapDomainForm.run({ domainId: domain.id, formId, slug: "survey" }),
    );
    const served = await getDomainForm.run({
      host: "Forms.Example.test:8080",
      slug: "survey",
    });
    expect(served.formId).toBe(formId);
    expect(
      (await getDomainForm.run({ host: "forms.example.test", slug: "other" }))
        .formId,
    ).toBeNull();
    expect(
      (await getDomainForm.run({ host: "other.example.test", slug: "survey" }))
        .formId,
    ).toBeNull();

    const listed = (await as(owner, () => listDomains.run({}))).domains[0];
    const mapping = listed?.forms[0];
    expect(mapping?.slug).toBe("survey");
    await as(owner, () => unmapDomainForm.run({ id: mapping?.id ?? "" }));
    expect(
      (await getDomainForm.run({ host: "forms.example.test", slug: "survey" }))
        .formId,
    ).toBeNull();
  });

  it("keeps other organizations out and deletes for good", async () => {
    const [domain] = (await as(owner, () => listDomains.run({}))).domains;
    if (!domain) throw new Error("domain missing");
    expect((await as(stranger, () => listDomains.run({}))).domains).toEqual([]);
    await expect(
      as(stranger, () => deleteDomain.run({ id: domain.id })),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    await as(owner, () => deleteDomain.run({ id: domain.id }));
    expect((await as(owner, () => listDomains.run({}))).domains).toEqual([]);
  });
});
