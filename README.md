# 后端服务说明

本项目是图书馆预约系统后端，基于 Koa + TypeScript，提供预约、续约、签到签退、通知、活动、审批、规则配置等接口。

## 1. 技术栈

-   Node.js + TypeScript
-   Koa
-   Sequelize + MySQL
-   Mongoose + MongoDB

## 2. 目录结构

-   src：业务源码
-   src/routes：接口路由
-   src/services：业务服务层
-   src/models：MySQL 与 MongoDB 模型
-   src/utils：工具函数与规则解析
-   database：数据库初始化与迁移脚本
-   scripts：运维和开发脚本
-   test：接口与规则测试

## 3. 环境变量

请先复制模板：

cp .env.example .env

建议按环境维护以下文件：

-   .env.development
-   .env.test
-   .env.uat
-   .env.production

关键变量：

-   NODE_ENV
-   PORT
-   DB_MYSQL_HOST / DB_MYSQL_PORT / DB_MYSQL_DATABASE / DB_MYSQL_USERNAME / DB_MYSQL_PASSWORD
-   DB_MONGODB_URI
-   JWT_SECRET
-   WX_APP_ID / WX_APP_SECRET

## 4. 数据库初始化

开发环境初始化：

mysql -u root -p < database/init-dev.sql

UAT 环境初始化：

mysql -u root -p < database/init-uat.sql

生产环境初始化：

mysql -u root -p < database/init-production.sql

MongoDB 初始化：

pnpm db:mongo:init

## 5. 启动与脚本

安装依赖：

pnpm install

开发启动：

pnpm start:dev

测试环境启动：

pnpm start:test

UAT 启动：

pnpm start:uat

生产启动：

pnpm start:prod

常用命令：

-   pnpm lint
-   pnpm lint:fix
-   pnpm format
-   pnpm test
-   pnpm swagger
-   pnpm generate:swagger

## 6. Swagger 文档

-   生成脚本：[src/generate-swagger-full.ts](src/generate-swagger-full.ts)
-   产物文件：[swagger-full.json](swagger-full.json)
-   本地查看：pnpm swagger

本次已对预约接口文档做了同步更新：

-   我的预约列表返回字段与实际实现保持一致（list, pageSize）
-   增加续约窗口相关字段（renewalAdvanceDays, renewalBlockedReason）
-   续约接口补充常见失败场景说明

## 7. 续约规则说明

-   renewal.maxExtraSlots：单条预约最多可续约的时段数
-   renewal.advanceDays：可提前续约天数

规则示例：

-   renewal.advanceDays = 0：仅预约当天可续约
-   renewal.advanceDays = 1：可在预约当天和前 1 天续约

续约资格由后端统一判定，并通过接口返回不可续约原因。

## 8. 质量与发布检查

1. 变更接口后执行 pnpm generate:swagger
2. 执行 pnpm lint 与核心用例测试
3. 检查规则默认值与数据库脚本一致
4. 发布前确认生产环境变量完整且密钥已替换
