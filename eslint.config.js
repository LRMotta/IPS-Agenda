'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['tools/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // These rules only constrain how regex patterns are written.
      'no-regex-spaces': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['**/*.gs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
    },
    rules: {
      // Apps Script services and project globals span multiple .gs files.
      'no-undef': 'off',
      // Public and private functions can be referenced by another .gs file.
      'no-unused-vars': 'off',
      // Regex escaping conventions differ between JS strings, regexes and templates.
      'no-regex-spaces': 'off',
      'no-useless-escape': 'off',
      // Best-effort service calls may intentionally have empty catch blocks.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Keep findings visible without blocking while legacy fallbacks are reviewed.
      'no-useless-assignment': 'warn',
    },
  },
];
