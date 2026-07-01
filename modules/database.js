'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const phoneCrypto = require('./phoneCrypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'ascended_bot.db');
const db      = new Database(DB_PATH);

function getGuildIdContext() {
    try {
        const state = require('./state');
        const store = state.guildLocalStorage.getStore();
        return store && store.guildId ? store.guildId : '1512243295332601999';
    } catch {
        return '1512243295332601999';
    }
}

// Migration block to add guild_id and modify primary keys of claims, claims_queue, registered_members
try {
    const tableInfo = db.pragma('table_info(claims)');
    const hasGuildId = tableInfo.some(col => col.name === 'guild_id');
    if (!hasGuildId) {
        console.log('[Database] Migrating database schema to multi-guild (adding guild_id)...');
        db.exec(`
            DROP TABLE IF EXISTS claims_queue;
            DROP TABLE IF EXISTS claims;
            DROP TABLE IF EXISTS registered_members;
        `);
        console.log('[Database] Dropped old non-guild tables successfully.');
    }
} catch (err) {
    console.error('[Database] Migration precheck failed:', err.message);
}

// Drop user_api_keys once to fix composite foreign key mismatch
try {
    const hasKeys = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_api_keys' AND sql LIKE '%FOREIGN KEY%'").get();
    if (hasKeys) {
        console.log('[Database] Dropping user_api_keys due to foreign key mismatch...');
        db.exec('DROP TABLE IF EXISTS user_api_keys');
    }
} catch (e) {
    console.error('[Database] Failed to check/drop user_api_keys:', e.message);
}

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS deaths (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        date      TEXT NOT NULL,
        name      TEXT NOT NULL,
        level     INTEGER,
        killed_by TEXT,
        raw_time  TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS frags (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        date        TEXT NOT NULL,
        killer_name TEXT NOT NULL,
        victim_name TEXT NOT NULL,
        raw_time    TEXT,
        victim_level INTEGER,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
        date     TEXT NOT NULL,
        name     TEXT NOT NULL,
        daily_xp INTEGER DEFAULT 0,
        gain_xp  INTEGER DEFAULT 0,
        lost_xp  INTEGER DEFAULT 0,
        online_ms INTEGER DEFAULT 0,
        PRIMARY KEY (date, name)
    );

    CREATE TABLE IF NOT EXISTS hunted (
        name TEXT PRIMARY KEY,
        added_by TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bot_config (
        key   TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS claims (
        guild_id     TEXT NOT NULL,
        respawn_id   TEXT NOT NULL,
        respawn_name TEXT NOT NULL,
        category     TEXT NOT NULL,
        player_id    TEXT NOT NULL,
        player_name  TEXT NOT NULL,
        claimed_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        status       TEXT DEFAULT 'active',
        PRIMARY KEY (guild_id, respawn_id)
    );

    CREATE TABLE IF NOT EXISTS claims_queue (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id     TEXT NOT NULL,
        respawn_id   TEXT NOT NULL,
        player_id    TEXT NOT NULL,
        player_name  TEXT NOT NULL,
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boss_cooldowns (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id    TEXT NOT NULL,
        boss_name    TEXT NOT NULL,
        killed_at    INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        notified     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS temp_voice_channels (
        channel_id   TEXT PRIMARY KEY,
        creator_id   TEXT NOT NULL,
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registered_members (
        guild_id     TEXT NOT NULL,
        discord_id   TEXT NOT NULL,
        char_name    TEXT NOT NULL,
        class_code   TEXT NOT NULL,
        bomba        TEXT,
        phone        TEXT,
        registered_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_characters (
        discord_id       TEXT PRIMARY KEY,
        nickname         TEXT UNIQUE NOT NULL,
        class_code       TEXT NOT NULL,
        gender           TEXT NOT NULL,
        level            INTEGER DEFAULT 1,
        xp               INTEGER DEFAULT 0,
        wins             INTEGER DEFAULT 0,
        losses           INTEGER DEFAULT 0,
        streak           INTEGER DEFAULT 0,
        city_damage      INTEGER DEFAULT 0,
        equipped_weapon  TEXT DEFAULT NULL,
        equipped_shield  TEXT DEFAULT NULL,
        equipped_armor   TEXT DEFAULT NULL,
        equipped_amulet  TEXT DEFAULT NULL,
        created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parties (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id   TEXT,
        channel_id   TEXT,
        creator_id   TEXT NOT NULL,
        local        TEXT NOT NULL,
        horario      TEXT NOT NULL,
        duracao      TEXT NOT NULL,
        level_min    INTEGER,
        max_ek       INTEGER NOT NULL,
        max_ed       INTEGER NOT NULL,
        max_rp       INTEGER NOT NULL,
        max_ms       INTEGER NOT NULL,
        max_em       INTEGER NOT NULL,
        members_json TEXT NOT NULL,
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_last_seen (
        char_name TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id   TEXT NOT NULL,
        start_time   INTEGER NOT NULL,
        end_time     INTEGER
    );

    CREATE TABLE IF NOT EXISTS massivo_evasions (
        discord_id   TEXT PRIMARY KEY,
        char_name    TEXT NOT NULL,
        logoffs      INTEGER DEFAULT 0,
        ignored_ms   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS registration_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id  TEXT NOT NULL,
        char_name   TEXT NOT NULL,
        bomba       TEXT,
        action      TEXT NOT NULL,
        reason      TEXT,
        created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievements (
        discord_id     TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at    INTEGER NOT NULL,
        PRIMARY KEY (discord_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS player_levels (
        char_name   TEXT PRIMARY KEY,
        level       INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id   TEXT UNIQUE NOT NULL,
        user_id      TEXT NOT NULL,
        claimed_by   TEXT,
        status       TEXT DEFAULT 'open',
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hunts_schedule (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        respawn_id         TEXT NOT NULL,
        time_slot          TEXT NOT NULL,
        leader_discord_id  TEXT NOT NULL,
        member_ids         TEXT NOT NULL,
        active             INTEGER DEFAULT 1,
        last_active_at     INTEGER NOT NULL,
        created_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hunts_schedule_requests (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        respawn_id         TEXT NOT NULL,
        time_slot          TEXT NOT NULL,
        leader_discord_id  TEXT NOT NULL,
        member_ids         TEXT NOT NULL,
        status             TEXT DEFAULT 'pending',
        created_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hunts_schedule_attendance (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id        INTEGER NOT NULL,
        date               TEXT NOT NULL,
        checked_in         INTEGER DEFAULT 0,
        checked_in_at      INTEGER,
        UNIQUE(schedule_id, date)
    );

    CREATE TABLE IF NOT EXISTS bounties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_name TEXT NOT NULL,
        reward TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        claimed_by TEXT,
        claimed_by_char TEXT,
        claimed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS guild_taxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        char_name TEXT NOT NULL,
        cycle_start_at INTEGER NOT NULL,
        amount TEXT NOT NULL,
        status TEXT DEFAULT 'submitted',
        proof_url TEXT NOT NULL,
        verified_by TEXT,
        verified_at INTEGER,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guild_debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debtor_id TEXT NOT NULL,
        creditor_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        settled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS raffles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        ticket_cost REAL NOT NULL,
        ends_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        created_by TEXT NOT NULL,
        winner_id TEXT,
        winner_ticket_id INTEGER,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raffle_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raffle_id INTEGER NOT NULL,
        discord_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(raffle_id) REFERENCES raffles(id)
    );

    CREATE TABLE IF NOT EXISTS member_shop_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        material_id TEXT NOT NULL,
        quantity INTEGER DEFAULT 0
    );

    
    CREATE TABLE IF NOT EXISTS daily_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        quest_type TEXT NOT NULL,
        target TEXT,
        progress INTEGER DEFAULT 0,
        goal INTEGER NOT NULL,
        reward_ac INTEGER NOT NULL,
        completed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS player_pets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        pet_id TEXT NOT NULL,
        is_active INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS player_eggs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        rarity TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
    );\n    CREATE TABLE IF NOT EXISTS invasion_stats (
        discord_id TEXT PRIMARY KEY,
        char_name TEXT NOT NULL,
        total_damage INTEGER DEFAULT 0,
        invasions_participated INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS guilds (
        guild_id   TEXT PRIMARY KEY,
        guild_name TEXT NOT NULL,
        joined_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active  INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id      TEXT NOT NULL,
        setting_key   TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        PRIMARY KEY (guild_id, setting_key),
        FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracked_games (
        game_id        TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        platform       TEXT NOT NULL,
        current_price  REAL NOT NULL,
        original_price REAL NOT NULL,
        url            TEXT,
        last_updated   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_price_history (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id          TEXT NOT NULL,
        price            REAL NOT NULL,
        discount_percent INTEGER NOT NULL,
        recorded_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES tracked_games(game_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_api_keys (
        api_key          TEXT PRIMARY KEY,
        discord_id       TEXT NOT NULL,
        status           TEXT DEFAULT 'active',
        rate_limit_max   INTEGER DEFAULT 60,
        rate_limit_window INTEGER DEFAULT 60,
        requests_count   INTEGER DEFAULT 0,
        window_reset_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at       DATETIME
    );
`);

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN coins REAL DEFAULT 0');
try {
    db.exec('ALTER TABLE rpg_characters ADD COLUMN current_hp INTEGER DEFAULT -1');
} catch (e) {}
try {
    db.exec('ALTER TABLE rpg_characters ADD COLUMN stamina INTEGER DEFAULT 100');
} catch (e) {}
try {
    db.exec('ALTER TABLE rpg_characters ADD COLUMN death_time INTEGER DEFAULT 0');
} catch (e) {}
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN custom_banner TEXT');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN custom_banner_expires_at INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN guild_xp REAL DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN guild_level INTEGER DEFAULT 1');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN total_voice_mins INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN total_voice_war_mins INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE registered_members ADD COLUMN night_voice_mins INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE rpg_characters ADD COLUMN city_damage INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE daily_stats ADD COLUMN levels_gained INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE voice_sessions ADD COLUMN is_war INTEGER DEFAULT 0');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE deaths ADD COLUMN is_pvp INTEGER DEFAULT 1');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE claims ADD COLUMN status TEXT DEFAULT "active"');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE frags ADD COLUMN victim_level INTEGER');
} catch (e) {
    // Column already exists
}

try {
    db.exec('ALTER TABLE hunted ADD COLUMN reason TEXT DEFAULT ""');
} catch (e) {
    // Column already exists
}

// ─── Config ───────────────────────────────────────────────────────────────────
const stmtGetCfg = db.prepare('SELECT value FROM bot_config WHERE key = ?');
const stmtSetCfg = db.prepare('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)');

function getConfig(key, guildId = null) {
    if (guildId) {
        try {
            const row = db.prepare('SELECT setting_value FROM guild_settings WHERE guild_id = ? AND setting_key = ?').get(guildId, key);
            if (row && row.setting_value !== undefined && row.setting_value !== null && row.setting_value !== '') {
                return row.setting_value;
            }
        } catch (e) {
            console.error('[DB] Erro ao buscar guild setting:', e.message);
        }
    }
    const row = stmtGetCfg.get(key);
    return row ? row.value : null;
}

function setConfig(key, value, guildId = null) {
    const targetGuildId = guildId || getGuildIdContext();
    if (targetGuildId) {
        setGuildConfig(targetGuildId, key, value);
    } else {
        stmtSetCfg.run(key, String(value));
    }
}

function loadAllConfig() {
    const rows = db.prepare('SELECT key, value FROM bot_config').all();
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });
    return cfg;
}

function addGuild(guildId, guildName) {
    db.prepare(`
        INSERT INTO guilds (guild_id, guild_name, is_active)
        VALUES (?, ?, 1)
        ON CONFLICT(guild_id) DO UPDATE SET
            guild_name = excluded.guild_name,
            is_active  = 1
    `).run(guildId, guildName);
}

function removeGuild(guildId) {
    db.prepare('UPDATE guilds SET is_active = 0 WHERE guild_id = ?').run(guildId);
}

function clearGuildAllData(guildId) {
    db.transaction(() => {
        // Delete taxes and debts associated with members of this guild first
        db.prepare('DELETE FROM guild_taxes WHERE discord_id IN (SELECT discord_id FROM registered_members WHERE guild_id = ?)').run(guildId);
        db.prepare('DELETE FROM guild_debts WHERE debtor_id IN (SELECT discord_id FROM registered_members WHERE guild_id = ?) OR creditor_id IN (SELECT discord_id FROM registered_members WHERE guild_id = ?)').run(guildId, guildId);

        // Delete the remaining guild-specific table rows
        db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
        db.prepare('DELETE FROM guilds WHERE guild_id = ?').run(guildId);
        db.prepare('DELETE FROM registered_members WHERE guild_id = ?').run(guildId);
        db.prepare('DELETE FROM claims WHERE guild_id = ?').run(guildId);
        db.prepare('DELETE FROM claims_queue WHERE guild_id = ?').run(guildId);
    })();
}

function getActiveGuilds() {
    return db.prepare('SELECT * FROM guilds WHERE is_active = 1').all();
}

function getGuildConfig(guildId) {
    if (!guildId) return {};
    const rows = db.prepare('SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?').all(guildId);
    const cfg = {};
    rows.forEach(r => { cfg[r.setting_key] = r.setting_value; });
    return cfg;
}

function setGuildConfig(guildId, key, value) {
    if (!guildId) return;
    db.prepare('INSERT OR IGNORE INTO guilds (guild_id, guild_name) VALUES (?, ?)').run(guildId, 'Guild ' + guildId);
    db.prepare('INSERT OR REPLACE INTO guild_settings (guild_id, setting_key, setting_value) VALUES (?, ?, ?)').run(guildId, key, String(value));
}

function getGuildConfigMerged(guildId) {
    const globalCfg = loadAllConfig();
    const CONFIG_PATH = path.join(__dirname, '..', 'bot.config.json');
    let fileConfig = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* ignore */ }
    }
    
    const merged = {};
    const defaultKeys = [
        'guildName', 'worldName', 'enemyGuildName', 'deathChannelId', 'reportChannelId',
        'enemyChannelId', 'fragChannelId', 'warChannelId', 'warMode', 'adminRoleId',
        'cargoClaim90', 'cargoClaim180', 'claimCommandsChannelId', 'claimsPanelChannelId',
        'panelMessageId', 'cleanChannelId', 'claimsPaused', 'voiceGeneratorChannelId',
        'registrationChannelId', 'warScoreboardChannelId', 'warScoreboardMessageId',
        'onlineGuildChannelId', 'onlineEnemyChannelId', 'enemyHuntingChannelId',
        'enemyHuntingMessageId', 'allyHuntingChannelId', 'allyHuntingMessageId', 'warVoiceChannelId', 'levelUpChannelId',
        'protectedVoiceChannelIds', 'ticketCategoryId', 'ticketSupportRoleId',
        'ticketPanelChannelId', 'ticketPanelMessageId', 'ticketLogChannelId',
        'planilhadoCategoryId', 'planilhadoRequestChannelId', 'planilhadoAdminChannelId',
        'planilhadoListChannelId', 'announcementChannelId', 'taxEnabled', 'taxValue',
        'taxPlanilhadoValue', 'taxTargetChar', 'taxCycleDays', 'taxAuditChannelId',
        'taxPanelChannelId', 'cargoTaxa', 'guildBankName', 'whatsappMassLogEnabled'
    ];

    const isRealGuild = !guildId || /^\d+$/.test(guildId);

    defaultKeys.forEach(k => {
        if (isRealGuild) {
            if (globalCfg[k] !== undefined && globalCfg[k] !== null) {
                merged[k] = globalCfg[k];
            } else if (fileConfig[k] !== undefined && fileConfig[k] !== null) {
                merged[k] = fileConfig[k];
            } else {
                merged[k] = null;
            }
        } else {
            merged[k] = null;
        }
    });

    if (guildId) {
        const guildCfg = getGuildConfig(guildId);
        Object.keys(guildCfg).forEach(k => {
            if (guildCfg[k] !== undefined && guildCfg[k] !== null) {
                merged[k] = guildCfg[k];
            }
        });
    }

    return merged;
}

// ─── Mortes ───────────────────────────────────────────────────────────────────
const stmtInsertDeath = db.prepare(`
    INSERT INTO deaths (date, name, level, killed_by, raw_time, is_pvp)
    VALUES (@date, @name, @level, @killed_by, @raw_time, @is_pvp)
`);

function insertDeath({ date, name, level, killedBy, rawTime, isPvP = true }) {
    stmtInsertDeath.run({ date, name, level, killed_by: killedBy, raw_time: rawTime, is_pvp: isPvP ? 1 : 0 });
}

function getDeathsForDate(date) {
    return db.prepare('SELECT * FROM deaths WHERE date = ? ORDER BY created_at DESC').all(date);
}

function getAllDeaths() {
    return db.prepare('SELECT * FROM deaths ORDER BY created_at DESC').all();
}

// ─── Frags ────────────────────────────────────────────────────────────────────
const stmtInsertFrag = db.prepare(`
    INSERT INTO frags (date, killer_name, victim_name, raw_time, victim_level)
    VALUES (@date, @killer_name, @victim_name, @raw_time, @victim_level)
`);

function insertFrag({ date, killerName, victimName, rawTime, victimLevel }) {
    stmtInsertFrag.run({ date, killer_name: killerName, victim_name: victimName, raw_time: rawTime, victim_level: victimLevel || null });
}

function getFragsForDate(date) {
    return db.prepare('SELECT * FROM frags WHERE date = ? ORDER BY created_at DESC').all(date);
}

function getAllFrags() {
    return db.prepare('SELECT * FROM frags ORDER BY created_at DESC').all();
}

// ─── Daily Stats ──────────────────────────────────────────────────────────────
function upsertDailyStats({ date, name, dailyXp = 0, gainXp = 0, lostXp = 0, onlineMs = 0, levelsGained = 0 }) {
    db.prepare(`
        INSERT INTO daily_stats (date, name, daily_xp, gain_xp, lost_xp, online_ms, levels_gained)
        VALUES (@date, @name, @dailyXp, @gainXp, @lostXp, @onlineMs, @levelsGained)
        ON CONFLICT(date, name) DO UPDATE SET
            daily_xp      = daily_xp  + excluded.daily_xp,
            gain_xp       = gain_xp   + excluded.gain_xp,
            lost_xp       = lost_xp   + excluded.lost_xp,
            online_ms     = online_ms + excluded.online_ms,
            levels_gained = levels_gained + excluded.levels_gained
    `).run({ date, name, dailyXp, gainXp, lostXp, onlineMs, levelsGained });
}

function getDailyStatsForDate(date) {
    return db.prepare('SELECT * FROM daily_stats WHERE date = ? ORDER BY daily_xp DESC').all(date);
}

// ─── Hunted ───────────────────────────────────────────────────────────────────
function addHunted(name, addedBy, reason = '') {
    db.prepare('INSERT OR REPLACE INTO hunted (name, added_by, reason) VALUES (?, ?, ?)').run(name, addedBy, reason);
}

function removeHunted(name) {
    db.prepare('DELETE FROM hunted WHERE LOWER(name) = LOWER(?)').run(name);
}

function getHuntedEntry(name) {
    return db.prepare('SELECT name, added_by, added_at, reason FROM hunted WHERE LOWER(name) = LOWER(?)').get(name);
}

function getHuntedList() {
    return db.prepare('SELECT name FROM hunted ORDER BY name').all().map(r => r.name);
}

// ─── Claims ───────────────────────────────────────────────────────────────────
function getActiveClaims() {
    const guildId = getGuildIdContext();
    return db.prepare('SELECT * FROM claims WHERE expires_at > ? AND guild_id = ? ORDER BY category, respawn_id').all(Date.now(), guildId);
}

function getClaimByPlayer(playerId) {
    const guildId = getGuildIdContext();
    return db.prepare('SELECT * FROM claims WHERE player_id = ? AND expires_at > ? AND guild_id = ?').get(playerId, Date.now(), guildId);
}

function getClaimByRespawn(respawnId) {
    const guildId = getGuildIdContext();
    return db.prepare('SELECT * FROM claims WHERE LOWER(respawn_id) = LOWER(?) AND expires_at > ? AND guild_id = ?').get(respawnId, Date.now(), guildId);
}

function insertClaim({ respawnId, respawnName, category, playerId, playerName, durationMs, status = 'active' }) {
    const now = Date.now();
    const guildId = getGuildIdContext();
    db.prepare(`
        INSERT OR REPLACE INTO claims (guild_id, respawn_id, respawn_name, category, player_id, player_name, claimed_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, respawnId, respawnName, category, playerId, playerName, now, now + durationMs, status);
}

function deleteClaim(respawnId) {
    const guildId = getGuildIdContext();
    db.prepare('DELETE FROM claims WHERE LOWER(respawn_id) = LOWER(?) AND guild_id = ?').run(respawnId, guildId);
}

function deleteClaimByPlayer(playerId) {
    const guildId = getGuildIdContext();
    db.prepare('DELETE FROM claims WHERE player_id = ? AND guild_id = ?').run(playerId, guildId);
}

function extendClaim(respawnId, durationMs) {
    const guildId = getGuildIdContext();
    db.prepare('UPDATE claims SET expires_at = expires_at + ? WHERE LOWER(respawn_id) = LOWER(?) AND guild_id = ?').run(durationMs, respawnId, guildId);
}

// ─── Claims Queue ─────────────────────────────────────────────────────────────
function getQueue(respawnId) {
    const guildId = getGuildIdContext();
    return db.prepare('SELECT * FROM claims_queue WHERE LOWER(respawn_id) = LOWER(?) AND guild_id = ? ORDER BY created_at ASC').all(respawnId, guildId);
}

function getPlayerQueue(playerId) {
    const guildId = getGuildIdContext();
    return db.prepare('SELECT * FROM claims_queue WHERE player_id = ? AND guild_id = ?').get(playerId, guildId);
}

function addToQueue(respawnId, playerId, playerName) {
    const now = Date.now();
    db.prepare(`
        INSERT INTO claims_queue (respawn_id, player_id, player_name, created_at)
        VALUES (?, ?, ?, ?)
    `).run(respawnId, playerId, playerName, now);
}

function removeFromQueue(respawnId, playerId) {
    db.prepare('DELETE FROM claims_queue WHERE LOWER(respawn_id) = LOWER(?) AND player_id = ?').run(respawnId, playerId);
}

function clearQueue(respawnId) {
    db.prepare('DELETE FROM claims_queue WHERE LOWER(respawn_id) = LOWER(?)').run(respawnId);
}

function clearPlayerQueues(playerId) {
    db.prepare('DELETE FROM claims_queue WHERE player_id = ?').run(playerId);
}

function getNextInQueue(respawnId) {
    return db.prepare('SELECT * FROM claims_queue WHERE LOWER(respawn_id) = LOWER(?) ORDER BY created_at ASC LIMIT 1').get(respawnId);
}

// ─── Boss Cooldowns ──────────────────────────────────────────────────────────
function addBossCooldown(playerId, bossName, durationMs) {
    const now = Date.now();
    // Delete any active cooldown for the same boss for this player
    db.prepare('DELETE FROM boss_cooldowns WHERE player_id = ? AND LOWER(boss_name) = LOWER(?)').run(playerId, bossName);
    db.prepare(`
        INSERT INTO boss_cooldowns (player_id, boss_name, killed_at, expires_at, notified)
        VALUES (?, ?, ?, ?, 0)
    `).run(playerId, bossName, now, now + durationMs);
}

function getActiveBossCooldowns(playerId) {
    const now = Date.now();
    return db.prepare('SELECT * FROM boss_cooldowns WHERE player_id = ? AND expires_at > ? ORDER BY expires_at ASC').all(playerId, now);
}

function getPendingBossNotifications() {
    const now = Date.now();
    return db.prepare('SELECT * FROM boss_cooldowns WHERE expires_at <= ? AND notified = 0').all(now);
}

function markBossNotified(id) {
    db.prepare('UPDATE boss_cooldowns SET notified = 1 WHERE id = ?').run(id);
}

// ─── Canais Temporários ───────────────────────────────────────────────────────
function addTempVoiceChannel(channelId, creatorId) {
    db.prepare('INSERT OR REPLACE INTO temp_voice_channels (channel_id, creator_id, created_at) VALUES (?, ?, ?)').run(channelId, creatorId, Date.now());
}

function isTempVoiceChannel(channelId) {
    const row = db.prepare('SELECT 1 FROM temp_voice_channels WHERE channel_id = ?').get(channelId);
    return !!row;
}

function deleteTempVoiceChannel(channelId) {
    db.prepare('DELETE FROM temp_voice_channels WHERE channel_id = ?').run(channelId);
}

function getAllTempVoiceChannels() {
    return db.prepare('SELECT channel_id, creator_id FROM temp_voice_channels').all();
}

// ─── Membros Registrados ─────────────────────────────────────────────────────
function addRegisteredMember({ discordId, charName, classCode, bomba, phone }) {
    const encryptedPhone = phone ? phoneCrypto.encrypt(phone) : phone;
    const guildId = getGuildIdContext();
    db.prepare(`
        INSERT OR REPLACE INTO registered_members (guild_id, discord_id, char_name, class_code, bomba, phone, registered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, discordId, charName, classCode, bomba, encryptedPhone, Date.now());
}

function getRegisteredMember(discordId) {
    const guildId = getGuildIdContext();
    const row = db.prepare('SELECT * FROM registered_members WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId);
    return phoneCrypto.decryptMemberRow(row);
}

function getAllRegisteredMembers() {
    const guildId = getGuildIdContext();
    return db.prepare('SELECT * FROM registered_members WHERE guild_id = ?').all(guildId)
        .map(row => phoneCrypto.decryptMemberRow(row));
}

function migratePlaintextPhones() {
    try {
        const rows = db.prepare("SELECT discord_id, phone, guild_id FROM registered_members WHERE phone IS NOT NULL AND phone != ''").all();
        let migrated = 0;
        for (const row of rows) {
            if (!row.phone || phoneCrypto.isEncrypted(row.phone)) continue;
            db.prepare('UPDATE registered_members SET phone = ? WHERE discord_id = ? AND guild_id = ?')
                .run(phoneCrypto.encrypt(row.phone), row.discord_id, row.guild_id);
            migrated++;
        }
        if (migrated > 0) {
            console.log(`[Database] ${migrated} telefone(s) migrado(s) para armazenamento criptografado.`);
        }
    } catch (err) {
        console.error('[Database] Falha na migração de telefones:', err.message);
    }
}

migratePlaintextPhones();

function deleteRegisteredMember(discordId) {
    const guildId = getGuildIdContext();
    db.prepare('DELETE FROM registered_members WHERE discord_id = ? AND guild_id = ?').run(discordId, guildId);
}

// ─── Parties (Hunts) ──────────────────────────────────────────────────────────
function insertParty(party) {
    const stmt = db.prepare(`
        INSERT INTO parties (message_id, channel_id, creator_id, local, horario, duracao, level_min, max_ek, max_ed, max_rp, max_ms, max_em, members_json, created_at)
        VALUES (@message_id, @channel_id, @creator_id, @local, @horario, @duracao, @level_min, @max_ek, @max_ed, @max_rp, @max_ms, @max_em, @members_json, @created_at)
    `);
    const info = stmt.run({
        message_id: party.messageId || null,
        channel_id: party.channelId || null,
        creator_id: party.creatorId,
        local: party.local,
        horario: party.horario,
        duracao: party.duracao,
        level_min: party.levelMin || null,
        max_ek: party.maxEk,
        max_ed: party.maxEd,
        max_rp: party.maxRp,
        max_ms: party.maxMs,
        max_em: party.maxEm,
        members_json: JSON.stringify(party.members || []),
        created_at: Date.now()
    });
    return info.lastInsertRowid;
}

function updateParty(party) {
    const stmt = db.prepare(`
        UPDATE parties
        SET message_id = @message_id,
            channel_id = @channel_id,
            members_json = @members_json
        WHERE id = @id
    `);
    stmt.run({
        id: party.id,
        message_id: party.messageId,
        channel_id: party.channelId,
        members_json: JSON.stringify(party.members || [])
    });
}

function getParty(id) {
    const row = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
    if (!row) return null;
    return {
        id: row.id,
        messageId: row.message_id,
        channelId: row.channel_id,
        creatorId: row.creator_id,
        local: row.local,
        horario: row.horario,
        duracao: row.duracao,
        levelMin: row.level_min,
        maxEk: row.max_ek,
        maxEd: row.max_ed,
        maxRp: row.max_rp,
        maxMs: row.max_ms,
        maxEm: row.max_em,
        members: JSON.parse(row.members_json),
        createdAt: row.created_at
    };
}

function getPartyByMessage(messageId) {
    const row = db.prepare('SELECT * FROM parties WHERE message_id = ?').get(messageId);
    if (!row) return null;
    return {
        id: row.id,
        messageId: row.message_id,
        channelId: row.channel_id,
        creatorId: row.creator_id,
        local: row.local,
        horario: row.horario,
        duracao: row.duracao,
        levelMin: row.level_min,
        maxEk: row.max_ek,
        maxEd: row.max_ed,
        maxRp: row.max_rp,
        maxMs: row.max_ms,
        maxEm: row.max_em,
        members: JSON.parse(row.members_json),
        createdAt: row.created_at
    };
}

function deleteParty(id) {
    db.prepare('DELETE FROM parties WHERE id = ?').run(id);
}

// ─── Last Seen ──────────────────────────────────────────────────────────────
const stmtInsertLastSeen = db.prepare('INSERT OR REPLACE INTO player_last_seen (char_name, last_seen) VALUES (?, ?)');
const stmtGetLastSeen = db.prepare('SELECT last_seen FROM player_last_seen WHERE LOWER(char_name) = LOWER(?)');

function updateLastSeen(charName, timestamp = Date.now()) {
    stmtInsertLastSeen.run(charName, timestamp);
}

function getLastSeen(charName) {
    const row = stmtGetLastSeen.get(charName);
    return row ? row.last_seen : null;
}

function getAllLastSeen() {
    const rows = db.prepare('SELECT char_name, last_seen FROM player_last_seen').all();
    const map = new Map();
    rows.forEach(r => map.set(r.char_name.toLowerCase(), r.last_seen));
    return map;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function todayDate() {
    return new Date().toISOString().slice(0, 10);
}

// ─── Registration History ─────────────────────────────────────────────────────
function insertRegistrationHistory({ discordId, charName, bomba, action, reason }) {
    db.prepare('INSERT INTO registration_history (discord_id, char_name, bomba, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(discordId, charName, bomba || null, action, reason || null, Date.now());
}

function getRegistrationHistory(charName) {
    return db.prepare('SELECT * FROM registration_history WHERE LOWER(char_name) = LOWER(?) OR LOWER(bomba) = LOWER(?) ORDER BY created_at DESC').all(charName, charName);
}

function getRegistrationHistoryByDiscordId(discordId) {
    return db.prepare('SELECT * FROM registration_history WHERE discord_id = ? ORDER BY created_at DESC').all(discordId);
}

// ─── Achievements ─────────────────────────────────────────────────────────────
function hasAchievement(discordId, achievementId) {
    const row = db.prepare('SELECT 1 FROM achievements WHERE discord_id = ? AND achievement_id = ?').get(discordId, achievementId);
    return !!row;
}

function unlockAchievement(discordId, achievementId) {
    if (hasAchievement(discordId, achievementId)) return false; // already unlocked
    db.prepare('INSERT OR IGNORE INTO achievements (discord_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').run(discordId, achievementId, Date.now());
    return true;
}

function getPlayerAchievements(discordId) {
    return db.prepare('SELECT * FROM achievements WHERE discord_id = ? ORDER BY unlocked_at ASC').all(discordId);
}

function getAchievementsUnlockedSince(sinceTimestamp) {
    return db.prepare('SELECT * FROM achievements WHERE unlocked_at >= ?').all(sinceTimestamp);
}

// ─── Player Levels ────────────────────────────────────────────────────────────
function getPlayerLevel(charName) {
    const row = db.prepare('SELECT level FROM player_levels WHERE LOWER(char_name) = LOWER(?)').get(charName);
    return row ? row.level : null;
}

function upsertPlayerLevel(charName, level) {
    db.prepare('INSERT OR REPLACE INTO player_levels (char_name, level, updated_at) VALUES (?, ?, ?)').run(charName, level, Date.now());
}

// ─── K/D Ratio ────────────────────────────────────────────────────────────────
// Returns { frags, deaths, kd } for a discord member counting both main and bomba chars
function getPlayerKD(discordId, sinceDate) {
    const guildId = getGuildIdContext();
    const member = db.prepare('SELECT char_name, bomba FROM registered_members WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId);
    if (!member) return { frags: 0, deaths: 0, kd: 0 };

    const charNames = [member.char_name];
    const bomba = member.bomba;
    const hasBomba = bomba && bomba !== '-' && bomba.toLowerCase() !== 'none' && bomba.toLowerCase() !== 'nenhum';
    if (hasBomba) charNames.push(bomba);

    const placeholders = charNames.map(() => '?').join(', ');

    const fragRow = db.prepare(
        `SELECT COUNT(*) as count FROM frags WHERE LOWER(killer_name) IN (${charNames.map(() => 'LOWER(?)').join(',')}) AND date >= ?`
    ).get(...charNames, sinceDate);

    const deathRow = db.prepare(
        `SELECT COUNT(*) as count FROM deaths WHERE LOWER(name) IN (${charNames.map(() => 'LOWER(?)').join(',')}) AND is_pvp = 1 AND date >= ?`
    ).get(...charNames, sinceDate);

    const frags = fragRow ? fragRow.count : 0;
    const deaths = deathRow ? deathRow.count : 0;
    const kd = deaths > 0 ? (frags / deaths) : frags;

    return { frags, deaths, kd };
}

// Returns top K/D ranking for all registered members
function getTopKDPlayers(sinceDate, limit = 15) {
    const guildId = getGuildIdContext();
    const members = db.prepare('SELECT discord_id, char_name, bomba FROM registered_members WHERE guild_id = ?').all(guildId);
    const results = [];

    for (const member of members) {
        const kd = getPlayerKD(member.discord_id, sinceDate);
        if (kd.frags > 0 || kd.deaths > 0) {
            results.push({ discordId: member.discord_id, charName: member.char_name, bomba: member.bomba, ...kd });
        }
    }

    results.sort((a, b) => {
        // Primary: K/D ratio desc; secondary: frags desc
        if (b.kd !== a.kd) return b.kd - a.kd;
        return b.frags - a.frags;
    });

    return results.slice(0, limit);
}

// Total frags for a player counting both main and bomba
function getTotalFragsForPlayer(discordId) {
    const guildId = getGuildIdContext();
    const member = db.prepare('SELECT char_name, bomba FROM registered_members WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId);
    if (!member) return 0;
    const charNames = [member.char_name];
    const bomba = member.bomba;
    const hasBomba = bomba && bomba !== '-' && bomba.toLowerCase() !== 'none' && bomba.toLowerCase() !== 'nenhum';
    if (hasBomba) charNames.push(bomba);
    const row = db.prepare(
        `SELECT COUNT(*) as count FROM frags WHERE ${charNames.map(() => 'LOWER(killer_name) = LOWER(?)').join(' OR ')}`
    ).get(...charNames);
    return row ? row.count : 0;
}

// Total voice time for a player (all time)
function getTotalVoiceTimeMs(discordId) {
    const now = Date.now();
    const rowFinished = db.prepare('SELECT SUM(end_time - start_time) as total FROM voice_sessions WHERE discord_id = ? AND end_time IS NOT NULL').get(discordId);
    const rowOpen = db.prepare('SELECT SUM(? - start_time) as total FROM voice_sessions WHERE discord_id = ? AND end_time IS NULL').get(now, discordId);
    return (rowFinished?.total || 0) + (rowOpen?.total || 0);
}

// ─── Tickets ──────────────────────────────────────────────────────────────────
function createTicket(channelId, userId) {
    db.prepare('INSERT INTO tickets (channel_id, user_id, status, created_at) VALUES (?, ?, ?, ?)')
        .run(channelId, userId, 'open', Date.now());
}

function getActiveTicketByUser(userId) {
    return db.prepare("SELECT * FROM tickets WHERE user_id = ? AND status = 'open'").get(userId);
}

function getTicketByChannel(channelId) {
    return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId);
}

function claimTicket(channelId, staffId) {
    db.prepare("UPDATE tickets SET claimed_by = ? WHERE channel_id = ?").run(staffId, channelId);
}

function closeTicket(channelId) {
    db.prepare("UPDATE tickets SET status = 'closed' WHERE channel_id = ?").run(channelId);
}

function reopenTicket(channelId) {
    db.prepare("UPDATE tickets SET status = 'open' WHERE channel_id = ?").run(channelId);
}

function deleteTicket(channelId) {
    db.prepare("DELETE FROM tickets WHERE channel_id = ?").run(channelId);
}

// ─── Planilhados ──────────────────────────────────────────────────────────────
function createScheduleRequest(respawnId, timeSlot, leaderId, memberIds) {
    const info = db.prepare(`
        INSERT INTO hunts_schedule_requests (respawn_id, time_slot, leader_discord_id, member_ids, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(respawnId, timeSlot, leaderId, memberIds, Date.now());
    return info.lastInsertRowid;
}

function getScheduleRequest(id) {
    return db.prepare('SELECT * FROM hunts_schedule_requests WHERE id = ?').get(id);
}

function updateScheduleRequestStatus(id, status) {
    db.prepare('UPDATE hunts_schedule_requests SET status = ? WHERE id = ?').run(status, id);
}

function createSchedule(respawnId, timeSlot, leaderId, memberIds, active = 1) {
    const info = db.prepare(`
        INSERT INTO hunts_schedule (respawn_id, time_slot, leader_discord_id, member_ids, active, last_active_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(respawnId, timeSlot, leaderId, memberIds, active, Date.now(), Date.now());
    return info.lastInsertRowid;
}

function getActiveSchedules() {
    return db.prepare('SELECT * FROM hunts_schedule WHERE active = 1').all();
}

function getAllSchedules() {
    return db.prepare('SELECT * FROM hunts_schedule ORDER BY respawn_id, time_slot').all();
}

function getSchedulesByRespawnAndSlot(respawnId, timeSlot) {
    return db.prepare('SELECT * FROM hunts_schedule WHERE LOWER(respawn_id) = LOWER(?) AND time_slot = ?').all(respawnId, timeSlot);
}

function getActiveSchedulesByLeader(leaderId) {
    return db.prepare('SELECT * FROM hunts_schedule WHERE leader_discord_id = ? AND active = 1').all(leaderId);
}

function getActiveScheduleByRespawnAndSlot(respawnId, timeSlot) {
    return db.prepare('SELECT * FROM hunts_schedule WHERE LOWER(respawn_id) = LOWER(?) AND time_slot = ? AND active = 1').get(respawnId, timeSlot);
}

function markAttendance(scheduleId, date) {
    db.prepare(`
        INSERT INTO hunts_schedule_attendance (schedule_id, date, checked_in, checked_in_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(schedule_id, date) DO UPDATE SET
            checked_in = 1,
            checked_in_at = excluded.checked_in_at
    `).run(scheduleId, date, Date.now());
}

function getAttendance(scheduleId, date) {
    return db.prepare('SELECT * FROM hunts_schedule_attendance WHERE schedule_id = ? AND date = ?').get(scheduleId, date);
}

function deactivateSchedule(id) {
    db.prepare('UPDATE hunts_schedule SET active = 0 WHERE id = ?').run(id);
}

function activateSchedule(id) {
    db.prepare('UPDATE hunts_schedule SET active = 1, last_active_at = ? WHERE id = ?').run(Date.now(), id);
}

function deleteSchedule(id) {
    db.prepare('DELETE FROM hunts_schedule WHERE id = ?').run(id);
    db.prepare('DELETE FROM hunts_schedule_attendance WHERE schedule_id = ?').run(id);
}

function addBounty(targetName, reward, createdBy) {
    db.prepare('INSERT INTO bounties (target_name, reward, created_by, created_at) VALUES (?, ?, ?, ?)').run(targetName, reward, createdBy, Date.now());
}

function getActiveBounties() {
    return db.prepare('SELECT * FROM bounties WHERE status = "active"').all();
}

function getBountyByTarget(targetName) {
    return db.prepare('SELECT * FROM bounties WHERE LOWER(target_name) = LOWER(?) AND status = "active"').get(targetName);
}

function claimBounty(id, claimedBy, claimedByChar) {
    db.prepare('UPDATE bounties SET status = "claimed", claimed_by = ?, claimed_by_char = ?, claimed_at = ? WHERE id = ?').run(claimedBy, claimedByChar, Date.now(), id);
}

function cancelBounty(id) {
    db.prepare('UPDATE bounties SET status = "canceled" WHERE id = ?').run(id);
}

function addTaxPayment(discordId, charName, cycleStart, amount, proofUrl) {
    const info = db.prepare('INSERT INTO guild_taxes (discord_id, char_name, cycle_start_at, amount, proof_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(discordId, charName, cycleStart, amount, proofUrl, 'submitted', Date.now());
    return info.lastInsertRowid;
}

function getTaxPayment(id) {
    return db.prepare('SELECT * FROM guild_taxes WHERE id = ?').get(id);
}

function updateTaxStatus(id, status, verifiedBy) {
    db.prepare('UPDATE guild_taxes SET status = ?, verified_by = ?, verified_at = ? WHERE id = ?').run(status, verifiedBy, Date.now(), id);
}

function getPaidMembersForCycle(cycleStart) {
    return db.prepare('SELECT * FROM guild_taxes WHERE cycle_start_at = ? AND status = \'paid\'').all(cycleStart);
}

function getPendingMembersForCycle(cycleStart) {
    const guildId = getGuildIdContext();
    return db.prepare(`
        SELECT rm.* 
        FROM registered_members rm
        WHERE rm.guild_id = ? AND rm.discord_id NOT IN (
            SELECT gt.discord_id 
            FROM guild_taxes gt 
            WHERE gt.cycle_start_at = ? AND gt.status = 'paid'
        )
    `).all(guildId, cycleStart);
}

function addDebt(debtorId, creditorId, amount, description) {
    const info = db.prepare(`
        INSERT INTO guild_debts (debtor_id, creditor_id, amount, description, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(debtorId, creditorId, amount, description || null, Date.now());
    return info.lastInsertRowid;
}

function getDebt(id) {
    return db.prepare('SELECT * FROM guild_debts WHERE id = ?').get(id);
}

function getPendingDebtsForUser(discordId) {
    return db.prepare(`
        SELECT * FROM guild_debts 
        WHERE (debtor_id = ? OR creditor_id = ?) AND status = 'pending'
        ORDER BY created_at DESC
    `).all(discordId, discordId);
}

function settleDebtsBetween(debtorId, creditorId) {
    db.prepare(`
        UPDATE guild_debts 
        SET status = 'settled', settled_at = ? 
        WHERE debtor_id = ? AND creditor_id = ? AND status = 'pending'
    `).run(Date.now(), debtorId, creditorId);
}

function settleDebtById(id) {
    db.prepare(`
        UPDATE guild_debts 
        SET status = 'settled', settled_at = ? 
        WHERE id = ?
    `).run(Date.now(), id);
}

// --- Gamificação e Economia (Ascended Coins - AC) ---

function addCoins(discordId, amount) {
    const guildId = getGuildIdContext();
    db.prepare('UPDATE registered_members SET coins = coins + ? WHERE discord_id = ? AND guild_id = ?').run(amount, discordId, guildId);
}

function removeCoins(discordId, amount) {
    const guildId = getGuildIdContext();
    db.prepare(`
        UPDATE registered_members 
        SET coins = CASE WHEN coins - ? < 0 THEN 0.0 ELSE coins - ? END 
        WHERE discord_id = ? AND guild_id = ?
    `).run(amount, amount, discordId, guildId);
}

function awardCoinsByCharName(charName, amount) {
    const guildId = getGuildIdContext();
    const member = db.prepare('SELECT discord_id FROM registered_members WHERE (LOWER(char_name) = LOWER(?) OR LOWER(bomba) = LOWER(?)) AND guild_id = ?').get(charName, charName, guildId);
    if (member) {
        addCoins(member.discord_id, amount);
        return member.discord_id;
    }
    return null;
}

function createRaffle(title, ticketCost, endsAt, createdBy, channelId, messageId) {
    const info = db.prepare(`
        INSERT INTO raffles (title, ticket_cost, ends_at, status, created_by, channel_id, message_id, created_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(title, ticketCost, endsAt, createdBy, channelId, messageId, Date.now());
    return info.lastInsertRowid;
}

function getRaffle(id) {
    return db.prepare('SELECT * FROM raffles WHERE id = ?').get(id);
}

// Keep consistent
function getActiveRaffles() {
    return db.prepare("SELECT * FROM raffles WHERE status = 'active'").all();
}

function buyRaffleTicket(raffleId, discordId, cost) {
    const guildId = getGuildIdContext();
    const transaction = db.transaction(() => {
        const member = db.prepare('SELECT coins FROM registered_members WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId);
        if (!member || member.coins < cost) {
            throw new Error('insufficient_coins');
        }

        // Deduct coins
        db.prepare('UPDATE registered_members SET coins = coins - ? WHERE discord_id = ? AND guild_id = ?').run(cost, discordId, guildId);

        // Add ticket
        const info = db.prepare(`
            INSERT INTO raffle_tickets (raffle_id, discord_id, created_at)
            VALUES (?, ?, ?)
        `).run(raffleId, discordId, Date.now());
        return info.lastInsertRowid;
    });
    return transaction();
}

function getRaffleTickets(raffleId) {
    return db.prepare('SELECT * FROM raffle_tickets WHERE raffle_id = ?').all(raffleId);
}

function finishRaffle(raffleId, winnerId, winnerTicketId) {
    db.prepare(`
        UPDATE raffles 
        SET status = 'finished', winner_id = ?, winner_ticket_id = ? 
        WHERE id = ?
    `).run(winnerId, winnerTicketId, raffleId);
}

function addShopRole(discordId, roleId, durationMs) {
    const expiresAt = Date.now() + durationMs;
    db.prepare(`
        INSERT INTO member_shop_roles (discord_id, role_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
    `).run(discordId, roleId, expiresAt, Date.now());
}

function getExpiredShopRoles() {
    return db.prepare('SELECT * FROM member_shop_roles WHERE expires_at <= ?').all(Date.now());
}

function deleteShopRole(id) {
    db.prepare('DELETE FROM member_shop_roles WHERE id = ?').run(id);
}

function getInventory(discordId) {
    return db.prepare('SELECT * FROM member_inventory WHERE discord_id = ?').all(discordId);
}

function getInventoryItemQuantity(discordId, itemId) {
    const row = db.prepare('SELECT quantity FROM member_inventory WHERE discord_id = ? AND item_id = ?').get(discordId, itemId);
    return row ? row.quantity : 0;
}

function addInventoryItem(discordId, itemId, qty = 1) {
    const existing = db.prepare('SELECT id, quantity FROM member_inventory WHERE discord_id = ? AND item_id = ?').get(discordId, itemId);
    if (existing) {
        db.prepare('UPDATE member_inventory SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
    } else {
        db.prepare('INSERT INTO member_inventory (discord_id, item_id, quantity, created_at) VALUES (?, ?, ?, ?)').run(discordId, itemId, qty, Date.now());
    }
}

function removeInventoryItem(discordId, itemId, qty = 1) {
    const existing = db.prepare('SELECT id, quantity FROM member_inventory WHERE discord_id = ? AND item_id = ?').get(discordId, itemId);
    if (existing) {
        const newQty = Math.max(0, existing.quantity - qty);
        if (newQty === 0) {
            db.prepare('DELETE FROM member_inventory WHERE id = ?').run(existing.id);
        } else {
            db.prepare('UPDATE member_inventory SET quantity = ? WHERE id = ?').run(newQty, existing.id);
        }
    }
}


// --- INVASION STATS ---
function addInvasionDamage(discordId, charName, damage) {
    const existing = db.prepare('SELECT * FROM invasion_stats WHERE discord_id = ?').get(discordId);
    if (existing) {
        db.prepare('UPDATE invasion_stats SET total_damage = total_damage + ?, invasions_participated = invasions_participated + 1, char_name = ? WHERE discord_id = ?')
            .run(damage, charName, discordId);
    } else {
        db.prepare('INSERT INTO invasion_stats (discord_id, char_name, total_damage, invasions_participated) VALUES (?, ?, ?, 1)')
            .run(discordId, charName, damage);
    }
}

function getInvasionRanking(limit = 10) {
    return db.prepare('SELECT * FROM invasion_stats ORDER BY total_damage DESC LIMIT ?').all(limit);
}


// --- HP AND DEATH MECHANICS ---
function updateHp(discordId, hp) {
    db.prepare('UPDATE rpg_characters SET current_hp = ? WHERE discord_id = ?').run(hp, discordId);
}

function handleDeath(discordId) {
    const char = getRpgCharacter(discordId);
    if (!char) return null;

    // Remove 5% of total XP
    const penalty = Math.floor(char.xp * 0.05);
    let newXp = Math.max(0, char.xp - penalty);
    
    // Check if level dropped
    const getLevelFromXp = (xp) => {
        let l = 1;
        while (l < 500) {
            const nextXp = Math.floor(100 * Math.pow(l, 1.5));
            if (xp < nextXp) break;
            l++;
        }
        return l;
    };
    
    const newLevel = getLevelFromXp(newXp);
    
    db.prepare('UPDATE rpg_characters SET xp = ?, level = ?, current_hp = 0, death_time = ? WHERE discord_id = ?')
        .run(newXp, newLevel, Date.now(), discordId);
        
    return { xpLost: penalty, levelDropped: newLevel < char.level ? newLevel : false };
}


// --- MATERIALS CRAFTING ---
function getMaterials(discordId) {
    return db.prepare('SELECT material_id, quantity FROM player_materials WHERE discord_id = ? AND quantity > 0').all(discordId);
}

function getMaterialQty(discordId, materialId) {
    const row = db.prepare('SELECT quantity FROM player_materials WHERE discord_id = ? AND material_id = ?').get(discordId, materialId);
    return row ? row.quantity : 0;
}

function addMaterial(discordId, materialId, quantity) {
    const existing = db.prepare('SELECT id, quantity FROM player_materials WHERE discord_id = ? AND material_id = ?').get(discordId, materialId);
    if (existing) {
        db.prepare('UPDATE player_materials SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
    } else {
        db.prepare('INSERT INTO player_materials (discord_id, material_id, quantity) VALUES (?, ?, ?)').run(discordId, materialId, quantity);
    }
}

function removeMaterial(discordId, materialId, quantity) {
    const existing = db.prepare('SELECT id, quantity FROM player_materials WHERE discord_id = ? AND material_id = ?').get(discordId, materialId);
    if (existing && existing.quantity >= quantity) {
        db.prepare('UPDATE player_materials SET quantity = quantity - ? WHERE id = ?').run(quantity, existing.id);
        return true;
    }
    return false;
}

function updateStamina(discordId, staminaAmount) {
    db.prepare('UPDATE rpg_characters SET stamina = ? WHERE discord_id = ?').run(staminaAmount, discordId);
}

// --- PETS & EGGS ---
function addEgg(discordId, rarity) {
    db.prepare('INSERT INTO player_eggs (discord_id, rarity) VALUES (?, ?)').run(discordId, rarity);
}

function getEggs(discordId) {
    return db.prepare('SELECT id, rarity FROM player_eggs WHERE discord_id = ?').all(discordId);
}

function removeEgg(id) {
    db.prepare('DELETE FROM player_eggs WHERE id = ?').run(id);
}

function addPet(discordId, petId) {
    // Se não tiver pet, o primeiro já vem ativo
    const hasPets = db.prepare('SELECT COUNT(*) as c FROM player_pets WHERE discord_id = ?').get(discordId).c > 0;
    const isActive = hasPets ? 0 : 1;
    db.prepare('INSERT INTO player_pets (discord_id, pet_id, is_active) VALUES (?, ?, ?)').run(discordId, petId, isActive);
}

function getPets(discordId) {
    return db.prepare('SELECT id, pet_id, is_active FROM player_pets WHERE discord_id = ?').all(discordId);
}

function getActivePet(discordId) {
    return db.prepare('SELECT id, pet_id, level, xp FROM player_pets WHERE discord_id = ? AND is_active = 1').get(discordId);
}

function addPetXp(discordId, amount) {
    const active = getActivePet(discordId);
    if (!active) return null;
    
    let newXp = (active.xp || 0) + amount;
    let newLevel = active.level || 1;
    let leveledUp = false;
    
    // Very simple XP curve: 50 * level
    let xpForNext = 50 * newLevel;
    while (newXp >= xpForNext && newLevel < 20) {
        newXp -= xpForNext;
        newLevel++;
        xpForNext = 50 * newLevel;
        leveledUp = true;
    }
    
    db.prepare('UPDATE player_pets SET xp = ?, level = ? WHERE id = ?').run(newXp, newLevel, active.id);
    return { petId: active.pet_id, oldLevel: active.level, newLevel: newLevel, leveledUp };
}

function setActivePet(discordId, petIdToActivate) {
    // Desativa todos
    db.prepare('UPDATE player_pets SET is_active = 0 WHERE discord_id = ?').run(discordId);
    // Ativa o selecionado
    db.prepare('UPDATE player_pets SET is_active = 1 WHERE discord_id = ? AND pet_id = ?').run(discordId, petIdToActivate);
}

function getPlayerMaxHp(char) {
    if (!char) return 100;
    let baseHp = (char.level || 1) * 50 + 100;
    if (char.vocation === 'Cavaleiro') baseHp = Math.floor(baseHp * 1.20);
    if (char.vocation === 'Mago') baseHp = Math.floor(baseHp * 0.80);
    return baseHp;
}

function getDailyQuests(discordId) {
    return db.prepare('SELECT * FROM daily_quests WHERE discord_id = ?').all(discordId);
}

function generateDailyQuests(discordId) {
    db.prepare('DELETE FROM daily_quests WHERE discord_id = ?').run(discordId);
    
    // Sortear 3 missões distintas
    const types = ['hunt', 'duel', 'tax'];
    const questsToInsert = [];
    
    types.forEach(type => {
        let goal = 1;
        let reward = 500;
        let target = null;
        
        if (type === 'hunt') {
            goal = Math.floor(Math.random() * 10) + 10; // 10 a 20 hunts
            reward = goal * 150;
        } else if (type === 'duel') {
            goal = Math.floor(Math.random() * 3) + 2; // 2 a 4 duelos
            reward = goal * 300;
        } else if (type === 'tax') {
            goal = 1;
            reward = 1000;
        }
        
        db.prepare('INSERT INTO daily_quests (discord_id, quest_type, target, goal, reward_ac) VALUES (?, ?, ?, ?, ?)').run(discordId, type, target, goal, reward);
    });

    return getDailyQuests(discordId);
}

function progressQuest(discordId, type, amount = 1) {
    const quests = getDailyQuests(discordId);
    if (!quests || quests.length === 0) return false;
    
    let progressed = false;
    quests.forEach(quest => {
        if (quest.completed === 0 && quest.quest_type === type && quest.progress < quest.goal) {
            quest.progress += amount;
            if (quest.progress >= quest.goal) {
                quest.progress = quest.goal;
            }
            db.prepare('UPDATE daily_quests SET progress = ? WHERE id = ?').run(quest.progress, quest.id);
            progressed = true;
        }
    });
    return progressed;
}

function completeQuests(discordId) {
    const quests = getDailyQuests(discordId);
    let totalReward = 0;
    
    quests.forEach(quest => {
        if (quest.progress >= quest.goal && quest.completed === 0) {
            db.prepare('UPDATE daily_quests SET completed = 1 WHERE id = ?').run(quest.id);
            totalReward += quest.reward_ac;
        }
    });
    
    if (totalReward > 0) {
        const addCoins = require('./database').addCoins; // Self ref
        if (addCoins) addCoins(discordId, totalReward);
        // Extra reward if all are completed
        const allCompleted = getDailyQuests(discordId).every(q => q.completed === 1);
        if (allCompleted) {
            db.prepare('DELETE FROM daily_quests WHERE discord_id = ?').run(discordId); // Reset to force a new board next day
        }
        return totalReward;
    }
    return 0;
}
module.exports = {
    getDailyQuests,
    generateDailyQuests,
    progressQuest,
    completeQuests,
    getPlayerMaxHp,
    db,
    addCityDamage,
    updateHp,
    getMaterials,
    getMaterialQty,
    addMaterial,
    addEgg,
    getEggs,
    removeEgg,
    addPet,
    getPets,
    getActivePet,
    setActivePet,
    addPetXp,
    removeMaterial,
    updateStamina,
    handleDeath,
    addInvasionDamage,
    getInvasionRanking,
    addGuildXp,
    incrementVoiceTimeStats,
    getInventory,
    getInventoryItemQuantity,
    addInventoryItem,
    removeInventoryItem,
    addCoins,
    removeCoins,
    awardCoinsByCharName,
    createRaffle,
    getRaffle,
    getActiveRaffles,
    buyRaffleTicket,
    getRaffleTickets,
    finishRaffle,
    addShopRole,
    getExpiredShopRoles,
    deleteShopRole,
    addTaxPayment,
    getTaxPayment,
    updateTaxStatus,
    getPaidMembersForCycle,
    getPendingMembersForCycle,
    addDebt,
    getDebt,
    getPendingDebtsForUser,
    settleDebtsBetween,
    settleDebtById,
    addBounty,
    getActiveBounties,
    getBountyByTarget,
    claimBounty,
    cancelBounty,
    getConfig,
    setConfig,
    loadAllConfig,
    addGuild,
    removeGuild,
    clearGuildAllData,
    getActiveGuilds,
    getGuildConfig,
    setGuildConfig,
    getGuildConfigMerged,
    createTicket,
    getActiveTicketByUser,
    getTicketByChannel,
    claimTicket,
    closeTicket,
    reopenTicket,
    deleteTicket,
    createScheduleRequest,
    getScheduleRequest,
    updateScheduleRequestStatus,
    createSchedule,
    getActiveSchedules,
    getAllSchedules,
    getSchedulesByRespawnAndSlot,
    getActiveSchedulesByLeader,
    getActiveScheduleByRespawnAndSlot,
    markAttendance,
    getAttendance,
    deactivateSchedule,
    activateSchedule,
    deleteSchedule,
    insertDeath,
    getDeathsForDate,
    getAllDeaths,
    insertFrag,
    getFragsForDate,
    getAllFrags,
    upsertDailyStats,
    getDailyStatsForDate,
    addHunted,
    removeHunted,
    getHuntedList,
    getHuntedEntry,
    getActiveClaims,
    getClaimByPlayer,
    getClaimByRespawn,
    insertClaim,
    deleteClaim,
    deleteClaimByPlayer,
    extendClaim,
    getQueue,
    getPlayerQueue,
    addToQueue,
    removeFromQueue,
    clearQueue,
    clearPlayerQueues,
    getNextInQueue,
    addBossCooldown,
    getActiveBossCooldowns,
    getPendingBossNotifications,
    markBossNotified,
    addTempVoiceChannel,
    isTempVoiceChannel,
    deleteTempVoiceChannel,
    getAllTempVoiceChannels,
    addRegisteredMember,
    getRegisteredMember,
    getAllRegisteredMembers,
    deleteRegisteredMember,
    insertParty,
    updateParty,
    getParty,
    getPartyByMessage,
    deleteParty,
    todayDate,
    updateLastSeen,
    getLastSeen,
    getAllLastSeen,
    // Voice Presence and Massivo stats
    startVoiceSession,
    endVoiceSession,
    getVoiceTimeMs,
    incrementMassivoIgnored,
    incrementMassivoLogoffs,
    getMassivoEvasion,
    getAllMassivoEvasions,
    getGameOnlineTimeMs,
    dateDaysAgo,
    getTopFraggedPlayer,
    getTopVoicePlayer,
    getTopXpPlayer,
    // Registration History
    insertRegistrationHistory,
    getRegistrationHistory,
    getRegistrationHistoryByDiscordId,
    // Achievements
    hasAchievement,
    unlockAchievement,
    getPlayerAchievements,
    getAchievementsUnlockedSince,
    // Player Levels
    getPlayerLevel,
    upsertPlayerLevel,
    // K/D
    getPlayerKD,
    getTopKDPlayers,
    getTotalFragsForPlayer,
    getTotalVoiceTimeMs,
    createRpgCharacter,
    getRpgCharacter,
    getRpgCharacterByNickname,
    addRpgXp,
    updateRpgDuelStats,
    updateRpgEquipment,
};

// ─── Voice Presence & Evasion Implementations ─────────────────────────────────
function startVoiceSession(discordId) {
    // End any open session first
    db.prepare('UPDATE voice_sessions SET end_time = ? WHERE discord_id = ? AND end_time IS NULL').run(Date.now(), discordId);
    // Insert new session
    db.prepare('INSERT INTO voice_sessions (discord_id, start_time, end_time) VALUES (?, ?, NULL)').run(discordId, Date.now());
}

function endVoiceSession(discordId) {
    db.prepare('UPDATE voice_sessions SET end_time = ? WHERE discord_id = ? AND end_time IS NULL').run(Date.now(), discordId);
}

function getVoiceTimeMs(discordId, sinceTimestamp) {
    const now = Date.now();
    // Sum of finished sessions
    const rowFinished = db.prepare('SELECT SUM(end_time - start_time) as total FROM voice_sessions WHERE discord_id = ? AND start_time >= ? AND end_time IS NOT NULL').get(discordId, sinceTimestamp);
    // Duration of open session
    const rowOpen = db.prepare('SELECT SUM(? - start_time) as total FROM voice_sessions WHERE discord_id = ? AND start_time >= ? AND end_time IS NULL').get(now, discordId, sinceTimestamp);
    
    const finishedMs = rowFinished && rowFinished.total ? rowFinished.total : 0;
    const openMs = rowOpen && rowOpen.total ? rowOpen.total : 0;
    return finishedMs + openMs;
}

function incrementMassivoIgnored(discordId, charName, ms) {
    db.prepare(`
        INSERT INTO massivo_evasions (discord_id, char_name, ignored_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            ignored_ms = ignored_ms + excluded.ignored_ms
    `).run(discordId, charName, ms);
}

function incrementMassivoLogoffs(discordId, charName) {
    db.prepare(`
        INSERT INTO massivo_evasions (discord_id, char_name, logoffs)
        VALUES (?, ?, 1)
        ON CONFLICT(discord_id) DO UPDATE SET
            logoffs = logoffs + 1
    `).run(discordId, charName);
}

function getMassivoEvasion(discordId) {
    return db.prepare('SELECT * FROM massivo_evasions WHERE discord_id = ?').get(discordId);
}

function getAllMassivoEvasions() {
    return db.prepare('SELECT * FROM massivo_evasions').all();
}

function getGameOnlineTimeMs(charName, sinceDate) {
    const row = db.prepare('SELECT SUM(online_ms) as total FROM daily_stats WHERE LOWER(name) = LOWER(?) AND date >= ?').get(charName, sinceDate);
    return row && row.total ? row.total : 0;
}

function dateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function getTopFraggedPlayer(sinceDate) {
    const guildId = getGuildIdContext();
    const row = db.prepare(`
        SELECT rm.discord_id, COUNT(*) as count 
        FROM frags f
        JOIN registered_members rm ON LOWER(f.killer_name) = LOWER(rm.char_name) AND rm.guild_id = ?
        WHERE f.date >= ?
        GROUP BY rm.discord_id
        ORDER BY count DESC
        LIMIT 1
    `).get(guildId, sinceDate);
    return row ? row.discord_id : null;
}

function getTopVoicePlayer(sinceTimestamp) {
    const now = Date.now();
    const guildId = getGuildIdContext();
    const row = db.prepare(`
        SELECT rm.discord_id, 
               SUM(CASE WHEN vs.end_time IS NOT NULL THEN (vs.end_time - vs.start_time) ELSE (? - vs.start_time) END) as total_duration
        FROM voice_sessions vs
        JOIN registered_members rm ON vs.discord_id = rm.discord_id AND rm.guild_id = ?
        WHERE vs.start_time >= ?
        GROUP BY rm.discord_id
        ORDER BY total_duration DESC
        LIMIT 1
    `).get(now, guildId, sinceTimestamp);
    return row ? row.discord_id : null;
}

function getTopXpPlayer(sinceDate) {
    const guildId = getGuildIdContext();
    const row = db.prepare(`
        SELECT rm.discord_id, SUM(ds.gain_xp) as total_xp
        FROM daily_stats ds
        JOIN registered_members rm ON LOWER(ds.name) = LOWER(rm.char_name) AND rm.guild_id = ?
        WHERE ds.date >= ? AND ds.gain_xp > 0
        GROUP BY rm.discord_id
        ORDER BY total_xp DESC
        LIMIT 1
    `).get(guildId, sinceDate);
    return row ? row.discord_id : null;
}

function addGuildXp(discordId, amount, guild) {
    const guildId = getGuildIdContext();
    const member = db.prepare('SELECT guild_xp, guild_level, char_name FROM registered_members WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId);
    if (!member) return;
    
    const newXp = (member.guild_xp || 0) + amount;
    const newLevel = Math.max(1, Math.floor(0.1 * Math.sqrt(newXp)));
    const currentLevel = member.guild_level || 1;
    
    db.prepare('UPDATE registered_members SET guild_xp = ?, guild_level = ? WHERE discord_id = ? AND guild_id = ?').run(newXp, newLevel, discordId, guildId);
    
    if (newLevel > currentLevel) {
        // Level Up!
        try {
            const state = require('./state');
            const { EmbedBuilder } = require('discord.js');
            const cfg = loadAllConfig();
            
            const reportChannelId = cfg.reportChannelId || cfg.claimCommandsChannelId;
            if (reportChannelId && state._client) {
                state._client.channels.fetch(reportChannelId).then(channel => {
                    if (channel) {
                        const embed = new EmbedBuilder()
                            .setColor(0x3498DB) // Blue
                            .setTitle('🎉 SUBIU DE NÍVEL!')
                            .setDescription(`Parabéns, <@${discordId}> (**${member.char_name}**) alcançou o **Nível ${newLevel}** de atividade na guilda!\n\n✨ **Bônus de AC:** \`+${((newLevel - 1) * 2)}%\` extra em calls!`)
                            .setFooter({ text: 'Ascended Bot • Nível de Atividade' })
                            .setTimestamp();
                        channel.send({ content: `<@${discordId}>`, embeds: [embed] }).catch(() => {});
                    }
                }).catch(() => {});
            }
        } catch (err) {
            console.error('[Database] Erro ao anunciar level up:', err.message);
        }
    }
}

function incrementVoiceTimeStats(discordId, isWar, isNight) {
    const guildId = getGuildIdContext();
    db.prepare(`
        UPDATE registered_members 
        SET total_voice_mins = total_voice_mins + 1,
            total_voice_war_mins = total_voice_war_mins + (CASE WHEN ? = 1 THEN 1 ELSE 0 END),
            night_voice_mins = night_voice_mins + (CASE WHEN ? = 1 THEN 1 ELSE 0 END)
        WHERE discord_id = ? AND guild_id = ?
    `).run(isWar ? 1 : 0, isNight ? 1 : 0, discordId, guildId);
}

// ─── RPG Minigame Helpers ────────────────────────────────────────────────────
function createRpgCharacter({ discordId, nickname, classCode, gender }) {
    db.prepare(`
        INSERT INTO rpg_characters (discord_id, nickname, class_code, gender, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(discordId, nickname, classCode, gender, Date.now());
}

function getRpgCharacter(discordId) {
    return db.prepare('SELECT * FROM rpg_characters WHERE discord_id = ?').get(discordId);
}

function getRpgCharacterByNickname(nickname) {
    return db.prepare('SELECT * FROM rpg_characters WHERE LOWER(nickname) = LOWER(?)').get(nickname);
}

function addRpgXp(discordId, amount) {
    const char = getRpgCharacter(discordId);
    if (!char) return null;

    let newXp = (char.xp || 0) + amount;
    let level = char.level || 1;
    let leveledUp = false;

    // Formula: XP needed for next level is Level * 100
    while (true) {
        const xpNeeded = level * 100;
        if (newXp >= xpNeeded) {
            newXp -= xpNeeded;
            level++;
            leveledUp = true;
        } else {
            break;
        }
    }

    db.prepare('UPDATE rpg_characters SET xp = ?, level = ? WHERE discord_id = ?').run(newXp, level, discordId);
    return { level, leveledUp };
}

function updateRpgDuelStats(discordId, isWin) {
    const char = getRpgCharacter(discordId);
    if (!char) return;

    if (isWin) {
        const newStreak = (char.streak || 0) + 1;
        db.prepare('UPDATE rpg_characters SET wins = wins + 1, streak = ? WHERE discord_id = ?').run(newStreak, discordId);
    } else {
        db.prepare('UPDATE rpg_characters SET losses = losses + 1, streak = 0 WHERE discord_id = ?').run(discordId);
    }
}

function updateRpgEquipment(discordId, slot, itemId) {
    const validSlots = ['weapon', 'shield', 'armor', 'amulet'];
    if (!validSlots.includes(slot)) throw new Error('Slot inválido');
    db.prepare(`UPDATE rpg_characters SET equipped_${slot} = ? WHERE discord_id = ?`).run(itemId || null, discordId);
}

function addCityDamage(discordId, amount) {
    try {
        db.prepare('UPDATE rpg_characters SET city_damage = city_damage + ? WHERE discord_id = ?').run(amount, discordId);
    } catch (err) {
        console.error('[DB] Erro ao addCityDamage:', err.message);
    }
}
