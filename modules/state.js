'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const guildLocalStorage = new AsyncLocalStorage();

/**
 * state.js — Estado global compartilhado com suporte multi-guilda dinâmico
 */
const state = {
    // ── Propriedades globais não-guilda ───────────────────────────────────────
    whatsappPairingCode: null,
    rpgMinigameEnabled : false,
    _client            : null,
    scraperPaused      : false,
    lastResetDate      : '',

    // ── Repositório de estados por guilda ────────────────────────────────────
    guilds: {},
    getGuildState(guildId) {
        if (!guildId) return this;
        if (!this.guilds[guildId]) {
            this.guilds[guildId] = {
                guildMembers: [],
                trackedPlayers: {},
                playerGuildCache: {},
                lastSeenMap: {},
                leftVoiceMap: {},
                dailyStats: {},
                hourlyActivityStats: {},
                playerHourlyActivity: {},
                dailyDeaths: [],
                dailyFrags: [],
                huntedList: [],
                huntedOnlineAlerted: new Set(),
                enemyGuildMembers: [],
                trackedEnemyPlayers: {},
                enemyOnlineStatus: {},
                warMode: false,
                warAlerted: new Set(),
                warXp: {},
                roletaActive: false,
                roletaChannelId: null,
                roletaTarget: null,
                isMassivoActive: false,
                activeBoss: null,
                activeInvasion: null,
                isFirstDeathScrape: true,
                processedDeaths: new Set()
            };
        }
        return this.guilds[guildId];
    },

    // ── Fallbacks originais (usados quando fora do contexto de guilda) ─────────
    _guildMembers    : [],
    _trackedPlayers  : {},
    _playerGuildCache: {},
    _lastSeenMap     : {},
    _leftVoiceMap    : {},
    _dailyStats      : {},
    _hourlyActivityStats : {},
    _playerHourlyActivity: {},
    _dailyDeaths         : [],
    _dailyFrags          : [],
    _huntedList          : [],
    _huntedOnlineAlerted : new Set(),
    _enemyGuildMembers   : [],
    _trackedEnemyPlayers : {},
    _enemyOnlineStatus   : {},
    _warMode    : false,
    _warAlerted : new Set(),
    _warXp      : {},
    _roletaActive   : false,
    _roletaChannelId: null,
    _roletaTarget   : null,
    _isMassivoActive    : false,
    _activeBoss         : null,
    _activeInvasion     : null,
    _isFirstDeathScrape : true,
    _processedDeaths    : new Set()
};

// Define getters/setters dinâmicos para isolar propriedades por guilda
const guildProps = [
    'guildMembers', 'trackedPlayers', 'playerGuildCache', 'lastSeenMap', 'leftVoiceMap',
    'dailyStats', 'hourlyActivityStats', 'playerHourlyActivity', 'dailyDeaths', 'dailyFrags',
    'huntedList', 'huntedOnlineAlerted', 'enemyGuildMembers', 'trackedEnemyPlayers', 'enemyOnlineStatus',
    'warMode', 'warAlerted', 'warXp', 'roletaActive', 'roletaChannelId', 'roletaTarget',
    'isMassivoActive', 'activeBoss', 'activeInvasion', 'isFirstDeathScrape', 'processedDeaths'
];

guildProps.forEach(prop => {
    Object.defineProperty(state, prop, {
        get() {
            const store = guildLocalStorage.getStore();
            const guildId = store ? store.guildId : null;
            const targetState = state.getGuildState(guildId);
            if (!guildId) {
                return this['_' + prop];
            }
            return targetState[prop];
        },
        set(val) {
            const store = guildLocalStorage.getStore();
            const guildId = store ? store.guildId : null;
            const targetState = state.getGuildState(guildId);
            if (!guildId) {
                this['_' + prop] = val;
            } else {
                targetState[prop] = val;
            }
        },
        configurable: true,
        enumerable: true
    });
});

state.guildLocalStorage = guildLocalStorage;

module.exports = state;
