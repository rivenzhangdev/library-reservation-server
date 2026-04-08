/**
 * Swagger UI 本地服务器
 * 用于在浏览器中查看 API 文档
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// 加载项目 .env（若存在），使 SWAGGER_PORT 等配置可用
try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch (e) {
    // ignore if dotenv not available
}

// 获取 swagger-ui-dist 的路径
const swaggerUiAssetPath = require('swagger-ui-dist').getAbsoluteFSPath();

// 配置：默认仅绑定到本地回环地址以避免被外网访问，可通过 SWAGGER_HOST 覆盖
const SWAGGER_HOST = process.env.SWAGGER_HOST || '127.0.0.1';
// 可选 Basic Auth，若同时设置 SWAGGER_USER 和 SWAGGER_PASS，则要求访问时提供 Basic Auth
const SWAGGER_USER = process.env.SWAGGER_USER || '';
const SWAGGER_PASS = process.env.SWAGGER_PASS || '';
// 在生产环境下默认禁止启动此工具，除非显式设置 SWAGGER_ENABLE=true
const SWAGGER_ENABLE = process.env.SWAGGER_ENABLE === 'true';

if (process.env.NODE_ENV === 'production' && !SWAGGER_ENABLE) {
    console.error('Swagger UI server is disabled in production by default. Set SWAGGER_ENABLE=true to override.');
    process.exit(1);
}

// 计算 Swagger 端口：优先使用 SWAGGER_PORT 环境变量；若未设置，则使用应用端口 PORT + 1000；若两者都未设置，默认 4000
let envSwagger = process.env.SWAGGER_PORT ? parseInt(process.env.SWAGGER_PORT, 10) : NaN;
let envAppPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
let PORT = Number.isFinite(envSwagger) && !Number.isNaN(envSwagger)
    ? envSwagger
    : (Number.isFinite(envAppPort) && !Number.isNaN(envAppPort) ? envAppPort + 1000 : 4000);
const MAX_PORT_RETRY = 10; // 最大重试次数

// MIME 类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/**
 * 检查端口是否被占用
 */
function checkPortInUse(port) {
    return new Promise((resolve) => {
        const server = http.createServer();

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // 端口被占用
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false); // 端口可用
        });

        server.listen(port);
    });
}

/**
 * 查找占用端口的进程信息（仅显示提示）
 */
function logPortOccupancyInfo(port) {
    console.log(`\n⚠️  端口 ${port} 已被占用，可能的原因:`);
    console.log(`   1. 另一个 Swagger UI 服务正在运行`);
    console.log(`   2. 其他服务占用了该端口`);
    console.log(`   3. 测试环境服务正在运行（测试环境默认端口 3001）`);
    console.log(`\n💡 建议:`);
    console.log(`   - 检查是否有其他服务运行在该端口`);
    console.log(`   - 使用以下命令查看占用进程:`);
    console.log(`     Windows: netstat -ano | findstr :${port}`);
    console.log(`     Linux/Mac: lsof -i :${port}`);
    console.log(`   - 或者等待系统自动切换到其他可用端口\n`);
}

/**
 * 尝试启动服务器，如果端口被占用则自动切换
 */
async function startServerWithRetry() {
    let currentPort = PORT;
    let attempts = 0;

    while (attempts < MAX_PORT_RETRY) {
        const isPortInUse = await checkPortInUse(currentPort);

        if (!isPortInUse) {
            // 端口可用，启动服务器
            startServer(currentPort);
            return;
        }

        // 端口被占用
        if (attempts === 0) {
            logPortOccupancyInfo(currentPort);
        }

        attempts++;
        currentPort++;

        if (attempts < MAX_PORT_RETRY) {
            console.log(
                `⚠️  端口 ${
                    currentPort - 1
                } 被占用，尝试切换到端口 ${currentPort}...`
            );
        }
    }

    // 所有端口都被占用
    console.error(
        `\n❌ 错误：无法找到可用端口（已尝试 ${PORT} 到 ${
            PORT + MAX_PORT_RETRY - 1
        }）`
    );
    console.error(`请手动关闭一些服务后重试\n`);
    process.exit(1);
}

/**
 * 启动 HTTP 服务器
 */
