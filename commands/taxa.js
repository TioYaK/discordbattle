'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../modules/database');

function isAdmin(member, config) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild))   return true;
    if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
    return false;
}

function getCycleStartMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function isMemberPlanilhado(discordId) {
    const activeSchedules = db.getActiveSchedules();
    if (!activeSchedules || activeSchedules.length === 0) return false;
    for (const s of activeSchedules) {
        const leaderId = s.leader_discord_id;
        const memberIds = s.member_ids ? s.member_ids.split(',').filter(Boolean) : [];
        if (leaderId === discordId || memberIds.includes(discordId)) {
            return true;
        }
    }
    return false;
}

function getTaxValue(isPlanilhado, config) {
    const rawVal = isPlanilhado
        ? (config.taxPlanilhadoValue || '1500 RC')
        : (config.taxValue || '1000 RC');
    const num = parseInt(String(rawVal).replace(/[^0-9]/g, ''), 10);
    if (isNaN(num) || num <= 0) {
        return isPlanilhado ? '1500 RC' : '1000 RC';
    }
    return String(rawVal);
}

function getTaxNumber(isPlanilhado, config) {
    const val = getTaxValue(isPlanilhado, config);
    return parseInt(val.replace(/[^0-9]/g, ''), 10);
}

function parseAmount(amountStr) {
    if (!amountStr) return 0;
    const numStr = String(amountStr).replace(/[^0-9]/g, '');
    const num = parseInt(numStr, 10);
    return isNaN(num) ? 0 : num;
}

