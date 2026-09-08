const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'playwright-report/**',
            'src-tauri/binaries/**',
            'src-tauri/resources/**',
            'src-tauri/target/**',
            'test-results/**',
            'vendor/**',
        ],
    },
    js.configs.recommended,
    {
        files: ['*.js', 'scripts/**/*.js', 'sidecar/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
        },
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {...globals.node, ...globals.browser},
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
        },
    },
    {
        files: ['public/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {...globals.browser, ...globals.serviceworker},
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
        },
    },
];