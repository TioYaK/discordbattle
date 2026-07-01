'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

// Cargos de classe que podem ser removidos junto com "Registrado"
const CLASS_ROLE_NAMES = ['Elite Knight', 'Master Sorcerer', 'Royal Paladin', 'Elder Druid', 'Exalted Monk'];

function isAdmin(member, config) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.permissions.has('ManageGuild'))   return true;
    if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
    return false;
}

/**
 * Lógica central de desregistro — reutilizada no prefix e no slash.
 * @param {Guild}  guild      - Guild do Discord
 * @param {string} adminId    - ID de quem executou o comando
 * @param {string} targetId   - Discord ID do membro a ser desregistrado
 * @param {string} motivo     - Motivo do desregistro (opcional)
 * @param {object} config     - Configuração do bot
 * @param {Client} client     - Discord client
 * @returns {object}          - Objeto com info do resultado
 */
async function handleDesregistrar(guild, adminId, targetId, motivo, config, client) {
    // 1. Verifica se existe registro no banco
    const reg = db.getRegisteredMember(targetId);
    if (!reg) {
        throw new Error(`O membro <@${targetId}> **não está registrado** no banco de dados.`);
    }

    const charName  = reg.char_name;
    const classCode = reg.class_code;
    const phone     = reg.phone ? `+${reg.phone}` : '—';

    // 2. Remove da tabela principal
    db.deleteRegisteredMember(targetId);

    // 3. Limpa dados secundários vinculados ao discord_id
    db.db.prepare('DELETE FROM massivo_evasions WHERE discord_id = ?').run(targetId);
    db.db.prepare('DELETE FROM voice_sessions    WHERE discord_id = ?').run(targetId);
    db.db.prepare('DELETE FROM achievements      WHERE discord_id = ?').run(targetId);
    db.db.prepare('DELETE FROM boss_cooldowns    WHERE player_id  = ?').run(targetId);
    db.deleteClaimByPlayer(targetId);
    db.clearPlayerQueues(targetId);

    // 4. Registra no histórico
    db.insertRegistrationHistory({
        discordId: targetId,
        charName,
        bomba: reg.bomba,
        action: 'REMOVED',
        reason: motivo || 'Removido por administrador'
    });

    const warnings = [];

    // 5. Remove cargos "Registrado" e de classe do membro no Discord
    try {
        const member = await guild.members.fetch(targetId).catch(() => null);
        if (member) {
            // Coleta os cargos a remover
            const rolesToRemove = member.roles.cache.filter(r =>
                r.name.toLowerCase() === 'registrado' ||
                CLASS_ROLE_NAMES.some(cn => cn.toLowerCase() === r.name.toLowerCase())
            );

            if (rolesToRemove.size > 0) {
                await member.roles.remove(rolesToRemove).catch(err => {
                    warnings.push(`⚠️ Não foi possível remover os cargos: ${err.message}`);
                });
            }

            // 6. Reseta o apelido para o nome de usuário original
            await member.setNickname(null).catch(() => {
                warnings.push('⚠️ Não foi possível resetar o apelido do membro (permissão insuficiente ou cargo superior).');
            });
        } else {
            warnings.push('⚠️ Membro não encontrado no servidor — cargos e apelido não foram alterados.');
        }
    } catch (err) {
        warnings.push(`⚠️ Erro ao atualizar membro no Discord: ${err.message}`);
    }

    // 7. Loga no canal de registros se configurado
    if (config.registrationChannelId) {
        try {
            const regChannel = guild.channels.cache.get(config.registrationChannelId)
                || await guild.channels.fetch(config.registrationChannelId).catch(() => null);

            if (regChannel) {
                const isSpyAlert = motivo && motivo.startsWith('🚨 [ANTI-SPY]');
                const title = isSpyAlert ? '🚨 ALERTA ANTI-SPY: MEMBRO EXPULSO' : '🗑️ Membro Desregistrado';
                const color = isSpyAlert ? 0xFF0000 : 0xFF4444;
                const desc = isSpyAlert ? `O sistema anti-espionagem removeu o registro automaticamente.` : `Desregistro executado por <@${adminId}>.`;

                const logEmbed = new EmbedBuilder()
                    .setColor(color)
                    .setTitle(title)
                    .setDescription(desc)
                    .addFields(
                        { name: '👤 Discord',    value: `<@${targetId}>`,  inline: true },
                        { name: '🎮 Personagem', value: `\`${charName}\``, inline: true },
                        { name: '⚡ Classe',     value: `\`${classCode}\``, inline: true },
                        { name: '📞 WhatsApp',   value: `\`${phone}\``,    inline: true },
                        { name: '📝 Motivo/Info', value: motivo || '—',     inline: false }
                    )
                    .setFooter({ text: 'Ascended Bot • RubinOT' })
                    .setTimestamp();

                const sendOptions = { embeds: [logEmbed] };
                if (isSpyAlert) {
                    sendOptions.content = '@everyone 🚨 **ESPIÃO DETECTADO**';
                }
                await regChannel.send(sendOptions);
            }
        } catch (e) {
            console.warn('[Desregistrar] Erro ao logar no canal de registros:', e.message);
        }
    }

    return { charName, classCode, phone, warnings };
}

