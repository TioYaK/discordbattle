'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('./database');
const state = require('./state');

// Cooldown map for the alert button (partyId -> timestamp)
const alertCooldowns = new Map();

const CLASSES_LABELS = {
    EK: { name: 'Elite Knights', icon: '⚔️', roleName: 'Elite Knight' },
    ED: { name: 'Elder Druids', icon: '🌳', roleName: 'Elder Druid' },
    RP: { name: 'Royal Paladins', icon: '🎯', roleName: 'Royal Paladin' },
    MS: { name: 'Master Sorcerers', icon: '✨', roleName: 'Master Sorcerer' },
    EM: { name: 'Exalted Monks', icon: '🧘', roleName: 'Exalted Monk' }
};

function buildPtEmbed(party) {
    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🏹 Nova Hunt: ${party.local}`)
        .setDescription(`Confirme sua presença clicando nos botões abaixo!`)
        .addFields(
            { name: '👑 Organizador', value: `<@${party.creatorId}>`, inline: true },
            { name: '⏰ Horário', value: `${party.horario} (Duração: ${party.duracao})`, inline: true },
            { name: '📊 Level Mínimo', value: party.levelMin ? `\`${party.levelMin}+\`` : '`Nenhum`', inline: true }
        );

    // Group current members by classCode
    const grouped = { EK: [], ED: [], RP: [], MS: [], EM: [] };
    party.members.forEach(m => {
        if (grouped[m.classCode]) {
            grouped[m.classCode].push(m);
        }
    });

    const limits = {
        EK: party.maxEk,
        ED: party.maxEd,
        RP: party.maxRp,
        MS: party.maxMs,
        EM: party.maxEm
    };

    // For each class, list the slots
    for (const classCode of ['EK', 'ED', 'RP', 'MS', 'EM']) {
        const max = limits[classCode];
        if (max === 0) continue;

        const filled = grouped[classCode];
        const lines = [];

        for (let i = 0; i < max; i++) {
            if (filled[i]) {
                lines.push(`🟢 **${filled[i].charName}** (<@${filled[i].discordId}>)`);
            } else {
                lines.push(`🔴 *[ Vaga disponível ]*`);
            }
        }

        const label = CLASSES_LABELS[classCode];
        embed.addFields({
            name: `${label.icon} ${label.name} (${filled.length}/${max})`,
            value: lines.join('\n'),
            inline: false
        });
    }

    // Check if PT is full
    const totalMax = party.maxEk + party.maxEd + party.maxRp + party.maxMs + party.maxEm;
    const totalFilled = party.members.length;
    if (totalFilled === totalMax) {
        embed.setColor(0x2ECC71); // Green
        embed.setTitle(`🔥 Hunt Confirmada: ${party.local} (PT CHEIA!)`);
    }

    embed.setFooter({ text: `PT ID: ${party.id} • Ascended Bot` }).setTimestamp();
    return embed;
}

function buildPtButtons(party) {
    const rows = [];
    const mainRow = new ActionRowBuilder();

    const limits = {
        EK: party.maxEk,
        ED: party.maxEd,
        RP: party.maxRp,
        MS: party.maxMs,
        EM: party.maxEm
    };

    // Add join buttons for required classes
    let buttonCount = 0;
    for (const classCode of ['EK', 'ED', 'RP', 'MS', 'EM']) {
        if (limits[classCode] > 0) {
            mainRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`pt_join_${classCode}_${party.id}`)
                    .setLabel(`${CLASSES_LABELS[classCode].icon} ${classCode}`)
                    .setStyle(ButtonStyle.Primary)
            );
            buttonCount++;
        }
    }

    if (buttonCount > 0) {
        rows.push(mainRow);
    }

    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`pt_leave_${party.id}`)
                .setLabel('❌ Sair')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`pt_alert_${party.id}`)
                .setLabel('📢 Chamar Vaga')
                .setStyle(ButtonStyle.Secondary)
        );

    rows.push(controlRow);
    return rows;
}

