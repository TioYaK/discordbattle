'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../modules/database');

module.exports = {
    name: 'profissao',
    aliases: ['profession', 'subclasse'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('profissao')
        .setDescription('Escolha sua Profissão Secundária (Requer Nível 15+)'),

    async execute(msg) {
        return handleProfissao(msg.author.id, msg.channel, msg.author);
    },

    async executeSlash(interaction) {
        await interaction.deferReply({ ephemeral: true });
        return handleProfissao(interaction.user.id, interaction, interaction.user, true);
    }
};

async function handleProfissao(userId, channelOrInteraction, user, isSlash = false) {
    const char = db.getRpgCharacter(userId);
    
    if (!char) {
        const err = 'Você precisa estar registrado no RPG para escolher uma profissão. Use `!rpg-registrar`.';
        if (isSlash) return channelOrInteraction.editReply({ content: err });
        return channelOrInteraction.send(err);
    }

    if (char.level < 15) {
        const err = `Você precisa atingir o **Nível 15** para escolher uma Profissão. Você está no nível ${char.level}.`;
        if (isSlash) return channelOrInteraction.editReply({ content: err });
        return channelOrInteraction.send(err);
    }

    if (char.profession) {
        const err = `Você já é um(a) **${char.profession}**! Profissões não podem ser alteradas.`;
        if (isSlash) return channelOrInteraction.editReply({ content: err });
        return channelOrInteraction.send(err);
    }

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🛠️ Escolha sua Profissão Secundária')
        .setDescription('Ao atingir o Nível 15, os heróis de Aethelgard se especializam em uma profissão para ajudar na economia e nas caçadas.\n\n🧪 **Alquimista:** Desbloqueia receitas de Poções na Forja.\n🔨 **Ferreiro:** Coleta recursos em dobro (`!coletar`) e tem chance extra de sucesso no Refino.\n🐾 **Domador:** 30% a mais de chance de Ovos Misteriosos e metade do custo de Incubação (`!pets`).\n\n**CUIDADO:** Esta escolha é **PERMANENTE** e não poderá ser alterada!');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prof_alchemist').setLabel('Alquimista').setEmoji('🧪').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('prof_blacksmith').setLabel('Ferreiro').setEmoji('🔨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('prof_tamer').setLabel('Domador').setEmoji('🐾').setStyle(ButtonStyle.Secondary)
    );

    let msg;
    if (isSlash) {
        msg = await channelOrInteraction.editReply({ embeds: [embed], components: [row] });
    } else {
        msg = await channelOrInteraction.send({ embeds: [embed], components: [row] });
    }

    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        let chosenProf = '';
        if (i.customId === 'prof_alchemist') chosenProf = 'Alquimista';
        if (i.customId === 'prof_blacksmith') chosenProf = 'Ferreiro';
        if (i.customId === 'prof_tamer') chosenProf = 'Domador';

        if (chosenProf) {
            db.db.prepare('UPDATE rpg_characters SET profession = ? WHERE discord_id = ?').run(chosenProf, userId);
            
            const winEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🎉 Profissão Escolhida!')
                .setDescription(`Parabéns! Você se tornou um(a) **${chosenProf}**!\n\nAgora você pode desfrutar dos bônus exclusivos da sua classe secundária!`);
            
            await i.update({ embeds: [winEmbed], components: [] });
            collector.stop('done');
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            if (isSlash) {
                channelOrInteraction.editReply({ content: '⏳ Tempo esgotado.', components: [] }).catch(()=>{});
            } else {
                msg.edit({ content: '⏳ Tempo esgotado.', components: [] }).catch(()=>{});
            }
        }
    });
}
