import { defineConfig } from "tsup";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "esbuild";

/**
 * esbuild plugin: resolve `.js` imports to `.ts` / `.tsx` source files.
 *
 * Node16 module resolution requires explicit `.js` extensions in import
 * statements, but the actual source files are `.ts` / `.tsx`. tsup / esbuild
 * handles this for the entry file but not for transitive relative imports that
 * use the `.js` suffix explicitly (esbuild won't try `.ts` if `.js` is given
 * and no such `.js` file exists).
 *
 * This plugin intercepts all relative `.js` imports and, if no real `.js` file
 * exists on disk, tries `.tsx` then `.ts`.
 */
const resolveJsToTs: Plugin = {
  name: "resolve-js-to-ts",
  setup(build) {
    // Only intercept relative paths that end in .js
    build.onResolve({ filter: /^\..*\.js$/ }, (args) => {
      // args.resolveDir is the directory of the importing file — use it, not dirname(importer)
      const dir = args.resolveDir;
      if (!dir) return null;

      const base = args.path.replace(/\.js$/, "");
      const candidates = [`${base}.tsx`, `${base}.ts`];

      for (const candidate of candidates) {
        const abs = resolve(dir, candidate);
        if (existsSync(abs)) {
          return { path: abs };
        }
      }

      // Not found as TS — let esbuild try its default resolution
      return null;
    });
  },
};

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
  esbuildPlugins: [resolveJsToTs],
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