function startServer(port) {
    const server = http.createServer((req, res) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

        // 若设置了 Basic Auth 凭证，则对所有请求强制校验
        if (SWAGGER_USER && SWAGGER_PASS) {
            const auth = (req.headers['authorization'] || '');
            if (!auth.startsWith('Basic ')) {
                res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Swagger UI"' });
                res.end('Unauthorized');
                return;
            }
            try {
                const creds = Buffer.from(auth.slice(6), 'base64').toString('utf8');
                const idx = creds.indexOf(':');
                const user = idx >= 0 ? creds.slice(0, idx) : creds;
                const pass = idx >= 0 ? creds.slice(idx + 1) : '';
                if (user !== SWAGGER_USER || pass !== SWAGGER_PASS) {
                    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Swagger UI"' });
                    res.end('Unauthorized');
                    return;
                }
            } catch (e) {
                res.writeHead(400, {});
                res.end('Bad Authorization header');
                return;
            }
        }

        // 处理 Swagger JSON 文件（优先使用完整版）
        if (req.url === '/swagger.json' || req.url === '/swagger-full.json') {
            // 尝试从当前 scripts 目录读取 swagger-full.json，若不存在则回退到上级目录（项目根目录）
            const candidatePaths = [
                path.join(__dirname, 'swagger-full.json'),
                path.join(__dirname, '..', 'swagger-full.json'),
            ];
            let swaggerJsonPath = null;
            for (const p of candidatePaths) {
                if (fs.existsSync(p)) {
                    swaggerJsonPath = p;
                    break;
                }
            }
            if (swaggerJsonPath) {
                const swaggerJson = fs.readFileSync(swaggerJsonPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(swaggerJson);
                return;
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('swagger-full.json not found');
                return;
            }
        }

        // 处理根路径，重定向到 index.html
        if (req.url === '/' || req.url === '/index.html') {
            // 尝试从 scripts 目录或项目根读取 swagger-index.html
            const candidateIndexPaths = [
                path.join(__dirname, 'swagger-index.html'),
                path.join(__dirname, '..', 'swagger-index.html'),
            ];
            let indexPath = null;
            for (const p of candidateIndexPaths) {
                if (fs.existsSync(p)) {
                    indexPath = p;
                    break;
                }
            }
            if (indexPath) {
                serveFile(indexPath, res);
                return;
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('swagger-index.html not found');
                return;
            }
        }

        // 提供错误码 JSON（从 src/utils/error-codes.ts 解析）
        if (req.url === '/error-codes' || req.url === '/error-codes.json') {
            const candidatePaths = [
                path.join(__dirname, '..', 'src', 'utils', 'error-codes.ts'),
                path.join(__dirname, '..', 'src', 'utils', 'error-codes.js')
            ];
            let codesPath = null;
            for (const p of candidatePaths) {
                if (fs.existsSync(p)) { codesPath = p; break; }
            }
            if (!codesPath) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'error-codes file not found' }));
                return;
            }

            try {
                const content = fs.readFileSync(codesPath, 'utf8');
                const m = content.match(/export\s+const\s+ErrorCodes\s*=\s*\{([\s\S]*?)\}\s*as\s*const/) || content.match(/export\s+const\s+ErrorCodes\s*=\s*\{([\s\S]*?)\}\s*;/);
                const body = m ? m[1] : '';
                const lines = body.split(/\r?\n/);
                const codes = [];
                for (let line of lines) {
                    const lm = line.match(/\s*([A-Z0-9_]+)\s*:\s*([0-9]+)\s*,?\s*(?:\/\/\s*(.*))?/);
                    if (lm) {
                        codes.push({ key: lm[1], code: Number(lm[2]), desc: lm[3] ? lm[3].trim() : '' });
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ codes }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 处理 Swagger UI 资源
        if (req.url.startsWith('/swagger-ui/')) {
            const resourcePath = req.url.replace('/swagger-ui/', '');
            const fullPath = path.join(swaggerUiAssetPath, resourcePath);
            serveFile(fullPath, res);
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.listen(port, SWAGGER_HOST, () => {
        console.log('\n========================================');
        console.log('  🚀 Swagger UI 服务器已启动!');
        console.log('========================================');
        console.log(`\n📖 访问地址：http://${SWAGGER_HOST}:${port}`);
        console.log(`📄 API 文档：http://${SWAGGER_HOST}:${port}/swagger-full.json`);

        if (port !== PORT) {
            console.log(
                `\n⚠️  注意：由于原端口 ${PORT} 被占用，已自动切换到端口 ${port}`
            );
        }

        console.log(`\n💡 提示:`);
        console.log(`   - 按 Ctrl+C 停止服务器`);
        console.log(`   - 文档包含所有接口的完整说明`);
        console.log(`   - 支持在线测试接口功能`);
        console.log(`   - 如需指定端口，使用环境变量：SWAGGER_PORT=${port}\n`);
    });
}

function serveFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found: ' + filePath);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error reading file: ' + err.message);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
}

// 启动服务器（带自动重试）
startServerWithRetry().catch(console.error);
