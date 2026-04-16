import { Context } from 'koa';

export function getCurrentUserId(ctx: Context): string | undefined {
    const user = (ctx as any).state?.user;
    if (!user) return undefined;
    const id = user.id ?? user._id ?? user.sub;
    return id !== undefined && id !== null ? String(id) : undefined;
}

export function buildCreatedBy(ctx: Context): Record<string, string> {
    const id = getCurrentUserId(ctx);
    return id ? { createdBy: id } : {};
}

export function buildUpdatedBy(ctx: Context): Record<string, string> {
    const id = getCurrentUserId(ctx);
    return id ? { updatedBy: id } : {};
}

export function buildAuditFields(
    ctx: Context,
    options?: { created?: boolean; updated?: boolean }
): Record<string, string> {
    const id = getCurrentUserId(ctx);
    if (!id) return {};
    return {
        ...(options?.created ?? true ? { createdBy: id } : {}),
        ...(options?.updated ?? true ? { updatedBy: id } : {}),
    };
}
