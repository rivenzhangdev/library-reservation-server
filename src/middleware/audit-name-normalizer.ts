import { User } from '../models/mongodb';
import { getUserDisplayName } from '../utils/user-display';

type AnyRecord = Record<string, any>;

const AUDIT_FIELD_PAIRS = [
    { idKey: 'createdBy', nameKey: 'createdByName' },
    { idKey: 'updatedBy', nameKey: 'updatedByName' },
    { idKey: 'reviewerId', nameKey: 'reviewerName' },
    { idKey: 'publisher', nameKey: 'publisherName' },
];

function hasValue(value: any): boolean {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function toPublicId(value: any): string | undefined {
    if (value === undefined || value === null) return undefined;

    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }

    if (typeof value === 'object' && typeof value.toString === 'function') {
        const converted = String(value);
        if (converted && converted !== '[object Object]') {
            return converted;
        }
    }

    return undefined;
}

function isObjectIdLike(value: string): boolean {
    return /^[a-fA-F0-9]{24}$/.test(value);
}

function normalizeKey(value: any): string | undefined {
    if (value === undefined || value === null) return undefined;
    const key = String(value).trim();
    return key || undefined;
}

function resolveDirectDisplayName(value: any): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    return getUserDisplayName(value as any);
}

function resolveNameFromValue(
    rawValue: any,
    userMap: Record<string, string>
): string | undefined {
    if (rawValue === undefined || rawValue === null) return undefined;

    const directDisplayName = resolveDirectDisplayName(rawValue);
    if (directDisplayName) return directDisplayName;

    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
        const key = normalizeKey(rawValue);
        return key ? userMap[key] : undefined;
    }

    if (typeof rawValue === 'object') {
        const objectLike = rawValue as AnyRecord;
        const objectKeys = [
            objectLike._id,
            objectLike.id,
            objectLike.userId,
            objectLike.username,
            objectLike.name,
        ];

        for (const keyValue of objectKeys) {
            const key = normalizeKey(keyValue);
            if (key && userMap[key]) return userMap[key];
        }
    }

    return undefined;
}

function collectUserReferenceKeys(
    value: any,
    keys: Set<string>,
    visited: WeakSet<object>
) {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
        value.forEach((item) => collectUserReferenceKeys(item, keys, visited));
        return;
    }

    const obj = value as AnyRecord;

    for (const { idKey, nameKey } of AUDIT_FIELD_PAIRS) {
        if (obj[nameKey]) continue;
        const rawValue = obj[idKey];
        if (!rawValue) continue;

        if (typeof rawValue === 'string' || typeof rawValue === 'number') {
            const key = normalizeKey(rawValue);
            if (key) keys.add(key);
            continue;
        }

        if (typeof rawValue === 'object') {
            const objectLike = rawValue as AnyRecord;
            const candidates = [
                objectLike._id,
                objectLike.id,
                objectLike.userId,
                objectLike.username,
                objectLike.name,
            ];
            candidates.forEach((candidate) => {
                const key = normalizeKey(candidate);
                if (key) keys.add(key);
            });
        }
    }

    Object.values(obj).forEach((child) =>
        collectUserReferenceKeys(child, keys, visited)
    );
}

function applyAuditNames(
    value: any,
    userMap: Record<string, string>,
    visited: WeakSet<object>
) {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
        value.forEach((item) => applyAuditNames(item, userMap, visited));
        return;
    }

    const obj = value as AnyRecord;

    for (const { idKey, nameKey } of AUDIT_FIELD_PAIRS) {
        if (obj[nameKey]) continue;
        const resolvedName = resolveNameFromValue(obj[idKey], userMap);
        if (resolvedName) obj[nameKey] = resolvedName;
    }

    Object.values(obj).forEach((child) =>
        applyAuditNames(child, userMap, visited)
    );
}

function pruneRedundantFields(value: any, visited: WeakSet<object>) {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
        value.forEach((item) => pruneRedundantFields(item, visited));
        return;
    }

    const obj = value as AnyRecord;

    // 统一 ID 输出：保留 id，去除 _id
    if (obj._id !== undefined) {
        const normalizedId = toPublicId(obj._id);
        if (!hasValue(obj.id) && normalizedId) {
            obj.id = normalizedId;
        }
        delete obj._id;
    }

    // 移除 Mongoose 内部版本字段
    if (Object.prototype.hasOwnProperty.call(obj, '__v')) {
        delete obj.__v;
    }

    // 审计字段去重：存在 Name 时不再返回原始 ID 字段
    for (const { idKey, nameKey } of AUDIT_FIELD_PAIRS) {
        if (hasValue(obj[nameKey])) {
            delete obj[idKey];
        } else if (obj[nameKey] !== undefined && !hasValue(obj[nameKey])) {
            delete obj[nameKey];
        }
    }

    Object.values(obj).forEach((child) => pruneRedundantFields(child, visited));
}

async function buildUserDisplayMap(
    keys: Set<string>
): Promise<Record<string, string>> {
    if (!keys.size) return {};

    const keyList = Array.from(keys);
    const objectIdKeys = keyList.filter(isObjectIdLike);

    const conditions: AnyRecord[] = [
        { username: { $in: keyList } },
        { name: { $in: keyList } },
    ];

    if (objectIdKeys.length) {
        conditions.push({ _id: { $in: objectIdKeys } });
    }

    const users = await User.find({ $or: conditions })
        .select('_id name username')
        .lean();

    const userMap: Record<string, string> = {};
    users.forEach((user: any) => {
        const displayName = getUserDisplayName(user);
        if (!displayName) return;

        const candidateKeys = [user._id, user.username, user.name];
        candidateKeys.forEach((candidate) => {
            const key = normalizeKey(candidate);
            if (key) userMap[key] = displayName;
        });
    });

    return userMap;
}

export async function auditNameNormalizer(ctx: any, next: any) {
    await next();

    try {
        if (!ctx?.body || typeof ctx.body !== 'object') return;

        const userKeys = new Set<string>();
        collectUserReferenceKeys(ctx.body, userKeys, new WeakSet<object>());

        const userMap = await buildUserDisplayMap(userKeys);
        applyAuditNames(ctx.body, userMap, new WeakSet<object>());
        pruneRedundantFields(ctx.body, new WeakSet<object>());
    } catch (error) {
        console.warn('Failed to normalize audit names:', error);
    }
}
