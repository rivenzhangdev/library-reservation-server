/**
 * Swagger UI 本地服务器
 * 用于在浏览器中查看 API 文档
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// 获取 swagger-ui-dist 的路径
const swaggerUiAssetPath = require('swagger-ui-dist').getAbsoluteFSPath();

let PORT = parseInt(process.env.SWAGGER_PORT) || 3001;
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

        // 处理 Swagger JSON 文件（优先使用完整版）
        if (req.url === '/swagger.json' || req.url === '/swagger-full.json') {
            const swaggerJsonPath = path.join(__dirname, 'swagger-full.json');
            if (fs.existsSync(swaggerJsonPath)) {
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
            serveFile(path.join(__dirname, 'swagger-index.html'), res);
            return;
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

    server.listen(port, () => {
        console.log('\n========================================');
        console.log('  🚀 Swagger UI 服务器已启动!');
        console.log('========================================');
        console.log(`\n📖 访问地址：http://localhost:${port}`);
        console.log(`📄 API 文档：http://localhost:${port}/swagger-full.json`);

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
