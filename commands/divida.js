'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

function parseGoldValue(str) {
    if (!str) return null;
    const clean = str.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, '');
    let multiplier = 1;
    let numStr = clean;

    if (clean.endsWith('kk')) {
        multiplier = 1000000;
        numStr = clean.slice(0, -2);
    } else if (clean.endsWith('k')) {
        multiplier = 1000;
        numStr = clean.slice(0, -1);
    } else if (clean.endsWith('m')) {
        multiplier = 1000000;
        numStr = clean.slice(0, -1);
    }

    const val = parseFloat(numStr);
    if (isNaN(val)) return null;
    return Math.round(val * multiplier);
}

function formatGoldValue(val) {
    if (val === 0) return '0 Gold';
    if (val >= 1000000) {
        return `${(val / 1000000).toFixed(2).replace(/\.00$/, '')}kk Gold`;
    }
    if (val >= 1000) {
        return `${(val / 1000).toFixed(1).replace(/\.0$/, '')}k Gold`;
    }
    return `${val.toLocaleString('pt-BR')} Gold`;
}

async function handleDever(ctx, debtorId, creditorId, amountStr, description, isSlash = false) {
    if (debtorId === creditorId) {
        const text = '⚠️ Você não pode dever a si mesmo!';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const amount = parseGoldValue(amountStr);
    if (amount === null || amount <= 0) {
        const text = '⚠️ Valor inválido. Use formatos como `500k`, `1.5kk` ou `500000`.';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const debtId = db.addDebt(debtorId, creditorId, amount, description);

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C) // Red / Debt
        .setTitle('💸 Nova Dívida Registrada')
        .setDescription(
            `👤 **Devedor:** <@${debtorId}>\n` +
            `👤 **Credor:** <@${creditorId}>\n` +
            `💰 **Valor:** **${formatGoldValue(amount)}**\n` +
            `📝 **Descrição:** ${description || '_Sem descrição_'}\n\n` +
            `*ID do Registro:* \`#${debtId}\` · Digite \`!divida pagar <@credor>\` para quitar.`
        )
        .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
        .setTimestamp();

    return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handleCobrar(ctx, creditorId, debtorId, amountStr, description, isSlash = false) {
    if (creditorId === debtorId) {
        const text = '⚠️ Você não pode cobrar de si mesmo!';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const amount = parseGoldValue(amountStr);
    if (amount === null || amount <= 0) {
        const text = '⚠️ Valor inválido. Use formatos como `500k`, `1.5kk` ou `500000`.';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    const debtId = db.addDebt(debtorId, creditorId, amount, description);

    const embed = new EmbedBuilder()
        .setColor(0xE67E22) // Orange / Charge
        .setTitle('📢 Nova Cobrança Registrada')
        .setDescription(
            `👤 **Credor:** <@${creditorId}>\n` +
            `👤 **Devedor:** <@${debtorId}>\n` +
            `💰 **Valor:** **${formatGoldValue(amount)}**\n` +
            `📝 **Descrição:** ${description || '_Sem descrição_'}\n\n` +
            `*ID do Registro:* \`#${debtId}\` · Digite \`!divida receber <@devedor>\` para dar baixa.`
        )
        .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
        .setTimestamp();

    return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handleBalanco(ctx, userId, isSlash = false) {
    const debts = db.getPendingDebtsForUser(userId);

    if (debts.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71) // Green
            .setTitle('⚖️ Seu Balanço Financeiro')
            .setDescription('✅ **Tudo limpo!** Você não possui nenhuma dívida pendente de pagamento ou recebimento.')
            .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
            .setTimestamp();
        return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
    }

    // Dividas ativas (onde sou devedor)
    const myDebts = debts.filter(d => d.debtor_id === userId);
    // Creditos ativos (onde sou credor)
    const myCredits = debts.filter(d => d.creditor_id === userId);

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('⚖️ Balanço de Dívidas & Créditos')
        .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
        .setTimestamp();

    // 1. Calcular consolidados a pagar
    if (myDebts.length > 0) {
        const debtsByCreditor = {};
        myDebts.forEach(d => {
            debtsByCreditor[d.creditor_id] = debtsByCreditor[d.creditor_id] || { total: 0, items: [] };
            debtsByCreditor[d.creditor_id].total += d.amount;
            debtsByCreditor[d.creditor_id].items.push(d);
        });

        const debtLines = [];
        for (const [credId, data] of Object.entries(debtsByCreditor)) {
            debtLines.push(`• **Para <@${credId}>: ${formatGoldValue(data.total)}**`);
            data.items.forEach(item => {
                const desc = item.description ? ` (${item.description})` : '';
                debtLines.push(`  └ \`#${item.id}\` — **${formatGoldValue(item.amount)}**${desc}`);
            });
        }
        embed.addFields({ name: '💸 Dívidas a Pagar (Você deve)', value: debtLines.join('\n'), inline: false });
    } else {
        embed.addFields({ name: '💸 Dívidas a Pagar (Você deve)', value: '_Nenhuma dívida a pagar._', inline: false });
    }

    // 2. Calcular consolidados a receber
    if (myCredits.length > 0) {
        const creditsByDebtor = {};
        myCredits.forEach(c => {
            creditsByDebtor[c.debtor_id] = creditsByDebtor[c.debtor_id] || { total: 0, items: [] };
            creditsByDebtor[c.debtor_id].total += c.amount;
            creditsByDebtor[c.debtor_id].items.push(c);
        });

        const creditLines = [];
        for (const [debtId, data] of Object.entries(creditsByDebtor)) {
            creditLines.push(`• **De <@${debtId}>: ${formatGoldValue(data.total)}**`);
            data.items.forEach(item => {
                const desc = item.description ? ` (${item.description})` : '';
                creditLines.push(`  └ \`#${item.id}\` — **${formatGoldValue(item.amount)}**${desc}`);
            });
        }
        embed.addFields({ name: '📈 Créditos a Receber (Devem a você)', value: creditLines.join('\n'), inline: false });
    } else {
        embed.addFields({ name: '📈 Créditos a Receber (Devem a você)', value: '_Nenhum crédito a receber._', inline: false });
    }

    return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handlePagar(ctx, debtorId, creditorId, isSlash = false) {
    if (debtorId === creditorId) {
        const text = '⚠️ Você não pode pagar a si mesmo!';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    db.settleDebtsBetween(debtorId, creditorId);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Dívidas Quitadas')
        .setDescription(`Você quitou **todas** as suas dívidas pendentes com o credor <@${creditorId}>.`)
        .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
        .setTimestamp();

    return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handleReceber(ctx, creditorId, debtorId, isSlash = false) {
    if (creditorId === debtorId) {
        const text = '⚠️ Você não pode receber de si mesmo!';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    db.settleDebtsBetween(debtorId, creditorId);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Cobranças Baixadas')
        .setDescription(`Você deu baixa e marcou como recebidas **todas** as dívidas que o devedor <@${debtorId}> tinha com você.`)
        .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
        .setTimestamp();

    return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handleLiquidar(ctx, userId, id, isSlash = false) {
    const debt = db.getDebt(id);
    if (!debt) {
        const text = '⚠️ Dívida não encontrada.';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    if (debt.status !== 'pending') {
        const text = `⚠️ Esta dívida já está quitada (Status: \`${debt.status}\`).`;
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    if (debt.debtor_id !== userId && debt.creditor_id !== userId) {
        const text = '🚫 Você não tem permissão para liquidar esta dívida, pois não é o devedor nem o credor dela.';
        return isSlash ? ctx.reply({ content: text, ephemeral: true }) : ctx.reply(text);
    }

    db.settleDebtById(id);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Registro Quitado')
        .setDescription(
            `A dívida **\`#${id}\`** no valor de **${formatGoldValue(debt.amount)}** foi marcada como quitada.\n\n` +
            `• **Devedor:** <@${debt.debtor_id}>\n` +
            `• **Credor:** <@${debt.creditor_id}>`
        )
        .setFooter({ text: 'Ascended Bot • Sistema Financeiro' })
        .setTimestamp();

    return isSlash ? ctx.reply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

module.exports = {
    name: 'divida',
    aliases: ['dividas', 'balanco', 'ledger'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('divida')
        .setDescription('Gerencia balanço de loot, dívidas e créditos da guilda')
        .addSubcommand(sub =>
            sub.setName('dever')
                .setDescription('Registra que você deve a outro membro')
                .addUserOption(opt => opt.setName('credor').setDescription('Membro a quem você deve').setRequired(true))
                .addStringOption(opt => opt.setName('valor').setDescription('Valor (Ex: 500k, 1.5kk, 500000)').setRequired(true))
                .addStringOption(opt => opt.setName('descricao').setDescription('Descrição da dívida').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('cobrar')
                .setDescription('Registra que outro membro deve a você')
                .addUserOption(opt => opt.setName('devedor').setDescription('Membro que deve a você').setRequired(true))
                .addStringOption(opt => opt.setName('valor').setDescription('Valor (Ex: 500k, 1.5kk, 500000)').setRequired(true))
                .addStringOption(opt => opt.setName('descricao').setDescription('Descrição da dívida').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('balanco')
                .setDescription('Exibe seu balanço de dívidas e créditos')
        )
        .addSubcommand(sub =>
            sub.setName('pagar')
                .setDescription('Quita todas as suas dívidas com um credor')
                .addUserOption(opt => opt.setName('credor').setDescription('Membro a quem você pagou').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('receber')
                .setDescription('Quita todas as dívidas que um devedor tinha com você')
                .addUserOption(opt => opt.setName('devedor').setDescription('Membro que pagou a você').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('liquidar')
                .setDescription('Quita uma dívida específica pelo ID')
                .addIntegerOption(opt => opt.setName('id').setDescription('ID da dívida').setRequired(true))
        ),

    async execute(msg, args, { config }) {
        const sub = args[0]?.toLowerCase();

        if (sub === 'dever') {
            const targetMention = args[1];
            const targetId = targetMention ? targetMention.replace(/[<@!>]/g, '') : null;
            if (!targetId || targetId === targetMention) {
                return msg.reply('⚠️ Você precisa mencionar o credor (Ex: `!divida dever @Membro 500k`).');
            }
            const valueStr = args[2];
            const desc = args.slice(3).join(' ').trim();
            return handleDever(msg, msg.author.id, targetId, valueStr, desc, false);
        }

        if (sub === 'cobrar') {
            const targetMention = args[1];
            const targetId = targetMention ? targetMention.replace(/[<@!>]/g, '') : null;
            if (!targetId || targetId === targetMention) {
                return msg.reply('⚠️ Você precisa mencionar o devedor (Ex: `!divida cobrar @Membro 500k`).');
            }
            const valueStr = args[2];
            const desc = args.slice(3).join(' ').trim();
            return handleCobrar(msg, msg.author.id, targetId, valueStr, desc, false);
        }

        if (sub === 'balanco' || sub === 'listar' || !sub) {
            return handleBalanco(msg, msg.author.id, false);
        }

        if (sub === 'pagar') {
            const targetMention = args[1];
            const targetId = targetMention ? targetMention.replace(/[<@!>]/g, '') : null;
            if (!targetId || targetId === targetMention) {
                return msg.reply('⚠️ Você precisa mencionar o credor (Ex: `!divida pagar @Membro`).');
            }
            return handlePagar(msg, msg.author.id, targetId, false);
        }

        if (sub === 'receber') {
            const targetMention = args[1];
            const targetId = targetMention ? targetMention.replace(/[<@!>]/g, '') : null;
            if (!targetId || targetId === targetMention) {
                return msg.reply('⚠️ Você precisa mencionar o devedor (Ex: `!divida receber @Membro`).');
            }
            return handleReceber(msg, msg.author.id, targetId, false);
        }

        if (sub === 'liquidar' || sub === 'quitar') {
            const id = parseInt(args[1], 10);
            if (isNaN(id)) {
                return msg.reply('⚠️ ID inválido. Uso: `!divida liquidar <ID_da_divida>`.');
            }
            return handleLiquidar(msg, msg.author.id, id, false);
        }

        return msg.reply('⚠️ Uso correto: `!divida dever @membro <valor>`, `!divida cobrar @membro <valor>`, `!divida balanco`, `!divida pagar @membro` ou `!divida receber @membro`.');
    },

    async executeSlash(interaction, { config }) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'dever') {
            const credor = interaction.options.getUser('credor');
            const valor = interaction.options.getString('valor');
            const desc = interaction.options.getString('descricao') || '';
            return handleDever(interaction, interaction.user.id, credor.id, valor, desc, true);
        }

        if (sub === 'cobrar') {
            const devedor = interaction.options.getUser('devedor');
            const valor = interaction.options.getString('valor');
            const desc = interaction.options.getString('descricao') || '';
            return handleCobrar(interaction, interaction.user.id, devedor.id, valor, desc, true);
        }

        if (sub === 'balanco') {
            return handleBalanco(interaction, interaction.user.id, true);
        }

        if (sub === 'pagar') {
            const credor = interaction.options.getUser('credor');
            return handlePagar(interaction, interaction.user.id, credor.id, true);
        }

        if (sub === 'receber') {
            const devedor = interaction.options.getUser('devedor');
            return handleReceber(interaction, interaction.user.id, devedor.id, true);
        }

        if (sub === 'liquidar') {
            const id = interaction.options.getInteger('id');
            return handleLiquidar(interaction, interaction.user.id, id, true);
        }
    }
};
