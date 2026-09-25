import { describe, expect, it } from "vitest";

import { sanitizeVisualEditSnapshotHtml } from "./visual-edit-snapshot";

describe("sanitizeVisualEditSnapshotHtml", () => {
  it("blocks private and reserved IPv4 literals in resource attributes", () => {
    const blockedHosts = [
      "127.0.0.1",
      "127.0.0.1.",
      "localhost.",
      "preview.local",
      "10.1.2.3",
      "172.31.2.3",
      "192.168.1.2",
      "169.254.1.2",
      "100.64.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "0.0.0.0",
      "255.255.255.255",
      "0x7f000001",
    ];
    const html = blockedHosts
      .map(
        (host, index) =>
          `<img id="blocked-${index}" src="https://${host}/asset.png">`,
      )
      .join("");

    const sanitized = sanitizeVisualEditSnapshotHtml(html);

    for (let index = 0; index < blockedHosts.length; index += 1) {
      expect(sanitized).toContain(`id="blocked-${index}"`);
      expect(sanitized).not.toContain(
        `src="https://${blockedHosts[index]}/asset.png"`,
      );
    }
  });

  it("blocks network resources and keeps embedded images", () => {
    const blockedHosts = [
      "[::]",
      "[::1]",
      "[::ffff:127.0.0.1]",
      "[fc00::1]",
      "[fd12:3456::1]",
      "[fe80::1]",
      "[ff02::1]",
      "[2001:db8::1]",
      "[2002:7f00:1::1]",
      "[3fff::1]",
    ];
    const html = [
      ...blockedHosts.map(
        (host, index) =>
          `<img id="blocked-${index}" src="https://${host}/asset.png">`,
      ),
      '<img id="public-host" src="https://cdn.example.com/asset.png">',
      '<img id="embedded" src="data:image/png;base64,AAAA">',
    ].join("");

    const sanitized = sanitizeVisualEditSnapshotHtml(html);

    for (let index = 0; index < blockedHosts.length; index += 1) {
      expect(sanitized).toContain(`id="blocked-${index}"`);
      expect(sanitized).not.toContain(
        `src="https://${blockedHosts[index]}/asset.png"`,
      );
    }
    expect(sanitized).toContain('id="public-host"');
    expect(sanitized).not.toContain('src="https://cdn.example.com/asset.png"');
    expect(sanitized).toContain('src="data:image/png;base64,AAAA"');
  });

  it("checks background and strips navigation or other URL-bearing attributes", () => {
    const sanitized = sanitizeVisualEditSnapshotHtml(`
      <body background="http://127.0.0.1/private.png">
        <img id="image" src="https://cdn.example.com/public.png"
          srcset="http://127.0.0.1/private.png 2x"
          imagesrcset="http://127.0.0.1/private.png 2x"
          lowsrc="http://127.0.0.1/private.png"
          dynsrc="http://127.0.0.1/private.mp4"
          attributionsrc="https://example.com/attribution">
        <input id="focus" autofocus>
        <a id="link" href="http://127.0.0.1/" ping="https://example.com/ping">Open</a>
        <blockquote id="quote" cite="https://example.com/source">Quote</blockquote>
        <html manifest="http://127.0.0.1/cache" profile="https://example.com/profile"></html>
      </body>
    `);

    expect(sanitized).not.toContain("background=");
    expect(sanitized).not.toContain("srcset=");
    expect(sanitized).not.toContain("imagesrcset=");
    expect(sanitized).not.toContain("lowsrc=");
    expect(sanitized).not.toContain("dynsrc=");
    expect(sanitized).not.toContain("attributionsrc=");
    expect(sanitized).not.toContain("href=");
    expect(sanitized).not.toContain("ping=");
    expect(sanitized).not.toContain("cite=");
    expect(sanitized).not.toContain("manifest=");
    expect(sanitized).not.toContain("profile=");
    expect(sanitized).not.toContain("autofocus");
    expect(sanitized).not.toContain('src="https://cdn.example.com/public.png"');
  });

  it("strips legacy and navigation URL attributes", () => {
    const attributes = [
      "action",
      "archive",
      "classid",
      "code",
      "codebase",
      "data",
      "formaction",
      "icon",
      "itemid",
      "longdesc",
      "srcdoc",
      "target",
      "usemap",
      "xml:base",
    ];
    const html = `<div ${attributes.map((name) => `${name}="https://example.com/resource"`).join(" ")}></div>`;

    const sanitized = sanitizeVisualEditSnapshotHtml(html);

    for (const attribute of attributes) {
      expect(sanitized).not.toContain(`${attribute}=`);
    }
  });

  it("filters external URLs from SVG presentation attributes but keeps local and public references", () => {
    const sanitized = sanitizeVisualEditSnapshotHtml(`
      <svg>
        <path id="loopback-fill" fill="url(http://127.0.0.1/fill.svg#paint)"></path>
        <path id="private-filter" filter="url(http://10.0.0.1/filter.svg#filter)"></path>
        <path id="private-clip" clip-path="url(https://[::1]/clip.svg#clip)"></path>
        <path id="private-mask" mask="url(https://[fe80::1]/mask.svg#mask)"></path>
        <path id="private-marker" marker-start="url(https://192.168.1.5/marker.svg#marker)"></path>
        <path id="local" fill="url(#local-gradient)" clip-path="url(#local-clip)"></path>
        <path id="public-host" filter="url(https://cdn.example.com/filter.svg#filter)"></path>
      </svg>
    `);

    expect(sanitized).not.toContain(
      'fill="url(http://127.0.0.1/fill.svg#paint)"',
    );
    expect(sanitized).not.toContain(
      'filter="url(http://10.0.0.1/filter.svg#filter)"',
    );
    expect(sanitized).not.toContain(
      'clip-path="url(https://[::1]/clip.svg#clip)"',
    );
    expect(sanitized).not.toContain(
      'mask="url(https://[fe80::1]/mask.svg#mask)"',
    );
    expect(sanitized).not.toContain(
      'marker-start="url(https://192.168.1.5/marker.svg#marker)"',
    );
    expect(sanitized).toContain('fill="url(#local-gradient)"');
    expect(sanitized).toContain('clip-path="url(#local-clip)"');
    expect(sanitized).toContain('id="public-host"');
    expect(sanitized).not.toContain(
      'filter="url(https://cdn.example.com/filter.svg#filter)"',
    );
  });

  it("removes unsafe CSS url() while keeping safe layout and public image styles", () => {
    const sanitized = sanitizeVisualEditSnapshotHtml(`
      <div id="unsafe" style="display: grid; gap: 8px; background-image: u\\72l(https://127.0.0.1/private.png); color: red"></div>
      <div id="safe" style="display: grid; gap: 8px; background-image: url(https://cdn.example.com/public.png); color: red"></div>
      <div id="local" style="mask-image: url(#local-mask); margin: 0"></div>
      <div id="text" style="content: &quot;u\\72l(https://127.0.0.1/private.png)&quot;; margin: 0"></div>
    `);

    expect(sanitized).toContain(
      'id="unsafe" style="display: grid; gap: 8px; color: red"',
    );
    expect(sanitized).toContain(
      'id="safe" style="display: grid; gap: 8px; color: red"',
    );
    expect(sanitized).toContain(
      'id="local" style="mask-image: url(#local-mask); margin: 0"',
    );
    expect(sanitized).toContain(
      'id="text" style="content: &quot;u\\72l(https://127.0.0.1/private.png)&quot;; margin: 0"',
    );
  });

  it("checks escaped image-set() string candidates for private IPv4 and IPv6", () => {
    const sanitized = sanitizeVisualEditSnapshotHtml(`
      <div id="escaped" style="display: grid; background-image: image-\\73 et('http://192.168.1.2/private.png' 1x, url(https://cdn.example.com/public.png) 2x); margin: 0"></div>
      <div id="ipv6" style="display: grid; background-image: image-set('https://[fe80::1]/private.png' 1x); margin: 0"></div>
      <div id="safe" style="display: grid; background-image: image-set('https://cdn.example.com/a.png' 1x, url(https://cdn.example.com/b.png) 2x); margin: 0"></div>
    `);

    expect(sanitized).toContain(
      'id="escaped" style="display: grid; margin: 0"',
    );
    expect(sanitized).toContain('id="ipv6" style="display: grid; margin: 0"');
    expect(sanitized).toContain('id="safe" style="display: grid; margin: 0"');
  });

  it("removes form controls and their serialized values", () => {
    const sanitized = sanitizeVisualEditSnapshotHtml(`
      <input id="name" value="private name">
      <input type="hidden" name="csrf" value="example-hidden-secret">
      <input type="password" name="password" value="example-password-secret">
      <textarea id="notes">private notes</textarea>
      <select id="account"><option value="private-id">private account</option></select>
      <button name="operation" value="private-action">Save changes</button>
      <output>private result</output>
      <div id="placeholder" data-value="kept as page markup">Visible</div>
    `);

    expect(sanitized).not.toContain("<input");
    expect(sanitized).not.toContain("<textarea");
    expect(sanitized).not.toContain("<select");
    expect(sanitized).not.toContain("<option");
    expect(sanitized).not.toContain("<output");
    expect(sanitized).not.toContain("private");
    expect(sanitized).not.toContain("example-hidden-secret");
    expect(sanitized).not.toContain("example-password-secret");
    expect(sanitized).not.toContain('name="operation"');
    expect(sanitized).not.toContain('value="private-action"');
    expect(sanitized).toContain("<button>Save changes</button>");
    expect(sanitized).toContain('id="placeholder"');
  });
});