async function handleButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('pt_')) return;

    const parts = customId.split('_');
    const action = parts[1]; // 'join', 'leave', or 'alert'
    
    let classCode = null;
    let partyId = null;

    if (action === 'join') {
        classCode = parts[2];
        partyId = parseInt(parts[3], 10);
    } else {
        partyId = parseInt(parts[2], 10);
    }

    const party = db.getParty(partyId);
    if (!party) {
        return interaction.reply({ content: '❌ PT não encontrada no banco de dados. Ela pode ter sido deletada.', ephemeral: true });
    }

    // ─── ACTION: JOIN ────────────────────────────────────────────────────────
    if (action === 'join') {
        // Enforce registration
        const reg = db.getRegisteredMember(interaction.user.id);
        if (!reg) {
            return interaction.reply({
                content: '🚫 **Registro Requerido:** Você precisa estar registrado para se juntar a uma PT de hunt. Peça para um Administrador te registrar usando `/registro`.',
                ephemeral: true
            });
        }

        // Validate Level limits if known
        if (party.levelMin) {
            const charData = state.guildMembers?.find(m => m.name.toLowerCase() === reg.char_name.toLowerCase());
            if (charData && charData.level < party.levelMin) {
                return interaction.reply({
                    content: `🚫 **Level Insuficiente:** O level mínimo para esta hunt é **${party.levelMin}+**, mas seu personagem **${reg.char_name}** é level **${charData.level}**.`,
                    ephemeral: true
                });
            }
        }

        // Check if class limit has been reached
        const grouped = party.members.filter(m => m.classCode === classCode);
        const limit = { EK: party.maxEk, ED: party.maxEd, RP: party.maxRp, MS: party.maxMs, EM: party.maxEm }[classCode];
        
        // Check if already in the party under this exact class
        const alreadyInClass = party.members.find(m => m.discordId === interaction.user.id && m.classCode === classCode);
        if (alreadyInClass) {
            return interaction.reply({ content: `💡 Você já está preenchendo uma vaga de **${classCode}** nesta PT!`, ephemeral: true });
        }

        if (grouped.length >= limit) {
            return interaction.reply({ content: `❌ **Classe Cheia:** Todas as vagas para **${classCode}** nesta PT já estão ocupadas!`, ephemeral: true });
        }

        // Remove from other classes in this PT if already joined
        party.members = party.members.filter(m => m.discordId !== interaction.user.id);

        // Add to the new class
        party.members.push({
            discordId: interaction.user.id,
            charName: reg.char_name,
            classCode: classCode
        });

        db.updateParty(party);

        // Re-render embed & update message
        const embed = buildPtEmbed(party);
        const buttons = buildPtButtons(party);

        await interaction.update({ embeds: [embed], components: buttons });

        // Check if PT is now full
        const totalMax = party.maxEk + party.maxEd + party.maxRp + party.maxMs + party.maxEm;
        if (party.members.length === totalMax) {
            const mentions = party.members.map(m => `<@${m.discordId}>`).join(', ');
            await interaction.channel.send({
                content: `🔥 **PT Fechada!** O grupo para **${party.local}** está completo! Boa hunt: ${mentions}.`
            }).catch(() => {});
        }

    // ─── ACTION: LEAVE ───────────────────────────────────────────────────────
    } else if (action === 'leave') {
        const isMember = party.members.some(m => m.discordId === interaction.user.id);
        if (!isMember) {
            return interaction.reply({ content: '💡 Você não está nesta PT.', ephemeral: true });
        }

        party.members = party.members.filter(m => m.discordId !== interaction.user.id);
        db.updateParty(party);

        const embed = buildPtEmbed(party);
        const buttons = buildPtButtons(party);

        await interaction.update({ embeds: [embed], components: buttons });

    // ─── ACTION: ALERT ───────────────────────────────────────────────────────
    } else if (action === 'alert') {
        // Cooldown check
        const lastAlert = alertCooldowns.get(partyId);
        if (lastAlert && Date.now() - lastAlert < 120_000) {
            const timeLeft = Math.ceil((120_000 - (Date.now() - lastAlert)) / 1000);
            return interaction.reply({
                content: `⏳ **Aguarde:** Por favor, espere mais **${timeLeft}s** para chamar vagas novamente e evitar spam.`,
                ephemeral: true
            });
        }

        // Check missing slots
        const grouped = { EK: 0, ED: 0, RP: 0, MS: 0, EM: 0 };
        party.members.forEach(m => { grouped[m.classCode]++; });

        const limits = { EK: party.maxEk, ED: party.maxEd, RP: party.maxRp, MS: party.maxMs, EM: party.maxEm };
        const missingClasses = [];
        const rolePings = [];

        for (const classCode of ['EK', 'ED', 'RP', 'MS', 'EM']) {
            if (limits[classCode] > grouped[classCode]) {
                missingClasses.push(classCode);
                
                // Try to find the corresponding role in the guild for ping
                const label = CLASSES_LABELS[classCode];
                const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === label.roleName.toLowerCase());
                if (role) {
                    rolePings.push(`<@&${role.id}>`);
                } else {
                    rolePings.push(`@${label.roleName}`);
                }
            }
        }

        if (missingClasses.length === 0) {
            return interaction.reply({ content: '✅ A PT já está cheia!', ephemeral: true });
        }

        // Set cooldown
        alertCooldowns.set(partyId, Date.now());

        // Send alert message
        const messageLink = `https://discord.com/channels/${interaction.guild.id}/${interaction.channelId}/${party.messageId}`;
        const levelRequirement = party.levelMin ? ` level ${party.levelMin}+` : '';
        
        await interaction.reply({ content: '📢 Alerta de vagas enviado com sucesso!', ephemeral: true });
        
        await interaction.channel.send({
            content: `🚨 **Procura-se Jogadores (${missingClasses.join(', ')})!**\n` +
                     `O grupo para **${party.local}** (início às **${party.horario}**) precisa de: ${missingClasses.map(c => `**${c}**`).join(', ')}${levelRequirement}.\n` +
                     `Avisando: ${rolePings.join(' ')}\n` +
                     `🔗 **Clique aqui para entrar:** [Painel da PT](${messageLink})`
        });
    }
}

module.exports = {
    buildPtEmbed,
    buildPtButtons,
    handleButton
};
