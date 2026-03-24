#!/usr/bin/env node
/**
 * 环境变量配置助手
 * 用途：帮助开发者快速配置和验证环境变量
 *
 * 用法:
 *   node scripts/config-env.js           - 交互式配置向导
 *   node scripts/config-env.js --check   - 检查当前环境配置
 *   node scripts/config-env.js --copy    - 从 .env.example 复制生成 .env
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const ENV_EXAMPLE_PATH = path.join(__dirname, '../.env.example');
const ENV_PATH = path.join(__dirname, '../.env');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

/**
 * 生成随机字符串
 */
function generateRandomString(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * 读取 .env 文件内容
 */
function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * 解析 .env 文件内容
 */
function parseEnvContent(content) {
    const envVars = {};
    const lines = content.split('\n');

    lines.forEach((line) => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                envVars[key.trim()] = valueParts.join('=').trim();
            }
        }
    });

    return envVars;
}

/**
 * 检查环境变量配置
 */
function checkEnvConfig() {
    console.log(`\n${colors.cyan}========================================`);
    console.log('  环境变量配置检查');
    console.log('========================================\n');

    const content = readEnvFile(ENV_PATH);

    if (!content) {
        console.log(`${colors.red}❌ .env 文件不存在`);
        console.log(
            `${colors.yellow}提示：运行 "node scripts/config-env.js --copy" 创建 .env 文件\n`
        );
        return false;
    }

    const envVars = parseEnvContent(content);
    const requiredVars = [
        'WX_APP_ID',
        'WX_APP_SECRET',
        'JWT_SECRET',
        'DB_MYSQL_HOST',
        'DB_MYSQL_PORT',
        'DB_MYSQL_USER',
        'DB_MYSQL_PASSWORD',
        'DB_MYSQL_DATABASE',
        'DB_MONGODB_URI',
    ];

    let allConfigured = true;

    console.log(`${colors.blue}检查必需的环境变量:\n`);

    requiredVars.forEach((varName) => {
        const value = envVars[varName];
        const isPlaceholder =
            value && (value.includes('your_') || value.includes('here'));

        if (!value) {
            console.log(`${colors.red}❌ ${varName} - 未配置`);
            allConfigured = false;
        } else if (isPlaceholder) {
            console.log(
                `${colors.yellow}⚠️  ${varName} - 使用占位符，需要替换为实际值`
            );
            allConfigured = false;
        } else {
            const maskedValue =
                varName.includes('SECRET') || varName.includes('PASSWORD')
                    ? '••••••••'
                    : value;
            console.log(
                `${colors.green}✅ ${varName} - 已配置 (${maskedValue})`
            );
        }
    });

    console.log();

    if (allConfigured) {
        console.log(`${colors.green}✅ 所有环境变量已正确配置!\n`);
        return true;
    } else {
        console.log(`${colors.yellow}⚠️  部分环境变量未配置或使用了占位符\n`);
        return false;
    }
}

/**
 * 从示例文件复制生成 .env
 */
function copyFromExample() {
    console.log(`\n${colors.cyan}========================================`);
    console.log('  从 .env.example 创建 .env 文件');
    console.log('========================================\n');

    if (fs.existsSync(ENV_PATH)) {
        console.log(`${colors.yellow}⚠️  .env 文件已存在，是否覆盖？(y/n)`);
        const answer = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        answer.question('> ', (response) => {
            if (response.toLowerCase() === 'y') {
                performCopy();
            } else {
                console.log(`${colors.gray}已取消操作\n`);
            }
            answer.close();
        });
    } else {
        performCopy();
    }
}

function performCopy() {
    if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
        console.log(`${colors.red}❌ .env.example 文件不存在\n`);
        return;
    }

    const exampleContent = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    fs.writeFileSync(ENV_PATH, exampleContent, 'utf8');

    console.log(`${colors.green}✅ 已创建 .env 文件`);
    console.log(`${colors.yellow}📝 请编辑 .env 文件，填入实际的配置值\n`);

    console.log(`${colors.cyan}快速配置指南:`);
    console.log('1. WX_APP_ID 和 WX_APP_SECRET: 在微信公众平台注册获取');
    console.log('2. JWT_SECRET: 可使用自动生成的随机字符串');
    console.log('3. DB_MYSQL_PASSWORD: 你的 MySQL 数据库密码');
    console.log('4. DB_MONGODB_URI: MongoDB 连接 URI\n');
}

/**
 * 生成交互式配置
 */
