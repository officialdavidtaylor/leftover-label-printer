import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const disableTypeCheckedForE2e = {
  ...tseslint.configs.disableTypeChecked,
  files: ['tests/e2e/**/*.ts'],
};

export default tseslint.config(
  {
    ignores: ['build/**', 'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.react-router/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  },
  disableTypeCheckedForE2e
);
