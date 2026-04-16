export function isLikelyWechatIdentifier(value?: string): boolean {
    if (!value) return false;
    const trimmed = String(value).trim();
    if (trimmed.length < 20) return false;

    const wechatOpenId = /^o[a-zA-Z0-9_-]{26,32}$/;
    const wechatWxid = /^wxid_[a-zA-Z0-9_-]{6,32}$/;
    const genericId = /^[a-zA-Z0-9_-]{28,32}$/;

    return (
        wechatOpenId.test(trimmed) ||
        wechatWxid.test(trimmed) ||
        genericId.test(trimmed)
    );
}

export function getUserDisplayName(user?: {
    name?: string;
    username?: string;
}): string | undefined {
    if (!user) return undefined;
    const username = String(user.username || '').trim();
    if (username) return username;

    const name = String(user.name || '').trim();
    if (name) return name;

    return undefined;
}

export function getUserDisplayNameFromMap(
    userId: any,
    userMap: Record<string, any>
): string | undefined {
    if (!userId) return undefined;
    const user = userMap[String(userId)];
    return getUserDisplayName(user);
}
