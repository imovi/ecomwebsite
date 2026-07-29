import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  /* `scripts/` holds standalone operational tooling run with plain node —
     untyped, console-driven, outside the app's module graph. The type-aware
     ruleset targets application code and is the wrong tool for it. */
  { ignores: ["dist/**", "node_modules/**", "migrations/**", "scripts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        /* `src`, `tests` and drizzle.config.ts are all covered by
           tsconfig.json. Only this file — being .mjs — falls outside it. */
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      /* Express error middleware must declare 4 params to be recognised, and
         several handlers legitimately ignore `next`. */
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": "error",
    },
  },
  {
    /* Scripts that run outside the server process may log directly. */
    files: ["src/db/seed.ts", "src/db/migrate.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      /* `describe()` and `it()` from node:test return promises that the test
         runner itself awaits. Flagging them would mean prefixing every block
         with `void`, which obscures the tests for no safety gain. */
      "@typescript-eslint/no-floating-promises": "off",
      /* Test helpers deliberately set process.env before importing modules
         that read it, which requires top-level await and dynamic import. */
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);
