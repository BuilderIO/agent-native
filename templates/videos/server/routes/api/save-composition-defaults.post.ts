import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import fs from "fs/promises";
import path from "path";
import { getSession, readBody } from "@agent-native/core/server";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jsString(value: unknown): string {
  return JSON.stringify(typeof value === "string" ? value : "");
}

function jsNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function jsPropertyKey(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

export default defineEventHandler(async (event: H3Event) => {
  // Block source file writes in production (treat undefined NODE_ENV as production for edge runtimes)
  if (process.env.NODE_ENV !== "development") {
    setResponseStatus(event, 403);
    return {
      error:
        "Source file modification is not available in production mode. Use local development instead.",
    };
  }

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  try {
    const body = await readBody(event);
    const {
      compositionId,
      tracks,
      defaultProps,
      durationInFrames,
      fps,
      width,
      height,
    } = body;

    if (
      typeof compositionId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(compositionId)
    ) {
      setResponseStatus(event, 400);
      return "Invalid compositionId";
    }

    // Read the current registry file
    const registryPath = path.join(process.cwd(), "app/remotion/registry.ts");
    let registryContent = await fs.readFile(registryPath, "utf-8");

    // Format tracks and props
    const formattedTracks = formatTracksAsCode(tracks);
    const formattedProps = formatPropsAsCode(defaultProps);

    // Find the composition by searching for the id
    const idPattern = new RegExp(
      `id:\\s*"${escapeRegExp(compositionId)}"`,
      "g",
    );
    const matches: number[] = [];
    let match;
    while ((match = idPattern.exec(registryContent)) !== null) {
      matches.push(match.index);
    }

    if (matches.length === 0) {
      setResponseStatus(event, 404);
      return `Composition "${compositionId}" not found in registry`;
    }

    // Find the composition object that starts with { id: "compositionId"
    const startIndex = matches[0];

    // Search backwards to find the opening {
    let openBrace = -1;
    for (let i = startIndex - 1; i >= 0; i--) {
      if (registryContent[i] === "{") {
        openBrace = i;
        break;
      }
    }

    if (openBrace === -1) {
      setResponseStatus(event, 500);
      return "Could not find composition opening brace";
    }

    // Now find the matching closing brace
    let braceCount = 0;
    let closeBrace = -1;
    for (let i = openBrace; i < registryContent.length; i++) {
      if (registryContent[i] === "{") braceCount++;
      if (registryContent[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          closeBrace = i;
          break;
        }
      }
    }

    if (closeBrace === -1) {
      setResponseStatus(event, 500);
      return "Could not find composition closing brace";
    }

    // Extract the old composition
    const oldComposition = registryContent.substring(openBrace, closeBrace + 1);

    // Extract metadata from the old composition
    const titleMatch = oldComposition.match(/title:\s*"([^"]+)"/);
    const descMatch = oldComposition.match(/description:\s*"([^"]+)"/);
    const componentMatch = oldComposition.match(/component:\s*(\w+)/);
    const satisfiesMatch = oldComposition.match(/satisfies\s+(\w+)/);

    // Build the new composition object
    const newComposition = `{
    id: ${jsString(compositionId)},
    title: ${jsString(titleMatch?.[1])},
    description: ${jsString(descMatch?.[1])},
    component: ${componentMatch?.[1] || ""},
    durationInFrames: ${jsNumber(durationInFrames)},
    fps: ${jsNumber(fps, 30)},
    width: ${jsNumber(width, 1920)},
    height: ${jsNumber(height, 1080)},
    defaultProps: ${formattedProps} satisfies ${satisfiesMatch?.[1] || "any"},
    tracks: ${formattedTracks},
  }`;

    // Replace the old composition with the new one
    registryContent =
      registryContent.substring(0, openBrace) +
      newComposition +
      registryContent.substring(closeBrace + 1);

    // Write back to the file
    await fs.writeFile(registryPath, registryContent, "utf-8");

    return {
      success: true,
      message: `Composition "${compositionId}" defaults saved`,
    };
  } catch (error) {
    console.error("Save composition error:", error);
    setResponseStatus(event, 500);
    return error instanceof Error ? error.message : String(error);
  }
});

