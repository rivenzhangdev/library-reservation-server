# 图书馆座位预约系统 - 后端服务

## 📁 项目结构

```
server/
├── scripts/              # 可执行脚本工具
│   ├── switch-env.js    # 环境切换工具
│   └── serve-swagger.js # Swagger UI 服务器
├── tools/                # 开发和测试工具
│   ├── init-mongodb.js  # MongoDB 初始化脚本
│   └── test-all-apis.ps1 # API 接口测试工具 (PowerShell)
├── test/                 # 测试相关文件
│   └── swagger-*.json   # Swagger API 文档
├── database/             # SQL 初始化脚本
│   └── *.sql            # 各环境数据库表结构定义
├── src/                  # 源代码目录
│   ├── app.ts           # 应用入口
│   ├── routes/          # 路由控制器
│   ├── models/          # 数据模型
│   ├── middleware/      # 中间件
│   ├── database/        # 数据库配置
│   └── utils/           # 工具函数
└── .env.example         # 环境变量模板
```

## 🔐 安全配置说明

### 环境变量管理

**重要**: 所有敏感信息（微信 AppSecret、数据库密码、JWT 密钥等）都已从版本控制中移除。

#### 配置步骤:

1. **复制环境变量模板**

```bash
cp .env.example .env
```

2. **编辑 `.env` 文件，填入实际值:**

```env
# 微信配置 - 需在微信公众平台注册获取
WX_APP_ID=你的小程序 AppID
WX_APP_SECRET=你的小程序 AppSecret
WECHAT_TEMPLATE_BOOKING_SUCCESS=你环境下的打卡提醒模板 ID
WECHAT_TEMPLATE_BOOKING_REMINDER=你环境下的签到提醒模板 ID

# JWT 密钥 - 生产环境务必使用强随机字符串
JWT_SECRET=你的 JWT 密钥

# MySQL 配置
DB_MYSQL_PASSWORD=你的 MySQL 密码

# MongoDB 配置
DB_MONGODB_URI=mongodb://localhost:27017/library_booking_dev
```

> 真实的 `WECHAT_TEMPLATE_BOOKING_SUCCESS` 和 `WECHAT_TEMPLATE_BOOKING_REMINDER` 应当写入每个环境对应的配置文件，例如 `.env.development`, `.env.test`, `.env.uat`, `.env.production`。`

3. **获取微信 AppID 和 Secret:**
    - 访问 [微信公众平台](https://mp.weixin.qq.com/)
    - 注册小程序账号
    - 在"开发" -> "开发管理" -> "开发设置" 中获取
    - 或使用测试号：[微信测试号申请](https://developers.weixin.qq.com/miniprogram/dev/framework/customize/samecity.html)

### 多环境配置

项目支持四套环境，每套环境有独立的配置文件:

| 环境     | 配置文件           | 端口 | 数据库               |
| -------- | ------------------ | ---- | -------------------- |
| 开发环境 | `.env.development` | 3000 | library_booking_dev  |
| 测试环境 | `.env.test`        | 3001 | library_booking_test |
| UAT 环境 | `.env.uat`         | 3002 | library_booking_uat  |
| 生产环境 | `.env.production`  | 3003 | library_booking_prod |

**注意**: 所有 `.env*` 配置文件都不会提交到 Git，每个开发者需要自行配置。

### MySQL 日志输出控制

开发时我们在启动过程中会打印 Sequelize 执行的 SQL 语句（用于调试）。如果你不希望在控制台看到这些 SQL 日志，可以通过环境变量 `MYSQL_LOGGING` 控制：

-   在 `.env.development`（或你当前使用的环境文件）中添加 `MYSQL_LOGGING=false` 来关闭 SQL 日志。
-   要开启日志（显示 SQL），设置为 `MYSQL_LOGGING=true`。

示例：

```ini
# 关闭 SQL 输出
MYSQL_LOGGING=false
```

默认行为：如果未设置 `MYSQL_LOGGING`，开发环境（`NODE_ENV=development`）下会默认打印 SQL 日志，以便调试。

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 初始化数据库

**MySQL:**

```bash
pnpm db:init
# 或重置数据库
pnpm db:reset
```

**MongoDB:**

```bash
pnpm db:mongo:init
# 如需仅补齐默认超级管理员
pnpm db:mongo:ensure-admin
```

### 3. 配置环境变量

```bash
# 复制模板
cp .env.example .env

# 编辑 .env 文件，填入你的微信 AppID、AppSecret 等配置
```

### 4. 启动服务

**方式一：直接启动**

```bash
pnpm dev
```

**方式二：使用环境切换工具**

```bash
# 查看当前环境
pnpm switch:env

# 切换到开发环境并启动
node scripts/switch-env.js dev --start
# 或简写
pnpm switch:env:dev
```

### 5. 查看 API 文档

```bash
pnpm swagger
# 访问 http://localhost:<PORT>/swagger
```

## 🧪 测试

### API 接口测试

使用 PowerShell 运行自动化测试脚本:

```powershell
.\tools\test-all-apis.ps1
```

### 代码检查

```bash
# ESLint 检查
pnpm lint

# 自动修复格式问题
pnpm lint:fix

# Prettier 格式化
pnpm format
```

## 📝 常用命令

| 命令                         | 说明                          |
| ---------------------------- | ----------------------------- |
| `pnpm dev`                   | 启动开发服务器 (热重载)       |
| `pnpm build`                 | 编译 TypeScript 到 JavaScript |
| `pnpm start`                 | 启动生产环境服务              |
| `pnpm switch:env`            | 查看/切换环境                 |
| `pnpm switch:env:dev`        | 切换到开发环境并启动          |
| `pnpm switch:env:test`       | 切换到测试环境并启动          |
| `pnpm switch:env:uat`        | 切换到 UAT 环境并启动         |
| `pnpm switch:env:prod`       | 切换到生产环境并启动          |
| `pnpm db:init`               | 初始化 MySQL 数据库           |
| `pnpm db:mongo:init`         | 初始化 MongoDB 数据库         |
| `pnpm db:mongo:ensure-admin` | 仅补齐/更新默认超级管理员     |
| `pnpm swagger`               | 启动 Swagger UI 文档服务      |
| `pnpm generate:swagger`      | 重新生成 Swagger API 文档     |
| `pnpm config:env`            | 交互式配置环境变量            |
| `pnpm config:env:check`      | 检查环境配置状态              |

## 🔒 安全最佳实践

1. **永不提交敏感信息**: 所有包含真实密码、密钥的配置文件都已添加到 `.gitignore`
2. **使用环境变量**: 生产环境通过 CI/CD 系统注入环境变量
3. **定期更换密钥**: JWT_SECRET 等密钥应定期更换
4. **最小权限原则**: 数据库账号仅授予必要权限
5. **HTTPS**: 生产环境必须使用 HTTPS 传输

## 📄 License

MIT
