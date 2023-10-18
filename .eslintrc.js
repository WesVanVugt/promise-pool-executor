// @ts-check
/** @type {import("eslint").Linter.Config} */
const config = {
	root: true,
	env: { node: true },
	parser: "@typescript-eslint/parser",
	parserOptions: {
		tsconfigRootDir: __dirname,
		project: ["./tsconfig.eslint.json"],
	},
	ignorePatterns: ["*.d.ts"],
	plugins: ["@typescript-eslint", "jest", "prettier"],
	extends: [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking",
		"plugin:jest/recommended",
	],
	rules: {
		"@typescript-eslint/no-base-to-string": "error",
		"@typescript-eslint/no-inferrable-types": "error",
		"@typescript-eslint/no-invalid-this": "error",
		"@typescript-eslint/no-throw-literal": "error",
		"@typescript-eslint/no-unsafe-argument": "error",
		"@typescript-eslint/prefer-includes": "error",
		"@typescript-eslint/prefer-readonly": "error",
		"@typescript-eslint/require-await": "off",
		"@typescript-eslint/return-await": "error",
		"no-console": "error",
		"no-sequences": "error",
		"prettier/prettier": "error",
	},
};
module.exports = config;
