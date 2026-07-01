'use strict';

const { buildConfigEmbed, buildErrorEmbed, buildHuntedListEmbed } = require('../modules/embeds');
const { EmbedBuilder } = require('discord.js');
const db     = require('../modules/database');
const state  = require('../modules/state');
const scheduler = require('../modules/scheduler');
const voiceManager = require('../modules/voiceManager');

module.exports = {
    name: 'config',
    aliases: ['configurar', 'setup'],
    adminOnly: true,
    async execute(msg, args, { config, saveConfig }) {
        if (!args.length) {
            // Mostra config atual
            return msg.reply({ embeds: [buildConfigEmbed(config)] });
        }

        const [subCmd, ...rest] = args;
        const value = rest.join(' ').trim();

        switch (subCmd.toLowerCase()) {
            // ── Guilda e Mundo ──────────────────────────────────────────────
            case 'guilda':
            case 'guild': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config guilda <nome>`')] });
                config.guildName = value;
                db.setConfig('guildName', value);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Guilda configurada para: **${value}**`)] });
            }

            case 'mundo':
            case 'world': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config mundo <nome>`')] });
                config.worldName = value;
                db.setConfig('worldName', value);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Mundo configurado para: **${value}**`)] });
            }

            case 'guilda-inimiga':
            case 'enemy-guild': {
                config.enemyGuildName = value || null;
                db.setConfig('enemyGuildName', value || '');
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(value ? `Guilda inimiga: **${value}**` : 'Guilda inimiga removida.')] });
            }

            // ── Canais ──────────────────────────────────────────────────────
            case 'canal-mortes':
            case 'death-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-mortes #mortes`')] });
                config.deathChannelId = channelId;
                db.setConfig('deathChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal de mortes: <#${channelId}>`)] });
            }

            case 'canal-relatorio':
            case 'report-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-relatorio #relatorio`')] });
                config.reportChannelId = channelId;
                db.setConfig('reportChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal de relatório: <#${channelId}>`)] });
            }

            case 'canal-inimigos':
            case 'enemy-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-inimigos #radar`')] });
                config.enemyChannelId = channelId;
                db.setConfig('enemyChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal de inimigos: <#${channelId}>`)] });
            }

            case 'canal-frags':
            case 'frag-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-frags #frags`')] });
                config.fragChannelId = channelId;
                db.setConfig('fragChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal de frags: <#${channelId}>`)] });
            }

            case 'canal-guerra':
            case 'war-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-guerra #guerra`')] });
                config.warChannelId = channelId;
                db.setConfig('warChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal de guerra: <#${channelId}>`)] });
            }

            case 'canal-comandos':
            case 'commands-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-comandos #claims`')] });
                config.claimCommandsChannelId = channelId;
                db.setConfig('claimCommandsChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal exclusivo de comandos: <#${channelId}>`)] });
            }

            case 'canal-painel':
            case 'panel-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-painel #painel`')] });
                config.claimsPanelChannelId = channelId;
                db.setConfig('claimsPanelChannelId', channelId);
                // Reset panelMessageId so it restarts in the new channel
                config.panelMessageId = null;
                db.setConfig('panelMessageId', '');
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal do painel em tempo real: <#${channelId}>`)] });
            }

            case 'canal-limpo':
            case 'clean-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.cleanChannelId = null;
                    db.setConfig('cleanChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('🧹 **Canal com auto-limpeza desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-limpo #canal` ou `!config canal-limpo off`')] });
                config.cleanChannelId = channelId;
                db.setConfig('cleanChannelId', channelId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`🧹 **Canal com auto-limpeza ativado:** <#${channelId}>\n(Todas as mensagens de usuários enviadas aqui serão apagadas imediatamente).`)] });
            }

            case 'canal-gerador-voz':
            case 'voice-generator': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.voiceGeneratorChannelId = null;
                    db.setConfig('voiceGeneratorChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('🔊 **Canal gerador de voz desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal de voz. Ex: `!config canal-gerador-voz #canal` ou `!config canal-gerador-voz off`')] });
                config.voiceGeneratorChannelId = channelId;
                db.setConfig('voiceGeneratorChannelId', channelId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`🔊 **Canal gerador de voz ativado:** <#${channelId}>`)] });
            }

            case 'canal-registros':
            case 'registration-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.registrationChannelId = null;
                    db.setConfig('registrationChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('📝 **Canal de registros desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal de registros. Ex: `!config canal-registros #canal` ou `!config canal-registros off`')] });
                config.registrationChannelId = channelId;
                db.setConfig('registrationChannelId', channelId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`📝 **Canal de registros ativado:** <#${channelId}>`)] });
            }

            case 'canal-placar':
            case 'scoreboard-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-placar #placar-guerra`')] });
                config.warScoreboardChannelId = channelId;
                db.setConfig('warScoreboardChannelId', channelId);
                config.warScoreboardMessageId = null;
                db.setConfig('warScoreboardMessageId', '');
                saveConfig(config);
                scheduler.updateConfig(config);
                scheduler.updateWarScoreboard();
                return msg.reply({ embeds: [buildOkEmbed(`Canal do placar de guerra: <#${channelId}>`)] });
            }

            case 'canal-contador-guilda':
            case 'guild-counter-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.onlineGuildChannelId = null;
                    db.setConfig('onlineGuildChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('🟢 **Canal contador de guilda desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal de voz. Ex: `!config canal-contador-guilda #canal` ou `!config canal-contador-guilda off`')] });
                config.onlineGuildChannelId = channelId;
                db.setConfig('onlineGuildChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                scheduler.updateCounterChannels(true);
                return msg.reply({ embeds: [buildOkEmbed(`🟢 **Canal contador de guilda ativado:** <#${channelId}>`)] });
            }

            case 'canal-contador-inimigos':
            case 'enemy-counter-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.onlineEnemyChannelId = null;
                    db.setConfig('onlineEnemyChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('🔴 **Canal contador de inimigos desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal de voz. Ex: `!config canal-contador-inimigos #canal` ou `!config canal-contador-inimigos off`')] });
                config.onlineEnemyChannelId = channelId;
                db.setConfig('onlineEnemyChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                scheduler.updateCounterChannels(true);
                return msg.reply({ embeds: [buildOkEmbed(`🔴 **Canal contador de inimigos ativado:** <#${channelId}>`)] });
            }

            case 'canal-monitor-inimigos':
            case 'enemy-hunting-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-monitor-inimigos #monitor-inimigos`')] });
                config.enemyHuntingChannelId = channelId;
                db.setConfig('enemyHuntingChannelId', channelId);
                config.enemyHuntingMessageId = null;
                db.setConfig('enemyHuntingMessageId', '');
                saveConfig(config);
                scheduler.updateConfig(config);
                scheduler.updateEnemyHuntingDashboard();
                return msg.reply({ embeds: [buildOkEmbed(`Canal de monitoramento de inimigos: <#${channelId}>`)] });
            }

            case 'canal-monitor-aliados':
            case 'ally-hunting-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-monitor-aliados #monitor-aliados`')] });
                config.allyHuntingChannelId = channelId;
                db.setConfig('allyHuntingChannelId', channelId);
                config.allyHuntingMessageId = null;
                db.setConfig('allyHuntingMessageId', '');
                saveConfig(config);
                scheduler.updateConfig(config);
                scheduler.updateAllyHuntingDashboard();
                return msg.reply({ embeds: [buildOkEmbed(`Canal de monitoramento de aliados: <#${channelId}>`)] });
            }

            case 'canal-guerra-voz':
            case 'war-voice-channel': {
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal de voz. Ex: `!config canal-guerra-voz #canal`')] });
                config.warVoiceChannelId = channelId;
                db.setConfig('warVoiceChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                voiceManager.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canal de voz de guerra: <#${channelId}>`)] });
            }

            case 'canais-voz-protegidos':
            case 'protected-voice-channels': {
                const ids = rest.map(extractChannelId).filter(Boolean);
                if (!ids.length) {
                    return msg.reply({ embeds: [buildErrorEmbed('Mencione um ou mais canais de voz. Ex: `!config canais-voz-protegidos #canal1 #canal2`')] });
                }
                config.protectedVoiceChannelIds = ids.join(',');
                db.setConfig('protectedVoiceChannelIds', config.protectedVoiceChannelIds);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Canais de voz protegidos (masskick/massmove): ${ids.map(id => `<#${id}>`).join(', ')}`)] });
            }

            case 'canal-levelup':
            case 'levelup-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.levelUpChannelId = null;
                    db.setConfig('levelUpChannelId', '');
                    saveConfig(config);
                    scheduler.updateConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('⬆️ **Canal de level up desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-levelup #levelups` ou `!config canal-levelup off`')] });
                config.levelUpChannelId = channelId;
                db.setConfig('levelUpChannelId', channelId);
                saveConfig(config);
                scheduler.updateConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`⬆️ **Canal de level up ativado:** <#${channelId}>`)] });
            }

            case 'canal-anuncios':
            case 'announcement-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.announcementChannelId = null;
                    db.setConfig('announcementChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('📢 **Canal de anúncios desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config canal-anuncios #anuncios` ou `!config canal-anuncios off`')] });
                config.announcementChannelId = channelId;
                db.setConfig('announcementChannelId', channelId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`📢 **Canal de anúncios ativado:** <#${channelId}>`)] });
            }

            case 'taxa-ativa':
            case 'tax-enabled': {
                const arg = rest[0]?.toLowerCase();
                if (arg === 'on' || arg === 'ativar' || arg === 'true' || arg === 'sim') {
                    config.taxEnabled = 'true';
                    db.setConfig('taxEnabled', 'true');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('💰 **Sistema de Taxas de Guerra ATIVADO!**')] });
                } else {
                    config.taxEnabled = 'false';
                    db.setConfig('taxEnabled', 'false');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('💰 **Sistema de Taxas de Guerra DESATIVADO!**')] });
                }
            }

            case 'taxa':
            case 'taxa-valor':
            case 'tax-value': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config taxa-valor <valor>` (Ex: `!config taxa-valor 500 RC`)')] });
                config.taxValue = value;
                db.setConfig('taxValue', value);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`💰 **Valor da taxa padrão configurado para:** \`${value}\``)] });
            }

            case 'taxa-planilhado':
            case 'tax-planilhado-value': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config taxa-planilhado <valor>` (Ex: `!config taxa-planilhado 1000 RC`)')] });
                config.taxPlanilhadoValue = value;
                db.setConfig('taxPlanilhadoValue', value);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`💰 **Valor da taxa de planilhados configurado para:** \`${value}\``)] });
            }

            case 'taxa-destino':
            case 'tax-target': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config taxa-destino <nome>` (Ex: `!config taxa-destino Bank Ascended`)')] });
                config.taxTargetChar = value;
                db.setConfig('taxTargetChar', value);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`💰 **Personagem de destino configurado para:** \`${value}\``)] });
            }

            case 'taxa-ciclo':
            case 'tax-cycle': {
                const days = parseInt(rest[0], 10);
                if (isNaN(days) || days <= 0) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config taxa-ciclo <dias>` (Ex: `!config taxa-ciclo 7`)')] });
                config.taxCycleDays = String(days);
                db.setConfig('taxCycleDays', String(days));
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`💰 **Ciclo de cobrança configurado para:** \`${days} dias\``)] });
            }

            case 'taxa-canal':
            case 'tax-channel': {
                const arg = rest[0]?.toLowerCase();
                if (!arg || arg === 'off' || arg === 'desativar' || arg === 'none') {
                    config.taxAuditChannelId = null;
                    db.setConfig('taxAuditChannelId', '');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('💰 **Canal de auditoria de taxas desativado.**')] });
                }
                const channelId = extractChannelId(rest[0]);
                if (!channelId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o canal. Ex: `!config taxa-canal #auditoria-taxas`')] });
                config.taxAuditChannelId = channelId;
                db.setConfig('taxAuditChannelId', channelId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`💰 **Canal de auditoria de taxas configurado:** <#${channelId}>`)] });
            }

            case 'gb':
            case 'guildbank':
            case 'guildbankname': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config gb <NomeDoPersonagem>`')] });
                config.guildBankName = value;
                db.setConfig('guildBankName', value);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`🏦 **Personagem do Guild Bank configurado para:** \`${value}\``)] });
            }

            // ── Modo Guerra ──────────────────────────────────────────────────
            case 'war':
            case 'guerra': {
                const arg = rest[0]?.toLowerCase();
                if (arg === 'on' || arg === 'ativar') {
                    state.warMode    = true;
                    state.warAlerted = new Set();
                    state.warXp      = {};
                    db.setConfig('warMode', 'true');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('⚔️ **Modo Guerra ATIVADO!** Alertas a partir de 1.000.000 XP.')] });
                } else if (arg === 'off' || arg === 'desativar') {
                    state.warMode    = false;
                    state.warAlerted = new Set();
                    state.warXp      = {};
                    db.setConfig('warMode', 'false');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('✅ **Modo Guerra DESATIVADO!**')] });
                }
                return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config guerra on` ou `!config guerra off`')] });
            }

            // ── Hunted list ──────────────────────────────────────────────────
            case 'hunted':
            case 'add-hunted': {
                const enemyName = rest.join(' ').trim();
                if (!enemyName) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config hunted <nome>`')] });
                db.addHunted(enemyName, msg.author.username);
                state.huntedList = db.getHuntedList();
                return msg.reply({ embeds: [buildOkEmbed(`**${enemyName}** adicionado à lista de hunted.`)] });
            }

            case 'remove-hunted':
            case 'unhunted': {
                const enemyName = rest.join(' ').trim();
                if (!enemyName) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config remove-hunted <nome>`')] });
                db.removeHunted(enemyName);
                state.huntedList = db.getHuntedList();
                return msg.reply({ embeds: [buildOkEmbed(`**${enemyName}** removido da lista de hunted.`)] });
            }

            case 'list-hunted':
            case 'hunted-list': {
                const list = db.getHuntedList();
                return msg.reply({ embeds: [buildHuntedListEmbed(list)] });
            }

            case 'cargo-claim-90':
            case 'cargo-claim-1h30':
            case 'claim-90': {
                const roleId = extractRoleId(rest[0]);
                if (!roleId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o cargo. Ex: `!config cargo-claim-90 @Cargo`')] });
                config.cargoClaim90 = roleId;
                db.setConfig('cargoClaim90', roleId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Cargo de claim 1h30 configurado: <@&${roleId}>`)] });
            }

            case 'cargo-taxa':
            case 'taxa-cargo': {
                const roleId = extractRoleId(rest[0]);
                if (!roleId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o cargo. Ex: `!config cargo-taxa @TaxaPaga`')] });
                config.cargoTaxa = roleId;
                db.setConfig('cargoTaxa', roleId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Cargo de Taxa Paga configurado: <@&${roleId}>`)] });
            }

            case 'cargo-claim-180':
            case 'cargo-claim-3h':
            case 'claim-180': {
                const roleId = extractRoleId(rest[0]);
                if (!roleId) return msg.reply({ embeds: [buildErrorEmbed('Mencione o cargo. Ex: `!config cargo-claim-180 @Cargo`')] });
                config.cargoClaim180 = roleId;
                db.setConfig('cargoClaim180', roleId);
                saveConfig(config);
                return msg.reply({ embeds: [buildOkEmbed(`Cargo de claim 3h configurado: <@&${roleId}>`)] });
            }

            case 'whatsapp-massivo':
            case 'whatsapp-masslog': {
                if (!value) return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config whatsapp-massivo <ativar/desativar>`')] });
                const lower = value.toLowerCase();
                if (lower === 'sim' || lower === 'yes' || lower === 'true' || lower === 'ativar' || lower === 'on') {
                    config.whatsappMassLogEnabled = 'true';
                    db.setConfig('whatsappMassLogEnabled', 'true');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('Notificações de massivo por WhatsApp **ativadas**.')] });
                } else if (lower === 'não' || lower === 'nao' || lower === 'no' || lower === 'false' || lower === 'desativar' || lower === 'off') {
                    config.whatsappMassLogEnabled = 'false';
                    db.setConfig('whatsappMassLogEnabled', 'false');
                    saveConfig(config);
                    return msg.reply({ embeds: [buildOkEmbed('Notificações de massivo por WhatsApp **desativadas**.')] });
                } else {
                    return msg.reply({ embeds: [buildErrorEmbed('Uso: `!config whatsapp-massivo <ativar/desativar>`')] });
                }
            }

            // ── Ajuda ────────────────────────────────────────────────────────
            default: {
                return msg.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x4488FF)
                            .setTitle('⚙️ Comandos de Configuração')
                            .addFields(
                                { name: '!config',                          value: 'Mostra configuração atual',                inline: false },
                                { name: '!config guilda <nome>',            value: 'Define guilda monitorada',                 inline: false },
                                { name: '!config mundo <nome>',             value: 'Define mundo monitorado',                  inline: false },
                                { name: '!config guilda-inimiga <nome>',    value: 'Define guilda inimiga para placar',        inline: false },
                                { name: '!config canal-mortes #canal',      value: 'Canal para notificações de mortes',        inline: false },
                                { name: '!config canal-relatorio #canal',   value: 'Canal para relatório diário',              inline: false },
                                { name: '!config canal-inimigos #canal',    value: 'Canal para alertas de inimigos online',    inline: false },
                                { name: '!config canal-frags #canal',       value: 'Canal para alertas de frags',              inline: false },
                                { name: '!config canal-guerra #canal',      value: 'Canal para alertas de modo guerra (texto)', inline: false },
                                { name: '!config canal-guerra-voz #canal',  value: 'Canal de voz de guerra para o Mass Log',    inline: false },
                                { name: '!config canal-levelup #canal/off',  value: 'Canal exclusivo de notificações de level up (aliados + inimigos)', inline: false },
                                { name: '!config canal-comandos #canal',    value: 'Canal exclusivo para comandos de claim',   inline: false },
                                { name: '!config canal-painel #canal',      value: 'Canal do painel de respawns em tempo real',inline: false },
                                { name: '!config canal-limpo #canal/off',   value: 'Canal onde mensagens de membros são apagadas na hora',inline: false },
                                { name: '!config canal-gerador-voz #canal/off', value: 'Canal de voz mestre que cria salas dinâmicas ao entrar',inline: false },
                                { name: '!config canal-registros #canal/off', value: 'Canal onde as informações de registro formatadas são postadas', inline: false },
                                { name: '!config canal-monitor-inimigos #canal', value: 'Canal de monitoramento de inimigos caçando em tempo real', inline: false },
                                { name: '!config guerra on/off',            value: 'Ativa/desativa modo guerra',               inline: false },
                                { name: '!config cargo-claim-90 @Cargo',    value: 'Define cargo permitido reservar 1h30',     inline: false },
                                { name: '!config cargo-claim-180 @Cargo',   value: 'Define cargo permitido reservar 3h',       inline: false },
                                { name: '!config whatsapp-massivo <ativar/desativar>', value: 'Ativa/desativa alertas de masslog no WhatsApp', inline: false },
                                { name: '🏦 /config-gb (Slash)',              value: 'Configura Cargo, GB e Valores da Taxa',    inline: false },
                                { name: '!config gb <nome>',                value: 'Define personagem do Guild Bank (GB)',     inline: false },
                                { name: '!config hunted <nome>',            value: 'Adiciona inimigo ao radar',                inline: false },
                                { name: '!config remove-hunted <nome>',     value: 'Remove inimigo do radar',                  inline: false },
                                { name: '!config hunted-list',              value: 'Lista inimigos no radar',                  inline: false },
                            )
                            .setFooter({ text: 'Ascended Bot • RubinOT | Somente Admins' })
                            .setTimestamp()
                    ]
                });
            }
        }
    },
};

function extractChannelId(mention) {
    if (!mention) return null;
    const match = mention.match(/^<#(\d+)>$/) || mention.match(/^(\d+)$/);
    return match ? match[1] : null;
}

function extractRoleId(mention) {
    if (!mention) return null;
    const match = mention.match(/^<@&(\d+)>$/) || mention.match(/^(\d+)$/);
    return match ? match[1] : null;
}

function buildOkEmbed(text) {
    return new EmbedBuilder()
        .setColor(0x44FF88)
        .setTitle('✅ Configuração Salva')
        .setDescription(text)
        .setFooter({ text: 'Ascended Bot • RubinOT' })
        .setTimestamp();
}
