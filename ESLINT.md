# ESLint

ESLint is intentionally limited to files it can analyze as standalone
JavaScript in this Apps Script project:

- `tools/**/*.js` and `tests/**/*.js` use ESLint's recommended correctness
  rules, with Node.js globals and CommonJS parsing.
- Root `*.gs` files use the same correctness rules with script parsing. The
  `no-undef` rule is disabled because Apps Script services and project functions
  are global across files. `no-unused-vars` is disabled because top-level
  functions are called across `.gs` files and by the HTML client.
- In `.gs`, only empty `catch` blocks are allowed for best-effort service calls.
  The two legacy function-scoped `var` redeclarations, caught errors translated
  at RPC/input boundaries, and the NUL-removal regex in `WebApp.gs` have
  line-level exceptions. `no-useless-assignment` is a warning in `.gs` so
  possible redundant initializations stay visible without blocking the build.
- `IndexAgendaScripts.html` also uses the recommended correctness rules,
  including `no-undef` and `no-unreachable`. Its processor preserves source line
  numbers, masks HTML and neutralizes Apps Script templates. Shared global
  declarations and exports from browser IIFEs are collected from the root HTML
  files, so calls across includes are recognized. Browser and Google RPC globals
  are allowed; unused globals are not flagged. No autofix is enabled.
- Other HTML files and inline handlers remain covered by
  `tools/validate-syntax.js`. The Agenda lint does not evaluate template logic or
  check whether a global is available in every conditional include at runtime.

The `verify` script runs syntax validation, ESLint, then the existing Node test
suite. ESLint is not configured to enforce formatting, and no autofix is part
of the verification flow. The root `eslint.config.js` is excluded from Apps
Script uploads by `.claspignore`; it is a Node-only development file.
