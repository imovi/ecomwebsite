import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    /* `backend/` is a separate application with its own ESLint config, its own
       type-aware ruleset and Node — not browser — globals. Linting it from here
       applies the wrong rules and reports hundreds of errors its own lint run
       does not have. */
    "backend/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
