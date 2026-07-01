'use strict';

const crypto = require('crypto');

const PREFIX = 'v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let _key = null;

function getKey() {
    if (_key) return _key;

    const envKey = process.env.PHONE_ENCRYPTION_KEY;
    const token = process.env.BOT_TOKEN;

    if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
        _key = Buffer.from(envKey, 'hex');
    } else if (envKey) {
        _key = crypto.scryptSync(envKey, 'ascended-phone-salt', 32);
    } else if (token) {
        console.warn('[PhoneCrypto] PHONE_ENCRYPTION_KEY não definido — derivando chave do BOT_TOKEN. Defina PHONE_ENCRYPTION_KEY no .env para maior segurança.');
        _key = crypto.scryptSync(token, 'ascended-phone-salt', 32);
    } else {
        throw new Error('[PhoneCrypto] Defina PHONE_ENCRYPTION_KEY ou BOT_TOKEN para criptografar telefones.');
    }

    return _key;
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plain) {
    if (!plain) return plain;
    if (isEncrypted(plain)) return plain;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decrypt(value) {
    if (!value) return value;
    if (!isEncrypted(value)) return value;

    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return value;

    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64url')),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}

function decryptMemberRow(row) {
    if (!row) return row;
    return { ...row, phone: decrypt(row.phone) };
}

module.exports = {
    encrypt,
    decrypt,
    isEncrypted,
    decryptMemberRow,
};
