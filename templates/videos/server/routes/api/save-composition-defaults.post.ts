import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs/promises";
import path from "path";

export default defineEventHandler(async (event: H3Event) => {
  // Block source file writes in production
  if (process.env.NODE_ENV === "production") {
    setResponseStatus(event, 403);
    return {
      error:
        "Source file modification is not available in production mode. Use local development instead.",
    };
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

    if (!compositionId) {
      setResponseStatus(event, 400);
      return "Missing compositionId";
    }

    // Read the current registry file
    const registryPath = path.join(
      process.cwd(),
      "client/remotion/registry.ts",
    );
    let registryContent = await fs.readFile(registryPath, "utf-8");

    // Format tracks and props
    const formattedTracks = formatTracksAsCode(tracks);
    const formattedProps = formatPropsAsCode(defaultProps);

    // Find the composition by searching for the id
    const idPattern = new RegExp(`id:\\s*"${compositionId}"`, "g");
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
    id: "${compositionId}",
    title: "${titleMatch?.[1] || ""}",
    description: "${descMatch?.[1] || ""}",
    component: ${componentMatch?.[1] || ""},
    durationInFrames: ${durationInFrames},
    fps: ${fps},
    width: ${width},
    height: ${height},
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
        `id: "${track.id}"`,
        `label: "${track.label}"`,
        `startFrame: ${track.startFrame}`,
        `endFrame: ${track.endFrame}`,
        `easing: "${track.easing}"`,
      ];

      if (track.animatedProps && track.animatedProps.length > 0) {
        const animatedPropsCode = track.animatedProps
          .map((prop: any) => {
            const propParts: string[] = [
              `property: "${prop.property}"`,
              `from: "${prop.from}"`,
              `to: "${prop.to}"`,
              `unit: "${prop.unit}"`,
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
                    `name: "${param.name}"`,
                    `label: "${param.label}"`,
                    `default: ${param.default}`,
                  ];
                  if (param.min !== undefined) parts.push(`min: ${param.min}`);
                  if (param.max !== undefined) parts.push(`max: ${param.max}`);
                  if (param.step !== undefined)
                    parts.push(`step: ${param.step}`);
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
                .map(([key, value]) => `${key}: ${value}`)
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
                    `frame: ${kf.frame}`,
                    `value: "${kf.value}"`,
                  ];
                  if (kf.easing) kfParts.push(`easing: "${kf.easing}"`);
                  return `{ ${kfParts.join(", ")} }`;
                })
                .join(", ");
              propParts.push(`keyframes: [${keyframesCode}]`);
            }

            if (prop.easing) {
              propParts.push(`easing: "${prop.easing}"`);
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
    const formattedValue =
      typeof value === "string" ? `"${value}"` : JSON.stringify(value);
    return `${key}: ${formattedValue}`;
  });
  return `{\n      ${entries.join(",\n      ")}\n    }`;
}
