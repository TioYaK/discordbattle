'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../modules/database');

function parseDuration(str) {
    if (!str) return null;
    const clean = str.toLowerCase().trim();
    const num = parseInt(clean, 10);
    if (isNaN(num)) return null;
    if (clean.endsWith('m')) return num * 60 * 1000;
    if (clean.endsWith('h')) return num * 60 * 60 * 1000;
    if (clean.endsWith('d')) return num * 24 * 60 * 60 * 1000;
    return num * 60 * 1000; // default to minutes
}

async function handleCriarSorteio(ctx, premio, precoStr, duracaoStr, creatorId, isSlash = false) {
    const preco = parseFloat(precoStr);
    if (isNaN(preco) || preco <= 0) {
        const text = '⚠️ Preço do ticket inválido. Digite um valor numérico positivo.';
        return isSlash ? ctx.editReply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const durationMs = parseDuration(duracaoStr);
    if (!durationMs || durationMs <= 0) {
        const text = '⚠️ Duração inválida. Use formatos como `30m` (30 minutos), `2h` (2 horas) ou `1d` (1 dia).';
        return isSlash ? ctx.editReply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const endsAt = Date.now() + durationMs;

    const embed = new EmbedBuilder()
        .setColor(0xE67E22) // Orange / Raffle Theme
        .setTitle(`🎟️ SORTEIO: ${premio} 🎟️`)
        .setDescription(
            `Um novo sorteio foi iniciado pela Staff!\n\n` +
            `💰 **Preço do Ticket:** \`${preco} AC\`\n` +
            `⏰ **Encerra em:** <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:f>)\n\n` +
            `🎟️ **Tickets Comprados:** \`0\`\n` +
            `👥 **Participantes:** \`0\`\n\n` +
            `*Clique no botão abaixo para comprar tickets com suas Ascended Coins.*`
        )
        .setFooter({ text: 'Ascended Bot • Sorteio Automatizado' })
        .setTimestamp();

    // Placeholder button first
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('raffle_buy_placeholder')
            .setLabel('🎟️ Comprar Ticket')
            .setStyle(ButtonStyle.Success)
    );

    let sentMsg;
    if (isSlash) {
        sentMsg = await ctx.editReply({ embeds: [embed], components: [row]});
    } else {
        sentMsg = await ctx.reply({ embeds: [embed], components: [row] });
    }

    const messageId = sentMsg.id;
    const channelId = ctx.channel.id;

    // Create entry in DB to get the actual Raffle ID
    const raffleId = db.createRaffle(premio, preco, endsAt, creatorId, channelId, messageId);

    // Update button custom ID with actual raffleId
    const finalRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raffle_buy_${raffleId}`)
            .setLabel('🎟️ Comprar Ticket')
            .setStyle(ButtonStyle.Success)
    );

    await sentMsg.edit({ components: [finalRow] }).catch(err => {
        console.error('[Raffle] Erro ao atualizar botão de sorteio:', err.message);
    });

    if (isSlash) {
        // Ephemeral success info to creator
        await ctx.followUp({ content: `✅ Sorteio de **${premio}** iniciado com sucesso! (ID: #${raffleId})`, ephemeral: true }).catch(() => {});
    }
}

async function handleRaffleTicketPurchase(interaction, raffleId) {
    const memberRow = db.getRegisteredMember(interaction.user.id);
    if (!memberRow) {
        return interaction.editReply({ content: '❌ Você não está registrado no bot. Use o canal de registros primeiro.', ephemeral: true }).catch(() => {});
    }

    const raffle = db.getRaffle(raffleId);
    if (!raffle) {
        return interaction.editReply({ content: '❌ Sorteio não encontrado no banco de dados.', ephemeral: true }).catch(() => {});
    }

    if (raffle.status !== 'active' || raffle.ends_at <= Date.now()) {
        return interaction.editReply({ content: '❌ Este sorteio já está encerrado!', ephemeral: true }).catch(() => {});
    }

    if (memberRow.coins < raffle.ticket_cost) {
        return interaction.editReply({ content: `❌ Saldo insuficiente! O ticket custa **${raffle.ticket_cost} AC**, mas seu saldo atual é de **${(memberRow.coins || 0).toFixed(1)} AC**.`, ephemeral: true });
    }

    try {
        db.buyRaffleTicket(raffleId, interaction.user.id, raffle.ticket_cost);

        // Fetch updated counts
        const tickets = db.getRaffleTickets(raffleId);
        const totalTickets = tickets.length;
        const uniqueParticipants = new Set(tickets.map(t => t.discord_id)).size;

        const updatedMember = db.getRegisteredMember(interaction.user.id);
        const coinsFormatted = (updatedMember.coins % 1 === 0) ? updatedMember.coins.toFixed(0) : updatedMember.coins.toFixed(1);

        // Edit the original message to update counts
        const channel = await interaction.guild.channels.fetch(raffle.channel_id).catch(() => null);
        if (channel) {
            const message = await channel.messages.fetch(raffle.message_id).catch(() => null);
            if (message) {
                const oldEmbed = message.embeds[0];
                const embed = EmbedBuilder.from(oldEmbed)
                    .setDescription(
                        `Um novo sorteio foi iniciado pela Staff!\n\n` +
                        `💰 **Preço do Ticket:** \`${raffle.ticket_cost} AC\`\n` +
                        `⏰ **Encerra em:** <t:${Math.floor(raffle.ends_at / 1000)}:R> (<t:${Math.floor(raffle.ends_at / 1000)}:f>)\n\n` +
                        `🎟️ **Tickets Comprados:** \`${totalTickets}\`\n` +
                        `👥 **Participantes:** \`${uniqueParticipants}\`\n\n` +
                        `*Clique no botão abaixo para comprar tickets com suas Ascended Coins.*`
                    );
                await message.edit({ embeds: [embed] }).catch(() => {});
            }
        }

        return interaction.editReply({
            content: `🎉 **Ticket Adquirido!** Você comprou 1 ticket para o sorteio por **${raffle.ticket_cost} AC**.\nSeu novo saldo é **${coinsFormatted} AC**.\n*(Você pode comprar mais tickets clicando novamente!)*`,
            ephemeral: true
        });

    } catch (err) {
        if (err.message === 'insufficient_coins') {
            return interaction.editReply({ content: '❌ Saldo insuficiente!', ephemeral: true }).catch(() => {});
        }
        console.error('[Raffle] Erro ao comprar ticket:', err.message);
        return interaction.editReply({ content: '❌ Ocorreu um erro interno ao processar sua compra.', ephemeral: true }).catch(() => {});
    }
}

module.exports = {
    name: 'sorteio',
    description: 'Gerencia sorteios automatizados usando Ascended Coins (AC)',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('sorteio')
        .setDescription('Gerencia sorteios usando moedas AC (Staff apenas)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('criar')
                .setDescription('Cria um novo sorteio de bilhetes')
                .addStringOption(opt => opt.setName('premio').setDescription('O prêmio do sorteio').setRequired(true))
                .addStringOption(opt => opt.setName('preco').setDescription('Custo em AC por ticket (Ex: 10, 5)').setRequired(true))
                .addStringOption(opt => opt.setName('duracao').setDescription('Tempo de duração (Ex: 30m, 2h, 1d)').setRequired(true))
        ),

    async execute(msg, args, { config }) {
        const isAdmin = msg.member.permissions.has(PermissionFlagsBits.ManageGuild);
        if (!isAdmin) {
            return msg.reply('🚫 Você não tem permissão para usar este comando.').catch(() => {});
        }

        const sub = args[0]?.toLowerCase();
        if (sub === 'criar') {
            const rawArgs = args.slice(1).join(' ');
            const parts = rawArgs.split('|').map(p => p.trim());
            
            const premio = parts[0];
            const precoStr = parts[1];
            const duracaoStr = parts[2];

            if (!premio || !precoStr || !duracaoStr) {
                return msg.reply('⚠️ Formato incorreto. Uso: `!sorteio criar <Prêmio> | <Preço AC> | <Duração>` (Ex: `!sorteio criar 250 Tibia Coins | 10 | 2h`).catch(() => {}).');
            }

            return handleCriarSorteio(msg, premio, precoStr, duracaoStr, msg.author.id, false);
        }

        return msg.reply('⚠️ Comandos disponíveis: `!sorteio criar <Prêmio> | <Preço AC> | <Duração>`.').catch(() => {});
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();

        if (sub === 'criar') {
            const premio = interaction.options.getString('premio');
            const preco = interaction.options.getString('preco');
            const duracao = interaction.options.getString('duracao');

            return handleCriarSorteio(interaction, premio, preco, duracao, interaction.user.id, true);
        }
    },

    handleRaffleTicketPurchase
};
