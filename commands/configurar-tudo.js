'use strict';

const { 
    SlashCommandBuilder, 
    ChannelType, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const db = require('../modules/database');
const state = require('../modules/state');

module.exports = {
    name: 'configurar-tudo',
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('configurar-tudo')
        .setDescription('Configura o servidor criando canais, categorias e cargos necessários')
        .addStringOption(option => 
            option.setName('mundo')
                .setDescription('Nome do mundo do Tibia (ex: Auroria, Gladera)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('guilda')
                .setDescription('Nome da sua guilda aliada in-game (ex: Ascended)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('inimigos')
                .setDescription('Nome da guilda inimiga in-game (opcional)')
                .setRequired(false)
        ),

    async executeSlash(interaction, { config }) {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        if (!guild) {
            return interaction.editReply({ content: '❌ Este comando só pode ser usado dentro de um servidor.' });
        }

        // Verifica permissão de Administrador do executor
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({ content: '🚫 Você precisa ter permissão de Administrador para usar este comando.' });
        }

        const mundo = interaction.options.getString('mundo').trim();
        const guilda = interaction.options.getString('guilda').trim();
        const inimigos = interaction.options.getString('inimigos')?.trim() || null;

        const report = [];
        report.push(`⚙️ **Iniciando configuração do servidor para ${guild.name}...**`);
        report.push(`• Mundo Tibia: \`${mundo}\``);
        report.push(`• Guilda Aliada: \`${guilda}\``);
        if (inimigos) report.push(`• Guilda Inimiga: \`${inimigos}\``);

        try {
            // ─── 1. Criação/Busca de Cargos ──────────────────────────────────────────
            const roleRegistrado = await getOrCreateRole(guild, 'Registrado', '#2ecc71', 'Cargo de membro verificado');
            const roleCaller = await getOrCreateRole(guild, 'Caller', '#e74c3c', 'Líder de chamadas de guerra');
            const roleTaxa = await getOrCreateRole(guild, 'Taxa Paga', '#f1c40f', 'Membro com taxa em dia');
            const roleSuporte = await getOrCreateRole(guild, 'Suporte Tickets', '#3498db', 'Staff de suporte');

            // Descobrir cargo de Admin existente ou criar um
            let roleAdmin = guild.roles.cache.find(r => r.name.toLowerCase() === 'admin' || r.name.toLowerCase() === 'administrador');
            if (!roleAdmin) {
                roleAdmin = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator) && r.id !== guild.roles.everyone.id);
            }
            const adminRoleId = roleAdmin ? roleAdmin.id : null;

            report.push('\n🎭 **Cargos configurados:**');
            report.push(`• \`Registrado\`: <@&${roleRegistrado.id}>`);
            report.push(`• \`Caller\`: <@&${roleCaller.id}>`);
            report.push(`• \`Taxa Paga\`: <@&${roleTaxa.id}>`);
            report.push(`• \`Suporte Tickets\`: <@&${roleSuporte.id}>`);
            if (roleAdmin) report.push(`• \`Admin\`: <@&${roleAdmin.id}>`);

            // Permissões padrão para canais públicos/privados
            const botId = guild.client.user.id;
            
            const permsEveryoneReadOnly = [
                { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
                { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions] }
            ];

            const permsEveryoneWritable = [
                { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions] }
            ];

            const permsStaffOnly = [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: roleSuporte.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] },
                { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions] }
            ];

            if (roleAdmin) {
                permsStaffOnly.push({ id: roleAdmin.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            }

            // ─── 2. Criação da Estrutura de Categorias e Canais ─────────────────────
            report.push('\n📁 **Criando categorias e canais:**');

            // --- CATEGORIA: GERAL ---
            const catGeral = await getOrCreateCategory(guild, '📁 INFO & REGISTRO');
            const chanAnuncios = await getOrCreateChannel(guild, '📢-anuncios', ChannelType.GuildText, catGeral.id, permsEveryoneReadOnly);
            const chanRegistro = await getOrCreateChannel(guild, '📝-registro', ChannelType.GuildText, catGeral.id, permsEveryoneReadOnly);

            // --- CATEGORIA: CLAIMS & PTS ---
            const catClaims = await getOrCreateCategory(guild, '📁 RESERVAS & PTS');
            const chanPainelClaims = await getOrCreateChannel(guild, '📋-painel-claims', ChannelType.GuildText, catClaims.id, permsEveryoneReadOnly);
            const chanComandosClaim = await getOrCreateChannel(guild, '💬-comandos-claim', ChannelType.GuildText, catClaims.id, permsEveryoneWritable);
            
            const permsVoiceGen = [
                { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
                { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers] }
            ];
            const chanCriarPt = await getOrCreateChannel(guild, '🔊 Criar PT [Voz]', ChannelType.GuildVoice, catClaims.id, permsVoiceGen);

            // --- CATEGORIA: GUERRA ---
            const catGuerra = await getOrCreateCategory(guild, '📁 GUERRA & RELATÓRIOS');
            const chanPlacar = await getOrCreateChannel(guild, '⚔️-placar-guerra', ChannelType.GuildText, catGuerra.id, permsEveryoneReadOnly);
            const chanMortes = await getOrCreateChannel(guild, '💀-mortes', ChannelType.GuildText, catGuerra.id, permsEveryoneReadOnly);
            const chanRelatorio = await getOrCreateChannel(guild, '📊-relatorio-guilda', ChannelType.GuildText, catGuerra.id, permsEveryoneReadOnly);
            const chanWarVoice = await getOrCreateChannel(guild, '🔊 War Call [Voz]', ChannelType.GuildVoice, catGuerra.id, permsVoiceGen);

            // --- CATEGORIA: RADAR ---
            const catRadar = await getOrCreateCategory(guild, '📁 RADAR');
            const chanMembrosOnline = await getOrCreateChannel(guild, '🟢-membros-online', ChannelType.GuildText, catRadar.id, permsEveryoneReadOnly);
            const chanInimigosOnline = await getOrCreateChannel(guild, '🔴-inimigos-online', ChannelType.GuildText, catRadar.id, permsEveryoneReadOnly);
            const chanHunted = await getOrCreateChannel(guild, '🎯-inimigos-hunted', ChannelType.GuildText, catRadar.id, permsEveryoneReadOnly);
            const chanAlliesHunted = await getOrCreateChannel(guild, '🛡️-aliados-cacando', ChannelType.GuildText, catRadar.id, permsEveryoneReadOnly);

            // --- CATEGORIA: FINANCEIRO ---
            const catFinanceiro = await getOrCreateCategory(guild, '📁 FINANCEIRO');
            const chanTaxasPainel = await getOrCreateChannel(guild, '💰-taxas-painel', ChannelType.GuildText, catFinanceiro.id, permsEveryoneReadOnly);
            const chanTaxasAuditoria = await getOrCreateChannel(guild, '🔍-taxas-auditoria', ChannelType.GuildText, catFinanceiro.id, permsStaffOnly);

            // --- CATEGORIA: SUPORTE ---
            const catSuporte = await getOrCreateCategory(guild, '📁 SUPORTE');
            const chanCriarTicket = await getOrCreateChannel(guild, '🎫-criar-ticket', ChannelType.GuildText, catSuporte.id, permsEveryoneReadOnly);
            const chanHistoricoTickets = await getOrCreateChannel(guild, '📜-historico-tickets', ChannelType.GuildText, catSuporte.id, permsStaffOnly);

            // --- CATEGORIA: PLANILHADOS ---
            const catPlanilhados = await getOrCreateCategory(guild, '📁 PLANILHADOS');
            const chanSolicitarPlanilhado = await getOrCreateChannel(guild, '📝-solicitar-planilhado', ChannelType.GuildText, catPlanilhados.id, permsEveryoneReadOnly);
            const chanPainelSolicitacoes = await getOrCreateChannel(guild, '⚙️-painel-solicitacoes', ChannelType.GuildText, catPlanilhados.id, permsStaffOnly);
            const chanListaPlanilhados = await getOrCreateChannel(guild, '📋-lista-planilhados', ChannelType.GuildText, catPlanilhados.id, permsEveryoneReadOnly);

            report.push('• Canais e Categorias criados com sucesso!');

            // ─── 3. Salvando Configurações no Banco de Dados ──────────────────────────
            const guildId = guild.id;
            db.addGuild(guildId, guild.name);

            db.setGuildConfig(guildId, 'guildName', guilda);
            db.setGuildConfig(guildId, 'worldName', mundo);
            db.setGuildConfig(guildId, 'enemyGuildName', inimigos || '');
            db.setGuildConfig(guildId, 'adminRoleId', adminRoleId || '');
            db.setGuildConfig(guildId, 'cargoClaim90', roleRegistrado.id);
            db.setGuildConfig(guildId, 'cargoClaim180', roleRegistrado.id);
            db.setGuildConfig(guildId, 'registrationChannelId', chanRegistro.id);
            db.setGuildConfig(guildId, 'claimsPanelChannelId', chanPainelClaims.id);
            db.setGuildConfig(guildId, 'claimCommandsChannelId', chanComandosClaim.id);
            db.setGuildConfig(guildId, 'cleanChannelId', chanComandosClaim.id);
            db.setGuildConfig(guildId, 'voiceGeneratorChannelId', chanCriarPt.id);
            db.setGuildConfig(guildId, 'warScoreboardChannelId', chanPlacar.id);
            db.setGuildConfig(guildId, 'deathChannelId', chanMortes.id);
            db.setGuildConfig(guildId, 'reportChannelId', chanRelatorio.id);
            db.setGuildConfig(guildId, 'warChannelId', chanPlacar.id);
            db.setGuildConfig(guildId, 'onlineGuildChannelId', chanMembrosOnline.id);
            db.setGuildConfig(guildId, 'onlineEnemyChannelId', chanInimigosOnline.id);
            db.setGuildConfig(guildId, 'enemyHuntingChannelId', chanHunted.id);
            db.setGuildConfig(guildId, 'allyHuntingChannelId', chanAlliesHunted.id);
            db.setGuildConfig(guildId, 'warVoiceChannelId', chanWarVoice.id);
            db.setGuildConfig(guildId, 'levelUpChannelId', chanRelatorio.id);
            db.setGuildConfig(guildId, 'announcementChannelId', chanAnuncios.id);
            db.setGuildConfig(guildId, 'ticketCategoryId', catSuporte.id);
            db.setGuildConfig(guildId, 'ticketSupportRoleId', roleSuporte.id);
            db.setGuildConfig(guildId, 'ticketPanelChannelId', chanCriarTicket.id);
            db.setGuildConfig(guildId, 'ticketLogChannelId', chanHistoricoTickets.id);
            db.setGuildConfig(guildId, 'planilhadoCategoryId', catPlanilhados.id);
            db.setGuildConfig(guildId, 'planilhadoRequestChannelId', chanSolicitarPlanilhado.id);
            db.setGuildConfig(guildId, 'planilhadoAdminChannelId', chanPainelSolicitacoes.id);
            db.setGuildConfig(guildId, 'planilhadoListChannelId', chanListaPlanilhados.id);
            db.setGuildConfig(guildId, 'taxPanelChannelId', chanTaxasPainel.id);
            db.setGuildConfig(guildId, 'taxAuditChannelId', chanTaxasAuditoria.id);
            db.setGuildConfig(guildId, 'cargoTaxa', roleTaxa.id);
            db.setGuildConfig(guildId, 'guildBankName', `Bank ${guilda}`);

            // Ativa o sistema de taxas para a guilda
            db.setGuildConfig(guildId, 'taxEnabled', 'true');

            report.push('• Configurações registradas no Banco de Dados para esta guilda.');

            // ─── 4. Publicando Painel de Registro ────────────────────────────────────
            report.push('\n📲 **Gerando Painel de Registro...**');
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`⚔️ REGISTRO DA GUILDA — ${guilda.toUpperCase()} ⚔️`)
                .setDescription(
                    `Bem-vindo ao servidor do Discord da guilda **${guilda}**!\n\n` +
                    'Para ter acesso aos canais de guerra, claims, radar, relatórios e PTs, você precisa se registrar no bot.\n\n' +
                    '**Antes de começar, certifique-se de que:**\n' +
                    `1. Seu personagem principal está na guilda **${guilda}** no jogo.\n` +
                    '2. Você sabe o nome do seu personagem bomba (se houver).\n' +
                    '3. **Salve o número do bot nos seus contatos:** `+55 11 92600-7896` (se não salvar, o código de verificação por WhatsApp irá para a pasta "Filtros" ou "Desconhecidos" e você não receberá a notificação).\n\n' +
                    'Clique no botão abaixo para abrir o formulário de registro:'
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            const rowReg = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('register_start')
                    .setLabel('📝 Iniciar Registro')
                    .setStyle(ButtonStyle.Primary)
            );

            await chanRegistro.send({ embeds: [welcomeEmbed], components: [rowReg] });
            report.push('• Painel de registro publicado com sucesso em #registro!');

            // ─── 4.5. Publicando Painéis de Tickets e Planilhados ─────────────────────
            report.push('\n📲 **Gerando Painel de Tickets e Planilhados...**');
            try {
                // Painel de Tickets
                const ticketPanelEmbed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle('🎫 Central de Atendimento — Suporte')
                    .setDescription(
                        `Precisa de ajuda com alguma dúvida, denúncia ou problema?\n\n` +
                        `Clique no botão verde **Abrir Ticket** abaixo para iniciar um atendimento privado com nossa equipe de **Suporte**.`
                    )
                    .setFooter({ text: 'Ascended Bot • Suporte' })
                    .setTimestamp();

                const rowTicket = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_create')
                        .setLabel('Abrir Ticket')
                        .setEmoji('🎫')
                        .setStyle(ButtonStyle.Success)
                );

                const ticketPanelMessage = await chanCriarTicket.send({ embeds: [ticketPanelEmbed], components: [rowTicket] });
                db.setGuildConfig(guildId, 'ticketPanelMessageId', ticketPanelMessage.id);
                report.push('• Painel de tickets publicado em #criar-ticket!');

                // Painel de Planilhados
                const planilhadoPanelEmbed = new EmbedBuilder()
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
                    .setFooter({ text: 'Ascended Bot • Planilhados' })
                    .setTimestamp();

                const rowPlanilhado = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('planilhado_solicitar_btn')
                        .setLabel('📅 Solicitar Planilhado')
                        .setStyle(ButtonStyle.Primary)
                );

                await chanSolicitarPlanilhado.send({ embeds: [planilhadoPanelEmbed], components: [rowPlanilhado] });
                report.push('• Painel de solicitações de planilhados publicado em #solicitar-planilhado!');

            } catch (errPanels) {
                console.error('[ConfigTudo] Falha ao publicar painéis de suporte/planilhado:', errPanels.message);
                report.push('⚠️ Falha ao publicar painéis interativos de Suporte/Planilhados.');
            }

            // ─── 5. Inicializando Wiki RPG e Tutorial ────────────────────────────────
            report.push('\n📚 **Inicializando Canais de RPG (Wiki/Tutorial)...**');
            try {
                // Configura canais do Bastião de Aethelgard
                const { setupAethelgardChannels } = require('../bot');
                if (typeof setupAethelgardChannels === 'function') {
                    await setupAethelgardChannels(guild);
                }

                // Configura Wiki RPG
                const wikiCmd = require('./rpg-wiki');
                if (wikiCmd && typeof wikiCmd.execute === 'function') {
                    await wikiCmd.execute({ channel: chanAnuncios, guild }, [], { config });
                }
                report.push('• Canais e tutorial do Aethelgard RPG configurados com sucesso!');
            } catch (errWiki) {
                console.error('[ConfigTudo] Falha ao configurar RPG Wiki:', errWiki.message);
                report.push('⚠️ Falha ao publicar wiki/tutorial do RPG (verifique as logs).');
            }

            // Envia resposta final
            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🎉 Configuração Concluída com Sucesso!')
                .setDescription(report.join('\n'))
                .setFooter({ text: 'Ascended Bot • Multi-Guild Setup' })
                .setTimestamp();

            return interaction.editReply({ embeds: [successEmbed] });

        } catch (err) {
            console.error('[ConfigTudo] Erro crítico na configuração:', err);
            return interaction.editReply({ content: `❌ **Ocorreu um erro crítico durante a configuração:** ${err.message}` });
        }
    }
};

// ─── Helpers auxiliares ────────────────────────────────────────────────────────
async function getOrCreateRole(guild, name, color, reason) {
    let role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (!role) {
        role = await guild.roles.create({
            name,
            color,
            reason
        });
    }
    return role;
}

async function getOrCreateCategory(guild, name) {
    let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (!category) {
        category = await guild.channels.create({
            name,
            type: ChannelType.GuildCategory,
            reason: 'Configuração Automática'
        });
    }
    return category;
}

async function getOrCreateChannel(guild, name, type, parentId, permissionOverwrites) {
    let channel = guild.channels.cache.find(c => c.name === name && c.type === type);
    if (!channel) {
        channel = await guild.channels.create({
            name,
            type,
            parent: parentId,
            permissionOverwrites,
            reason: 'Configuração Automática'
        });
    } else if (parentId && channel.parentId !== parentId) {
        await channel.setParent(parentId).catch(() => {});
    }
    return channel;
}
