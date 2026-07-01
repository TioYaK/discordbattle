'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../modules/database');

module.exports = {
    name: 'resetar-tudo',
    description: 'Reseta o servidor: remove as configurações do bot e exclui TODAS as categorias e canais de texto/voz.',
    adminOnly: true,
    aliases: ['limpar-discord', 'reset-all', 'clean-discord'],

    data: new SlashCommandBuilder()
        .setName('resetar-tudo')
        .setDescription('Reseta o servidor: deleta todos os canais e limpa configurações do bot.')
        .addBooleanOption(option =>
            option.setName('confirmar')
                .setDescription('Confirme definindo como True para deletar tudo permanentemente')
                .setRequired(true)
        ),

    async execute(msg, args, { config }) {
        const confirm = args[0] ? args[0].toLowerCase() === 'confirmar' : false;
        if (!confirm) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF8C00)
                        .setTitle('⚠️ Confirmação Requerida')
                        .setDescription(
                            'Esta ação irá **DELETAR PERMANENTEMENTE** todas as configurações do bot no banco de dados e **TODOS OS CANAIS E CATEGORIAS** deste servidor do Discord.\n\n' +
                            'Para confirmar, digite:\n' +
                            '👉 **`!resetar-tudo confirmar`**'
                        )
                        .setFooter({ text: 'Ascended Bot • Cuidado' })
                        .setTimestamp()
                ]
            });
        }

        await runReset(msg.guild, msg.channel, msg.author);
    },

    async executeSlash(interaction, { config }) {
        const confirm = interaction.options.getBoolean('confirmar');
        if (!confirm) {
            return interaction.reply({
                content: '❌ Operação cancelada. Você deve selecionar "True" na opção de confirmação.',
                ephemeral: true
            });
        }

        await interaction.reply({ content: '⏳ Iniciando limpeza completa do servidor...', ephemeral: true });
        await runReset(interaction.guild, interaction.channel, interaction.user);
    }
};

async function runReset(guild, commandChannel, executor) {
    console.log(`[Reset] Executor: ${executor.tag} em ${guild.name} (${guild.id})`);
    
    // 1. Limpar banco de dados
    try {
        db.clearGuildAllData(guild.id);
        console.log(`[Reset] Banco de dados limpo para a guilda: ${guild.id}`);
    } catch (err) {
        console.error(`[Reset] Erro ao limpar banco de dados:`, err.message);
    }

    // 2. Criar um canal padrão temporário
    let defaultChannel;
    try {
        defaultChannel = await guild.channels.create({
            name: 'bem-vindo',
            type: ChannelType.GuildText,
            topic: 'Canal de entrada criado após reset completo.',
            reason: 'Criado temporariamente durante a limpeza de canais.'
        });
    } catch (err) {
        console.error('[Reset] Falha ao criar canal default temporário:', err.message);
    }

    // Enviar mensagem informando no canal temporário
    if (defaultChannel) {
        const resetEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚙️ Servidor Resetado')
            .setDescription(
                `O servidor **${guild.name}** foi resetado com sucesso por <@${executor.id}>.\n\n` +
                `• Todas as configurações do bot foram limpas.\n` +
                `• Todas as categorias e canais antigos foram excluídos.\n\n` +
                `Use o comando **\`/configurar-tudo\`** para reconfigurar o servidor a qualquer momento.`
            )
            .setFooter({ text: 'Ascended Bot • Limpeza Concluída' })
            .setTimestamp();
        
        await defaultChannel.send({ embeds: [resetEmbed] }).catch(() => {});
    }

    // 3. Excluir todos os canais e categorias do servidor (exceto o recém-criado)
    const channels = Array.from(guild.channels.cache.values());
    
    for (const channel of channels) {
        // Ignora o canal temporário que acabamos de criar
        if (defaultChannel && channel.id === defaultChannel.id) continue;
        
        try {
            await channel.delete('Reset completo do servidor iniciado pelo bot.');
            console.log(`[Reset] Canal deletado: ${channel.name} (${channel.id})`);
        } catch (err) {
            console.warn(`[Reset] Não foi possível deletar canal ${channel.name}:`, err.message);
        }
    }
}
