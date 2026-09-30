// Bundles the server (and the shared rules package) into dist/main.js.
// Runtime dependencies stay external and are installed in the image.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/main.js",
  external: Object.keys(pkg.dependencies),
  sourcemap: true,
  alias: { "@st/shared": "../../packages/shared/src/index.ts" },
});
console.log("server built");
