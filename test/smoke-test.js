'use strict';

/**
 * Smoke test pós-refactor — valida módulos críticos sem Discord API.
 * Uso: node test/smoke-test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function ok(name) {
    passed++;
    console.log(`  ✅ ${name}`);
}

function fail(name, err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message || err}`);
}

function section(title) {
    console.log(`\n── ${title} ──`);
}

// ─── 1. Config helpers ───────────────────────────────────────────────────────
section('Config helpers');
try {
    const { getWarVoiceChannelId, getProtectedVoiceChannelIds, isProtectedVoiceChannel } = require('../modules/configHelpers');
    const cfg = require('../bot.config.json');
    assert.ok(getWarVoiceChannelId(cfg), 'war voice channel');
    assert.equal(getProtectedVoiceChannelIds(cfg).length, 3, '3 protected channels');
    assert.ok(isProtectedVoiceChannel(getProtectedVoiceChannelIds(cfg)[0], cfg));
    ok('configHelpers');
} catch (e) { fail('configHelpers', e); }

// ─── 2. Phone crypto ─────────────────────────────────────────────────────────
section('Phone crypto');
try {
    const phoneCrypto = require('../modules/phoneCrypto');
    const plain = '5511999887766';
    const enc = phoneCrypto.encrypt(plain);
    assert.ok(phoneCrypto.isEncrypted(enc));
    assert.equal(phoneCrypto.decrypt(enc), plain);
    assert.equal(phoneCrypto.decrypt(plain), plain, 'plaintext passthrough');
    ok('encrypt/decrypt roundtrip');
} catch (e) { fail('phoneCrypto', e); }

// ─── 3. Database + phone migration ───────────────────────────────────────────
section('Database');
try {
    const db = require('../modules/database');
    const members = db.getAllRegisteredMembers();
    assert.ok(Array.isArray(members));
    for (const m of members.slice(0, 5)) {
        if (m.phone) {
            assert.ok(!String(m.phone).startsWith('v1:'), 'phone returned decrypted to app');
            assert.match(String(m.phone), /^\d+$/, 'phone is digits only when decrypted');
        }
    }
    const rawRows = db.db.prepare("SELECT phone FROM registered_members WHERE phone IS NOT NULL AND phone != '' LIMIT 5").all();
    for (const row of rawRows) {
        if (row.phone) assert.ok(String(row.phone).startsWith('v1:'), 'phone stored encrypted in DB');
    }
    ok(`registered members (${members.length}) + encryption at rest`);
} catch (e) { fail('database', e); }

// ─── 4. Commands load ────────────────────────────────────────────────────────
section('Commands');
try {
    const commandsDir = path.join(ROOT, 'commands');
    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
    let loadErrors = 0;
    for (const file of files) {
        try {
            const cmd = require(path.join(commandsDir, file));
            assert.ok(cmd.name, `${file} has name`);
            assert.equal(typeof cmd.execute, 'function', `${file} has execute`);
        } catch (err) {
            loadErrors++;
            fail(`load ${file}`, err);
        }
    }
    if (loadErrors === 0) ok(`${files.length} commands loaded`);
} catch (e) { fail('commands', e); }

// ─── 5. Claim logic ──────────────────────────────────────────────────────────
section('Claim system');
try {
    const claim = require('../commands/claim');
    const respawns = require('../data/respawns.json');
    assert.ok(respawns.length > 0);
    // findRespawn is internal — test via module exports if any, else duplicate minimal test
    const q2 = respawns.find(r => r.id === 'Q2');
    assert.ok(q2, 'Q2 exists in respawns.json');
    ok('respawns data + claim module');
} catch (e) { fail('claim', e); }

// ─── 6. Register manager pending crypto ──────────────────────────────────────
section('Register manager');
try {
    const phoneCrypto = require('../modules/phoneCrypto');
    const pendingPath = path.join(ROOT, 'data', 'pending_registrations.json');
    if (fs.existsSync(pendingPath)) {
        const raw = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
        const entries = Object.values(raw);
        for (const p of entries) {
            if (p?.phone) assert.ok(phoneCrypto.isEncrypted(p.phone), 'pending phone encrypted on disk');
        }
        ok(`pending registrations file (${entries.length} entries)`);
    } else {
        ok('pending registrations (empty/missing — ok)');
    }
} catch (e) { fail('registerManager file', e); }

// ─── 7. Scraper (light) ──────────────────────────────────────────────────────
section('Scraper');
(async () => {
    try {
        const { scrapeGuild, closeBrowser } = require('../scraper/scraper');
        const cfg = require('../bot.config.json');
        const members = await scrapeGuild(cfg.guildName);
        assert.ok(Array.isArray(members));
        assert.ok(members.length > 0, 'guild scrape returns members');
        ok(`scrapeGuild "${cfg.guildName}" (${members.length} members)`);
        await closeBrowser();
    } catch (e) { fail('scraper', e); }

    // ─── 8. Scheduler module loads ───────────────────────────────────────────
    section('Scheduler');
    try {
        const scheduler = require('../modules/scheduler');
        assert.equal(typeof scheduler.init, 'function');
        assert.equal(typeof scheduler.updateConfig, 'function');
        ok('scheduler module exports');
    } catch (e) { fail('scheduler', e); }

    // ─── 9. WhatsApp helpers ─────────────────────────────────────────────────
    section('WhatsApp');
    try {
        const waPath = path.join(ROOT, 'modules', 'whatsapp.js');
        const src = fs.readFileSync(waPath, 'utf8');
        assert.ok(!src.includes('makeUniqueAuthFolder'), 'no makeUniqueAuthFolder');
        assert.ok(src.includes('cleanupOrphanedAuthFolders'), 'has orphan cleanup');
        ok('whatsapp retry refactor present');
    } catch (e) { fail('whatsapp', e); }

    // ─── 10. Bot.js syntax + shutdown ────────────────────────────────────────
    section('Bot entry');
    try {
        const botSrc = fs.readFileSync(path.join(ROOT, 'bot.js'), 'utf8');
        assert.ok(botSrc.includes('isShuttingDown'), 'graceful shutdown flag');
        assert.ok(!botSrc.includes('1513552528560754760'), 'no hardcoded registration channel');
        assert.ok(botSrc.includes('registrationChannelId'), 'uses config registration channel');
        ok('bot.js critical fixes');
    } catch (e) { fail('bot.js', e); }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(40)}`);
    console.log(`Resultado: ${passed} passou, ${failed} falhou`);
    console.log('═'.repeat(40));
    process.exit(failed > 0 ? 1 : 0);
})();
