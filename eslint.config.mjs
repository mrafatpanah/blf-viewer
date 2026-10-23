import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    // src/webview/main.js is a plain bundled runtime with no tsconfig/DOM lib
    // coverage (see plans/009) — excluded from linting until it gets one.
    ignores: ["src/webview/**"],

    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];