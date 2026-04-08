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
const { spawn, exec } = require('child_process');
let inquirer = require('inquirer');
if (inquirer && inquirer.default) inquirer = inquirer.default;

// 检查端口是否被占用
function checkPortInUse(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const tester = net.createServer()
            .once('error', (err) => {
                if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            })
            .once('listening', () => {
                tester.close();
                resolve(false);
            })
            // 监听所有地址，避免 IPv6/IPv4 差异
            .listen(port, '0.0.0.0');
    });
}

// 获取占用端口的 PID 列表（跨平台）
function getPidsByPort(port) {
    return new Promise((resolve) => {
        const platform = process.platform;
        if (platform === 'win32') {
            // netstat 输出，取最后一列 PID
            exec(`netstat -ano | findstr :${port}`, { shell: true }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                const lines = stdout.split(/\r?\n/).filter(Boolean);
                const pids = new Set();
                lines.forEach((line) => {
                    const parts = line.trim().split(/\s+/);
                    const last = parts[parts.length - 1];
                    const pid = parseInt(last, 10);
                    if (!Number.isNaN(pid)) pids.add(pid);
                });
                resolve(Array.from(pids));
            });
        } else {
            // 使用 lsof 获取占用 pid
            exec(`lsof -i :${port} -t`, { shell: true }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                const lines = stdout.split(/\r?\n/).filter(Boolean);
                const pids = lines.map((l) => parseInt(l, 10)).filter((n) => !Number.isNaN(n));
                resolve(Array.from(new Set(pids)));
            });
        }
    });
}

// 杀死指定 PID 列表
function killPids(pids) {
    return new Promise((resolve) => {
        if (!pids || pids.length === 0) return resolve(false);
        const platform = process.platform;
        if (platform === 'win32') {
            // taskkill 支持多个 /PID
            const args = pids.map((pid) => `/PID ${pid}`).join(' ');
            const cmd = `taskkill /F ${args}`;
            exec(cmd, { shell: true }, (err) => {
                resolve(!err);
            });
        } else {
            const cmd = `kill -9 ${pids.join(' ')}`;
            exec(cmd, { shell: true }, (err) => {
                resolve(!err);
            });
        }
    });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

async function runSwitch(inputEnv, startFlag) {
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

            // 计算端口（优先使用 .env 中的 PORT，若不存在使用默认映射）
            const desiredPort = portMatch
                ? Number.parseInt(portMatch[1], 10)
                : (targetEnv === 'development' ? 3000 : targetEnv === 'test' ? 3001 : targetEnv === 'uat' ? 3002 : targetEnv === 'production' ? 3003 : 3000);

            try {
                const inUse = await checkPortInUse(desiredPort);
                if (inUse) {
                    const pids = await getPidsByPort(desiredPort);
                    console.log(`${colors.yellow}⚠️  端口 ${desiredPort} 已被占用${colors.reset}`);
                    if (pids && pids.length > 0) console.log(`   占用 PID: ${pids.join(', ')}`);

                    const answer = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'action',
                            message: `端口 ${desiredPort} 被占用，选择操作：`,
                            choices: [
                                { name: '杀死占用进程并继续（推荐）', value: 'kill' },
                                { name: '取消启动', value: 'abort' },
                                { name: '继续启动（不杀进程，可能失败）', value: 'continue' },
                            ],
                        },
                    ]);

                    if (answer.action === 'abort') {
                        console.log('已取消启动。');
                        process.exit(0);
                    }

                    if (answer.action === 'kill') {
                        if (!pids || pids.length === 0) {
                            console.log('未找到占用 PID，无法自动杀进程，请手动处理后重试。');
                            process.exit(1);
                        }
                        console.log(`尝试杀死 PID: ${pids.join(', ')}`);
                        const ok = await killPids(pids);
                        if (!ok) {
                            console.log('杀进程失败，取消启动。');
                            process.exit(1);
                        }
                        // 等待端口释放
                        await sleep(800);
                        const still = await checkPortInUse(desiredPort);
                        if (still) {
                            console.log('端口仍被占用，取消启动。');
                            process.exit(1);
                        }
                        console.log('端口已释放，继续启动...');
                    } else {
                        console.log('继续启动（不杀进程），如遇 EADDRINUSE 请手动处理。');
                    }
                }
            } catch (err) {
                // 检查端口或杀进程时发生错误，不阻塞启动，但提示用户
                console.warn('端口检查出现错误，继续尝试启动：', err && err.message ? err.message : err);
            }

            const devServer = spawn('pnpm', ['dev'], {
                stdio: 'inherit',
                shell: true,
            });

            // 同时启动 Swagger（默认），可通过 --no-swagger 或 --skip-swagger 禁用
            let swaggerServer = null;
            const skipSwagger = args.includes('--no-swagger') || args.includes('--skip-swagger');
            if (!skipSwagger) {
                try {
                    console.log(`${colors.cyan}正在启动 Swagger UI...${colors.reset}`);
                    swaggerServer = spawn('node', ['scripts/serve-swagger.js'], {
                        stdio: 'inherit',
                        shell: true,
                    });
                } catch (e) {
                    console.warn('启动 Swagger 失败：', e && e.message ? e.message : e);
                }
            }

            devServer.on('close', (code) => {
                console.log(
                    `\n${colors.yellow}服务已停止 (退出码：${code})${colors.reset}`
                );
                if (swaggerServer) {
                    try {
                        swaggerServer.kill('SIGINT');
                    } catch (e) {}
                }
            });

            if (swaggerServer) {
                swaggerServer.on('close', (code) => {
                    console.log(`\n${colors.yellow}Swagger 服务已停止 (退出码：${code})${colors.reset}`);
                });
            }

            process.on('SIGINT', () => {
                try { devServer.kill('SIGINT'); } catch (e) {}
                try { if (swaggerServer) swaggerServer.kill('SIGINT'); } catch (e) {}
            });
        } else {
            console.log(`${colors.cyan}下一步操作:${colors.reset}`);
            console.log('  1. 启动服务：');
            console.log(
                `     - 使用切换脚本并启动（推荐）：node scripts/switch-env.js ${inputEnv} --start`
            );
            console.log(
                `       （或在 scripts 目录下运行：node switch-env.js ${inputEnv} --start）`
            );
            const scriptName = (function () {
                if (input === 'dev' || input === 'development') return 'dev';
                if (input === 'prod' || input === 'production') return 'prod';
                return input;
            })();
            console.log(
                `     - 或 使用 npm 脚本：pnpm run start:${scriptName}`
            );
            console.log(`     - 或 直接运行开发模式（适合本地调试）：pnpm dev`);
            console.log(
                `  2. 访问接口：http://localhost:${portMatch ? portMatch[1] : '3000'}`
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
        await runSwitch(chosen, true);
    })();

    return;
}

// 非交互模式：调用统一函数处理（包含端口占用提示与杀进程选项）
(async () => {
    try {
        await runSwitch(envArg || '', shouldStart);
    } catch (err) {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    }
})();
