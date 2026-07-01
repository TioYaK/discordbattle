'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('./database');

// ─── Cores temáticas ──────────────────────────────────────────────────────────
const COLORS = {
    GOLD    : 0xFFD700,
    RED     : 0xFF4444,
    GREEN   : 0x44FF88,
    BLUE    : 0x4488FF,
    PURPLE  : 0x9B59B6,
    ORANGE  : 0xFF8C00,
    DARK    : 0x2B2D31,
    GRAY    : 0x808080,
    WAR     : 0xC0392B,
    ASCENDED: 0x9B59B6,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const VOCATION_EMOJI = {
    'knight'              : '🗡️',
    'elite knight'        : '⚔️',
    'paladin'             : '🏹',
    'royal paladin'       : '🎯',
    'sorcerer'            : '🔮',
    'master sorcerer'     : '✨',
    'druid'               : '🌿',
    'elder druid'         : '🌳',
};

function vocEmoji(vocation = '') {
    const key = vocation.toLowerCase().trim();
    return VOCATION_EMOJI[key] || '⚡';
}

function formatXp(n) {
    if (typeof n !== 'number') return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString('pt-BR');
}

function formatElapsed(timestamp) {
    if (!timestamp) return 'nunca';
    const diff = Date.now() - timestamp;
    const m    = Math.floor(diff / 60000);
    if (m < 1)  return 'agora mesmo';
    if (m < 60) return `${m}m atrás`;
    const h    = Math.floor(m / 60);
    const mins = m % 60;
    if (h < 24) return `${h}h ${mins}m atrás`;
    const d = Math.floor(h / 24);
    return `${d}d ${Math.floor(h % 24)}h atrás`;
}

function footer() {
    return { text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' };
}

function extractGuildName(guildStr, playerName) {
    if (!guildStr) return 'Nenhuma';
    const state = require('./state');
    if (playerName && state.playerGuildCache[playerName]) {
        return state.playerGuildCache[playerName];
    }
    const lower = guildStr.toLowerCase();
    const markers = ['of the ', 'of ', 'da ', 'do ', 'de '];
    for (const marker of markers) {
        const idx = lower.indexOf(marker);
        if (idx !== -1) {
            return guildStr.slice(idx + marker.length).trim();
        }
    }
    return guildStr;
}

// ─── Embed: Personagem ────────────────────────────────────────────────────────
function buildPlayerEmbed(data) {
    const statusEmoji = data.status === 'Online' ? '🟢' : '🔴';
    const emoji       = vocEmoji(data.vocation);
    
    const lastSeenVal = data.status === 'Online' 
        ? '`Online agora`' 
        : (data.lastSeen ? `\`${formatElapsed(data.lastSeen)}\`` : '`nunca`');

    return new EmbedBuilder()
        .setColor(data.status === 'Online' ? COLORS.GREEN : COLORS.GRAY)
        .setTitle(`${emoji} ${data.name}`)
        .setURL(`https://rubinot.com.br/characters?name=${encodeURIComponent(data.name)}`)
        .addFields(
            { name: '📊 Level',    value: `\`${data.level}\``,    inline: true },
            { name: '⚡ Vocação',  value: `\`${data.vocation}\``, inline: true },
            { name: `${statusEmoji} Status`, value: `\`${data.status}\``, inline: true },
            { name: '🏰 Guilda',   value: `\`${extractGuildName(data.guild, data.name)}\``, inline: true },
            { name: '🌍 Mundo',    value: `\`${data.world || 'N/A'}\``,    inline: true },
            { name: '🕒 Última vez online', value: lastSeenVal, inline: true },
        )
        .setFooter(footer())
        .setTimestamp();
}

// Helper para limitar linhas e evitar erro de limite de tamanho de Embed do Discord (4096 caracteres)
function truncateOnlineLines(lines, totalCount) {
    let currentLength = 0;
    const acceptedLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (currentLength + line.length + 1 > 2500) {
            const remaining = totalCount - acceptedLines.length;
            acceptedLines.push(`*... e mais ${remaining} jogadores online.*`);
            break;
        }
        acceptedLines.push(line);
        currentLength += line.length + 1;
    }
    return acceptedLines.join('\n');
}

// ─── Embed: Online da Guilda ──────────────────────────────────────────────────
function buildOnlineEmbed(members, guildName, dailyStats = {}) {
    const online = members.filter(m => m.status === 'Online').sort((a, b) => b.level - a.level);

    if (!online.length) {
        return new EmbedBuilder()
            .setColor(COLORS.GRAY)
            .setTitle(`😴 ${guildName} — Ninguém Online`)
            .setDescription('Nenhum membro da guilda está online no momento.')
            .setFooter(footer())
            .setTimestamp();
    }

    const lines = online.map(m => {
        const xp  = dailyStats[m.name]?.dailyXp || 0;
        const xpStr = xp > 0 ? ` · +${formatXp(xp)} XP` : '';
        return `${vocEmoji(m.vocation)} **${m.name}** · Lv.${m.level} · ${m.vocation}${xpStr}`;
    });

    return new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`🟢 ${guildName} — Online Agora (${online.length})`)
        .setDescription(truncateOnlineLines(lines, online.length) || '_Ninguém online_')
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Online da Guilda Inimiga ───────────────────────────────────────────
function buildEnemyOnlineListEmbed(members, guildName) {
    const online = members.filter(m => m.status === 'Online').sort((a, b) => b.level - a.level);

    if (!online.length) {
        return new EmbedBuilder()
            .setColor(COLORS.GRAY)
            .setTitle(`😴 ${guildName} — Ninguém Online`)
            .setDescription('Nenhum membro da guilda inimiga está online no momento.')
            .setFooter(footer())
            .setTimestamp();
    }

    const lines = online.map(m => {
        return `${vocEmoji(m.vocation)} **${m.name}** · Lv.${m.level} · ${m.vocation}`;
    });

    return new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle(`🔴 ${guildName} — Online Agora (${online.length})`)
        .setDescription(truncateOnlineLines(lines, online.length) || '_Ninguém online_')
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Morte de Aliado (Minimalista) ──────────────────────────────────────
function buildAllyDeathEmbed(death, isGuildMember = true) {
    const isPvP = death.isPvP !== false && death.is_pvp !== 0;
    const emoji = isPvP ? '☠️' : '👹';
    const time = death.time || death.rawTime || 'Agora';
    return new EmbedBuilder()
        .setColor(isPvP ? COLORS.RED : 0xE74C3C)
        .setDescription(`${emoji} **${death.name}** (Lv. ${death.level}) foi morto por **${death.killedBy || death.killed_by}** às \`${time}\``);
}

// ─── Embed: Frag (membro matou alguém - Minimalista) ───────────────────────────
function buildFragEmbed(frag) {
    const time = frag.time || frag.rawTime || 'Agora';
    return new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setDescription(`🎯 **${frag.killerName}** matou **${frag.victimName}** às \`${time}\``);
}

// ─── Embed: Inimigo Online ────────────────────────────────────────────────────
function buildEnemyOnlineEmbed(name, level, vocation) {
    return new EmbedBuilder()
        .setColor(COLORS.ORANGE)
        .setTitle(`👁️ Inimigo Online!`)
        .setDescription(`**${name}** entrou no servidor!`)
        .addFields(
            { name: '📊 Level',   value: `\`${level || '?'}\``,    inline: true },
            { name: '⚡ Vocação', value: `\`${vocation || '?'}\``, inline: true },
        )
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Mortes do Dia ─────────────────────────────────────────────────────
function buildDeathsEmbed(deaths) {
    if (!deaths.length) {
        return new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle('☠️ Mortes do Dia')
            .setDescription('✅ Nenhuma morte registrada hoje!')
            .setFooter(footer())
            .setTimestamp();
    }

    const lines = deaths.map(d => {
        const isPvP = d.isPvP !== false && d.is_pvp !== 0;
        const icon = isPvP ? '☠️' : '👹';
        return `${icon} **${d.name}** (Lv.${d.level || '?'}) → morto por **${d.killedBy || d.killed_by}** · \`${d.time || d.rawTime || ''}\``;
    });

    return new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle(`☠️ Mortes do Dia (${deaths.length})`)
        .setDescription(lines.slice(0, 20).join('\n'))
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Top XP ───────────────────────────────────────────────────────────
function buildTopEmbed(players, title = 'Top XP do Dia') {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    if (!players.length) {
        return new EmbedBuilder()
            .setColor(COLORS.GOLD)
            .setTitle(`🏆 ${title}`)
            .setDescription('❌ Nenhum dado disponível ainda.')
            .setFooter(footer())
            .setTimestamp();
    }

    const lines = players.slice(0, 10).map((p, i) => {
        const h = Math.floor((p.onlineMs || 0) / 3600000);
        const m = Math.floor(((p.onlineMs || 0) % 3600000) / 60000);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        return `${medals[i] || `\`${i + 1}.\``} **${p.name}** · +${formatXp(p.dailyXp || p.gain_xp || 0)} XP · ${timeStr}`;
    });

    return new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle(`🏆 ${title}`)
        .setDescription(lines.join('\n'))
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Relatório Diário ──────────────────────────────────────────────────
function buildRelatorioEmbed(players, deaths, frags, guildName) {
    const totalXp     = players.reduce((s, p) => s + (p.dailyXp || p.gain_xp || 0), 0);
    const topPlayers  = players.slice(0, 5);
    const medals      = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

    const topLines = topPlayers.length
        ? topPlayers.map((p, i) => `${medals[i]} **${p.name}** · +${formatXp(p.dailyXp || p.gain_xp || 0)} XP`).join('\n')
        : '_Sem dados_';

    return new EmbedBuilder()
        .setColor(COLORS.ASCENDED)
        .setTitle(`📊 Relatório Diário — ${guildName}`)
        .setDescription(`**${players.length}** jogadores farmaram hoje!\n\nTotal XP: **${formatXp(totalXp)}**`)
        .addFields(
            { name: '🏆 Top 5',                value: topLines,               inline: false },
            { name: '☠️ Mortes hoje',           value: `\`${deaths}\``,        inline: true  },
            { name: '🎯 Frags hoje',            value: `\`${frags}\``,         inline: true  },
            { name: '👥 Membros ativos',        value: `\`${players.length}\``,inline: true  },
        )
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Guerra ────────────────────────────────────────────────────────────
function buildGuerraEmbed(data, isFull = false) {
    const { sA, sB } = data;
    const xpA  = sA?.gainXp || 0;
    const xpB  = sB?.gainXp || 0;
    const diff = xpA - xpB;
    const leader = diff === 0 ? '⚖️ Empate!' : `🏆 Vantagem: ${diff > 0 ? sA.guildName : sB.guildName} (+${formatXp(Math.abs(diff))})`;

    return new EmbedBuilder()
        .setColor(COLORS.WAR)
        .setTitle(isFull ? '📊 Placar Geral de Guerra' : '⚔️ Placar Diário de Guerra')
        .addFields(
            { name: `🛡️ ${sA?.guildName || 'Side A'}`, value: `📈 +${formatXp(xpA)} XP\n💀 ${sA?.deaths || 0} mortes`, inline: true },
            { name: `⚔️ ${sB?.guildName || 'Side B'}`, value: `📈 +${formatXp(xpB)} XP\n💀 ${sB?.deaths || 0} mortes`, inline: true },
            { name: '🏅 Resultado',                     value: leader,                                                   inline: false },
        )
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Matadores ────────────────────────────────────────────────────────
function buildMatadoresEmbed(killers, title = 'Maiores Matadores do Dia') {
    const medals = ['🥇', '🥈', '🥉'];

    if (!killers.length) {
        return new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle(`⚔️ ${title}`)
            .setDescription('✅ Nenhum frag PvP registrado ainda.')
            .setFooter(footer())
            .setTimestamp();
    }

    const lines = killers.slice(0, 100).map((k, i) =>
        `${medals[i] || `\`${i + 1}.\``} **${k.name}** · ${k.kills} ${k.kills === 1 ? 'frag' : 'frags'}`
    );

    let description = lines.join('\n');
    if (description.length > 4000) {
        description = description.slice(0, 3950) + '\n... (lista truncada por limite do Discord)';
    }

    return new EmbedBuilder()
        .setColor(COLORS.ORANGE)
        .setTitle(`⚔️ ${title}`)
        .setDescription(description)
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Oráculo ──────────────────────────────────────────────────────────
function buildOraculoEmbed(player, stats) {
    const xpNext  = Math.floor((50 / 3) * (Math.pow(player.level + 1, 3) - 6 * Math.pow(player.level + 1, 2) + 17 * (player.level + 1) - 12));
    const xpLeft  = xpNext - (player.experience || 0);
    const pace    = stats?.gainXp || 0;
    const hrs     = ((stats?.onlineMs || 0) / 3600000) || 0.5;
    const rateH   = pace > 0 ? Math.round(pace / hrs) : 0;

    let prediction = '_Sem ritmo detectado hoje._';
    if (rateH > 0) {
        const hoursLeft = xpLeft / rateH;
        const h = Math.floor(hoursLeft);
        const m = Math.round((hoursLeft % 1) * 60);
        prediction = `~${h}h ${m}m para level ${player.level + 1}`;
    }

    return new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`🔮 Oráculo — ${player.name}`)
        .setDescription(`Previsão de nível para **${player.name}**`)
        .addFields(
            { name: '📊 Level atual',     value: `\`${player.level}\``,          inline: true  },
            { name: '🎯 XP para próx.',   value: `\`${formatXp(xpLeft)}\``,      inline: true  },
            { name: '📈 Ritmo (hoje)',     value: `\`${formatXp(rateH)}/h\``,     inline: true  },
            { name: '⏱️ Previsão',        value: prediction,                      inline: false },
        )
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Radar ─────────────────────────────────────────────────────────────
function buildRadarEmbed(onlineEnemies) {
    if (!onlineEnemies.length) {
        return new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle('🔍 Radar de Inimigos')
            .setDescription('✅ Nenhum inimigo da lista online no momento.')
            .setFooter(footer())
            .setTimestamp();
    }

    const lines = onlineEnemies.map(e => {
        const voc = e.vocation || '?';
        const level = e.level || '?';
        const hunting = e.isHunting ? ` · 🎯 Caçando${e.huntingStartTime ? ` (${formatElapsed(e.huntingStartTime)})` : ''}` : '';
        return `${vocEmoji(voc)} **${e.name}** · Lv.${level} · ${voc}${hunting}`;
    });

    return new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle(`🔍 Radar de Inimigos (${onlineEnemies.length} online!)`)
        .setDescription(lines.join('\n'))
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Roleta ────────────────────────────────────────────────────────────
function buildRoletaEmbed(winner, players) {
    return new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle('🎰 RESULTADO DA ROLETA!')
        .setDescription(`🎉 O escolhido é **${winner}**!`)
        .addFields(
            { name: '👥 Participantes', value: `${players.length} jogadores`, inline: true },
        )
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Config ────────────────────────────────────────────────────────────
function buildConfigEmbed(config) {
    return new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle('⚙️ Configuração do Ascended Bot')
        .addFields(
            { name: '🏰 Guilda',              value: `\`${config.guildName  || 'Não definido'}\``, inline: true },
            { name: '🌍 Mundo',               value: `\`${config.worldName  || 'Não definido'}\``, inline: true },
            { name: '☠️ Canal de Mortes',     value: config.deathChannelId   ? `<#${config.deathChannelId}>`   : '`Não definido`', inline: true },
            { name: '📊 Canal de Relatório',  value: config.reportChannelId  ? `<#${config.reportChannelId}>`  : '`Não definido`', inline: true },
            { name: '👁️ Canal de Inimigos',   value: config.enemyChannelId   ? `<#${config.enemyChannelId}>`   : '`Não definido`', inline: true },
            { name: '🎯 Canal de Frags',      value: config.fragChannelId    ? `<#${config.fragChannelId}>`    : '`Não definido`', inline: true },
            { name: '⌨️ Canal de Comandos',   value: config.claimCommandsChannelId ? `<#${config.claimCommandsChannelId}>` : '`Não definido`', inline: true },
            { name: '📊 Canal do Painel',     value: config.claimsPanelChannelId ? `<#${config.claimsPanelChannelId}>` : '`Não definido`', inline: true },
            { name: '⏱️ Cargo Claim 1h30',    value: config.cargoClaim90      ? `<@&${config.cargoClaim90}>`    : '`Não definido`', inline: true },
            { name: '⏳ Cargo Claim 3h',      value: config.cargoClaim180     ? `<@&${config.cargoClaim180}>`   : '`Não definido`', inline: true },
            { name: '⚔️ Modo Guerra',         value: config.warMode === 'true' ? '🟢 Ativo' : '🔴 Inativo',    inline: true },
            { name: '🧹 Canal Limpo',         value: config.cleanChannelId   ? `<#${config.cleanChannelId}>`   : '`Não definido`', inline: true },
            { name: '🔊 Canal Gerador de Voz', value: config.voiceGeneratorChannelId ? `<#${config.voiceGeneratorChannelId}>` : '`Não definido`', inline: true },
            { name: '📝 Canal de Registros',   value: config.registrationChannelId   ? `<#${config.registrationChannelId}>`   : '`Não definido`', inline: true },
            { name: '⚔️ Canal de Guerra (Alertas)', value: config.warChannelId ? `<#${config.warChannelId}>` : '`Não definido`', inline: true },
            { name: '🕵️ Monitor Inimigos',    value: config.enemyHuntingChannelId ? `<#${config.enemyHuntingChannelId}>` : '`Não definido`', inline: true },
            { name: '🛡️ Monitor Aliados',     value: config.allyHuntingChannelId ? `<#${config.allyHuntingChannelId}>` : '`Não definido`', inline: true },
            { name: '📢 Canal de Anúncios',   value: config.announcementChannelId ? `<#${config.announcementChannelId}>` : '`Não definido`', inline: true },
        )
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Ping ──────────────────────────────────────────────────────────────
function buildPingEmbed(latency, apiLatency) {
    const fields = [
        { name: '⏱️ Latência (Mensagem)', value: `\`${latency}ms\``, inline: true }
    ];
    if (typeof apiLatency === 'number') {
        fields.push({ name: '⚡ API (WebSocket)', value: `\`${apiLatency}ms\``, inline: true });
    }
    return new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('🏓 Pong!')
        .addFields(fields)
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Erro ─────────────────────────────────────────────────────────────
function buildErrorEmbed(message) {
    return new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle('❌ Erro')
        .setDescription(message)
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Hunted list ───────────────────────────────────────────────────────
function buildHuntedListEmbed(hunted) {
    const desc = hunted.length
        ? hunted.map((n, i) => `\`${i + 1}.\` **${n}**`).join('\n')
        : '_Lista vazia._';

    return new EmbedBuilder()
        .setColor(COLORS.ORANGE)
        .setTitle(`👁️ Lista de Hunted (${hunted.length})`)
        .setDescription(desc)
        .setFooter(footer())
        .setTimestamp();
}

// ─── Embed: Alerta de XP (modo guerra) ───────────────────────────────────────
function buildWarXpAlertEmbed(name, totalXp) {
    return new EmbedBuilder()
        .setColor(COLORS.WAR)
        .setTitle('⚔️ Alerta de Modo Guerra!')
        .setDescription(`**${name}** atingiu **${formatXp(totalXp)}** XP de farm! 🚨`)
        .setFooter(footer())
        .setTimestamp();
}

function formatRemaining(ms) {
    if (ms <= 0) return 'Expirado';
    const totalSecs = Math.floor(ms / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function getPlayerDisplayName(playerId, fallbackName) {
    const reg = db.getRegisteredMember(playerId);
    let name = fallbackName;
    let level = null;
    
    const state = require('./state');
    
    if (reg) {
        name = reg.char_name;
        if (state.guildMembers) {
            const member = state.guildMembers.find(m => m.name.toLowerCase() === reg.char_name.toLowerCase());
            if (member) {
                level = member.level;
            }
        }
        if (!level && state.trackedPlayers && state.trackedPlayers[reg.char_name]) {
            level = state.trackedPlayers[reg.char_name].level;
        }
    } else {
        if (state.guildMembers) {
            const member = state.guildMembers.find(m => m.name.toLowerCase() === fallbackName.toLowerCase());
            if (member) {
                level = member.level;
            }
        }
    }
    
    return level ? `${name} [Lv.${level}]` : name;
}

function getOwnerDisplayNameByName(ownerName) {
    const claims = db.getActiveClaims();
    const claim = claims.find(c => c.player_name.toLowerCase() === ownerName.toLowerCase() || c.player_name.toLowerCase().includes(ownerName.toLowerCase()));
    if (claim) {
        return getPlayerDisplayName(claim.player_id, claim.player_name);
    }
    const reg = db.getAllRegisteredMembers().find(r => r.char_name.toLowerCase() === ownerName.toLowerCase());
    if (reg) {
        return getPlayerDisplayName(reg.discord_id, reg.char_name);
    }
    return ownerName;
}

function buildClaimSuccessEmbed(claim, durationMinutes) {
    const expiresDate = new Date(claim.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('✅ Respawn Reservado')
        .setDescription(`Você reservou o respawn **${claim.respawn_name}** (${claim.respawn_id}) com sucesso!`)
        .addFields(
            { name: '👤 Jogador', value: `${getPlayerDisplayName(claim.player_id, claim.player_name)}`, inline: true },
            { name: '⏱️ Duração', value: `${durationMinutes} minutos`, inline: true },
            { name: '⏰ Expira às', value: `\`${expiresDate}\` (em ${durationMinutes} min)`, inline: true }
        )
        .setFooter(footer())
        .setTimestamp();
}

function buildQueueSuccessEmbed(respawnId, respawnName, position, ownerName) {
    return new EmbedBuilder()
        .setColor(COLORS.ORANGE)
        .setTitle('⏳ Entrou na Fila (Next)')
        .setDescription(`Você entrou na fila para o respawn **${respawnName}** (\`${respawnId}\`).`)
        .addFields(
            { name: '🔢 Posição na Fila', value: `\`${position}°\``, inline: true },
            { name: '👑 Ocupado por', value: `**${getOwnerDisplayNameByName(ownerName)}**`, inline: true }
        )
        .setFooter(footer())
        .setTimestamp();
}

function buildClaimReleasedEmbed(claim) {
    return new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle('🔓 Respawn Liberado')
        .setDescription(`O respawn **${claim.respawn_name}** (${claim.respawn_id}) está livre agora.`)
        .addFields(
            { name: '👤 Liberado por', value: `${getPlayerDisplayName(claim.player_id, claim.player_name)}`, inline: true }
        )
        .setFooter(footer())
        .setTimestamp();
}

function buildActiveClaimsEmbed(claims) {
    if (!claims.length) {
        return new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle('🔍 Respawns Ocupados')
            .setDescription('✅ Todos os respawns estão livres no momento!')
            .setFooter(footer())
            .setTimestamp();
    }

    const embed = new EmbedBuilder()
        .setColor(COLORS.ASCENDED)
        .setTitle('🏰 Respawns Ocupados no Momento')
        .setDescription('Veja abaixo quem está caçando e o tempo restante:');

    const groups = {};
    claims.forEach(c => {
        if (!groups[c.category]) groups[c.category] = [];
        groups[c.category].push(c);
    });

    for (const category in groups) {
        const lines = groups[category].map(c => {
            const timeLeft = c.expires_at - Date.now();
            const timeStr = formatRemaining(timeLeft);
            const statusStr = c.status === 'pending' ? '⏳ PENDENTE · ' : '';
            
            const claimerName = getPlayerDisplayName(c.player_id, c.player_name);
            
            // Get queue
            const queue = db.getQueue(c.respawn_id);
            let queueStr = '';
            if (queue && queue.length > 0) {
                queueStr = `\n   ↳ ⏳ **Fila (Next):** ` + queue.map((q, idx) => `\`${idx + 1}°\` **${getPlayerDisplayName(q.player_id, q.player_name)}**`).join(', ');
            }

            return `\`${c.respawn_id}\` **${c.respawn_name}**\n└ 👤 **${claimerName}** (${statusStr}resta ${timeStr})${queueStr}`;
        });
        embed.addFields({ name: `📍 ${category}`, value: lines.join('\n'), inline: false });
    }

    embed.setFooter(footer()).setTimestamp();
    return embed;
}

function buildLiveDashboardEmbed(claims) {
    let commandsChannelId = null;
    let claimsPaused = false;
    try {
        const state = require('./state');
        const store = state.guildLocalStorage.getStore();
        const guildId = store ? store.guildId : null;
        const config = db.getGuildConfigMerged(guildId);
        commandsChannelId = config.claimCommandsChannelId;
        claimsPaused = config.claimsPaused === 'true';
    } catch {
        commandsChannelId = db.getConfig('claimCommandsChannelId');
        claimsPaused = db.getConfig('claimsPaused') === 'true';
    }

    const channelMention = commandsChannelId ? `<#${commandsChannelId}>` : 'canal apropriado';

    const embed = new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle('📊 PAINEL DE RESPAWNS EM TEMPO REAL')
        .setDescription(`Atualizado automaticamente a cada 20 segundos.\n\nUse os comandos no canal ${channelMention} para reservar ou liberar respawns!`);

    if (claimsPaused) {
        embed.addFields({ name: '⏸️ Sistema Pausado', value: 'O sistema de claims/reservas de respawn está **temporariamente pausado** devido a guerra ativa no momento. Por favor, aguarde a liberação pelos administradores.', inline: false });
        embed.setColor(COLORS.RED);
    } else if (!claims.length) {
        embed.addFields({ name: '🟢 Status Geral', value: 'Todos os respawns estão **LIVRES** no momento! Aproveite.', inline: false });
        embed.setColor(COLORS.GREEN);
    } else {
        const groups = {};
        claims.forEach(c => {
            if (!groups[c.category]) groups[c.category] = [];
            groups[c.category].push(c);
        });

        for (const category in groups) {
            const lines = groups[category].map(c => {
                const timeLeft = c.expires_at - Date.now();
                const timeStr = formatRemaining(timeLeft);
                const statusStr = c.status === 'pending' ? '⏳ PENDENTE · ' : '';
                
                const claimerName = getPlayerDisplayName(c.player_id, c.player_name);
                
                // Get queue
                const queue = db.getQueue(c.respawn_id);
                let queueStr = '';
                if (queue && queue.length > 0) {
                    queueStr = `\n   ↳ ⏳ *Next:* ` + queue.map((q, idx) => `**${getPlayerDisplayName(q.player_id, q.player_name)}**`).join(', ');
                }

                return `\`${c.respawn_id}\` **${c.respawn_name}**\n└ 👤 **${claimerName}** (${statusStr}resta ${timeStr})${queueStr}`;
            });
            embed.addFields({ name: `📍 ${category}`, value: lines.join('\n'), inline: false });
        }
    }

    // Campo invisível para dar espaçamento visual
    embed.addFields({ name: '\u200B', value: '\u200B', inline: false });

    embed.addFields({
        name: '📖 Como funciona o Sistema de Reservas (Claims)?',
        value: `🎙️ **Presença em Voice:** É obrigatório estar em um canal de voz do Discord para reservar (\`!claim\`) ou entrar na fila (\`!next\`).\n⏳ **Vez na Fila:** Quando chegar a sua vez, você tem **10 minutos** para confirmar/aceitar sua reserva (via \`!claim\` ou botão), caso contrário ela expirará automaticamente.\n🚨 **Saída de Voice:** Se você sair de todos os canais de voz, terá **5 minutos** para voltar antes de perder a sua reserva.\n📲 **WhatsApp:** Se cadastrado, você receberá alertas de vez e avisos de saída de voice também no celular.`,
        inline: false
    });

    embed.setFooter({ text: 'Última atualização' }).setTimestamp();
    return embed;
}

function buildWarScoreboardEmbed(lastFrags, lastDeaths, totalFrags, totalDeaths, guildName) {
    const kdRatio = totalDeaths > 0 ? (totalFrags / totalDeaths).toFixed(2) : totalFrags.toFixed(2);

    // Visual progress bar
    const total = totalFrags + totalDeaths;
    let progressBar = '░░░░░░░░░░';
    if (total > 0) {
        const percent = Math.round((totalFrags / total) * 10);
        progressBar = '🟩'.repeat(percent) + '🟥'.repeat(10 - percent);
    }

    const fragLines = lastFrags.length
        ? lastFrags.map((f, i) => `\`${i + 1}.\` 🎯 **${f.killer_name}** matou **${f.victim_name}** (${f.raw_time || '?'})`)
        : ['_Nenhum frag registrado_'];

    const deathLines = lastDeaths.length
        ? lastDeaths.map((d, i) => `\`${i + 1}.\` ☠️ **${d.name}** [Lv.${d.level || '?'}] para **${d.killed_by || '?'}`.slice(0, 70) + `** (${d.raw_time || '?'})`)
        : ['_Nenhuma morte registrada_'];

    return new EmbedBuilder()
        .setColor(COLORS.WAR)
        .setTitle(`⚔️ PLACAR DE GUERRA — ${guildName}`)
        .setDescription(`Acompanhe o andamento da guerra em tempo real!\n\n**Balanço Geral:**\n${progressBar} \`${totalFrags} vs ${totalDeaths} (K/D: ${kdRatio})\``)
        .addFields(
            { name: '🎯 Últimos 5 Frags (Aliados)', value: fragLines.join('\n'), inline: false },
            { name: '☠️ Últimas 5 Mortes (Aliadas)', value: deathLines.join('\n'), inline: false }
        )
        .setFooter({ text: 'Placar de Guerra • Atualizado em tempo real' })
        .setTimestamp();
}

function buildEnemyHuntingEmbed(huntingEnemies, enemyGuildName) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.WAR)
        .setTitle(`🕵️ INIMIGOS CAÇANDO EM TEMPO REAL — ${enemyGuildName}`)
        .setDescription(`Atualizado automaticamente a cada 10 minutos.\nMostra membros da guilda inimiga ganhando XP recentemente.`);

    if (huntingEnemies.length === 0) {
        embed.setDescription(`Atualizado automaticamente a cada 10 minutos.\n\n✅ **Nenhum inimigo caçando no momento.**`);
        embed.setColor(COLORS.GREEN);
    } else {
        // Sort by level descending
        huntingEnemies.sort((a, b) => b.level - a.level);

        // Cap to top 20 to keep embed size safe
        const activeEnemies = huntingEnemies.slice(0, 20);

        // Se houver muitos caçando (> 8), usa formato compacto para economizar espaço e evitar limites do Discord
        const useCompactFormat = activeEnemies.length > 8;

        const lines = activeEnemies.map(p => {
            if (useCompactFormat) {
                const xpGain = p.deltaXp > 0 ? ` · \`+${formatXp(p.deltaXp)} XP\`` : '';
                return `${vocEmoji(p.vocation)} **${p.name}** [Lv.${p.level}]${xpGain}`;
            }

            const durationMs = Date.now() - p.huntingStartTime;
            const durationMin = Math.floor(durationMs / 60000);
            const durationStr = durationMin > 0 ? `${durationMin} min` : 'agora mesmo';
            
            const lastGainStr = p.deltaXp > 0 ? `+${formatXp(p.deltaXp)} XP` : 'XP';
            const elapsedSinceUpdate = Math.floor((Date.now() - p.lastUpdate) / 1000);
            const updateStr = elapsedSinceUpdate > 0 ? `${elapsedSinceUpdate}s atrás` : 'agora';

            return `${vocEmoji(p.vocation)} **${p.name}** [Lv.${p.level}]\n└ ⏳ Caçando há **${durationStr}** · Último ganho: \`${lastGainStr}\` · Atualizado há ${updateStr}`;
        });

        // Split fields dynamically to respect Discord's 1024 character limit per field
        let fieldValue = '';
        let fieldIndex = 1;
        lines.forEach(line => {
            if (fieldValue.length + line.length + 1 > 1024) {
                embed.addFields({ name: `⚔️ Atividade de Caça Ativa (Parte ${fieldIndex})`, value: fieldValue, inline: false });
                fieldValue = line;
                fieldIndex++;
            } else {
                fieldValue = fieldValue ? `${fieldValue}\n${line}` : line;
            }
        });
        if (fieldValue) {
            embed.addFields({
                name: fieldIndex > 1 ? `⚔️ Atividade de Caça Ativa (Parte ${fieldIndex})` : '⚔️ Atividade de Caça Ativa',
                value: fieldValue,
                inline: false
            });
        }
    }

    embed.setFooter({ text: 'Monitor de Inimigos • RubinOT' }).setTimestamp();
    return embed;
}

function buildAllyHuntingEmbed(huntingAllies, allyGuildName, isSpy = false) {
    const embed = new EmbedBuilder()
        .setColor(isSpy ? COLORS.RED : COLORS.GREEN)
        .setTitle(isSpy ? `🕵️ INIMIGOS CAÇANDO EM TEMPO REAL — ${allyGuildName}` : `🛡️ ALIADOS CAÇANDO EM TEMPO REAL — ${allyGuildName}`)
        .setDescription(isSpy ? `Atualizado automaticamente a cada 10 minutos.\nMostra membros da guilda inimiga ganhando XP recentemente.` : `Atualizado automaticamente a cada 10 minutos.\nMostra membros da guilda aliada ganhando XP recentemente.`);

    if (huntingAllies.length === 0) {
        embed.setDescription(isSpy ? `Atualizado automaticamente a cada 10 minutos.\n\n💤 **Nenhum inimigo caçando no momento.**` : `Atualizado automaticamente a cada 10 minutos.\n\n💤 **Nenhum aliado caçando no momento.**`);
        embed.setColor(0x7F8C8D); // Grey
    } else {
        // Sort by level descending
        huntingAllies.sort((a, b) => b.level - a.level);

        // Cap to top 20 to keep embed size safe
        const activeAllies = huntingAllies.slice(0, 20);

        // Se houver muitos caçando (> 8), usa formato compacto para economizar espaço e evitar limites do Discord
        const useCompactFormat = activeAllies.length > 8;

        const lines = activeAllies.map(p => {
            if (useCompactFormat) {
                const xpGain = p.deltaXp > 0 ? ` · \`+${formatXp(p.deltaXp)} XP\`` : '';
                return `${vocEmoji(p.vocation)} **${p.name}** [Lv.${p.level}]${xpGain}`;
            }

            const durationMs = p.huntingStartTime ? (Date.now() - p.huntingStartTime) : 0;
            const durationMin = Math.floor(durationMs / 60000);
            const durationStr = durationMin > 0 ? `${durationMin} min` : 'agora mesmo';
            
            const lastGainStr = p.deltaXp > 0 ? `+${formatXp(p.deltaXp)} XP` : 'XP';
            const elapsedSinceUpdate = Math.floor((Date.now() - p.lastUpdate) / 1000);
            const updateStr = elapsedSinceUpdate > 0 ? `${elapsedSinceUpdate}s atrás` : 'agora';

            return `${vocEmoji(p.vocation)} **${p.name}** [Lv.${p.level}]\n└ ⏳ Caçando há **${durationStr}** · Último ganho: \`${lastGainStr}\` · Atualizado há ${updateStr}`;
        });

        // Split fields dynamically to respect Discord's 1024 character limit per field
        let fieldValue = '';
        let fieldIndex = 1;
        lines.forEach(line => {
            if (fieldValue.length + line.length + 1 > 1024) {
                embed.addFields({ name: isSpy ? `🕵️ Atividade de Caça Inimiga (Parte ${fieldIndex})` : `🛡️ Atividade de Caça Ativa (Parte ${fieldIndex})`, value: fieldValue, inline: false });
                fieldValue = line;
                fieldIndex++;
            } else {
                fieldValue = fieldValue ? `${fieldValue}\n${line}` : line;
            }
        });
        if (fieldValue) {
            embed.addFields({
                name: fieldIndex > 1 ? `${isSpy ? '🕵️' : '🛡️'} Atividade de Caça ${isSpy ? 'Inimiga' : 'Ativa'} (Parte ${fieldIndex})` : `${isSpy ? '🕵️' : '🛡️'} Atividade de Caça ${isSpy ? 'Inimiga' : 'Ativa'}`,
                value: fieldValue,
                inline: false
            });
        }
    }

    embed.setFooter({ text: isSpy ? 'Monitor de Inimigos • RubinOT' : 'Monitor de Aliados • RubinOT' }).setTimestamp();
    return embed;
}

// ─── Embed: Level Up ──────────────────────────────────────────────────────────
function buildLevelUpEmbed(player, oldLevel, newLevel, isAlly) {
    const emoji = vocEmoji(player.vocation || '');
    const color = isAlly ? 0x44FF88 : 0xFF4444;
    const prefix = isAlly ? '🟢 ALIADO EVOLUIU!' : '🔴 INIMIGO EVOLUIU!';

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(`${prefix}`)
        .setDescription(`${emoji} **${player.name}** subiu do nível **${oldLevel}** para **${newLevel}**!`)
        .addFields(
            { name: '👤 Jogador', value: player.name, inline: true },
            { name: '📊 Nível Anterior', value: `${oldLevel}`, inline: true },
            { name: '⬆️ Novo Nível', value: `**${newLevel}**`, inline: true },
            { name: '🧬 Vocação', value: player.vocation || '?', inline: true },
        )
        .setFooter({ text: `Ascended Bot • ${isAlly ? 'Aliados' : 'Inimigos'}` })
        .setTimestamp();
}

// ─── Embed: K/D Leaderboard ───────────────────────────────────────────────────
function buildKDLeaderboardEmbed(rows, sinceDate, dias) {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '1️⃣1️⃣', '1️⃣2️⃣', '1️⃣3️⃣', '1️⃣4️⃣', '1️⃣5️⃣'];
    const embed = new EmbedBuilder()
        .setColor(0xC0392B)
        .setTitle(`⚔️ Ranking de Reputação de Guerra — Últimos ${dias} dias`)
        .setDescription(`K/D calculado somando frags do **main + bomba** vs mortes PvP.\n_Período: desde ${sinceDate}_`)
        .setFooter({ text: 'Ascended Bot • RubinOT' })
        .setTimestamp();

    if (!rows || rows.length === 0) {
        embed.addFields({ name: 'Sem dados', value: '_Nenhum frag ou morte PvP registrado neste período._', inline: false });
        return embed;
    }

    const lines = rows.map((r, i) => {
        const kdStr = r.kd.toFixed(2);
        const bombaStr = r.bomba && r.bomba !== '-' ? ` _(+${r.bomba})_` : '';
        return `${medals[i] || `\`${i + 1}.\``} **${r.charName}**${bombaStr} — ${r.frags}🎯 / ${r.deaths}☠️ = **${kdStr} K/D**`;
    });

    embed.addFields({ name: `🏆 Top ${rows.length} Guerreiros`, value: lines.join('\n'), inline: false });
    return embed;
}

module.exports = {
    buildPlayerEmbed,

    buildOnlineEmbed,
    buildEnemyOnlineListEmbed,
    buildAllyDeathEmbed,
    buildFragEmbed,
    buildEnemyOnlineEmbed,
    buildDeathsEmbed,
    buildWarScoreboardEmbed,
    buildEnemyHuntingEmbed,
    buildAllyHuntingEmbed,
    buildTopEmbed,
    buildRelatorioEmbed,
    buildGuerraEmbed,
    buildMatadoresEmbed,
    buildOraculoEmbed,
    buildRadarEmbed,
    buildRoletaEmbed,
    buildConfigEmbed,
    buildPingEmbed,
    buildErrorEmbed,
    buildHuntedListEmbed,
    buildWarXpAlertEmbed,
    buildClaimSuccessEmbed,
    buildQueueSuccessEmbed,
    buildClaimReleasedEmbed,
    buildActiveClaimsEmbed,
    buildLiveDashboardEmbed,
    buildLevelUpEmbed,
    buildKDLeaderboardEmbed,
    formatXp,
    formatElapsed,
    vocEmoji,
};
