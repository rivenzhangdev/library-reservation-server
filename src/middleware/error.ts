import { Context, Next } from 'koa';
import { ErrorCodes, ErrorCodeValue } from '../utils/error-codes';

// 错误处理中间件
export async function errorHandler(ctx: Context, next: Next) {
    try {
        await next();

        // 如果响应状态码是 404
        if (ctx.status === 404) {
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.NOT_FOUND,
                    message: 'Resource not found',
                },
            };
        }
    } catch (error: any) {
        console.error('Error:', error);

        // 已处理的错误
        if (error.isCustom) {
            ctx.status = error.status ?? 500;
            ctx.body = {
                success: false,
                error: {
                    code: error.errorCode ?? ErrorCodes.INTERNAL_ERROR,
                    message: error.message ?? 'Internal server error',
                },
            };
        } else {
            // 未处理的错误
            ctx.status = 500;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INTERNAL_ERROR,
                    message:
                        process.env.NODE_ENV === 'development'
                            ? error.message
                            : 'Internal server error',
                },
            };
        }
    }
}

// 自定义错误类
export class CustomError extends Error {
    isCustom: boolean;
    status: number; // HTTP 状态码（内部使用，最终响应始终为 200）
    errorCode: ErrorCodeValue; // 使用数字错误码

    constructor(
        message: string,
        errorCode: ErrorCodeValue = ErrorCodes.INTERNAL_ERROR,
        status: number = 200
    ) {
        super(message);
        this.isCustom = true;
        this.status = status; // 保留 status 用于内部逻辑，但中间件会统一设置为 200
        this.errorCode = errorCode;
    }
}
