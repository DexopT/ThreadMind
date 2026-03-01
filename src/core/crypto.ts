import crypto from 'crypto';
import { env } from './env';

const ALGORITHM = 'aes-256-gcm';
// In a real production app, this should strictly be provided via env.
// For this open-source agent, we fallback to a derived key if missing,
// but warn the user.
const ENCRYPTION_KEY = env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32
    ? Buffer.from(env.ENCRYPTION_KEY, 'utf-8')
    : crypto.createHash('sha256').update(env.ENCRYPTION_KEY || 'default_threadmind_salt').digest();

if (!env.ENCRYPTION_KEY) {
    console.warn("⚠️ [Security] ENCRYPTION_KEY not set in environment. Using a default derived key for credential storage. This is insecure for production.");
}

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:encryptedText
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(hash: string): string {
    const parts = hash.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
