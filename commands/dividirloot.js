'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function formatGp(num) {
    return num.toLocaleString('pt-BR') + ' gp';
}

function parsePartyHuntLog(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const members = [];
    let currentMember = null;
    
    let totalLoot = 0;
    let totalSupplies = 0;
    let totalBalance = 0;
    let inHeader = true;

    for (const line of lines) {
        if (line.startsWith('Session data:')) {
            inHeader = true;
            continue;
        }
        if (line.startsWith('Session:') || line.startsWith('Loot Type:')) {
            inHeader = true;
            continue;
        }
        
        const parseNum = (str) => {
            const clean = str.replace(/[^0-9\-]/g, '');
            return parseInt(clean, 10) || 0;
        };

        if (line.startsWith('Loot:')) {
            const val = parseNum(line.split(':')[1]);
            if (inHeader) totalLoot = val;
            else if (currentMember) currentMember.loot = val;
            continue;
        }
        if (line.startsWith('Supplies:')) {
            const val = parseNum(line.split(':')[1]);
            if (inHeader) totalSupplies = val;
            else if (currentMember) currentMember.supplies = val;
            continue;
        }
        if (line.startsWith('Balance:')) {
            const val = parseNum(line.split(':')[1]);
            if (inHeader) totalBalance = val;
            else if (currentMember) currentMember.balance = val;
            continue;
        }
        if (line.startsWith('Damage:') || line.startsWith('Healing:')) {
            continue;
        }

        inHeader = false;
        
        const nameClean = line.replace(/\s*\([^)]*\)/g, '').trim();
        if (nameClean) {
            currentMember = {
                name: nameClean,
                loot: 0,
                supplies: 0,
                balance: 0
            };
            members.push(currentMember);
        }
    }
    
    return {
        totalLoot,
        totalSupplies,
        totalBalance,
        members
    };
}

function calculateSplit(members, totalBalance) {
    const numPlayers = members.length;
    if (numPlayers === 0) return [];

    const share = totalBalance / numPlayers;
    
    // Calculate how much each player owes or is owed
    const balances = members.map(m => {
        const diff = m.balance - share;
        return {
            name: m.name,
            diff: diff // positive: owes, negative: is owed
        };
    });

    const payers = balances.filter(b => b.diff > 0).sort((a, b) => b.diff - a.diff);
    const receivers = balances.filter(b => b.diff < 0).map(b => ({ name: b.name, diff: Math.abs(b.diff) })).sort((a, b) => b.diff - a.diff);

    const transfers = [];
    let pIdx = 0;
    let rIdx = 0;

    while (pIdx < payers.length && rIdx < receivers.length) {
        const payer = payers[pIdx];
        const receiver = receivers[rIdx];

        const amount = Math.min(payer.diff, receiver.diff);

        transfers.push({
            from: payer.name,
            to: receiver.name,
            amount: Math.round(amount)
        });

        payer.diff -= amount;
        receiver.diff -= amount;

        if (Math.round(payer.diff) <= 0) pIdx++;
        if (Math.round(receiver.diff) <= 0) rIdx++;
    }

    return {
        share,
        transfers
    };
}

module.exports = {
    name: 'dividirloot',
    aliases: ['lootsplit', 'splitloot', 'huntlog', 'session'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('dividirloot')
        .setDescription('Divide o loot da hunt baseando-se no log do Party Hunt Analyzer')
        .addStringOption(opt =>
            opt.setName('log')
                .setDescription('Cole aqui o texto copiado do Party Hunt Analyzer')
                .setRequired(true)
        ),

    async execute(msg, args) {
        const rawText = args.join('\n');
        if (!rawText || !rawText.includes('Loot:')) {
            return msg.reply('⚠️ Você precisa copiar e colar o texto completo do **Party Hunt Analyzer**. Ex: `!dividirloot Session data...`');
        }

        const data = parsePartyHuntLog(rawText);
        if (data.members.length === 0) {
            return msg.reply('❌ Não foi possível extrair os membros da hunt do log fornecido. Certifique-se de copiar o texto completo.');
        }

        const { share, transfers } = calculateSplit(data.members, data.totalBalance);

        const embed = new EmbedBuilder()
            .setColor(data.totalBalance >= 0 ? 0x2ECC71 : 0xE74C3C)
            .setTitle('💰 Divisão de Loot da Hunt')
            .setDescription(`**Resultado da Sessão:**\n` +
                             `• Total Loot: **${formatGp(data.totalLoot)}**\n` +
                             `• Total Waste: **${formatGp(data.totalSupplies)}**\n` +
                             `• Lucro Geral: **${formatGp(data.totalBalance)}**\n` +
                             `• Parte de cada membro: **${formatGp(Math.round(share))}**\n\n` +
                             `📋 **Membros participando (${data.members.length}):**\n` +
                             data.members.map(m => `• **${m.name}** (Loot: ${formatGp(m.loot)} | Waste: ${formatGp(m.supplies)} | Balanço: ${formatGp(m.balance)})`).join('\n') + '\n\n' +
                             `💸 **Transferências necessárias:**\n` +
                             (transfers.length === 0
                                 ? '✅ Tudo dividido! Nenhuma transferência necessária.'
                                 : transfers.map(t => `• **${t.from}** transfere **${formatGp(t.amount)}** para **${t.to}**`).join('\n'))
            )
            .setFooter({ text: 'Ascended Loot Splitter' })
            .setTimestamp();

        return msg.reply({ embeds: [embed] });
    },

    async executeSlash(interaction) {
        const rawText = interaction.options.getString('log');
        if (!rawText || !rawText.includes('Loot:')) {
            return interaction.reply({ content: '⚠️ Você precisa copiar e colar o texto completo do **Party Hunt Analyzer**.', ephemeral: true });
        }

        const data = parsePartyHuntLog(rawText);
        if (data.members.length === 0) {
            return interaction.reply({ content: '❌ Não foi possível extrair os membros da hunt. Certifique-se de copiar o texto completo.', ephemeral: true });
        }

        const { share, transfers } = calculateSplit(data.members, data.totalBalance);

        const embed = new EmbedBuilder()
            .setColor(data.totalBalance >= 0 ? 0x2ECC71 : 0xE74C3C)
            .setTitle('💰 Divisão de Loot da Hunt')
            .setDescription(`**Resultado da Sessão:**\n` +
                             `• Total Loot: **${formatGp(data.totalLoot)}**\n` +
                             `• Total Waste: **${formatGp(data.totalSupplies)}**\n` +
                             `• Lucro Geral: **${formatGp(data.totalBalance)}**\n` +
                             `• Parte de cada membro: **${formatGp(Math.round(share))}**\n\n` +
                             `📋 **Membros participando (${data.members.length}):**\n` +
                             data.members.map(m => `• **${m.name}** (Loot: ${formatGp(m.loot)} | Waste: ${formatGp(m.supplies)} | Balanço: ${formatGp(m.balance)})`).join('\n') + '\n\n' +
                             `💸 **Transferências necessárias:**\n` +
                             (transfers.length === 0
                                 ? '✅ Tudo dividido! Nenhuma transferência necessária.'
                                 : transfers.map(t => `• **${t.from}** transfere **${formatGp(t.amount)}** para **${t.to}**`).join('\n'))
            )
            .setFooter({ text: 'Ascended Loot Splitter' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};