module.exports = {
    name: 'desregistrar',
    aliases: ['unregister', 'removerregistro', 'delregistro'],
    adminOnly: true,
    handleDesregistrar,

    data: new SlashCommandBuilder()
        .setName('desregistrar')
        .setDescription('(Admin) Remove completamente o registro de um membro, limpando todos os seus dados do banco')
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('Membro a ser desregistrado')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('motivo')
                .setDescription('Motivo do desregistro (opcional, será salvo no histórico)')
                .setRequired(false)
        ),

    // ── Comando de prefixo (!desregistrar @membro [motivo]) ─────────────────
    async execute(msg, args, { config }) {
        if (!isAdmin(msg.member, config)) {
            return msg.reply('🚫 **Apenas administradores** podem usar este comando.');
        }

        if (!args.length) {
            return msg.reply('❌ **Uso correto:** `!desregistrar @membro [motivo]`');
        }

        // Extrai o ID do membro da menção ou do ID direto
        const mentionOrId = args[0];
        const idMatch = mentionOrId.match(/^<@!?(\d+)>$/) || mentionOrId.match(/^(\d+)$/);
        if (!idMatch) {
            return msg.reply('❌ Membro inválido. Mencione o membro ou passe seu ID (ex: `@Membro` ou `123456789`).');
        }

        const targetId = idMatch[1];
        const motivo   = args.slice(1).join(' ').trim() || null;

        try {
            const res = await handleDesregistrar(msg.guild, msg.author.id, targetId, motivo, config, msg.client);

            const descLines = [
                `👤 Discord: <@${targetId}>`,
                `🎮 Personagem: \`${res.charName}\``,
                `⚡ Classe: \`${res.classCode}\``,
                `📞 WhatsApp: \`${res.phone}\``,
                '',
                '✅ Registro removido, cargos retirados e dados do banco limpos.',
                ...res.warnings
            ].filter(Boolean);

            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('🗑️ Membro Desregistrado com Sucesso')
                .setDescription(descLines.join('\n'))
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            return msg.reply({ embeds: [embed] });
        } catch (err) {
            console.error('[Desregistrar] Erro:', err.message);
            return msg.reply(`❌ ${err.message}`);
        }
    },

    // ── Slash command (/desregistrar membro:@X motivo:...) ──────────────────
    async executeSlash(interaction, { config }) {
        if (!isAdmin(interaction.member, config)) {
            return interaction.reply({ content: '🚫 **Apenas administradores** podem usar este comando.', ephemeral: true });
        }

        const targetMember = interaction.options.getMember('membro');
        const motivo       = interaction.options.getString('motivo') || null;

        if (!targetMember) {
            return interaction.reply({ content: '❌ Membro não encontrado no servidor.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const res = await handleDesregistrar(
                interaction.guild,
                interaction.user.id,
                targetMember.id,
                motivo,
                config,
                interaction.client
            );

            const descLines = [
                `👤 Discord: <@${targetMember.id}>`,
                `🎮 Personagem: \`${res.charName}\``,
                `⚡ Classe: \`${res.classCode}\``,
                `📞 WhatsApp: \`${res.phone}\``,
                '',
                '✅ Registro removido, cargos retirados e dados do banco limpos.',
                ...res.warnings
            ].filter(Boolean);

            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('🗑️ Membro Desregistrado com Sucesso')
                .setDescription(descLines.join('\n'))
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[Desregistrar] Erro no slash:', err.message);
            return interaction.editReply({ content: `❌ ${err.message}` });
        }
    }
};
