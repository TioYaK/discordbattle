'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

const CLASS_DETAILS = {
    EK: { name: 'Knight (Guerreiro)', hp: 150, atk: 10, def: 15, emoji: '⚔️' },
    RP: { name: 'Paladin (Arqueiro)', hp: 120, atk: 12, def: 12, emoji: '🎯' },
    ED: { name: 'Druid (Clérigo)', hp: 110, atk: 11, def: 10, emoji: '❄️' },
    MS: { name: 'Sorcerer (Mago)', hp: 100, atk: 15, def: 8, emoji: '🔥' }
};

const GENDER_DETAILS = {
    M: { name: 'Masculino', emoji: '♂️' },
    F: { name: 'Feminino', emoji: '♀️' }
};

module.exports = {
    name: 'rpg-registrar',
    aliases: ['rpg-criar', 'rpg-register', 'rpg-create'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('rpg-registrar')
        .setDescription('Cria seu personagem virtual no RPG do Bastião de Aethelgard')
        .addStringOption(option => 
            option.setName('apelido')
                .setDescription('Seu apelido único no RPG (3-15 caracteres alfanuméricos)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('classe')
                .setDescription('Sua vocação de combate')
                .setRequired(true)
                .addChoices(
                    { name: '⚔️ Knight (Guerreiro)', value: 'EK' },
                    { name: '🎯 Paladin (Arqueiro)', value: 'RP' },
                    { name: '❄️ Druid (Clérigo)', value: 'ED' },
                    { name: '🔥 Sorcerer (Mago)', value: 'MS' }
                ))
        .addStringOption(option =>
            option.setName('genero')
                .setDescription('O gênero do seu personagem')
                .setRequired(true)
                .addChoices(
                    { name: '♂️ Masculino', value: 'M' },
                    { name: '♀️ Feminino', value: 'F' }
                )),

    async execute(msg, args, { client }) {
        const userId = msg.author.id;

        if (args.length < 3) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0xFF4444)
                        .setTitle('🚫 Sintaxe Incorreta')
                        .setDescription('Use: **`!rpg-registrar [Apelido] [Classe: EK, RP, ED, MS] [Gênero: M, F]`**\n\nExemplo: `!rpg-registrar SirGallhad EK M`')
                ]
            });
        }

        const nickname = args[0].trim();
        const classCode = args[1].toUpperCase().trim();
        const gender = args[2].toUpperCase().trim();

        const result = await registerCharacter(userId, nickname, classCode, gender);

        if (result.error) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0xFF4444)
                        .setTitle('🚫 Erro no Registro')
                        .setDescription(result.error)
                ]
            });
        }

        return msg.reply({ embeds: [result.embed] }).catch(() => {});
    },

    async executeSlash(interaction, { client }) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const nickname = interaction.options.getString('apelido').trim();
        const classCode = interaction.options.getString('classe');
        const gender = interaction.options.getString('genero');

        const result = await registerCharacter(userId, nickname, classCode, gender);

        if (result.error) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0xFF4444)
                        .setTitle('🚫 Erro no Registro')
                        .setDescription(result.error)
                ],
                ephemeral: true
            });
        }

        return interaction.editReply({ embeds: [result.embed] }).catch(() => {});
    }
};

async function registerCharacter(userId, nickname, classCode, gender) {
    // 1. Verify if registered in main bot
    const mainMember = db.getRegisteredMember(userId);
    if (!mainMember) {
        return { error: 'Você precisa estar registrado no bot principal primeiro! Use **`/registro`**.' };
    }

    // 2. Verify if RPG character already exists
    const existingChar = db.getRpgCharacter(userId);
    if (existingChar) {
        return { error: `Você já possui um personagem RPG criado: **${existingChar.nickname}**.` };
    }

    // 3. Validation
    if (nickname.length < 3 || nickname.length > 15 || !/^[a-zA-Z0-9]+$/.test(nickname)) {
        return { error: 'O apelido deve conter entre 3 e 15 caracteres alfanuméricos (apenas letras e números, sem espaços).' };
    }

    if (!['EK', 'RP', 'ED', 'MS'].includes(classCode)) {
        return { error: 'Classe inválida! Escolha entre: **EK** (Knight), **RP** (Paladin), **ED** (Druid), ou **MS** (Sorcerer).' };
    }

    if (!['M', 'F'].includes(gender)) {
        return { error: 'Gênero inválido! Escolha entre **M** (Masculino) ou **F** (Feminino).' };
    }

    // 4. Nickname unique check
    const duplicateChar = db.getRpgCharacterByNickname(nickname);
    if (duplicateChar) {
        return { error: 'Este apelido já está em uso por outro guerreiro no Bastião.' };
    }

    // 5. Create character
    try {
        db.createRpgCharacter({ discordId: userId, nickname, classCode, gender });
        
        const details = CLASS_DETAILS[classCode];
        const genderText = GENDER_DETAILS[gender].name;
        const genderEmoji = GENDER_DETAILS[gender].emoji;

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6) // Purple
            .setTitle(`⚔️ BEM-VINDO AO BASTIÃO DE AETHELGARD! ⚔️`)
            .setDescription(
                `O destemido(a) guerreiro(a) **${nickname}** acaba de chegar às terras do Bastião!\n\n` +
                `✨ **Seu avatar de RPG foi criado com sucesso!**\n\n` +
                `**Votação:** ${details.emoji} **${details.name}**\n` +
                `**Gênero:** ${genderEmoji} **${genderText}**\n` +
                `**Nível:** \`1\` (0 / 100 RPG XP)\n\n` +
                `**❤️ Vida Máxima:** \`${details.hp}\` HP\n` +
                `**⚔️ Poder de Ataque:** \`${details.atk}\` Atk\n` +
                `**🛡️ Poder de Defesa:** \`${details.def}\` Def\n\n` +
                `Use **\`/rpg-perfil\`** para ver seu status e equipar itens, e **\`/duelar\`** para testar suas forças contra outros membros na Arena!`
            )
            .setFooter({ text: 'Ascended RPG • Bastião de Aethelgard' })
            .setTimestamp();

        return { embed };
    } catch (err) {
        console.error('[RPG] Erro ao registrar personagem:', err.message);
        return { error: `Erro interno ao salvar personagem: ${err.message}` };
    }
}
