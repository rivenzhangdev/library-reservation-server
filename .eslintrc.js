module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        warnOnUnsupportedTypeScriptVersion: false,
    },
    plugins: ['@typescript-eslint', 'prettier'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'prettier',
    ],
    rules: {
        // 基础规则
        'no-dupe-keys': 'error', // 禁止对象字面量中的重复键
        'no-console': 'off', // 开发环境允许 console（已关闭警告）
        'no-debugger': 'warn',

        // TypeScript 特定规则 - 自动清理未使用的变量和导入
        '@typescript-eslint/no-duplicate-type-constituents': 'error', // 禁止类型定义中的重复成员
        '@typescript-eslint/no-unused-vars': [
            'warn',
            {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            },
        ],
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-explicit-any': 'off', // 关闭 any 类型检查（开发灵活性）
        '@typescript-eslint/prefer-nullish-coalescing': 'warn',
        '@typescript-eslint/prefer-optional-chain': 'warn',
        '@typescript-eslint/no-unsafe-assignment': 'off', // 关闭不安全赋值检查
        '@typescript-eslint/no-unsafe-member-access': 'off', // 关闭不安全成员访问检查
        '@typescript-eslint/no-unsafe-argument': 'off', // 关闭不安全参数检查
        '@typescript-eslint/no-empty-object-type': 'off', // 关闭空对象类型检查（允许空接口作为占位符）

        // 关闭过于严格的解析检查，避免误报
        '@typescript-eslint/no-inferrable-types': 'off',

        // Prettier 集成
        'prettier/prettier': 'error',

        // 业务规范相关规则
        '@typescript-eslint/no-magic-numbers': 'off', // 允许数字枚举
        '@typescript-eslint/no-non-null-assertion': 'warn',
    },
    env: {
        node: true,
        es2020: true,
    },
    // 通用目录忽略，具体文件忽略请交给 .eslintignore 处理
    ignorePatterns: ['node_modules/', 'dist/'],
    overrides: [
        {
            files: ['*.ts'],
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: __dirname,
            },
        },
        {
            // JavaScript 文件（如 .eslintrc.js, commitlint.config.js 等）不使用 TypeScript parser
            files: ['*.js'],
            parser: 'espree',
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module',
            },
            // JavaScript 文件只使用基础 ESLint 推荐规则，禁用 TypeScript 特定规则
            extends: ['eslint:recommended', 'prettier'],
            rules: {
                // 禁用所有 TypeScript 特定规则
                '@typescript-eslint/no-duplicate-type-constituents': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
                '@typescript-eslint/explicit-function-return-type': 'off',
                '@typescript-eslint/no-explicit-any': 'off',
                '@typescript-eslint/prefer-nullish-coalescing': 'off',
                '@typescript-eslint/prefer-optional-chain': 'off',
                '@typescript-eslint/no-unsafe-assignment': 'off',
                '@typescript-eslint/no-unsafe-member-access': 'off',
                '@typescript-eslint/no-unsafe-argument': 'off',
                '@typescript-eslint/no-empty-object-type': 'off',
                '@typescript-eslint/no-inferrable-types': 'off',
                '@typescript-eslint/no-magic-numbers': 'off',
                '@typescript-eslint/no-non-null-assertion': 'off',
                // JavaScript 特定规则
                'no-var': 'warn',
                'no-undef': 'error',
                'no-unused-vars': 'warn',
            },
        },
    ],
};
