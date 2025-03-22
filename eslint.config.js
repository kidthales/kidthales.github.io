const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({ recommendedConfig: {} });

const tsOverride = {
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn'
  }
};

module.exports = [
  ...compat.config({
    extends: ['eslint:recommended', 'plugin:prettier/recommended'],
    ignorePatterns: ['dist'],
    overrides: [
      {
        files: ['./**/*.ts'],
        parserOptions: { project: `${__dirname}/tsconfig.json` },
        ...tsOverride
      }
    ]
  })
];
