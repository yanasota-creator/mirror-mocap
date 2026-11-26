// Code check for the page's script (tools/test_all.py pulls it out of index.html into page.lint.mjs).
// Only rules that point at real mistakes: undefined names, unused variables, unreachable code, NaN compares ...
import globals from 'globals';
export default [{
  files: ['page.lint.mjs'],
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
  rules: {
    'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }], 'no-redeclare': 'error',
    'no-dupe-keys': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error', 'no-self-assign': 'error',
    'no-self-compare': 'error', 'no-constant-condition': ['error', { checkLoops: false }], 'use-isnan': 'error', 'valid-typeof': 'error',
    'no-cond-assign': 'error', 'no-fallthrough': 'error', 'no-unsafe-negation': 'error', 'no-loss-of-precision': 'error',
    'no-dupe-else-if': 'error', 'no-unmodified-loop-condition': 'error', 'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],
    'no-shadow-restricted-names': 'error', 'no-sparse-arrays': 'error', 'no-unsafe-finally': 'error', 'no-compare-neg-zero': 'error',
    'array-callback-return': 'error', 'no-constant-binary-expression': 'error',
  },
}];
