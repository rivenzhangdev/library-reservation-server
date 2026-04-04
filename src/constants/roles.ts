// Numeric role enum: 0 = user, 1 = admin
export const Roles = {
    USER: 0,
    ADMIN: 1,
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];
