'use strict';

const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    PermissionFlagsBits 
} = require('discord.js');
const db = require('../modules/database');

function isAdmin(member, config) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild))   return true;
    if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
    return false;
}

module.exports = {
    name: 'planilhado',
    aliases: ['planilha', 'reserva-diaria'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('planilhado')
        .setDescription('Sistema de Reservas Diárias de Respawns (Planilhados)')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Configura o sistema de planilhados (Categoria, canais e painel) - Admin apenas')
        )
        .addSubcommand(sub =>
            sub.setName('solicitar')
                .setDescription('Solicita a reserva diária fixada de um respawn para sua PT')
                .addStringOption(opt => opt.setName('respawn').setDescription('Código ou nome do respawn (Ex: B16, P17)').setRequired(true))
                .addStringOption(opt => opt.setName('horario').setDescription('Horário da caçada diária no formato HH:MM-HH:MM (Ex: 20:00-22:00)').setRequired(true))
                .addUserOption(opt => opt.setName('membro1').setDescription('Primeiro parceiro da PT (Cadastrado)').setRequired(true))
                .addUserOption(opt => opt.setName('membro2').setDescription('Segundo parceiro da PT (Cadastrado)').setRequired(true))
                .addUserOption(opt => opt.setName('membro3').setDescription('Terceiro parceiro da PT (Cadastrado)').setRequired(true))
                .addUserOption(opt => opt.setName('membro4').setDescription('Quarto parceiro da PT (Opcional - Cadastrado)').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('checkin')
                .setDescription('Confirma presença diária no seu planilhado (Disponível de 1h antes até 15min depois)')
        )
        .addSubcommand(sub =>
            sub.setName('listar')
                .setDescription('Lista todos os respawns planilhados ativos e em fila de espera')
        ),

    // ─── Comando por Prefixo (!planilhado) ────────────────────────────────────
    async execute(msg, args, { config, saveConfig }) {
        if (!args.length) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x9b59b6)
                        .setTitle('📅 Sistema de Planilhado (Reservas Diárias)')
                        .setDescription(
                            `Organize as caçadas fixas diárias do seu time!\n\n` +
                            `⚙️ **Comandos Administrativos:**\n` +
                            `• \`!planilhado setup\` - Configura a categoria e canais do sistema.\n\n` +
                            `👥 **Comandos de Usuário:**\n` +
                            `• \`!planilhado solicitar <respawn> <horário> @membro1 @membro2 @membro3 [@membro4]\` - Solicita a reserva de um respawn (ex: B16) em um horário fixo (ex: 20:00-22:00) mencionando o time (4 ou 5 membros no total).\n` +
                            `• \`!planilhado checkin\` - Confirma a presença do time no dia de hoje (feito pelo líder).\n` +
                            `• \`!planilhado listar\` - Exibe a listagem pública dos planilhados.`
                        )
                        .setFooter({ text: 'Ascended Planilhados' })
                ]
            });
        }

        const subCmd = args[0].toLowerCase();

        // 1. SETUP (Admin apenas)
        if (subCmd === 'setup') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem configurar o sistema de planilhados.');
            }

            const { deleteOldPlanilhadoSetup, getOrCreatePlanilhadoCategory, getOrCreatePlanilhadoChannels, updatePlanilhadoListDashboard } = require('../modules/planilhadoManager');
            const statusMsg = await msg.reply('🔄 Limpando configuração antiga e configurando sistema de planilhados, aguarde...');

            await deleteOldPlanilhadoSetup(msg.guild);
            await new Promise(r => setTimeout(r, 1500)); // Aguarda cache atualizar

            const category = await getOrCreatePlanilhadoCategory(msg.guild);
            const { chanSolicitar, chanPainel, chanLista } = await getOrCreatePlanilhadoChannels(msg.guild, category);

            // Salva na config
            db.setConfig('planilhadoCategoryId', category.id);
            db.setConfig('planilhadoRequestChannelId', chanSolicitar.id);
            db.setConfig('planilhadoAdminChannelId', chanPainel.id);
            db.setConfig('planilhadoListChannelId', chanLista.id);

            config.planilhadoCategoryId = category.id;
            config.planilhadoRequestChannelId = chanSolicitar.id;
            config.planilhadoAdminChannelId = chanPainel.id;
            config.planilhadoListChannelId = chanLista.id;
            saveConfig(config);

            // Envia embed explicativo com botão no canal de solicitações
            const panelEmbed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('📅 Solicitações de Planilhados (Reservas Diárias)')
                .setDescription(
                    `Deseja fixar um horário diário de caça para a sua PT?\n\n` +
                    `**Regras Principais:**\n` +
                    `1️⃣ O time deve ter obrigatoriamente **4 ou 5 membros** (todos registrados no bot do Discord).\n` +
                    `2️⃣ A reserva tem duração de **15 dias**. Caso outra PT queira o mesmo respawn e horário, haverá um revezamento automático (rotação) ao final do ciclo.\n` +
                    `3️⃣ O líder da PT deve dar **check-in diariamente** entre 1 hora antes e 15 minutos depois do horário da hunt, caso contrário a reserva será liberada para claims comuns naquele dia.\n\n` +
                    `💡 **Como solicitar?**\n` +
                    `Clique no botão **Solicitar Planilhado** abaixo para preencher o formulário interativo, ou use o comando:\n` +
                    `\`!planilhado solicitar <respawn> <horário> @membro1 @membro2 @membro3 [@membro4]\``
                )
                .setFooter({ text: 'Ascended Bot • Planilhados' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('planilhado_solicitar_btn')
                    .setLabel('📅 Solicitar Planilhado')
                    .setStyle(ButtonStyle.Primary)
            );

            // Apaga mensagens antigas do bot no canal de solicitações e envia o painel explicativo
            const messages = await chanSolicitar.messages.fetch({ limit: 50 }).catch(() => null);
            if (messages) {
                const botMsgs = messages.filter(m => m.author.id === msg.client.user.id);
                for (const bm of botMsgs.values()) {
                    await bm.delete().catch(() => {});
                }
            }
            await chanSolicitar.send({ embeds: [panelEmbed], components: [row] });

            // Atualiza a listagem pública (vazia)
            await updatePlanilhadoListDashboard(msg.guild);

            return statusMsg.edit('✅ Sistema de planilhados configurado com sucesso! Categoria e canais criados na barra lateral.');
        }

        // 2. SOLICITAR
        if (subCmd === 'solicitar') {
            const requestChannelId = config.planilhadoRequestChannelId;
            if (requestChannelId && msg.channelId !== requestChannelId && msg.channelId !== config.claimCommandsChannelId) {
                return msg.reply(`⚠️ As solicitações de planilhado devem ser enviadas no canal <#${requestChannelId}>.`);
            }

            // Verifica se o próprio líder que está solicitando é registrado
            const leaderReg = db.getRegisteredMember(msg.author.id);
            if (!leaderReg) {
                return msg.reply('🚫 **Vínculo Obrigatório:** Você precisa estar registrado no bot do clã para solicitar um planilhado.');
            }

            const respawnArg = args[1];
            const timeSlotArg = args[2];

            if (!respawnArg || !timeSlotArg) {
                return msg.reply('❌ Formato inválido! Uso: \`!planilhado solicitar <respawn> <horário> @membro1 @membro2 @membro3 [@membro4]\`');
            }

            // Valida o horário (HH:MM-HH:MM)
            const timeMatch = timeSlotArg.match(/^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/);
            if (!timeMatch) {
                return msg.reply('❌ Horário inválido! Use o formato de 24 horas `HH:MM-HH:MM`. Ex: `20:00-22:00`.');
            }

            // Valida o respawn
            const { findRespawn } = require('../modules/planilhadoManager');
            const respawn = findRespawn(respawnArg);
            if (!respawn) {
                return msg.reply(`❌ O respawn **"${respawnArg}"** não foi encontrado na lista oficial de hunts.`);
            }

            // Valida os membros da PT (deve conter mentions dos outros membros, tamanho total de 4 ou 5)
            const mentionedUsers = [...msg.mentions.users.values()].filter(u => u.id !== msg.author.id && !u.bot);
            if (mentionedUsers.length < 3 || mentionedUsers.length > 4) {
                return msg.reply('❌ A Party deve ter exatamente **4 ou 5 membros** no total (Você + 3 ou 4 companheiros mencionados).');
            }

            // Verifica se todos os membros mencionados estão registrados no bot
            for (const user of mentionedUsers) {
                const reg = db.getRegisteredMember(user.id);
                if (!reg) {
                    return msg.reply(`❌ O membro <@${user.id}> não está registrado no bot. Peça para ele se registrar antes.`);
                }
            }

            const memberIds = mentionedUsers.map(u => u.id).join(',');

            try {
                // Cria a solicitação no banco
                const requestId = db.createScheduleRequest(respawn.id, timeSlotArg, msg.author.id, memberIds);

                // Envia painel de aprovação para os admins
                const adminChannelId = config.planilhadoAdminChannelId;
                if (adminChannelId) {
                    const adminChannel = await msg.guild.channels.fetch(adminChannelId).catch(() => null);
                    if (adminChannel && adminChannel.isTextBased()) {
                        const adminEmbed = new EmbedBuilder()
                            .setColor(0xf39c12)
                            .setTitle('📥 Nova Solicitação de Planilhado')
                            .setDescription(
                                `**Líder da PT:** ${msg.author} (${msg.author.tag})\n` +
                                `**Respawn solicitado:** \`${respawn.id}\` — **${respawn.name}** (${respawn.category})\n` +
                                `**Horário pretendido:** \`${timeSlotArg}\`\n\n` +
                                `**Membros da PT:**\n` +
                                mentionedUsers.map((u, i) => `· Membro ${i + 1}: <@${u.id}>`).join('\n')
                            )
                            .setTimestamp();

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`pl_approve_${requestId}`)
                                .setLabel('Aprovar')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`pl_reject_${requestId}`)
                                .setLabel('Recusar')
                                .setStyle(ButtonStyle.Danger)
                        );

                        await adminChannel.send({ embeds: [adminEmbed], components: [row] });
                    }
                }

                return msg.reply('✅ **Solicitação enviada com sucesso!** Os administradores analisarão seu planilhado e você receberá uma DM com a resposta em breve.');
            } catch (err) {
                console.error('[PlanilhadoCommand] Erro ao enviar solicitação:', err.message);
                return msg.reply('❌ Ocorreu um erro interno ao processar a solicitação de planilhado.');
            }
        }

        // 3. CHECKIN
        if (subCmd === 'checkin' || subCmd === 'presenca') {
            const { handleCheckInFlow } = require('../modules/planilhadoManager');
            const result = await handleCheckInFlow(msg.author, msg.member, msg.guild, config);
            if (result.error) {
                return msg.reply(result.error);
            }
            return msg.reply(result.message);
        }

        // 4. LISTAR
        if (subCmd === 'listar') {
            const allSchedules = db.getAllSchedules();
            const active = allSchedules.filter(s => s.active === 1);
            
            if (active.length === 0) {
                return msg.reply('📅 Nenhum planilhado diário ativo no momento.');
            }

            const embed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('📅 Respawns Planilhados Ativos')
                .setDescription('Lista rápida de reservas diárias fixas:');

            active.forEach(s => {
                const resp = findRespawn(s.respawn_id);
                const name = resp ? resp.name : s.respawn_id;
                const members = s.member_ids ? s.member_ids.split(',').map(id => `<@${id}>`).join(', ') : 'Nenhum';
                embed.addFields({
                    name: `📍 \`${s.respawn_id}\` — ${name} | ⏰ ${s.time_slot}`,
                    value: `👑 **Líder:** <@${s.leader_discord_id}>\n👥 **Membros:** ${members}`,
                    inline: false
                });
            });

            return msg.reply({ embeds: [embed] });
        }

        return msg.reply('❌ Subcomando inválido! Use `!planilhado` para ajuda.');
    },

    // ─── Comando por Slash (/planilhado) ──────────────────────────────────────
    async executeSlash(interaction, { config, saveConfig }) {
        const subCmd = interaction.options.getSubcommand();

        // 1. SETUP (Admin apenas)
        if (subCmd === 'setup') {
            if (!isAdmin(interaction.member, config)) {
                return interaction.reply({ content: '🚫 Apenas administradores podem configurar o sistema de planilhados.', ephemeral: true });
            }

            await interaction.deferReply();
            const { deleteOldPlanilhadoSetup, getOrCreatePlanilhadoCategory, getOrCreatePlanilhadoChannels, updatePlanilhadoListDashboard } = require('../modules/planilhadoManager');

            await deleteOldPlanilhadoSetup(interaction.guild);
            await new Promise(r => setTimeout(r, 1500)); // Aguarda cache atualizar

            const category = await getOrCreatePlanilhadoCategory(interaction.guild);
            const { chanSolicitar, chanPainel, chanLista } = await getOrCreatePlanilhadoChannels(interaction.guild, category);

            // Salva na config
            db.setConfig('planilhadoCategoryId', category.id);
            db.setConfig('planilhadoRequestChannelId', chanSolicitar.id);
            db.setConfig('planilhadoAdminChannelId', chanPainel.id);
            db.setConfig('planilhadoListChannelId', chanLista.id);

            config.planilhadoCategoryId = category.id;
            config.planilhadoRequestChannelId = chanSolicitar.id;
            config.planilhadoAdminChannelId = chanPainel.id;
            config.planilhadoListChannelId = chanLista.id;
            saveConfig(config);

            const panelEmbed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('📅 Solicitações de Planilhados (Reservas Diárias)')
                .setDescription(
                    `Deseja fixar um horário diário de caça para a sua PT?\n\n` +
                    `**Regras Principais:**\n` +
                    `1️⃣ O time deve ter obrigatoriamente **4 ou 5 membros** (todos registrados no bot do Discord).\n` +
                    `2️⃣ A reserva tem duração de **15 dias**. Caso outra PT queira o mesmo respawn e horário, haverá um revezamento automático (rotação) ao final do ciclo.\n` +
                    `3️⃣ O líder da PT deve dar **check-in diariamente** entre 1 hora antes e 15 minutos depois do horário da hunt, caso contrário a reserva será liberada para claims comuns naquele dia.\n\n` +
                    `💡 **Como solicitar?**\n` +
                    `Clique no botão **Solicitar Planilhado** abaixo para preencher o formulário interativo, ou use o comando:\n` +
                    `\`/planilhado solicitar respawn:<código> horario:<horário> membro1:<@membro> membro2:<@membro> membro3:<@membro> [membro4:<@membro>]\``
                )
                .setFooter({ text: 'Ascended Bot • Planilhados' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('planilhado_solicitar_btn')
                    .setLabel('📅 Solicitar Planilhado')
                    .setStyle(ButtonStyle.Primary)
            );

            const messages = await chanSolicitar.messages.fetch({ limit: 50 }).catch(() => null);
            if (messages) {
                const botMsgs = messages.filter(m => m.author.id === interaction.client.user.id);
                for (const bm of botMsgs.values()) {
                    await bm.delete().catch(() => {});
                }
            }
            await chanSolicitar.send({ embeds: [panelEmbed], components: [row] });

            await updatePlanilhadoListDashboard(interaction.guild);
            return interaction.editReply('✅ Sistema de planilhados configurado com sucesso! Categoria e canais criados na barra lateral.');
        }

        // 2. SOLICITAR
        if (subCmd === 'solicitar') {
            const requestChannelId = config.planilhadoRequestChannelId;
            if (requestChannelId && interaction.channelId !== requestChannelId && interaction.channelId !== config.claimCommandsChannelId) {
                return interaction.reply({ content: `⚠️ As solicitações de planilhado devem ser enviadas no canal <#${requestChannelId}>.`, ephemeral: true });
            }

            const leaderReg = db.getRegisteredMember(interaction.user.id);
            if (!leaderReg) {
                return interaction.reply({ content: '🚫 **Vínculo Obrigatório:** Você precisa estar registrado no bot do clã para solicitar um planilhado.', ephemeral: true });
            }

            const respawnArg = interaction.options.getString('respawn');
            const timeSlotArg = interaction.options.getString('horario');

            // Valida o horário (HH:MM-HH:MM)
            const timeMatch = timeSlotArg.match(/^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/);
            if (!timeMatch) {
                return interaction.reply({ content: '❌ Horário inválido! Use o formato de 24 horas `HH:MM-HH:MM`. Ex: `20:00-22:00`.', ephemeral: true });
            }

            // Valida o respawn
            const { findRespawn } = require('../modules/planilhadoManager');
            const respawn = findRespawn(respawnArg);
            if (!respawn) {
                return interaction.reply({ content: `❌ O respawn **"${respawnArg}"** não foi encontrado na lista oficial de hunts.`, ephemeral: true });
            }

            const m1 = interaction.options.getUser('membro1');
            const m2 = interaction.options.getUser('membro2');
            const m3 = interaction.options.getUser('membro3');
            const m4 = interaction.options.getUser('membro4');

            const members = [m1, m2, m3, m4].filter(Boolean).filter(u => u.id !== interaction.user.id && !u.bot);

            if (members.length < 3 || members.length > 4) {
                return interaction.reply({ content: '❌ A Party deve ter exatamente **4 ou 5 membros** no total (Você + 3 ou 4 companheiros selecionados).', ephemeral: true });
            }

            // Verifica se todos os membros mencionados estão registrados no bot
            for (const user of members) {
                const reg = db.getRegisteredMember(user.id);
                if (!reg) {
                    return interaction.reply({ content: `❌ O membro <@${user.id}> não está registrado no bot. Peça para ele se registrar antes.`, ephemeral: true });
                }
            }

            await interaction.deferReply();
            const memberIds = members.map(u => u.id).join(',');

            try {
                const requestId = db.createScheduleRequest(respawn.id, timeSlotArg, interaction.user.id, memberIds);

                // Envia painel de aprovação para os admins
                const adminChannelId = config.planilhadoAdminChannelId;
                if (adminChannelId) {
                    const adminChannel = await interaction.guild.channels.fetch(adminChannelId).catch(() => null);
                    if (adminChannel && adminChannel.isTextBased()) {
                        const adminEmbed = new EmbedBuilder()
                            .setColor(0xf39c12)
                            .setTitle('📥 Nova Solicitação de Planilhado')
                            .setDescription(
                                `**Líder da PT:** ${interaction.user} (${interaction.user.tag})\n` +
                                `**Respawn solicitado:** \`${respawn.id}\` — **${respawn.name}** (${respawn.category})\n` +
                                `**Horário pretendido:** \`${timeSlotArg}\`\n\n` +
                                `**Membros da PT:**\n` +
                                members.map((u, i) => `· Membro ${i + 1}: <@${u.id}>`).join('\n')
                            )
                            .setTimestamp();

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`pl_approve_${requestId}`)
                                .setLabel('Aprovar')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`pl_reject_${requestId}`)
                                .setLabel('Recusar')
                                .setStyle(ButtonStyle.Danger)
                        );

                        await adminChannel.send({ embeds: [adminEmbed], components: [row] });
                    }
                }

                return interaction.editReply('✅ **Solicitação enviada com sucesso!** Os administradores analisarão seu planilhado e você receberá uma DM com a resposta em breve.');
            } catch (err) {
                console.error('[PlanilhadoCommand] Erro ao enviar solicitação:', err.message);
                return interaction.editReply('❌ Ocorreu um erro interno ao processar a solicitação de planilhado.');
            }
        }

        // 3. CHECKIN
        if (subCmd === 'checkin') {
            await interaction.deferReply();
            const { handleCheckInFlow } = require('../modules/planilhadoManager');
            const result = await handleCheckInFlow(interaction.user, interaction.member, interaction.guild, config);
            if (result.error) {
                return interaction.editReply(result.error);
            }
            return interaction.editReply(result.message);
        }

        // 4. LISTAR
        if (subCmd === 'listar') {
            const allSchedules = db.getAllSchedules();
            const active = allSchedules.filter(s => s.active === 1);
            
            if (active.length === 0) {
                return interaction.reply({ content: '📅 Nenhum planilhado diário ativo no momento.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('📅 Respawns Planilhados Ativos')
                .setDescription('Lista rápida de reservas diárias fixas:');

            active.forEach(s => {
                const resp = findRespawn(s.respawn_id);
                const name = resp ? resp.name : s.respawn_id;
                const members = s.member_ids ? s.member_ids.split(',').map(id => `<@${id}>`).join(', ') : 'Nenhum';
                embed.addFields({
                    name: `📍 \`${s.respawn_id}\` — ${name} | ⏰ ${s.time_slot}`,
                    value: `👑 **Líder:** <@${s.leader_discord_id}>\n👥 **Membros:** ${members}`,
                    inline: false
                });
            });

            return interaction.reply({ embeds: [embed] });
        }
    }
};
