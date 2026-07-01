'use strict';

const { buildRoletaEmbed, buildErrorEmbed, buildHuntedListEmbed } = require('../modules/embeds');
const { EmbedBuilder } = require('discord.js');
const state = require('../modules/state');

module.exports = {
    name: 'roleta',
    aliases: ['ativaroleta', 'desativaroleta', 'sortear', 'roulette'],
    adminOnly: false,
    async execute(msg, args, { config }) {
        const sub = args[0]?.toLowerCase();

        // !ativaroleta — ativa a coleta de participantes neste canal
        if (sub === 'ativar' || msg.content.toLowerCase().includes('ativaroleta')) {
            state.roletaActive    = true;
            state.roletaChannelId = msg.channelId;
            state.roletaTarget    = [];

            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFD700)
                        .setTitle('🎰 Roleta Ativada!')
                        .setDescription('Qualquer mensagem neste canal agora conta como participação!\nUse `!roleta sortear` para sortear o ganhador.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ]
            });
        }

        // !desativaroleta — desativa
        if (sub === 'desativar' || msg.content.toLowerCase().includes('desativaroleta')) {
            state.roletaActive    = false;
            state.roletaChannelId = null;
            state.roletaTarget    = null;

            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x808080)
                        .setTitle('🎰 Roleta Desativada')
                        .setDescription('A roleta foi encerrada sem sortear.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ]
            });
        }

        // !roleta sortear — sorteia entre os participantes coletados
        if (sub === 'sortear' || sub === 'girar') {
            const participants = state.roletaTarget || [];

            if (participants.length === 0) {
                return msg.reply({ embeds: [buildErrorEmbed('Nenhum participante na roleta. Ative com `!ativaroleta` e aguarde mensagens.')] });
            }

            const winner = participants[Math.floor(Math.random() * participants.length)];
            state.roletaActive    = false;
            state.roletaChannelId = null;
            state.roletaTarget    = null;

            return msg.reply({ embeds: [buildRoletaEmbed(winner, participants)] });
        }

        // !roleta <nome1> <nome2> ... — roleta rápida com nomes fornecidos
        if (args.length > 0) {
            const participants = args;
            if (participants.length < 2) {
                return msg.reply({ embeds: [buildErrorEmbed('Forneça pelo menos 2 nomes para a roleta. Ex: `!roleta João Maria Pedro`')] });
            }

            const winner = participants[Math.floor(Math.random() * participants.length)];
            return msg.reply({ embeds: [buildRoletaEmbed(winner, participants)] });
        }

        // !roleta sem args — mostra ajuda
        return msg.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🎰 Roleta — Ajuda')
                    .addFields(
                        { name: '!roleta <n1> <n2> ...', value: 'Sorteia entre os nomes fornecidos',    inline: false },
                        { name: '!ativaroleta',           value: 'Ativa coleta de participantes no canal', inline: false },
                        { name: '!roleta sortear',        value: 'Sorteia entre participantes coletados',  inline: false },
                        { name: '!desativaroleta',        value: 'Desativa a roleta',                      inline: false },
                    )
                    .setFooter({ text: 'Ascended Bot • RubinOT' })
                    .setTimestamp()
            ]
        });
    },

    // Hook chamado no messageCreate para coletar participantes quando roleta está ativa
    onMessage(msg) {
        if (!state.roletaActive) return;
        if (msg.channelId !== state.roletaChannelId) return;
        if (msg.author.bot) return;

        const author = msg.member?.displayName || msg.author.username;
        if (!state.roletaTarget.includes(author)) {
            state.roletaTarget.push(author);
        }
    },
};
