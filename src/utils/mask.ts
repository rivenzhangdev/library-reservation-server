export function maskPhone(phone: string) {
    const trimmed = String(phone || '').trim();
    if (!trimmed) return '';
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 11) {
        return `${digits.slice(0, 3)}****${digits.slice(7)}`;
    }
    if (digits.length >= 7) {
        return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
    }
    if (trimmed.length <= 4) {
        return '*'.repeat(trimmed.length);
    }
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
}

export function maskStudentId(studentId: string) {
    const trimmed = String(studentId || '').trim();
    if (!trimmed) return '';
    const len = trimmed.length;
    if (len <= 4) {
        return '*'.repeat(len);
    }
    const left = 2;
    const right = 2;
    const middleLength = Math.max(0, len - left - right);
    return `${trimmed.slice(0, left)}${'*'.repeat(middleLength)}${trimmed.slice(
        -right
    )}`;
}
