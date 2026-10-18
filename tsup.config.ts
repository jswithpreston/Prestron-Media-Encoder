import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "node:fs";

export default defineConfig({
  entry: {
    // Output as dist/bin/prestron.js to match package.json bin paths
    "bin/prestron": "src/bin/prestron.ts",
  },
  format: ["esm"],
  // Target node22 to ensure node:sqlite is treated as a stable built-in.
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["node:sqlite", "sqlite"],
  // Inject the shebang into the bin file
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension: () => ({ js: ".js" }),
  async onSuccess() {
    // esbuild strips the "node:" prefix for sqlite when targeting node;
    // ensure the import in dist/bin/prestron.js retains "node:sqlite" so
    // Node.js resolves the built-in module at runtime.
    const file = "dist/bin/prestron.js";
    try {
      let content = readFileSync(file, "utf8");
      if (content.includes('from "sqlite"')) {
        content = content.replace(/from "sqlite"/g, 'from "node:sqlite"');
        writeFileSync(file, content, "utf8");
      }
    } catch {
      /* ignore if not found */
    }
  },
});
