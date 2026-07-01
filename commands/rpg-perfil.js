'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const rpgItems = require('../modules/rpgItems');

const CLASS_GROWTH = {
    EK: { name: 'Knight (Guerreiro)', hpBase: 150, atkBase: 10, defBase: 15, hplvl: 15, atklvl: 1.0, deflvl: 2.0, emoji: '⚔️' },
    RP: { name: 'Paladin (Arqueiro)', hpBase: 120, atkBase: 12, defBase: 12, hplvl: 10, atklvl: 1.5, deflvl: 1.5, emoji: '🎯' },
    ED: { name: 'Druid (Clérigo)', hpBase: 110, atkBase: 11, defBase: 10, hplvl: 8, atklvl: 1.8, deflvl: 1.0, emoji: '❄️' },
    MS: { name: 'Sorcerer (Mago)', hpBase: 100, atkBase: 15, defBase: 8, hplvl: 8, atklvl: 2.2, deflvl: 0.8, emoji: '🔥' }
};

const GENDER_DETAILS = {
    M: { name: 'Masculino', emoji: '♂️' },
    F: { name: 'Feminino', emoji: '♀️' }
};

module.exports = {
    name: 'rpg-perfil',
    aliases: ['rpg-status', 'rpg-char', 'rpg-avatar'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('rpg-perfil')
        .setDescription('Exibe as informações detalhadas e equipamentos do seu personagem de RPG')
        .addUserOption(option => 
            option.setName('usuario')
                .setDescription('Usuário para ver o perfil (opcional)')
                .setRequired(false)),

    async execute(msg, args, { client }) {
        let targetUser = msg.author;
        if (msg.mentions.users.first()) {
            targetUser = msg.mentions.users.first();
        } else if (args[0]) {
            // Find by ID or username
            const search = args[0].replace(/[^0-9]/g, '');
            if (search) {
                const user = await client.users.fetch(search).catch(() => null);
                if (user) targetUser = user;
            }
        }

        const result = await renderProfile(targetUser);

        if (result.error) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0xFF4444)
                        .setTitle('🚫 Perfil Não Encontrado')
                        .setDescription(result.error)
                ]
            });
        }

        return msg.reply({ embeds: [result.embed] }).catch(() => {});
    },

    async executeSlash(interaction, { client }) {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        const result = await renderProfile(targetUser);

        if (result.error) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0xFF4444)
                        .setTitle('🚫 Perfil Não Encontrado')
                        .setDescription(result.error)
                ],
                ephemeral: true
            });
        }

        return interaction.editReply({ embeds: [result.embed] }).catch(() => {});
    }
};

async function renderProfile(user) {
    const userId = user.id;

    // Fetch RPG character
    const char = db.getRpgCharacter(userId);
    if (!char) {
        if (userId === user.id) {
            return { error: 'Você não possui um personagem RPG criado no Bastião. Crie o seu usando **`/rpg-registrar`**!' };
        } else {
            return { error: `Este usuário não possui um personagem RPG registrado no Bastião.` };
        }
    }

    const level = char.level || 1;
    const growth = CLASS_GROWTH[char.class_code];
    const genderText = GENDER_DETAILS[char.gender]?.name || 'Desconhecido';
    const genderEmoji = GENDER_DETAILS[char.gender]?.emoji || '';

    // Calculate base attributes
    const baseHp = growth.hpBase + (level - 1) * growth.hplvl;
    const baseAtk = growth.atkBase + (level - 1) * growth.atklvl;
    const baseDef = growth.defBase + (level - 1) * growth.deflvl;

    // Calculate equipment bonuses
    let equipAtk = 0;
    let equipDef = 0;

    const weapon = char.equipped_weapon ? rpgItems[char.equipped_weapon] : null;
    const shield = char.equipped_shield ? rpgItems[char.equipped_shield] : null;
    const armor = char.equipped_armor ? rpgItems[char.equipped_armor] : null;
    const amulet = char.equipped_amulet ? rpgItems[char.equipped_amulet] : null;

    if (weapon) { equipAtk += weapon.atk || 0; equipDef += weapon.def || 0; }
    if (shield) { equipAtk += shield.atk || 0; equipDef += shield.def || 0; }
    if (armor) { equipAtk += armor.atk || 0; equipDef += armor.def || 0; }
    if (amulet) { equipAtk += amulet.atk || 0; equipDef += amulet.def || 0; }

    const totalHp = baseHp;
    const totalAtk = baseAtk + equipAtk;
    const totalDef = baseDef + equipDef;

    // Formatar números para exibição limpa
    const atkStr = totalAtk % 1 === 0 ? totalAtk.toFixed(0) : totalAtk.toFixed(1);
    const defStr = totalDef % 1 === 0 ? totalDef.toFixed(0) : totalDef.toFixed(1);

    // XP Progress bar
    const xpNeeded = level * 100;
    const xpPercent = Math.min(100, Math.floor((char.xp / xpNeeded) * 100));
    const filled = Math.round(xpPercent / 10);
    const empty = 10 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const xpBarStr = `\`[${bar}]\` (${xpPercent}%)\n**${char.xp}** / **${xpNeeded}** RPG XP`;

    // Equipments text
    const weaponText = weapon ? `🗡️ **Arma:** ${weapon.name} (+${weapon.atk} Atk / +${weapon.def} Def)` : '❌ **Arma:** Vazio';
    const shieldText = shield ? `🛡️ **Escudo:** ${shield.name} (+${shield.atk} Atk / +${shield.def} Def)` : '❌ **Escudo:** Vazio';
    const armorText = armor ? `👕 **Armadura:** ${armor.name} (+${armor.atk} Atk / +${armor.def} Def)` : '❌ **Armadura:** Vazio';
    const amuletText = amulet ? `📿 **Amuleto:** ${amulet.name} (+${amulet.atk} Atk / +${amulet.def} Def)` : '❌ **Amuleto:** Vazio';

    const embed = new EmbedBuilder()
        .setColor(0x8E44AD) // Dark Purple
        .setTitle(`🛡️ PERFIL DE AVATAR: ${char.nickname} 🛡️`)
        .setDescription(
            `Aventureiro(a) registrado(a) no **Bastião de Aethelgard**.\n\n` +
            `👤 **Classe:** ${growth.emoji} **${growth.name}**\n` +
            `⚧️ **Gênero:** ${genderEmoji} **${genderText}**\n` +
            `⭐ **Nível RPG:** \`${level}\`\n\n` +
            `**Progresso de Nível:**\n${xpBarStr}\n\n` +
            `📊 **Atributos Finais:**\n` +
            `• ❤️ **Vida Máxima (HP):** \`${totalHp}\`\n` +
            `• ⚔️ **Ataque Total:** \`${atkStr}\` _(base: ${baseAtk.toFixed(1)} + equip: ${equipAtk})_\n` +
            `• 🛡️ **Defesa Total:** \`${defStr}\` _(base: ${baseDef.toFixed(1)} + equip: ${equipDef})_\n\n` +
            `🏟️ **Histórico na Arena:**\n` +
            `• 🟢 **Vitórias:** \`${char.wins}\` | 🔴 **Derrotas:** \`${char.losses}\` | 🔥 **Racha:** \`${char.streak} vitórias\`\n\n` +
            `🛡️ **Equipamento Ativo:**\n` +
            `• ${weaponText}\n` +
            `• ${shieldText}\n` +
            `• ${armorText}\n` +
            `• ${amuletText}`
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'Ascended RPG • Bastião de Aethelgard' })
        .setTimestamp();

    return { embed };
}
