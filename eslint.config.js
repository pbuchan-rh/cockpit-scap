/* cockpit-scap uses classic <script> tags with shared browser global scope.
 * ESLint processes files in isolation, so cross-file symbol references look
 * undefined and top-level declarations look unused or never-reassigned to it.
 * Rules are tuned accordingly:
 *   - no-undef:       off  (cross-file globals are intentionally shared)
 *   - no-unused-vars: local only (top-level exports via global scope are valid)
 *   - prefer-const:   off  (mutable shared globals must stay let)
 *   - eqeqeq/null:    ignored (x != null is idiomatic "not null or undefined") */
module.exports = [
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'script',
            globals: {
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                Promise: 'readonly',
                URL: 'readonly',
                Blob: 'readonly',
                indexedDB: 'readonly',
                FormData: 'readonly',
                Event: 'readonly',
                cockpit: 'readonly',
            },
        },
        rules: {
            'no-undef': 'off',
            'no-unused-vars': ['warn', {
                vars: 'local',
                args: 'after-used',
                argsIgnorePattern: '^_',
                caughtErrors: 'none',
            }],
            'no-console': 'off',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': 'off',
        },
    },
];
