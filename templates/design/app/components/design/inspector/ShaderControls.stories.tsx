import type { ShaderDescriptor } from "@shared/shader-presets";
import React, { useState } from "react";

import { ShaderControls } from "./ShaderControls";

const defaultMesh: ShaderDescriptor = {
  preset: "MeshGradient",
  params: { distortion: 0.8, swirl: 0.1 },
  colors: ["#e0eaff", "#241d9a", "#f75092", "#9f50d3"],
  speed: 1,
  frame: 0,
  fit: "contain",
};

const defaultGrain: ShaderDescriptor = {
  preset: "GrainGradient",
  params: { softness: 0.5, intensity: 0.5, noise: 0.25, shape: "corners" },
  colors: ["#7300ff", "#eba8ff", "#00bfff"],
  speed: 0,
  frame: 0,
  fit: "contain",
};

export function ShaderControlsDemo() {
  const [mesh, setMesh] = useState<ShaderDescriptor>(defaultMesh);
  const [grain, setGrain] = useState<ShaderDescriptor>(defaultGrain);
  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        padding: 24,
        background: "#111",
        minHeight: "100vh",
      }}
    >
      <div style={{ width: 280 }}>
        <h3 style={{ color: "white", marginBottom: 12, fontSize: 12 }}>
          MeshGradient
        </h3>
        <ShaderControls descriptor={mesh} onChange={setMesh} />
        <pre
          style={{
            color: "#888",
            fontSize: 10,
            marginTop: 8,
            overflow: "auto",
          }}
        >
          {JSON.stringify(mesh, null, 2)}
        </pre>
      </div>
      <div style={{ width: 280 }}>
        <h3 style={{ color: "white", marginBottom: 12, fontSize: 12 }}>
          GrainGradient
        </h3>
        <ShaderControls descriptor={grain} onChange={setGrain} />
        <pre
          style={{
            color: "#888",
            fontSize: 10,
            marginTop: 8,
            overflow: "auto",
          }}
        >
          {JSON.stringify(grain, null, 2)}
        </pre>
      </div>
    </div>
  );
}