function formatTracksAsCode(tracks: any[]): string {
  const formatted = tracks
    .map((track) => {
      const props: string[] = [
        `id: ${jsString(track.id)}`,
        `label: ${jsString(track.label)}`,
        `startFrame: ${jsNumber(track.startFrame)}`,
        `endFrame: ${jsNumber(track.endFrame)}`,
        `easing: ${jsString(track.easing)}`,
      ];

      if (track.animatedProps && track.animatedProps.length > 0) {
        const animatedPropsCode = track.animatedProps
          .map((prop: any) => {
            const propParts: string[] = [
              `property: ${jsString(prop.property)}`,
              `from: ${jsString(prop.from)}`,
              `to: ${jsString(prop.to)}`,
              `unit: ${jsString(prop.unit)}`,
            ];

            if (prop.programmatic) {
              propParts.push(`programmatic: true`);
            }

            if (prop.description) {
              propParts.push(
                `description:\n              ${JSON.stringify(prop.description)}`,
              );
            }

            if (prop.parameters && prop.parameters.length > 0) {
              const paramsCode = prop.parameters
                .map((param: any) => {
                  const parts = [
                    `name: ${jsString(param.name)}`,
                    `label: ${jsString(param.label)}`,
                    `default: ${JSON.stringify(param.default ?? null)}`,
                  ];
                  if (param.min !== undefined)
                    parts.push(`min: ${jsNumber(param.min)}`);
                  if (param.max !== undefined)
                    parts.push(`max: ${jsNumber(param.max)}`);
                  if (param.step !== undefined)
                    parts.push(`step: ${jsNumber(param.step)}`);
                  return `{ ${parts.join(", ")} }`;
                })
                .join(", ");
              propParts.push(`parameters: [${paramsCode}]`);
            }

            if (
              prop.parameterValues &&
              Object.keys(prop.parameterValues).length > 0
            ) {
              const valuesCode = Object.entries(prop.parameterValues)
                .map(
                  ([key, value]) =>
                    `${jsPropertyKey(key)}: ${JSON.stringify(value)}`,
                )
                .join(", ");
              propParts.push(`parameterValues: { ${valuesCode} }`);
            }

            if (prop.codeSnippet) {
              const escapedSnippet = prop.codeSnippet
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\$/g, "\\$");
              propParts.push(`codeSnippet:\n\`${escapedSnippet}\``);
            }

            if (prop.keyframes && prop.keyframes.length > 0) {
              const keyframesCode = prop.keyframes
                .map((kf: any) => {
                  const kfParts = [
                    `frame: ${jsNumber(kf.frame)}`,
                    `value: ${jsString(kf.value)}`,
                  ];
                  if (kf.easing) kfParts.push(`easing: ${jsString(kf.easing)}`);
                  return `{ ${kfParts.join(", ")} }`;
                })
                .join(", ");
              propParts.push(`keyframes: [${keyframesCode}]`);
            }

            if (prop.easing) {
              propParts.push(`easing: ${jsString(prop.easing)}`);
            }

            return `{ ${propParts.join(", ")} }`;
          })
          .join(",\n          ");

        props.push(
          `animatedProps: [\n          ${animatedPropsCode}\n        ]`,
        );
      }

      return `{\n        ${props.join(",\n        ")}\n      }`;
    })
    .join(",\n      ");

  return `[\n      ${formatted}\n    ]`;
}

function formatPropsAsCode(props: Record<string, any>): string {
  const entries = Object.entries(props).map(([key, value]) => {
    return `${jsPropertyKey(key)}: ${JSON.stringify(value)}`;
  });
  return `{\n      ${entries.join(",\n      ")}\n    }`;
}
