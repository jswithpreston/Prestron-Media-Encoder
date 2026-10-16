import { defineConfig, type Plugin } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vite plugin that handles node:sqlite (and any other node: built-ins not in
 * the legacy builtinModules list) by:
 *   1. Resolving bare "sqlite" → virtual module ID "\0node:sqlite"
 *   2. Loading that virtual ID by re-exporting from "node:sqlite" at runtime
 *
 * This is needed because node:sqlite was added in Node 22.5 and is not in
 * Node's legacy builtinModules array, so Vite 5 doesn't know to treat it
 * as an external built-in.
 */
function nodeNewBuiltinsPlugin(): Plugin {
  // Built-ins not in the legacy list that we need to proxy
  const NEW_BUILTINS = ["sqlite"];

  return {
    name: "node-new-builtins",
    resolveId(id) {
      // "node:sqlite" or bare "sqlite" both get resolved to our virtual id
      const bare = id.startsWith("node:") ? id.slice(5) : id;
      if (NEW_BUILTINS.includes(bare)) {
        return `\0node-builtin:${bare}`;
      }
      return undefined;
    },
    load(id) {
      if (id.startsWith("\0node-builtin:")) {
        const bare = id.slice("\0node-builtin:".length);
        // Emit a CJS module that re-exports the node: built-in at runtime
        // Using createRequire so this works in both CJS and ESM contexts
        return [
          `import { createRequire } from 'node:module';`,
          `const _require = createRequire(import.meta.url);`,
          `const _mod = _require('node:${bare}');`,
          `export default _mod;`,
          `export const { ${getExports(bare)} } = _mod;`,
        ].join("\n");
      }
      return undefined;
    },
  };
}

function getExports(moduleName: string): string {
  if (moduleName === "sqlite") {
    return "DatabaseSync, StatementSync, Session, backup, constants";
  }
  return "default";
}

export default defineConfig({
  plugins: [nodeNewBuiltinsPlugin()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**", "dist/**"],
    environment: "node",
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/core/**"],
      exclude: ["src/core/index.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
      reporter: ["text", "lcov", "html"],
    },
    globals: false,
    root: resolve(__dirname),
  },
});
