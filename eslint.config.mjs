// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginJest from "eslint-plugin-jest";
import pluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default tseslint.config([
	{ ignores: ["./coverage/**/*.js"] },
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.js"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: "off",
		},
		extends: [
			eslint.configs.recommended,
			tseslint.configs.recommendedTypeChecked,
			pluginJest.configs["flat/recommended"],
			pluginPrettierRecommended,
		],
		ignores: ["./index.js"],
		files: ["./.*.js", "./*.js", "./ts/**/*.ts", "./test-package/**/*.ts"],
		plugins: {
			jest: pluginJest,
		},
		rules: {
			"@typescript-eslint/no-inferrable-types": "error",
			"@typescript-eslint/no-invalid-this": "error",
			"@typescript-eslint/prefer-readonly": "error",
			"@typescript-eslint/require-await": "off",
			"no-console": ["error", { allow: ["warn", "error"] }],
			"no-sequences": "error",
			"no-warning-comments": "error",
		},
	},
]);