async function interactiveConfig() {
    console.log(`\n${colors.cyan}========================================`);
    console.log('  环境变量配置向导');
    console.log('========================================\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (query) =>
        new Promise((resolve) => {
            rl.question(query, resolve);
        });

    try {
        const config = {};

        console.log(
            `${colors.yellow}请输入以下配置信息 (直接回车使用默认值或跳过):\n`
        );

        // 微信配置
        console.log(`${colors.blue}[微信配置]`);
        config.WX_APP_ID = await question('WX_APP_ID: ');
        config.WX_APP_SECRET = await question('WX_APP_SECRET: ');

        // JWT 配置
        console.log(`\n${colors.blue}[JWT 配置]`);
        const defaultJwtSecret = generateRandomString(32);
        console.log(`${colors.gray}建议的 JWT_SECRET: ${defaultJwtSecret}`);
        config.JWT_SECRET = await question('JWT_SECRET (回车自动生成): ');
        if (!config.JWT_SECRET) {
            config.JWT_SECRET = defaultJwtSecret;
            console.log(`${colors.green}✓ 已自动生成 JWT_SECRET`);
        }
        config.JWT_EXPIRES_IN =
            (await question('JWT_EXPIRES_IN (默认 7d): ')) || '7d';

        // MySQL 配置
        console.log(`\n${colors.blue}[MySQL 配置]`);
        config.DB_MYSQL_HOST =
            (await question('DB_MYSQL_HOST (默认 localhost): ')) || 'localhost';
        config.DB_MYSQL_PORT =
            (await question('DB_MYSQL_PORT (默认 3306): ')) || '3306';
        config.DB_MYSQL_USER =
            (await question('DB_MYSQL_USER (默认 root): ')) || 'root';
        config.DB_MYSQL_PASSWORD = await question('DB_MYSQL_PASSWORD: ');
        config.DB_MYSQL_DATABASE =
            (await question(
                'DB_MYSQL_DATABASE (默认 library_booking_dev): '
            )) || 'library_booking_dev';

        // MongoDB 配置
        console.log(`\n${colors.blue}[MongoDB 配置]`);
        config.DB_MONGODB_URI =
            (await question(
                'DB_MONGODB_URI (默认 mongodb://localhost:27017/library_booking_dev): '
            )) || 'mongodb://localhost:27017/library_booking_dev';

        // 服务器配置
        console.log(`\n${colors.blue}[服务器配置]`);
        config.PORT = (await question('PORT (默认 3000): ')) || '3000';
        config.NODE_ENV =
            (await question('NODE_ENV (默认 development): ')) || 'development';

        // 生成 .env 文件内容
        let envContent = `# 服务器配置\nPORT=${config.PORT}\nNODE_ENV=${config.NODE_ENV}\n\n`;
        envContent += `# 微信配置\nWX_APP_ID=${config.WX_APP_ID}\nWX_APP_SECRET=${config.WX_APP_SECRET}\n\n`;
        envContent += `# JWT 配置\nJWT_SECRET=${config.JWT_SECRET}\nJWT_EXPIRES_IN=${config.JWT_EXPIRES_IN}\n\n`;
        envContent += `# MySQL 配置\nDB_MYSQL_HOST=${config.DB_MYSQL_HOST}\nDB_MYSQL_PORT=${config.DB_MYSQL_PORT}\n`;
        envContent += `DB_MYSQL_USER=${config.DB_MYSQL_USER}\nDB_MYSQL_PASSWORD=${config.DB_MYSQL_PASSWORD}\n`;
        envContent += `DB_MYSQL_DATABASE=${config.DB_MYSQL_DATABASE}\n\n`;
        envContent += `# MongoDB 配置\nDB_MONGODB_URI=${config.DB_MONGODB_URI}\n`;

        fs.writeFileSync(ENV_PATH, envContent, 'utf8');

        console.log(`\n${colors.green}✅ 配置已保存到 .env 文件`);
        console.log(
            `${colors.yellow}📝 提示：敏感信息已从版本控制中移除，请妥善保管\n`
        );
    } catch (error) {
        console.error(`${colors.red}配置过程中出错:`, error.message);
    } finally {
        rl.close();
    }
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        // 无参数时显示帮助
        console.log(`\n${colors.cyan}环境变量配置助手`);
        console.log(`${colors.gray}用法:`);
        console.log(`  node scripts/config-env.js           - 交互式配置向导`);
        console.log(
            `  node scripts/config-env.js --check   - 检查当前环境配置`
        );
        console.log(
            `  node scripts/config-env.js --copy    - 从 .env.example 复制生成 .env`
        );
        console.log(`  node scripts/config-env.js --help    - 显示帮助信息\n`);
        return;
    }

    switch (command) {
        case '--check':
            checkEnvConfig();
            break;
        case '--copy':
            copyFromExample();
            break;
        case '--help':
        case '-h':
            console.log(`\n${colors.cyan}环境变量配置助手`);
            console.log(`${colors.gray}用法:`);
            console.log(
                `  node scripts/config-env.js           - 交互式配置向导`
            );
            console.log(
                `  node scripts/config-env.js --check   - 检查当前环境配置`
            );
            console.log(
                `  node scripts/config-env.js --copy    - 从 .env.example 复制生成 .env`
            );
            console.log(
                `  node scripts/config-env.js --help    - 显示帮助信息`
            );
            console.log(`${colors.gray}\n说明:`);
            console.log(`  此工具帮助你安全地配置环境变量，避免敏感信息泄露`);
            console.log(`  所有配置都保存在本地 .env 文件，不会提交到 Git\n`);
            break;
        default:
            await interactiveConfig();
    }
}

main();
