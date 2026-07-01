'use strict';

const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType
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
    name: 'ticket',
    aliases: ['tickets'],
    adminOnly: false, // Controlado internamente por subcomando

    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Comandos de gerenciamento do sistema de tickets')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Configura o painel de tickets neste canal (Admin apenas)')
        )
        .addSubcommand(sub =>
            sub.setName('close')
                .setDescription('Fecha o ticket atual')
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Adiciona um membro ao ticket atual')
                .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a ser adicionado').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove um membro do ticket atual')
                .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a ser removido').setRequired(true))
        ),

    // ─── Comando por Prefixo (!ticket) ────────────────────────────────────────
    async execute(msg, args, { config, saveConfig, client }) {
        if (!args.length) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0x3498db)
                        .setTitle('🎫 Como usar o sistema de Tickets')
                        .setDescription(
                            `Use os subcomandos abaixo:\n\n` +
                            `⚙️ **Administração:**\n` +
                            `• \`!ticket setup\` - Configura o painel de tickets no canal atual.\n\n` +
                            `🎫 **Dentro de um ticket:**\n` +
                            `• \`!ticket add @usuario\` - Adiciona um membro ao ticket.\n` +
                            `• \`!ticket remove @usuario\` - Remove um membro do ticket.\n` +
                            `• \`!ticket close\` - Fecha o ticket atual.`
                        )
                        .setFooter({ text: 'Ascended Tickets' })
                ]
            });
        }

        const subCmd = args[0].toLowerCase();

        // 1. SETUP (Admin apenas)
        if (subCmd === 'setup') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem configurar o sistema de tickets.').catch(() => {});
            }

            const { getOrCreateCategory, getOrCreateSupportRole, getOrCreateLogChannel, getOrCreatePanelChannel } = require('../modules/ticketManager');

            const statusMsg = await msg.reply('🔄 Configurando sistema de tickets, aguarde...').catch(() => {});
            
            const category = await getOrCreateCategory(msg.guild);
            const supportRole = await getOrCreateSupportRole(msg.guild);
            const logChannel = await getOrCreateLogChannel(msg.guild, category, supportRole);
            const panelChannel = await getOrCreatePanelChannel(msg.guild, category, supportRole);

            // Salva na config
            db.setConfig('ticketCategoryId', category.id);
            db.setConfig('ticketSupportRoleId', supportRole.id);
            db.setConfig('ticketLogChannelId', logChannel.id);
            db.setConfig('ticketPanelChannelId', panelChannel.id);
            config.ticketCategoryId = category.id;
            config.ticketSupportRoleId = supportRole.id;
            config.ticketLogChannelId = logChannel.id;
            config.ticketPanelChannelId = panelChannel.id;
            saveConfig(config);

            const panelEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('🎫 Central de Atendimento — Suporte')
                .setDescription(
                    `Precisa de ajuda com alguma dúvida, denúncia ou problema?\n\n` +
                    `Clique no botão verde **Abrir Ticket** abaixo para iniciar um atendimento privado com nossa equipe de **Suporte**.`
                )
                .setFooter({ text: 'Ascended Bot • Suporte' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_create')
                    .setLabel('Abrir Ticket')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Success)
            );

            const panelMessage = await panelChannel.send({ embeds: [panelEmbed], components: [row] });
            db.setConfig('ticketPanelMessageId', panelMessage.id);
            config.ticketPanelMessageId = panelMessage.id;
            saveConfig(config);

            return statusMsg.edit(`✅ Sistema de tickets configurado com sucesso! O canal de abertura foi criado em <#${panelChannel.id}>.`);
        }

        // 2. CLOSE
        if (subCmd === 'close') {
            const ticket = db.getTicketByChannel(msg.channel.id);
            if (!ticket) {
                return msg.reply('❌ Este canal não é um ticket registrado ou ativo.').catch(() => {});
            }

            // Simula clique no botão de fechar chamando a função de interação
            const { handleTicketInteraction } = require('../modules/ticketManager');
            // Cria um mock de interaction
            const interactionMock = {
                customId: 'ticket_close',
                guild: msg.guild,
                channelId: msg.channel.id,
                channel: msg.channel,
                user: msg.author,
                member: msg.member,
                message: msg,
                deferReply: async () => {},
                editReply: async (payload) => msg.reply(payload).catch(() => {}),
                reply: async (payload) => msg.reply(payload).catch(() => {}),
                followUp: async (payload) => msg.reply(payload).catch(() => {})
            };
            return handleTicketInteraction(interactionMock);
        }

        // 3. ADD
        if (subCmd === 'add') {
            const ticket = db.getTicketByChannel(msg.channel.id);
            if (!ticket) {
                return msg.reply('❌ Este comando só pode ser executado dentro de um ticket ativo.').catch(() => {});
            }

            if (msg.author.id !== ticket.user_id && !msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return msg.reply('🚫 Apenas o criador do ticket ou um Administrador pode adicionar membros.').catch(() => {});
            }

            const targetUser = msg.mentions.users.first();
            if (!targetUser) {
                return msg.reply('❌ Mencione o usuário que deseja adicionar ao ticket. Ex: `!ticket add @usuario`').catch(() => {});
            }

            try {
                await msg.channel.permissionOverwrites.edit(targetUser.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    AttachFiles: true,
                    EmbedLinks: true,
                    ReadMessageHistory: true
                });
                return msg.reply(`✅ **${targetUser.username}** foi adicionado ao ticket com sucesso.`).catch(() => {});
            } catch (err) {
                console.error('[Tickets] Erro ao adicionar usuário:', err.message);
                return msg.reply('❌ Ocorreu um erro ao adicionar o usuário ao ticket.').catch(() => {});
            }
        }

        // 4. REMOVE
        if (subCmd === 'remove') {
            const ticket = db.getTicketByChannel(msg.channel.id);
            if (!ticket) {
                return msg.reply('❌ Este comando só pode ser executado dentro de um ticket ativo.').catch(() => {});
            }

            if (msg.author.id !== ticket.user_id && !msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return msg.reply('🚫 Apenas o criador do ticket ou um Administrador pode remover membros.').catch(() => {});
            }

            const targetUser = msg.mentions.users.first();
            if (!targetUser) {
                return msg.reply('❌ Mencione o usuário que deseja remover do ticket. Ex: `!ticket remove @usuario`').catch(() => {});
            }

            if (targetUser.id === ticket.user_id) {
                return msg.reply('❌ Você não pode remover o criador do ticket.').catch(() => {});
            }

            try {
                await msg.channel.permissionOverwrites.delete(targetUser.id);
                return msg.reply(`✅ **${targetUser.username}** foi removido do ticket com sucesso.`).catch(() => {});
            } catch (err) {
                console.error('[Tickets] Erro ao remover usuário:', err.message);
                return msg.reply('❌ Ocorreu um erro ao remover o usuário do ticket.').catch(() => {});
            }
        }

        return msg.reply('❌ Subcomando inválido. Use `!ticket` para ajuda.').catch(() => {});
    },

    // ─── Comando por Slash (/ticket) ──────────────────────────────────────────
    async executeSlash(interaction, { config, saveConfig, client }) {
        const subCmd = interaction.options.getSubcommand();

        // 1. SETUP (Admin apenas)
        if (subCmd === 'setup') {
            if (!isAdmin(interaction.member, config)) {
                return interaction.reply({ content: '🚫 Apenas administradores podem configurar o sistema de tickets.', ephemeral: true });
            }

            await interaction.deferReply();
            const { getOrCreateCategory, getOrCreateSupportRole, getOrCreateLogChannel, getOrCreatePanelChannel } = require('../modules/ticketManager');
            
            const category = await getOrCreateCategory(interaction.guild);
            const supportRole = await getOrCreateSupportRole(interaction.guild);
            const logChannel = await getOrCreateLogChannel(interaction.guild, category, supportRole);
            const panelChannel = await getOrCreatePanelChannel(interaction.guild, category, supportRole);

            // Salva na config
            db.setConfig('ticketCategoryId', category.id);
            db.setConfig('ticketSupportRoleId', supportRole.id);
            db.setConfig('ticketLogChannelId', logChannel.id);
            db.setConfig('ticketPanelChannelId', panelChannel.id);
            config.ticketCategoryId = category.id;
            config.ticketSupportRoleId = supportRole.id;
            config.ticketLogChannelId = logChannel.id;
            config.ticketPanelChannelId = panelChannel.id;
            saveConfig(config);

            const panelEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('🎫 Central de Atendimento — Suporte')
                .setDescription(
                    `Precisa de ajuda com alguma dúvida, denúncia ou problema?\n\n` +
                    `Clique no botão verde **Abrir Ticket** abaixo para iniciar um atendimento privado com nossa equipe de **Suporte**.`
                )
                .setFooter({ text: 'Ascended Bot • Suporte' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_create')
                    .setLabel('Abrir Ticket')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Success)
            );

            const panelMessage = await panelChannel.send({ embeds: [panelEmbed], components: [row] });
            db.setConfig('ticketPanelMessageId', panelMessage.id);
            config.ticketPanelMessageId = panelMessage.id;
            saveConfig(config);

            return interaction.editReply(`✅ Sistema de tickets configurado com sucesso! O canal de abertura foi criado em <#${panelChannel.id}>.`).catch(() => {});
        }

        // 2. CLOSE
        if (subCmd === 'close') {
            const ticket = db.getTicketByChannel(interaction.channelId);
            if (!ticket) {
                return interaction.reply({ content: '❌ Este canal não é um ticket registrado ou ativo.', ephemeral: true });
            }

            const { handleTicketInteraction } = require('../modules/ticketManager');
            // Cria um mock de interaction
            const interactionMock = {
                customId: 'ticket_close',
                guild: interaction.guild,
                channelId: interaction.channelId,
                channel: interaction.channel,
                user: interaction.user,
                member: interaction.member,
                message: interaction.message,
                deferReply: async () => interaction.deferReply(),
                editReply: async (payload) => interaction.editReply(payload).catch(() => {}),
                reply: async (payload) => interaction.reply(payload),
                followUp: async (payload) => interaction.followUp(payload)
            };
            return handleTicketInteraction(interactionMock);
        }

        // 3. ADD
        if (subCmd === 'add') {
            const ticket = db.getTicketByChannel(interaction.channelId);
            if (!ticket) {
                return interaction.reply({ content: '❌ Este comando só pode ser executado dentro de um ticket ativo.', ephemeral: true });
            }

            if (interaction.user.id !== ticket.user_id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '🚫 Apenas o criador do ticket ou um Administrador pode adicionar membros.', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('usuario');

            try {
                await interaction.channel.permissionOverwrites.edit(targetUser.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    AttachFiles: true,
                    EmbedLinks: true,
                    ReadMessageHistory: true
                });
                return interaction.reply({ content: `✅ **${targetUser.username}** foi adicionado ao ticket com sucesso.` });
            } catch (err) {
                console.error('[Tickets] Erro ao adicionar usuário:', err.message);
                return interaction.reply({ content: '❌ Ocorreu um erro ao adicionar o usuário ao ticket.', ephemeral: true });
            }
        }

        // 4. REMOVE
        if (subCmd === 'remove') {
            const ticket = db.getTicketByChannel(interaction.channelId);
            if (!ticket) {
                return interaction.reply({ content: '❌ Este comando só pode ser executado dentro de um ticket ativo.', ephemeral: true });
            }

            if (interaction.user.id !== ticket.user_id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '🚫 Apenas o criador do ticket ou um Administrador pode remover membros.', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('usuario');
            if (targetUser.id === ticket.user_id) {
                return interaction.reply({ content: '❌ Você não pode remover o criador do ticket.', ephemeral: true });
            }

            try {
                await interaction.channel.permissionOverwrites.delete(targetUser.id);
                return interaction.reply({ content: `✅ **${targetUser.username}** foi removido do ticket com sucesso.` });
            } catch (err) {
                console.error('[Tickets] Erro ao remover usuário:', err.message);
                return interaction.reply({ content: '❌ Ocorreu um erro ao remover o usuário do ticket.', ephemeral: true });
            }
        }
    }
};
