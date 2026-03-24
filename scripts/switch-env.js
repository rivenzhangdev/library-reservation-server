#!/usr/bin/env node
/**
 * 一键环境切换与启动脚本
 * 用法：
 *   node switch-env.js                    - 查看当前环境
 *   node switch-env.js <environment>      - 切换环境
 *   node switch-env.js <environment> --start  - 切换环境并启动服务
 * 或简写：dev|test|uat|prod
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// 颜色代码
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

// 环境映射（支持简写）
const envMap = {
    dev: 'development',
    development: 'development',
    test: 'test',
    uat: 'uat',
    prod: 'production',
    production: 'production',
};

// 获取命令行参数
const args = process.argv.slice(2);
const shouldStart = args.includes('--start') || args.includes('-s');
const envArg = args.find((arg) => arg !== '--start' && arg !== '-s');

if (!envArg) {
    // 显示当前环境
    const currentEnv = process.env.NODE_ENV || 'development';
    console.log(
        `${colors.blue}========================================${colors.reset}`
    );
    console.log(
        `${colors.blue}  当前环境信息                          ${colors.reset}`
    );
    console.log(
        `${colors.blue}========================================${colors.reset}\n`
    );

    console.log(
        `${colors.cyan}当前环境:${colors.reset} ${colors.yellow}${currentEnv}${colors.reset}`
    );
    console.log(`${colors.cyan}可用环境:${colors.reset}`);
    console.log(
        `  - ${colors.green}dev${colors.reset}      开发环境 (端口 3000)`
    );
    console.log(
        `  - ${colors.green}test${colors.reset}     测试环境 (端口 3001)`
    );
    console.log(
        `  - ${colors.green}uat${colors.reset}       UAT 环境 (端口 3002)`
    );
    console.log(
        `  - ${colors.green}prod${colors.reset}     生产环境 (端口 3003)`
    );
    console.log(`\n${colors.cyan}使用方法:${colors.reset}`);
    console.log(`  1. 切换环境：node switch-env.js dev`);
    console.log(`  2. 切换并启动：node switch-env.js dev --start`);
    console.log(`  3. 使用 pnpm 命令:`);
    console.log(`     pnpm env:dev    - 切换到开发环境并启动`);
    console.log(`     pnpm env:test   - 切换到测试环境并启动`);
    console.log(`     pnpm env:uat    - 切换到 UAT 环境并启动`);
    console.log(`     pnpm env:prod   - 切换到生产环境并启动`);
    console.log('');
    process.exit(0);
}

const inputEnv = envArg.toLowerCase();
const targetEnv = envMap[inputEnv];

if (!targetEnv) {
    console.log(
        `${colors.red}❌ 错误：无效的环境名称 '${inputEnv}'${colors.reset}`
    );
    console.log(`\n${colors.cyan}可用的环境:${colors.reset}`);
    console.log(`  - dev, development`);
    console.log(`  - test`);
    console.log(`  - uat`);
    console.log(`  - prod, production`);
    console.log('');
    process.exit(1);
}

console.log(
    `${colors.blue}========================================${colors.reset}`
);
console.log(
    `${colors.blue}  切换环境到：${targetEnv.padEnd(12)}${colors.reset}`
);
console.log(
    `${colors.blue}========================================${colors.reset}\n`
);

try {
    // 读取 .env.${targetEnv} 文件内容
    const sourceFile = path.join(__dirname, `.env.${targetEnv}`);
    const targetFile = path.join(__dirname, '.env');

    if (!fs.existsSync(sourceFile)) {
        throw new Error(`配置文件不存在：${sourceFile}`);
    }

    const content = fs.readFileSync(sourceFile, 'utf8');

    // 写入到 .env 文件
    fs.writeFileSync(targetFile, content);

    console.log(`${colors.green}✅ 环境切换成功！${colors.reset}\n`);

    // 显示环境信息
    const portMatch = content.match(/PORT=(\d+)/);
    const dbMatch = content.match(/DB_MYSQL_DATABASE=(.+)/);
    const mongoMatch = content.match(/DB_MONGODB_URI=.+\/(.+)/);

    console.log(`${colors.cyan}环境配置:${colors.reset}`);
    console.log(`  环境：${colors.yellow}${targetEnv}${colors.reset}`);
    if (portMatch) {
        console.log(`  端口：${colors.green}${portMatch[1]}${colors.reset}`);
    }
    if (dbMatch) {
        console.log(
            `  MySQL 数据库：${colors.green}${dbMatch[1]}${colors.reset}`
        );
    }
    if (mongoMatch) {
        console.log(
            `  MongoDB 数据库：${colors.green}${mongoMatch[1]}${colors.reset}`
        );
    }

    console.log('');

    // 如果需要启动服务
    if (shouldStart) {
        console.log(`${colors.cyan}正在启动服务...${colors.reset}\n`);

        const devServer = spawn('pnpm', ['dev'], {
            stdio: 'inherit',
            shell: true,
        });

        devServer.on('close', (code) => {
            console.log(
                `\n${colors.yellow}服务已停止 (退出码：${code})${colors.reset}`
            );
        });

        // 监听 Ctrl+C
        process.on('SIGINT', () => {
            devServer.kill('SIGINT');
        });
    } else {
        console.log(`${colors.cyan}下一步操作:${colors.reset}`);
        console.log(`  1. 启动服务：node switch-env.js ${inputEnv} --start`);
        console.log(`     或使用：pnpm dev`);
        console.log(
            `  2. 访问接口：http://localhost:${
                portMatch ? portMatch[1] : '3000'
            }`
        );
        console.log(`  3. 查看文档：pnpm swagger`);
        console.log('');
    }
} catch (error) {
    console.log(`${colors.red}❌ 操作失败${colors.reset}`);
    console.error(`${colors.red}错误信息：${error.message}${colors.reset}\n`);
    process.exit(1);
}
