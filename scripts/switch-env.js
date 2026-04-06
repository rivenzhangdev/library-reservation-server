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
const { spawn } = require('child_process');
let inquirer = require('inquirer');
if (inquirer && inquirer.default) inquirer = inquirer.default;

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

function runSwitch(inputEnv, startFlag) {
    const input = String(inputEnv || '').toLowerCase();
    const targetEnv = envMap[input];

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
        const sourceFile = path.join(__dirname, '..', `.env.${targetEnv}`);
        const targetFile = path.join(__dirname, '..', '.env');

        if (!fs.existsSync(sourceFile)) {
            throw new Error(`配置文件不存在：${sourceFile}`);
        }

        const content = fs.readFileSync(sourceFile, 'utf8');

        fs.writeFileSync(targetFile, content);

        console.log(`${colors.green}✅ 环境切换成功！${colors.reset}\n`);

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

        if (startFlag) {
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
}

if (!envArg) {
    (async () => {
        const currentEnv = process.env.NODE_ENV || 'development';
        console.log(`${colors.blue}========================================${colors.reset}`);
        console.log(`${colors.blue}  当前环境信息                          ${colors.reset}`);
        console.log(`${colors.blue}========================================${colors.reset}\n`);

        console.log(`${colors.cyan}当前环境:${colors.reset} ${colors.yellow}${currentEnv}${colors.reset}`);

        const choices = [
            { title: 'dev      开发环境 (端口 3000)', value: 'dev' },
            { title: 'test     测试环境 (端口 3001)', value: 'test' },
            { title: 'uat      UAT 环境 (端口 3002)', value: 'uat' },
            { title: 'prod     生产环境 (端口 3003)', value: 'prod' },
        ];

        // 使用 inquirer list 单选：上下键选择，回车确认；选择即执行（切换并启动）
        const answers = await inquirer.prompt([
            {
                type: 'list',
                name: 'env',
                message: '请选择环境（上下键选择，回车确认，选择即执行）',
                choices: choices.map(c => ({ name: c.title, value: c.value })),
                pageSize: 10,
            },
        ]);

        if (!answers || !answers.env) {
            console.log('已取消操作。');
            process.exit(0);
        }

        const chosen = answers.env;
        // 选择即执行：切换并启动
        runSwitch(chosen, true);
    })();

    return;
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
    const sourceFile = path.join(__dirname, '..', `.env.${targetEnv}`);
    const targetFile = path.join(__dirname, '..', '.env');

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
