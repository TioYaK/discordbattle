'use strict';

const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    AttachmentBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
const db = require('./database');

// Lock em memória para evitar criação concorrente (Race Condition)
const pendingTickets = new Set();

// Configurações padrão
const CATEGORY_NAME = '🎫 TICKETS';
const ROLE_NAME = 'suporte-ticket';
const LOG_CHANNEL_NAME = 'histórico-tickets';

/**
 * Auxiliar para buscar ou criar a categoria de tickets
 */
async function getOrCreateCategory(guild) {
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory);
    if (!category) {
        try {
            category = await guild.channels.create({
                name: CATEGORY_NAME,
                type: ChannelType.GuildCategory
            });
            console.log(`[Tickets] Categoria "${CATEGORY_NAME}" criada com sucesso.`);
        } catch (err) {
            console.error('[Tickets] Erro ao criar categoria:', err.message);
        }
    }
    return category;
}

/**
 * Auxiliar para buscar ou criar o cargo de suporte
 */
async function getOrCreateSupportRole(guild) {
    let role = guild.roles.cache.find(r => r.name === ROLE_NAME);
    if (!role) {
        try {
            role = await guild.roles.create({
                name: ROLE_NAME,
                color: '#3498db',
                reason: 'Cargo para gerenciar o sistema de tickets'
            });
            console.log(`[Tickets] Cargo "${ROLE_NAME}" criado com sucesso.`);
        } catch (err) {
            console.error('[Tickets] Erro ao criar cargo de suporte:', err.message);
        }
    }
    return role;
}

/**
 * Auxiliar para buscar ou criar o canal de logs/histórico
 */
async function getOrCreateLogChannel(guild, category, supportRole) {
    let logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME && c.type === ChannelType.GuildText);
    if (!logChannel) {
        try {
            logChannel = await guild.channels.create({
                name: LOG_CHANNEL_NAME,
                type: ChannelType.GuildText,
                parent: category ? category.id : null,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: supportRole.id,
                        deny: [PermissionFlagsBits.ViewChannel] // Apenas admins visualizam
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ]
            });
            console.log(`[Tickets] Canal de logs "${LOG_CHANNEL_NAME}" criado com sucesso.`);
        } catch (err) {
            console.error('[Tickets] Erro ao criar canal de logs:', err.message);
        }
    }
    return logChannel;
}

/**
 * Auxiliar para buscar ou criar o canal de painel/abertura de tickets
 */
async function getOrCreatePanelChannel(guild, category, supportRole) {
    const PANEL_CHANNEL_NAME = 'criar-ticket';
    let panelChannel = guild.channels.cache.find(c => c.name === PANEL_CHANNEL_NAME && c.type === ChannelType.GuildText && c.parentId === category.id);
    if (!panelChannel) {
        try {
            panelChannel = await guild.channels.create({
                name: PANEL_CHANNEL_NAME,
                type: ChannelType.GuildText,
                parent: category ? category.id : null,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages] // Usuários só podem ver e clicar no botão
                    },
                    {
                        id: supportRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ]
            });
            console.log(`[Tickets] Canal de painel "${PANEL_CHANNEL_NAME}" criado com sucesso.`);
        } catch (err) {
            console.error('[Tickets] Erro ao criar canal de painel:', err.message);
        }
    }
    return panelChannel;
}

/**
 * Gerador de transcrição do ticket em formato de texto limpo
 */
async function generateTranscript(channel) {
    let messages = [];
    let lastId;
    
    // Busca até 500 mensagens do canal
    for (let i = 0; i < 5; i++) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        
        const fetched = await channel.messages.fetch(options).catch(() => null);
        if (!fetched || fetched.size === 0) break;
        
        messages.push(...fetched.values());
        lastId = fetched.lastKey();
        if (fetched.size < 100) break;
    }
    
    messages.reverse();
    
    let content = `==================================================\n`;
    content += ` TRANSCRICAO DE TICKET: #${channel.name}\n`;
    content += ` Data de Fechamento: ${new Date().toLocaleString('pt-BR')}\n`;
    content += `==================================================\n\n`;
    
    for (const msg of messages) {
        const timeStr = msg.createdAt.toLocaleString('pt-BR');
        if (msg.author.bot) {
            content += `[${timeStr}] [BOT] ${msg.author.tag}:\n`;
            if (msg.content) content += `  Conteúdo: ${msg.content}\n`;
            for (const embed of msg.embeds) {
                if (embed.title) content += `  Embed Título: ${embed.title}\n`;
                if (embed.description) content += `  Embed Descrição: ${embed.description}\n`;
                for (const f of embed.fields || []) {
                    content += `    Campo [${f.name}]: ${f.value}\n`;
                }
            }
        } else {
            const attachments = msg.attachments.map(a => a.url).join(', ');
            const attachStr = attachments ? ` (Anexos: ${attachments})` : '';
            content += `[${timeStr}] ${msg.author.tag}: ${msg.content}${attachStr}\n`;
        }
    }
    
    return content;
}

