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
                    code: String(ErrorCodes.NOT_FOUND),
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
                    code: String(error.errorCode ?? ErrorCodes.INTERNAL_ERROR),
                    message: error.message ?? 'Internal server error',
                },
            };
        } else {
            // 未处理的错误
            ctx.status = 500;
            ctx.body = {
                success: false,
                error: {
                    code: String(ErrorCodes.INTERNAL_ERROR),
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
        // 为了兼容历史写法：很多地方直接传入 403/500（期望为 HTTP 状态），
        // 也有地方传入 ErrorCodes.xxx（数字错误码）。这里做兼容处理：
        // - 如果第二个参数在 100-599 范围内，则视为 HTTP 状态码（status）
        // - 否则视为 errorCode（数字错误码），第三个参数可用于指定 status
        codeOrStatus?: number,
        statusArg?: number
    ) {
        super(message);
        this.isCustom = true;
        // 兼容逻辑：当传入 HTTP 状态（例如 403, 500）时将其作为 status
        if (
            typeof codeOrStatus === 'number' &&
            codeOrStatus >= 100 &&
            codeOrStatus < 600
        ) {
            this.status = codeOrStatus;
            this.errorCode =
                typeof statusArg === 'number'
                    ? (statusArg as ErrorCodeValue)
                    : ErrorCodes.INTERNAL_ERROR;
        } else {
            this.errorCode =
                typeof codeOrStatus === 'number'
                    ? (codeOrStatus as ErrorCodeValue)
                    : ErrorCodes.INTERNAL_ERROR;
            this.status = typeof statusArg === 'number' ? statusArg : 200;
        }
    }
}
