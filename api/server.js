const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('../modules/database');
const { RPG_PETS } = require('../modules/rpgPets');
const RPG_ITEMS = require('../modules/rpgItems');
const state = require('../modules/state');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../dashboard')));

// ──────────────────────────────────────────────
// GET /api/stats — Estatísticas gerais do servidor
// ──────────────────────────────────────────────
app.get('/api/stats', (_req, res) => {
    try {
        const totalPlayers = db.db.prepare('SELECT COUNT(*) as c FROM rpg_characters').get().c;
        const cycleRow = db.db.prepare("SELECT value FROM bot_config WHERE key = ?").get('taxCycleDate');

        res.json({
            players: totalPlayers,
            currentCycle: cycleRow ? cycleRow.value : 'Indefinido'
        });
    } catch (err) {
        console.error('[API /stats]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// GET /api/ranking — Top 10 heróis por XP
// ──────────────────────────────────────────────
app.get('/api/ranking', (_req, res) => {
    try {
        const topChars = db.db.prepare(
            'SELECT discord_id, nickname, level, xp, profession FROM rpg_characters ORDER BY xp DESC LIMIT 10'
        ).all();

        const result = topChars.map(char => {
            const member     = db.getRegisteredMember(char.discord_id);
            const activePet  = db.getActivePet(char.discord_id);
            let petData = null;

            if (activePet) {
                const def = RPG_PETS[activePet.pet_id];
                if (def) {
                    petData = {
                        id:     activePet.pet_id,
                        name:   def.name,
                        emoji:  def.emoji,
                        rarity: def.rarity,
                        desc:   def.desc,
                        level:  activePet.level || 1,
                        xp:     activePet.xp    || 0
                    };
                }
            }

            return {
                id:         char.discord_id,
                name:       char.nickname,
                char_name:  member ? member.char_name : '—',
                coins:      member ? member.coins      : 0,
                level:      char.level,
                xp:         char.xp,
                profession: char.profession,
                pet:        petData
            };
        });

        res.json(result);
    } catch (err) {
        console.error('[API /ranking]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// GET /api/player/:id — Perfil de jogador específico
// ──────────────────────────────────────────────
app.get('/api/player/:id', (req, res) => {
    try {
        const discordId = req.params.id;
        const char   = db.getRpgCharacter(discordId);
        const member = db.getRegisteredMember(discordId);

        if (!char || !member) return res.status(404).json({ error: 'Herói não encontrado.' });

        const activePet = db.getActivePet(discordId);
        const quests    = db.getDailyQuests(discordId);
        let petData = null;

        if (activePet) {
            const def = RPG_PETS[activePet.pet_id];
            if (def) petData = { ...def, level: activePet.level || 1, xp: activePet.xp || 0 };
        }

        const getEquipData = (itemId) => {
            if (!itemId) return null;
            const item = RPG_ITEMS[itemId];
            if (!item) return { id: itemId, name: itemId, type: 'unknown', atk: 0, def: 0 };
            return item;
        };

        res.json({
            name:       char.nickname,
            char_name:  member.char_name,
            coins:      member.coins,
            level:      char.level,
            xp:         char.xp,
            hp:         char.hp,
            max_hp:     db.getPlayerMaxHp(char),
            vocation:   char.vocation,
            profession: char.profession,
            wins:       char.wins,
            losses:     char.losses,
            pet:        petData,
            quests:     quests,
            equipment: {
                weapon: getEquipData(char.equipped_weapon),
                shield: getEquipData(char.equipped_shield),
                armor:  getEquipData(char.equipped_armor),
                amulet: getEquipData(char.equipped_amulet)
            }
        });
    } catch (err) {
        console.error('[API /player]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// GET /api/events — Eventos ativos (Boss / Invasão)
// ──────────────────────────────────────────────
app.get('/api/events', (_req, res) => {
    try {
        const activeBoss = state.activeBoss ? {
            name: state.activeBoss.name,
            hp: state.activeBoss.hp,
            maxHp: state.activeBoss.maxHp,
            players: Object.entries(state.activeBoss.players || {}).map(([id, p]) => ({
                id,
                name: p.name,
                damage: p.damage
            })).sort((a, b) => b.damage - a.damage).slice(0, 5)
        } : null;

        const activeInvasion = state.activeInvasion ? {
            name: state.activeInvasion.name,
            hp: state.activeInvasion.hp,
            maxHp: state.activeInvasion.maxHp,
            players: Object.entries(state.activeInvasion.players || {}).map(([id, p]) => ({
                id,
                name: p.name,
                damage: p.damage
            })).sort((a, b) => b.damage - a.damage).slice(0, 5)
        } : null;

        res.json({
            boss: activeBoss,
            invasion: activeInvasion
        });
    } catch (err) {
        console.error('[API /events]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// 404 fallback
// ──────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
});

function startServer(port = 3000) {
    app.listen(port, () => {
        console.log(`[Dashboard] ✅ API rodando em http://localhost:${port}`);
    });
}

module.exports = { startServer };
