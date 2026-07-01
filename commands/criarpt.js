'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const { buildPtEmbed, buildPtButtons } = require('../modules/ptManager');

function parseVagasString(vagasStr) {
    const counts = { EK: 1, ED: 1, RP: 1, MS: 1, EM: 0 };
    if (!vagasStr) return counts;

    counts.EK = 0;
    counts.ED = 0;
    counts.RP = 0;
    counts.MS = 0;
    counts.EM = 0;

    const matches = vagasStr.matchAll(/(\d+)\s*(ek|ed|rp|ms|em)/gi);
    let matchedAny = false;
    for (const match of matches) {
        matchedAny = true;
        const count = parseInt(match[1], 10);
        const voc = match[2].toUpperCase();
        counts[voc] = count;
    }

    if (!matchedAny) {
        counts.EK = 1;
        counts.ED = 1;
        counts.RP = 1;
        counts.MS = 1;
    }

    return counts;
}

module.exports = {
    name: 'criarpt',
    aliases: ['pt', 'party', 'criarparty'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('criarpt')
        .setDescription('Cria um painel de recrutamento interativo para hunt (PT)')
        .addStringOption(option =>
            option.setName('local')
                .setDescription('Local da hunt (ex: Cobras, Bulltaurs, Gnomprona)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('inicio')
                .setDescription('Horário de início (ex: 20:00, 22:30)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('vagas')
                .setDescription('Vagas por classe (ex: 2ed 1ek 1rp 1ms). Padrão: 1 de cada classe.')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('duracao')
                .setDescription('Duração da hunt (ex: 2h, 3h). Padrão: 2h.')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('level_min')
                .setDescription('Level mínimo recomendado')
                .setRequired(false)
        ),

    async execute(msg, args, { config }) {
        const argsStr = args.join(' ');
        const parts = argsStr.split(',').map(p => p.trim());

        if (parts.length < 3) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Uso Incorreto')
                        .setDescription('Como usar o comando:\n`!criarpt <local>, <vagas (ex: 2ed 1ek)>, <inicio (ex: 20:00)>, [duracao (ex: 2h)], [level_min]`\n\n*Nota: Os argumentos devem ser separados por vírgula.*')
                ]
            });
        }

        const local = parts[0];
        const vagasStr = parts[1];
        const horario = parts[2];
        const duracao = parts[3] || '2h';
        const levelMin = parts[4] ? parseInt(parts[4], 10) : null;

        const counts = parseVagasString(vagasStr);
        const creatorId = msg.author.id;

        // Auto join creator if registered and the class is needed
        const reg = db.getRegisteredMember(creatorId);
        const members = [];
        if (reg && counts[reg.class_code] > 0) {
            members.push({
                discordId: creatorId,
                charName: reg.char_name,
                classCode: reg.class_code
            });
        }

        const partyObj = {
            creatorId,
            local,
            horario,
            duracao,
            levelMin,
            maxEk: counts.EK,
            maxEd: counts.ED,
            maxRp: counts.RP,
            maxMs: counts.MS,
            maxEm: counts.EM,
            members
        };

        // Save initial party in DB to get an ID
        const partyId = db.insertParty(partyObj);
        partyObj.id = partyId;

        const embed = buildPtEmbed(partyObj);
        const buttons = buildPtButtons(partyObj);

        const replyMsg = await msg.channel.send({ embeds: [embed], components: buttons });

        // Update party in DB with message and channel details
        partyObj.messageId = replyMsg.id;
        partyObj.channelId = replyMsg.channelId;
        db.updateParty(partyObj);
    },

    async executeSlash(interaction, { config }) {
        const local = interaction.options.getString('local');
        const horario = interaction.options.getString('inicio');
        const vagasStr = interaction.options.getString('vagas');
        const duracao = interaction.options.getString('duracao') || '2h';
        const levelMin = interaction.options.getInteger('level_min');

        const counts = parseVagasString(vagasStr);
        const creatorId = interaction.user.id;

        // Auto join creator if registered and class is needed
        const reg = db.getRegisteredMember(creatorId);
        const members = [];
        if (reg && counts[reg.class_code] > 0) {
            members.push({
                discordId: creatorId,
                charName: reg.char_name,
                classCode: reg.class_code
            });
        }

        const partyObj = {
            creatorId,
            local,
            horario,
            duracao,
            levelMin,
            maxEk: counts.EK,
            maxEd: counts.ED,
            maxRp: counts.RP,
            maxMs: counts.MS,
            maxEm: counts.EM,
            members
        };

        // Save in DB to get row ID
        const partyId = db.insertParty(partyObj);
        partyObj.id = partyId;

        const embed = buildPtEmbed(partyObj);
        const buttons = buildPtButtons(partyObj);

        // Send interaction response
        const replyMsg = await interaction.reply({ embeds: [embed], components: buttons, fetchReply: true });

        // Update party details in DB
        partyObj.messageId = replyMsg.id;
        partyObj.channelId = replyMsg.channelId;
        db.updateParty(partyObj);
    }
};
