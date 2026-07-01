'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../modules/database');

module.exports = {
    name: 'taverna',
    aliases: ['quests', 'bounty', 'missao', 'missoes', 'diarias'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('taverna')
        .setDescription('Visite a Taverna para gerenciar suas Missões Diárias da Guilda.'),

    async execute(msg) {
        return handleTavern(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleTavern(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleTavern(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    // Cooldown de geração de quests diárias (1 por dia)
    const lastQuests = db.getConfig(`last_quests_${userId}`) || 0;
    const now = Date.now();
    const msInDay = 24 * 60 * 60 * 1000;
    
    let quests = db.getDailyQuests(userId);

    // Se não tiver quests e já passou 1 dia, ou se as quests estiverem zeradas
    if ((!quests || quests.length === 0) && (now - lastQuests > msInDay)) {
        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('🍻 Quadro de Missões da Taverna')
            .setDescription('O taverneiro aponta para o quadro. Há novos contratos diários disponíveis para você hoje.\nAceite os contratos para começar a progredir!');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('accept_quests').setLabel('Pegar Missões Diárias').setEmoji('📜').setStyle(ButtonStyle.Primary)
        );

        let msg;
        if (interaction) msg = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
        else msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});

        const filter = i => i.user.id === userId;
        const collector = msg.createMessageComponentCollector({ filter, time: 60000 });
        collector.on('collect', async i => {
            if (i.customId === 'accept_quests') {
                db.setConfig(`last_quests_${userId}`, now);
                quests = db.generateDailyQuests(userId);
                await i.update({ content: 'Missões aceitas! Use `!taverna` de novo para ver o progresso.', embeds: [], components: [] });
                collector.stop();
            }
        });
        return;
    } else if ((!quests || quests.length === 0) && (now - lastQuests <= msInDay)) {
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🍻 Taverna')
            .setDescription('Você já completou todas as missões diárias de hoje! Volte amanhã para novos contratos.');
        if (interaction) return interaction.editReply({ embeds: [embed] }).catch(() => {});
        return channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Montar o display das missões
    let allCompleted = true;
    let anyToClaim = false;
    let totalRewardAc = 0;

    let desc = 'Aqui estão os seus contratos atuais:\n\n';

    quests.forEach((q, index) => {
        let questDesc = '';
        if (q.quest_type === 'hunt') questDesc = `Cace **${q.goal}** monstros usando \`!cacar\`.`;
        if (q.quest_type === 'duel') questDesc = `Duele contra **${q.goal}** jogadores usando \`!duelar\`.`;
        if (q.quest_type === 'tax') questDesc = `Pague sua taxa do ciclo usando \`!taxa enviar\`.`;

        let status = '';
        if (q.completed === 1) {
            status = '✅ Completa';
        } else if (q.progress >= q.goal) {
            status = '🌟 Pronta para entregar';
            anyToClaim = true;
            allCompleted = false;
        } else {
            status = `🔄 ${q.progress} / ${q.goal}`;
            allCompleted = false;
        }

        totalRewardAc += q.reward_ac;
        desc += `**${index + 1}.** ${questDesc}\n└ Progresso: ${status} | Recompensa: **${q.reward_ac} AC**\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📜 Suas Missões Diárias')
        .setDescription(desc);

    const row = new ActionRowBuilder();
    
    if (anyToClaim) {
        embed.setColor(0xF1C40F);
        row.addComponents(new ButtonBuilder().setCustomId('claim_rewards').setLabel('Coletar Recompensas').setEmoji('💰').setStyle(ButtonStyle.Success));
    } else if (!allCompleted) {
        row.addComponents(new ButtonBuilder().setCustomId('abandon_quests').setLabel('Abandonar Missões').setStyle(ButtonStyle.Danger));
    }

    let msg;
    if (row.components.length > 0) {
        if (interaction) msg = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
        else msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});

        const filter = i => i.user.id === userId;
        const collector = msg.createMessageComponentCollector({ filter, time: 60000 });
        collector.on('collect', async i => {
            if (i.customId === 'claim_rewards') {
                const rewarded = db.completeQuests(userId);
                if (rewarded > 0) {
                    await i.update({ content: `🎉 Você completou missões e coletou um total de **${rewarded} AC** da Guilda!`, embeds: [], components: [] });
                }
                collector.stop();
            } else if (i.customId === 'abandon_quests') {
                db.db.prepare('DELETE FROM daily_quests WHERE discord_id = ?').run(userId);
                await i.update({ content: 'Você rasgou os contratos. Espere até amanhã para pegar novas missões.', embeds: [], components: [] });
                collector.stop();
            }
        });
    } else {
        if (interaction) return interaction.editReply({ embeds: [embed] }).catch(() => {});
        return channel.send({ embeds: [embed] }).catch(() => {});
    }
}
