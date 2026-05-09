import * as esbuild from "esbuild"

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/bundle.js",
  external: [], // bundle everything
  sourcemap: false,
  minify: false,
})
