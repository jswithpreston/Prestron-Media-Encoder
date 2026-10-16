import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    // Output as dist/bin/prestron.js to match package.json bin paths
    "bin/prestron": "src/bin/prestron.ts",
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  // Inject the shebang into the bin file
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension: () => ({ js: ".js" }),
});
