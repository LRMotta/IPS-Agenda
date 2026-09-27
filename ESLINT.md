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
- `.html` files are excluded from ESLint. They combine Apps Script template
  expressions, included fragments, shared browser globals, and inline event
  handlers; extracting each block as independent JavaScript would not preserve
  those execution relationships. `tools/validate-syntax.js` continues to
  validate inline script and handler syntax, including Apps Script templates.

The `verify` script runs syntax validation, ESLint, then the existing Node test
suite. ESLint is not configured to enforce formatting, and no autofix is part
of the verification flow.
