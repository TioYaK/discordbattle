'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

function formatVoiceTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
}

function getLevelProgress(xp) {
    let level = 1;
    if (xp >= 400) {
        level = Math.floor(0.1 * Math.sqrt(xp));
    }
    const currentLevelMinXp = level === 1 ? 0 : 100 * (level ** 2);
    const nextLevelMinXp = 100 * ((level + 1) ** 2);
    const xpInLevel = xp - currentLevelMinXp;
    const xpNeeded = nextLevelMinXp - currentLevelMinXp;
    const percentage = Math.min(100, Math.floor((xpInLevel / xpNeeded) * 100));
    
    const filledSegments = Math.round(percentage / 10);
    const bar = '█'.repeat(filledSegments) + '░'.repeat(10 - filledSegments);
    
    return {
        level,
        xpInLevel,
        xpNeeded,
        percentage,
        bar
    };
}

async function handleCarteira(ctx, userId, isSlash = false) {
    const memberRow = db.getRegisteredMember(userId);
    if (!memberRow) {
        const text = '❌ Você não está registrado no sistema do bot. Registre-se primeiro no canal correspondente.';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const totalFrags = db.getTotalFragsForPlayer(userId);
    const totalVoiceMs = db.getTotalVoiceTimeMs(userId);
    const coins = memberRow.coins || 0;
    
    // Format coins: if integer, show integer, else show 1 decimal place
    const coinsFormatted = (coins % 1 === 0) ? coins.toFixed(0) : coins.toFixed(1);

    const xpProgress = getLevelProgress(memberRow.guild_xp || 0);
    const levelMultiplier = 1 + (xpProgress.level - 1) * 0.02;
    const multiplierPct = ((levelMultiplier - 1) * 100).toFixed(0);

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // Premium Gold Color
        .setTitle(`💳 Carteira de ${memberRow.char_name}`)
        .addFields(
            {
                name: '💰 Saldo Disponível',
                value: `🪙 **${coinsFormatted} AC** *(Ascended Coins)*`,
                inline: false
            },
            {
                name: `📈 Nível de Atividade: Lvl ${xpProgress.level}`,
                value: `\`${xpProgress.bar}\` **${xpProgress.percentage}%**\n` +
                       `✨ **XP:** \`${xpProgress.xpInLevel.toFixed(0)} / ${xpProgress.xpNeeded} XP\` (Total: \`${(memberRow.guild_xp || 0).toFixed(0)} XP\`)\n` +
                       `🪙 **Bônus de AC:** \`+${multiplierPct}%\` extra em calls!`,
                inline: false
            },
            {
                name: '🩸 Participação em PvP (Kills)',
                value: `💀 **${totalFrags} kills** registrados no bot\n*(Garante 20 AC por kill)*`,
                inline: true
            },
            {
                name: '🎙️ Atividade em Voz (Discord)',
                value: `⏰ **${formatVoiceTime(totalVoiceMs)}** em canais de voz\n*(Garante 10 AC/h em comuns e 25 AC/h em canal de guerra)*`,
                inline: true
            }
        )
        .setThumbnail('https://rubinot.com.br/favicon.ico')
        .setFooter({ text: 'Ascended Bot • Economia & Gamificação' })
        .setTimestamp();

    const now = Date.now();
    const isBannerActive = memberRow.custom_banner_expires_at && memberRow.custom_banner_expires_at > now;
    
    if (isBannerActive && memberRow.custom_banner) {
        embed.setImage(memberRow.custom_banner);
    }

    if (isBannerActive) {
        embed.setDescription(
            `Aqui está o seu saldo financeiro e estatísticas de gamificação da guilda!\n` +
            `🖼️ **Banner Customizado:** Ativo até <t:${Math.floor(memberRow.custom_banner_expires_at / 1000)}:f>`
        );
    } else {
        embed.setDescription(`Aqui está o seu saldo financeiro e estatísticas de gamificação da guilda!`);
    }

    const replyData = { embeds: [embed] };
    return isSlash ? ctx.reply(replyData) : ctx.reply(replyData);
}

async function handleBanner(ctx, userId, bannerUrl, isSlash = false) {
    const memberRow = db.getRegisteredMember(userId);
    if (!memberRow) {
        const text = '❌ Você não está registrado no sistema do bot. Registre-se primeiro no canal correspondente.';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const now = Date.now();
    if (!memberRow.custom_banner_expires_at || memberRow.custom_banner_expires_at <= now) {
        const text = '❌ Você não possui a permissão de banner customizado ativa! Compre-a primeiro na `/loja` (custa 2500 AC por 30 dias).';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    if (!bannerUrl || (!bannerUrl.startsWith('http://') && !bannerUrl.startsWith('https://'))) {
        const text = '❌ URL inválida! Forneça uma URL de imagem válida começando com http:// ou https://';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    db.db.prepare('UPDATE registered_members SET custom_banner = ? WHERE discord_id = ?').run(bannerUrl, userId);

    const text = `🎉 **Banner de Carteira Atualizado!**\nSua imagem de fundo de carteira foi alterada. Digite \`/carteira\` para visualizá-la.`;
    return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
}

module.exports = {
    name: 'carteira',
    aliases: ['saldo', 'coins', 'wallet'],
    description: 'Exibe o seu saldo de Ascended Coins (AC) e estatísticas de atividades',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('carteira')
        .setDescription('Exibe o seu saldo de Ascended Coins (AC) e estatísticas de atividades')
        .addSubcommand(sub =>
            sub
                .setName('ver')
                .setDescription('Visualiza sua carteira e estatísticas')
        )
        .addSubcommand(sub =>
            sub
                .setName('banner')
                .setDescription('Define a URL da imagem de banner da sua carteira')
                .addStringOption(opt =>
                    opt
                        .setName('url')
                        .setDescription('A URL da imagem (deve começar com http/https)')
                        .setRequired(true)
                )
        ),

    async execute(msg, args, { config }) {
        if (args && args[0] === 'banner') {
            const url = args[1];
            return handleBanner(msg, msg.author.id, url, false);
        }
        return handleCarteira(msg, msg.author.id, false);
    },

    async executeSlash(interaction, { config }) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'banner') {
            const url = interaction.options.getString('url');
            return handleBanner(interaction, interaction.user.id, url, true);
        } else {
            return handleCarteira(interaction, interaction.user.id, true);
        }
    }
};
