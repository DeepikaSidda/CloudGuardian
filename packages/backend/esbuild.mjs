import * as esbuild from "esbuild";
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

// Collect all handler entry points
function getEntryPoints(dir, base = dir) {
  const entries = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) {
      entries.push(...getEntryPoints(full, base));
    } else if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")) {
      entries.push(full);
    }
  }
  return entries;
}

const entryPoints = getEntryPoints("src");

await esbuild.build({
  entryPoints,
  bundle: true,
  platform: "node",
  target: "node20",
  outdir: "dist-bundle",
  format: "cjs",
  sourcemap: true,
  // Keep the same directory structure (src/api/handlers.ts -> api/handlers.js)
  outbase: "src",
  // Don't bundle AWS SDK — it's available in the Lambda runtime
  external: [
    "@aws-sdk/*",
    "@smithy/*",
  ],
});

console.log("Backend bundled successfully to dist-bundle/");