/**
 * Direcionador de interações de botões de ticket
 */
async function handleTicketInteraction(interaction) {
    const customId = interaction.customId;
    const guild = interaction.guild;
    const config = db.loadAllConfig(); // Carrega configs do banco

    // ─── Botão: Abrir Ticket ──────────────────────────────────────────────────
    if (customId === 'ticket_create') {
        if (pendingTickets.has(interaction.user.id)) {
            return interaction.reply({ content: '⏳ Aguarde, seu ticket está sendo criado...', ephemeral: true });
        }
        pendingTickets.add(interaction.user.id);

        await interaction.deferReply({ ephemeral: true });

        // Verifica se já existe um ticket aberto pelo usuário no banco
        const existingTicket = db.getActiveTicketByUser(interaction.user.id);
        if (existingTicket) {
            const channel = guild.channels.cache.get(existingTicket.channel_id);
            if (channel) {
                pendingTickets.delete(interaction.user.id);
                return interaction.editReply({ 
                    content: `❌ Você já possui um ticket aberto em <#${existingTicket.channel_id}>.` 
                });
            } else {
                // Caso o canal tenha sido deletado manualmente por um admin, limpa o registro
                db.deleteTicket(existingTicket.channel_id);
            }
        }

        // Garante a existência da categoria, cargo e canal de logs
        const category = await getOrCreateCategory(guild);
        const supportRole = await getOrCreateSupportRole(guild);
        
        if (!category || !supportRole) {
            pendingTickets.delete(interaction.user.id);
            return interaction.editReply({ 
                content: `❌ Ocorreu um erro na infraestrutura de tickets. Verifique se o bot possui permissão de "Gerenciar Canais" e "Gerenciar Cargos".` 
            });
        }

        const logChannel = await getOrCreateLogChannel(guild, category, supportRole);

        // Atualiza a config local caso tenham sido criados novos elementos
        if (category && config.ticketCategoryId !== category.id) {
            db.setConfig('ticketCategoryId', category.id);
        }
        if (supportRole && config.ticketSupportRoleId !== supportRole.id) {
            db.setConfig('ticketSupportRoleId', supportRole.id);
        }
        if (logChannel && config.ticketLogChannelId !== logChannel.id) {
            db.setConfig('ticketLogChannelId', logChannel.id);
        }

        try {
            // Cria o canal privado
            const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category ? category.id : null,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id: supportRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ]
            });

            // Cria o registro no banco de dados
            db.createTicket(ticketChannel.id, interaction.user.id);

            // Envia embed de boas-vindas no canal do ticket
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle(`🎫 Ticket Aberto — #${ticketChannel.name}`)
                .setDescription(
                    `Olá ${interaction.user}, bem-vindo ao seu canal de atendimento privado!\n\n` +
                    `Por favor, descreva detalhadamente a sua dúvida ou problema.\n` +
                    `A equipe de **Suporte** (${supportRole}) foi notificada e responderá o mais breve possível.`
                )
                .addFields(
                    { name: '👤 Criado por', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                    { name: '🛠️ Responsável', value: `Ninguém`, inline: true }
                )
                .setFooter({ text: 'Ascended Tickets' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('🙋 Assumir Ticket')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('🔒 Fechar Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `${interaction.user} | ${supportRole}`, embeds: [welcomeEmbed], components: [row] });

            pendingTickets.delete(interaction.user.id);
            return interaction.editReply({ 
                content: `✅ Seu ticket foi criado com sucesso em <#${ticketChannel.id}>.` 
            });

        } catch (err) {
            console.error('[Tickets] Erro ao criar canal de ticket:', err);
            pendingTickets.delete(interaction.user.id);
            return interaction.editReply({ 
                content: `❌ Ocorreu um erro interno ao criar seu ticket. Por favor, avise um administrador.` 
            });
        }
    }

    // ─── Botão: Assumir Ticket ────────────────────────────────────────────────
    if (customId === 'ticket_claim') {
        const supportRoleId = config.ticketSupportRoleId;
        const hasRole = supportRoleId && interaction.member.roles.cache.has(supportRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ 
                content: '🚫 Apenas a equipe de suporte pode assumir tickets.', 
                ephemeral: true 
            });
        }

        const ticket = db.getTicketByChannel(interaction.channelId);
        if (!ticket) {
            return interaction.reply({ content: '❌ Este canal não é um ticket ativo registrado no banco de dados.', ephemeral: true });
        }

        if (ticket.claimed_by) {
            const claimUser = guild.members.cache.get(ticket.claimed_by) || await guild.members.fetch(ticket.claimed_by).catch(() => null);
            const claimName = claimUser ? claimUser.user.tag : ticket.claimed_by;
            return interaction.reply({ 
                content: `⚠️ Este ticket já foi assumido por **${claimName}**.`, 
                ephemeral: true 
            });
        }

        try {
            db.claimTicket(interaction.channelId, interaction.user.id);

            // Atualiza o embed original
            const originalEmbed = interaction.message.embeds[0];
            if (originalEmbed) {
                const updatedEmbed = EmbedBuilder.from(originalEmbed);
                updatedEmbed.spliceFields(1, 1, { name: '🛠️ Responsável', value: `${interaction.user}`, inline: true });
                
                await interaction.message.edit({ embeds: [updatedEmbed] }).catch(() => {});
            }

            await interaction.reply({ 
                content: `🙋 **${interaction.user.username}** assumiu o atendimento deste ticket.` 
            });
        } catch (err) {
            console.error('[Tickets] Erro ao assumir ticket:', err.message);
            return interaction.reply({ content: '❌ Erro ao registrar reivindicação do ticket.', ephemeral: true });
        }
    }

    // ─── Botão: Fechar Ticket ─────────────────────────────────────────────────
    if (customId === 'ticket_close') {
        const ticket = db.getTicketByChannel(interaction.channelId);
        if (!ticket) {
            return interaction.reply({ content: '❌ Este canal não é um ticket ativo registrado no banco de dados.', ephemeral: true });
        }

        if (ticket.status === 'closed') {
            return interaction.reply({ content: '⚠️ Este ticket já se encontra fechado.', ephemeral: true });
        }

        const supportRoleId = config.ticketSupportRoleId;
        const hasRole = supportRoleId && interaction.member.roles.cache.has(supportRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const isOwner = ticket.user_id === interaction.user.id;

        if (!hasRole && !isAdmin && !isOwner) {
            return interaction.reply({ 
                content: '🚫 Você não tem permissão para fechar este ticket.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        try {
            db.closeTicket(interaction.channelId);

            // Remove o acesso de todos os membros específicos que foram adicionados ao ticket (incluindo o criador)
            for (const [id, overwrite] of interaction.channel.permissionOverwrites.cache) {
                // overwrite.type === 1 corresponde a tipo "member" (usuário individual)
                if (overwrite.type === 1 && id !== interaction.client.user.id) {
                    await overwrite.delete().catch(() => {});
                }
            }

            // Envia embed de ticket fechado
            const closeEmbed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('🔒 Ticket Fechado')
                .setDescription(
                    `Este ticket foi fechado por **${interaction.user.tag}**.\n` +
                    `Abaixo você pode optar por reabrir o ticket, gerar a transcrição ou deletar permanentemente o canal.`
                )
                .setFooter({ text: 'Ascended Tickets' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_reopen')
                    .setLabel('🔓 Reabrir')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('ticket_transcript')
                    .setLabel('📂 Salvar Logs')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('ticket_delete')
                    .setLabel('⛔ Deletar')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ embeds: [closeEmbed], components: [row] });

            // Envia logs de transcrição automática no canal de histórico
            const logChannelId = config.ticketLogChannelId;
            const logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
            if (logChannel) {
                const textTranscript = await generateTranscript(interaction.channel);
                const buffer = Buffer.from(textTranscript, 'utf-8');
                const fileAttachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });

                const ownerTag = ticketOwner ? ticketOwner.user.tag : ticket.user_id;
                const claimUser = ticket.claimed_by ? (guild.members.cache.get(ticket.claimed_by) || await guild.members.fetch(ticket.claimed_by).catch(() => null)) : null;
                const staffTag = claimUser ? claimUser.user.tag : (ticket.claimed_by || 'Ninguém');

                const logEmbed = new EmbedBuilder()
                    .setColor(0x95a5a6)
                    .setTitle(`📝 Histórico de Ticket — #${interaction.channel.name}`)
                    .addFields(
                        { name: '👤 Dono do Ticket', value: `<@${ticket.user_id}> (${ownerTag})`, inline: true },
                        { name: '🛠️ Atendido por', value: ticket.claimed_by ? `<@${ticket.claimed_by}> (${staffTag})` : 'Ninguém', inline: true },
                        { name: '🔒 Fechado por', value: `${interaction.user} (${interaction.user.tag})`, inline: true }
                    )
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed], files: [fileAttachment] });
            }

        } catch (err) {
            console.error('[Tickets] Erro ao fechar ticket:', err.message);
            return interaction.followUp({ content: '❌ Erro interno ao fechar ticket.', ephemeral: true });
        }
    }

    // ─── Botão: Reabrir Ticket ────────────────────────────────────────────────
    if (customId === 'ticket_reopen') {
        const supportRoleId = config.ticketSupportRoleId;
        const hasRole = supportRoleId && interaction.member.roles.cache.has(supportRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ 
                content: '🚫 Apenas a equipe de suporte pode reabrir tickets.', 
                ephemeral: true 
            });
        }

        const ticket = db.getTicketByChannel(interaction.channelId);
        if (!ticket) {
            return interaction.reply({ content: '❌ Este canal não é um ticket registrado no banco de dados.', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            db.reopenTicket(interaction.channelId);

            // Restaura o acesso do criador do ticket
            const ticketOwner = await guild.members.fetch(ticket.user_id).catch(() => null);
            if (ticketOwner) {
                await interaction.channel.permissionOverwrites.edit(ticketOwner.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    AttachFiles: true,
                    EmbedLinks: true,
                    ReadMessageHistory: true
                }).catch(e => console.warn('[Tickets] Não foi possível restaurar visualização do criador:', e.message));
            }

            // Remove a mensagem de controle de ticket fechado (a que disparou o botão)
            await interaction.message.delete().catch(() => {});

            await interaction.editReply({ 
                content: `🔓 Ticket reaberto com sucesso por **${interaction.user.username}**! O criador tem acesso novamente.` 
            });

        } catch (err) {
            console.error('[Tickets] Erro ao reabrir ticket:', err.message);
            return interaction.followUp({ content: '❌ Erro interno ao reabrir ticket.', ephemeral: true });
        }
    }

    // ─── Botão: Salvar Logs (Transcript Manual) ──────────────────────────────
    if (customId === 'ticket_transcript') {
        const supportRoleId = config.ticketSupportRoleId;
        const hasRole = supportRoleId && interaction.member.roles.cache.has(supportRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ 
                content: '🚫 Apenas a equipe de suporte pode gerar transcrições manuais.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const textTranscript = await generateTranscript(interaction.channel);
            const buffer = Buffer.from(textTranscript, 'utf-8');
            const fileAttachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });

            await interaction.user.send({ 
                content: `Aqui está a transcrição para o ticket **#${interaction.channel.name}**:`, 
                files: [fileAttachment] 
            });

            return interaction.editReply({ content: '✅ Transcrição gerada e enviada com sucesso para suas Mensagens Diretas (DM)!' });
        } catch (err) {
            console.error('[Tickets] Erro ao gerar transcrição manual:', err.message);
            return interaction.editReply({ content: '❌ Não foi possível enviar a transcrição na sua DM. Verifique se suas DMs estão abertas.' });
        }
    }

    // ─── Botão: Deletar Ticket ────────────────────────────────────────────────
    if (customId === 'ticket_delete') {
        const supportRoleId = config.ticketSupportRoleId;
        const hasRole = supportRoleId && interaction.member.roles.cache.has(supportRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ 
                content: '🚫 Apenas a equipe de suporte pode deletar canais de tickets.', 
                ephemeral: true 
            });
        }

        await interaction.reply({ 
            content: '⛔ Este canal de ticket será excluído permanentemente em **5 segundos**...' 
        });

        setTimeout(async () => {
            try {
                db.deleteTicket(interaction.channelId);
                await interaction.channel.delete().catch(() => {});
            } catch (err) {
                console.error('[Tickets] Erro ao deletar canal de ticket:', err.message);
            }
        }, 5000);
    }
}

module.exports = {
    handleTicketInteraction,
    getOrCreateCategory,
    getOrCreateSupportRole,
    getOrCreateLogChannel,
    getOrCreatePanelChannel
};
