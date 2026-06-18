// Minimal, TS-aware ESLint flat config.
// Non-type-checked (fast) — pairs with `tsc --noEmit` for type correctness and
// Prettier for formatting. Keeps the linter focused on a few high-signal rules.
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
