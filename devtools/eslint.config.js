// Minimal, TS-aware ESLint flat config.
// Non-type-checked (fast) — pairs with `tsc --noEmit` for type correctness and
// Prettier for formatting. Keeps the linter focused on a few high-signal rules.
//
// Lives in devtools/ (not the repo root) so its `typescript-eslint` import
// resolves against the isolated toolchain's typescript@5.9.3 instead of the
// root project's typescript@7.0.2 — see devtools/README.md. It's invoked with
// the repo root as cwd (`npm run lint` from root), and flat-config `files`/
// `ignores` globs are resolved relative to cwd, not this file's location —
// so patterns below are root-relative, same as the original root-level config.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow intentionally-unused leading args and rest-sibling discards
      // (e.g. `const { creditor, ...rest } = c`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      // E2E helpers lean on `any` for loose JSON parsing — not worth fighting.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