async function handleEnviar(ctx, discordId, proofUrl, config, isSlash = false) {
    if (config.taxEnabled !== 'true') {
        const msgText = '⚠️ O sistema de cobrança de taxa de guerra está desativado no momento.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const reg = db.getRegisteredMember(discordId);
    if (!reg) {
        const msgText = '🚫 Você precisa estar registrado para enviar o comprovante de taxa. Use `!registro` ou o canal de registro.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const isPlanilhado = isMemberPlanilhado(discordId);
    const amount = getTaxValue(isPlanilhado, config);

    const cycleStart = getCycleStartMonth();

    let taxId;
    try {
        taxId = db.addTaxPayment(discordId, reg.char_name, cycleStart, amount, proofUrl);
        db.progressQuest(discordId, 'tax', 1);
    } catch (err) {
        console.error('[Taxa] Erro ao gravar pagamento no banco:', err.message);
        const msgText = '❌ Erro interno ao registrar comprovante. Tente novamente.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const auditChanId = config.taxAuditChannelId;
    if (!auditChanId) {
        const msgText = '⚠️ Canal de auditoria de taxas não configurado. Por favor, fale com um administrador.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    try {
        const channel = await ctx.client.channels.fetch(auditChanId);
        if (channel?.isTextBased()) {
            const auditEmbed = new EmbedBuilder()
                .setColor(0xFF8C00)
                .setTitle('💰 Novo Comprovante de Taxa de Guerra')
                .setDescription(
                    `👤 **Membro:** <@${discordId}> (${reg.char_name})\n` +
                    `💵 **Valor Esperado/Cobrado:** \`${amount}\`\n` +
                    `📅 **Ciclo Iniciado em:** <t:${Math.floor(cycleStart / 1000)}:D>\n` +
                    `🆔 **ID do Pagamento:** \`#${taxId}\``
                )
                .setImage(proofUrl)
                .setFooter({ text: 'Ascended Bot • Auditoria de Taxa', iconURL: 'https://rubinot.com.br/favicon.ico' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`tax_approve_${taxId}`)
                    .setLabel('🟢 Taxa Paga')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`tax_reject_${taxId}`)
                    .setLabel('🔴 Não conclusivo')
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [auditEmbed], components: [row] }).catch(() => {});
        }
    } catch (e) {
        console.error('[Taxa] Falha ao enviar para o canal de auditoria:', e.message);
        const msgText = '⚠️ Seu comprovante foi gravado, mas ocorreu um erro ao enviar para auditoria. Fale com um administrador.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const successMsg = `✅ Comprovante enviado com sucesso! O valor registrado foi **${amount}** (${isPlanilhado ? 'Taxa Planilhado' : 'Taxa Regular'}). Aguarde a validação da Staff.`;
    return isSlash ? ctx.editReply({ content: successMsg, ephemeral: true }) : ctx.reply(successMsg);
}

async function handlePendentes(ctx, config, isSlash = false) {
    if (!isAdmin(ctx.member, config)) {
        const msgText = '🚫 Apenas administradores podem ver a lista de pendentes.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const cycleStart = getCycleStartMonth();
    const pending = db.getPendingMembersForCycle(cycleStart);

    if (!pending.length) {
        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('💰 Cobrança de Taxa de Guerra')
            .setDescription('✅ Todos os membros registrados estão em dia com a taxa de guerra do ciclo atual!')
            .setFooter({ text: 'Ascended Bot • Auditoria de Taxa' })
            .setTimestamp();
        return isSlash ? ctx.editReply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
    }

    const lines = pending.map(m => {
        const isPlanilhado = isMemberPlanilhado(m.discord_id);
        const amount = getTaxValue(isPlanilhado, config);
        return `• <@${m.discord_id}> (${m.char_name}) — **Pendente** [${amount}]`;
    });

    const embed = new EmbedBuilder()
        .setColor(0xC0392B)
        .setTitle(`💰 Membros com Taxa Pendente — Ciclo <t:${Math.floor(cycleStart / 1000)}:D>`)
        .setDescription(`Os seguintes **${pending.length}** membros ainda não pagaram ou não tiveram o comprovante aprovado:\n\n` + lines.join('\n'))
        .setFooter({ text: 'Ascended Bot • Auditoria de Taxa' })
        .setTimestamp();

    return isSlash ? ctx.editReply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handleStatus(ctx, config, isSlash = false) {
    if (!isAdmin(ctx.member, config)) {
        const msgText = '🚫 Apenas administradores podem ver o status financeiro.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const cycleStart = getCycleStartMonth();
    const paid = db.getPaidMembersForCycle(cycleStart);
    const pending = db.getPendingMembersForCycle(cycleStart);

    const totalMembers = paid.length + pending.length;
    const rate = totalMembers > 0 ? (paid.length / totalMembers) * 100 : 100;

    let totalCollectedRC = 0;
    paid.forEach(p => {
        totalCollectedRC += parseAmount(p.amount);
    });

    let totalPendingRC = 0;
    pending.forEach(m => {
        const isPlanilhado = isMemberPlanilhado(m.discord_id);
        totalPendingRC += getTaxNumber(isPlanilhado, config);
    });

    const embed = new EmbedBuilder()
        .setColor(0xFF8C00)
        .setTitle(`📊 Status de Taxas — Ciclo <t:${Math.floor(cycleStart / 1000)}:D>`)
        .setDescription(
            `• **Membros Registrados:** \`${totalMembers}\`\n` +
            `• **Pagamentos Aprovados:** \`${paid.length}\` (${rate.toFixed(1)}%)\n` +
            `• **Pendentes:** \`${pending.length}\` (${(100 - rate).toFixed(1)}%)\n\n` +
            `💵 **Total Arrecadado:** \`${totalCollectedRC} RC\`\n` +
            `⏳ **Total Pendente:** \`${totalPendingRC} RC\`\n` +
            `📈 **Previsão Total:** \`${totalCollectedRC + totalPendingRC} RC\``
        )
        .setFooter({ text: 'Ascended Bot • Auditoria de Taxa' })
        .setTimestamp();

    return isSlash ? ctx.editReply({ embeds: [embed] }) : ctx.reply({ embeds: [embed] });
}

async function handlePainel(ctx, config, isSlash = false) {
    if (!isAdmin(ctx.member, config)) {
        const msgText = '🚫 Apenas administradores podem gerar o painel financeiro.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const cycleStart = getCycleStartMonth();
    const paid    = db.getPaidMembersForCycle(cycleStart);
    const pending = db.getPendingMembersForCycle(cycleStart);

    const totalMembers   = paid.length + pending.length;
    const rate           = totalMembers > 0 ? (paid.length / totalMembers) * 100 : 100;

    let totalCollectedRC = 0;
    paid.forEach(p => {
        totalCollectedRC += parseAmount(p.amount);
    });

    let totalPendingRC = 0;
    pending.forEach(m => {
        const isPlanilhado = isMemberPlanilhado(m.discord_id);
        totalPendingRC += getTaxNumber(isPlanilhado, config);
    });

    const cycleLabel = new Date(cycleStart).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const descText =
        `**Status Financeiro Global**\n` +
        `• **Membros Registrados:** \`${totalMembers}\`\n` +
        `• **Aprovados (Com Cargo):** \`${paid.length}\` (${rate.toFixed(1)}%)\n` +
        `• **Pendentes (Inadimplentes):** \`${pending.length}\` (${(100 - rate).toFixed(1)}%)\n\n` +
        `💵 **Arrecadado:** \`${totalCollectedRC} RC\`\n` +
        `⏳ **Pendente:** \`${totalPendingRC} RC\`\n` +
        `📈 **Previsão Total:** \`${totalCollectedRC + totalPendingRC} RC\`\n\n` +
        `Use os botões abaixo para gerenciar a lista de inadimplentes sem sobrecarregar o painel.`;

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`📊 Painel de Taxas — Ciclo ${cycleLabel}`)
        .setDescription(descText)
        .setFooter({ text: 'Ascended Bot • Atualização em Tempo Real' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tax_download_list')
            .setLabel('📥 Baixar Lista')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('tax_remind_pending')
            .setLabel('🔔 Cobrar Pendentes')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tax_refresh_panel')
            .setLabel('🔄 Atualizar')
            .setStyle(ButtonStyle.Secondary)
    );

    // Enviamos a resposta inicial
    // IMPORTANTE: slash commands já tiveram deferReply() — usamos editReply.
    //             prefix commands usam reply() normalmente.
    let sentMsg;
    try {
        if (isSlash) {
            sentMsg = await ctx.editReply({ embeds: [embed], components: [row] });
        } else {
            sentMsg = await ctx.reply({ embeds: [embed], components: [row] });
        }
    } catch (e) {
        console.error('[Painel] Erro ao enviar painel:', e.message);
        return;
    }

    // Registrar o collector de botões (5 minutos)
    const adminId = isSlash ? ctx.user?.id : ctx.author?.id;
    const filter  = i => i.user.id === adminId;
    const collector = sentMsg.createMessageComponentCollector({ filter, time: 5 * 60 * 1000 });

    collector.on('collect', async i => {
        // SEMPRE defer antes de qualquer operação longa para evitar "interaction failed"
        await i.deferUpdate().catch(() => {});

        if (i.customId === 'tax_download_list') {
            // Gera o conteúdo do arquivo .txt
            const cycleLabel2 = new Date(cycleStart).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            let lines = `=== LISTA DE INADIMPLENTES — Ciclo ${cycleLabel2} ===\n`;
            lines += `Gerado em: ${new Date().toLocaleString('pt-BR')}\n`;
            lines += `Total: ${pending.length} membros pendentes\n`;
            lines += `=`.repeat(60) + '\n\n';

            pending.forEach((m, idx) => {
                const isPlanilhado = isMemberPlanilhado(m.discord_id);
                const amount = getTaxValue(isPlanilhado, config);
                lines += `${idx + 1}. ${m.char_name} (Discord ID: ${m.discord_id}) — Valor: ${amount}${isPlanilhado ? ' [Planilhado]' : ''}\n`;
            });

            lines += `\n=`.repeat(60) + '\n';
            lines += `Total Arrecadado: ${totalCollectedRC} RC | Total Pendente: ${totalPendingRC} RC`;

            const { AttachmentBuilder } = require('discord.js');
            const buffer = Buffer.from(lines, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: `inadimplentes_${new Date().toISOString().split('T')[0]}.txt` });

            // followUp ephemeral não funciona para botões de mensagens normais (prefixo).
            // Enviamos direto no canal — funciona para ambos os contextos.
            await i.channel.send({
                content: `📥 <@${adminId}> Lista completa de inadimplentes — ciclo **${cycleLabel2}** (**${pending.length}** membros):`,
                files: [attachment]
            }).catch(err => {
                console.error('[Painel] Erro ao enviar arquivo:', err.message);
            });

        } else if (i.customId === 'tax_remind_pending') {
            if (pending.length === 0) {
                await i.channel.send({ content: '✅ Nenhum membro pendente para cobrar!' }).catch(() => {});
                return;
            }

            // Envia menções em blocos de 10 para não estourar o limite de mensagem
            const batchSize = 10;
            const batches = [];
            for (let b = 0; b < pending.length; b += batchSize) {
                batches.push(pending.slice(b, b + batchSize));
            }

            const cycleLabel2 = new Date(cycleStart).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            const channel = i.channel;

            await i.followUp({ content: `📢 Enviando cobranças para **${pending.length}** membros pendentes...`, ephemeral: true }).catch(() => {});

            for (const batch of batches) {
                const mentions = batch.map(m => `<@${m.discord_id}>`).join(' ');
                const isPlanilhado = batch.map(m => isMemberPlanilhado(m.discord_id));
                const amounts = batch.map((m, idx) => {
                    const amt = getTaxValue(isPlanilhado[idx], config);
                    return `• <@${m.discord_id}> (${m.char_name}) — **${amt}**`;
                }).join('\n');

                await channel.send({
                    content: `⚠️ **Lembrete de Taxa de Guerra — Ciclo ${cycleLabel2}**\n\n${mentions}\n\n${amounts}\n\nEnvie seu comprovante usando o comando \`!taxa enviar\` (com a imagem anexada) antes do prazo do ciclo!`
                }).catch(err => console.error('[Painel] Erro ao enviar cobrança em lote:', err.message));

                // Pequeno delay entre batches para evitar rate limit
                await new Promise(r => setTimeout(r, 1200));
            }

        } else if (i.customId === 'tax_refresh_panel') {
            // Recarrega os dados e atualiza o embed
            const freshPaid    = db.getPaidMembersForCycle(cycleStart);
            const freshPending = db.getPendingMembersForCycle(cycleStart);
            const freshTotal   = freshPaid.length + freshPending.length;
            const freshRate    = freshTotal > 0 ? (freshPaid.length / freshTotal) * 100 : 100;

            let freshCollected = 0;
            freshPaid.forEach(p => { freshCollected += parseAmount(p.amount); });
            let freshPendingRC = 0;
            freshPending.forEach(m => {
                const isPlanilhado = isMemberPlanilhado(m.discord_id);
                freshPendingRC += getTaxNumber(isPlanilhado, config);
            });

            const freshDesc =
                `**Status Financeiro Global**\n` +
                `• **Membros Registrados:** \`${freshTotal}\`\n` +
                `• **Aprovados (Com Cargo):** \`${freshPaid.length}\` (${freshRate.toFixed(1)}%)\n` +
                `• **Pendentes (Inadimplentes):** \`${freshPending.length}\` (${(100 - freshRate).toFixed(1)}%)\n\n` +
                `💵 **Arrecadado:** \`${freshCollected} RC\`\n` +
                `⏳ **Pendente:** \`${freshPendingRC} RC\`\n` +
                `📈 **Previsão Total:** \`${freshCollected + freshPendingRC} RC\`\n\n` +
                `Use os botões abaixo para gerenciar a lista de inadimplentes sem sobrecarregar o painel.`;

            const freshEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`📊 Painel de Taxas — Ciclo ${cycleLabel}`)
                .setDescription(freshDesc)
                .setFooter({ text: `Ascended Bot • Atualizado às ${new Date().toLocaleTimeString('pt-BR')}` })
                .setTimestamp();

            // Usa editReply para slash (já foi deferido), edit para prefix
            if (isSlash) {
                await ctx.editReply({ embeds: [freshEmbed], components: [row] }).catch(() => {});
            } else {
                await sentMsg.edit({ embeds: [freshEmbed], components: [row] }).catch(() => {});
            }
        }
    });

    collector.on('end', () => {
        // Desabilitar botões quando o collector expirar
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tax_download_list').setLabel('📥 Baixar Lista').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('tax_remind_pending').setLabel('🔔 Cobrar Pendentes').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('tax_refresh_panel').setLabel('🔄 Atualizar').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        sentMsg.edit({ components: [disabledRow] }).catch(() => {});
    });
}

module.exports = {
    name: 'taxa',
    aliases: ['tax', 'imposto', 'taxa-paga'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('taxa')
        .setDescription('Controle de Taxa de Guerra')
        .addSubcommand(sub =>
            sub.setName('enviar')
                .setDescription('Envia o comprovante da taxa mensal')
                .addAttachmentOption(opt =>
                    opt.setName('comprovante')
                        .setDescription('Imagem do comprovante de depósito')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('pendentes')
                .setDescription('Lista membros que ainda não pagaram a taxa no ciclo atual (Admin)')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Exibe o status financeiro do ciclo de taxa atual (Admin)')
        )
        .addSubcommand(sub =>
            sub.setName('painel')
                .setDescription('Gera um painel interativo financeiro da guild (Admin)')
        ),

    async execute(msg, args, { config }) {
        const sub = args[0]?.toLowerCase() || 'enviar';

        if (sub === 'enviar' || msg.content.toLowerCase().includes('taxa-paga')) {
            const attachment = msg.attachments.first();
            if (!attachment) {
                return msg.reply('⚠️ Você precisa anexar a imagem do comprovante à mensagem.').catch(() => {});
            }
            return handleEnviar(msg, msg.author.id, attachment.url, config, false);
        }

        if (sub === 'pendentes') {
            return handlePendentes(msg, config, false);
        }

        if (sub === 'status') {
            return handleStatus(msg, config, false);
        }

        if (sub === 'painel') {
            return handlePainel(msg, config, false);
        }

        return msg.reply('⚠️ Uso correto: `!taxa enviar` (com comprovante anexado).catch(() => {}), `!taxa pendentes`, `!taxa status` ou `!taxa painel`.');
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();

        if (sub === 'enviar') {
            const attachment = interaction.options.getAttachment('comprovante');
            if (!attachment) {
                return interaction.editReply({ content: '⚠️ Você precisa anexar a imagem do comprovante.', ephemeral: true }).catch(() => {});
            }
            return handleEnviar(interaction, interaction.user.id, attachment.url, config, true);
        }

        if (sub === 'pendentes') {
            return handlePendentes(interaction, config, true);
        }

        if (sub === 'status') {
            return handleStatus(interaction, config, true);
        }

        if (sub === 'painel') {
            return handlePainel(interaction, config, true);
        }
    }
};
