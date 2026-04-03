const API_KEY =
  "oBi4Cty5Hn7oWUPkqWpVauDn6E4S45ueHa14ymPF6MWgBCqj3MuoDGDJJGq311iM2DsQ0aSvVvL7Pa2Ay5553w";

const brands = [
  "greylock.com",
  "microsoft.com",
  "zapier.com",
  "jcrew.com",
  "panasonic.com",
  "scale.com",
  "ocbc.com",
  "pendo.io",
  "clickup.com",
  "harrys.com",
];

async function fetchLogos() {
  const results: Record<
    string,
    { url: string; format: string; theme: string }
  > = {};

  for (const domain of brands) {
    try {
      const res = await fetch("https://api.brandfetch.io/v2/brands/" + domain, {
        headers: { Authorization: "Bearer " + API_KEY },
      });

      if (!res.ok) {
        console.log(domain, "ERROR:", res.status, res.statusText);
        const text = await res.text();
        console.log("  Body:", text.substring(0, 200));
        continue;
      }

      const data = await res.json();
      const logos = data.logos || [];

      // Find dark theme logo (for dark backgrounds = white logo)
      const darkLogo = logos.find(
        (l: any) => l.type === "logo" && l.theme === "dark",
      );
      const anyLogo = logos.find((l: any) => l.type === "logo");

      const logo = darkLogo || anyLogo;

      if (logo && logo.formats && logo.formats.length > 0) {
        // Prefer SVG, then PNG
        const svg = logo.formats.find((f: any) => f.format === "svg");
        const png = logo.formats.find((f: any) => f.format === "png");
        const chosen = svg || png || logo.formats[0];
        results[domain] = {
          url: chosen.src,
          format: chosen.format,
          theme: logo.theme,
        };
        console.log(
          domain,
          "-> theme:",
          logo.theme,
          "format:",
          chosen.format,
          "url:",
          chosen.src,
        );
      } else {
        console.log(
          domain,
          "NO LOGO FOUND. Available types:",
          logos.map((l: any) => l.type + "/" + l.theme).join(", "),
        );
      }
    } catch (e: any) {
      console.log(domain, "FETCH ERROR:", e.message);
    }
  }

  console.log("\n--- JSON OUTPUT ---");
  console.log(JSON.stringify(results, null, 2));
}

fetchLogos();
