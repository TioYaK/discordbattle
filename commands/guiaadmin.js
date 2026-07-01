'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'guiaadmin',
    aliases: ['manualadmin', 'ajudaadmin', 'adminmanual'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('guiaadmin')
        .setDescription('Gera o guia e manual detalhado do bot para administradores'),

    async execute(msg, args, { config }) {
        const embeds = this.buildManualEmbeds(config);
        return msg.reply({ embeds });
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply({ ephemeral: true });
        const embeds = this.buildManualEmbeds(config);
        await interaction.channel.send({ embeds });
        return interaction.editReply({ content: '✅ Guia do Administrador enviado com sucesso neste canal!' });
    },

    buildManualEmbeds(config) {
        const warVoiceLabel = config.warVoiceChannelId
            ? `\`${config.warVoiceChannelId}\` (<#${config.warVoiceChannelId}>)`
            : 'canal de voz de guerra configurado em `!config canal-guerra-voz`';

        // Embed 1: Funcionamento Geral do Bot
        const embed1 = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🛡️ Ascended Bot — Manual de Funcionamento Geral')
            .setDescription(
                `Este manual detalha o funcionamento interno de todos os módulos do **Ascended Bot**. ` +
                `Ele foi projetado para automatizar o monitoramento da guilda, radar de inimigos, reservas de respawn e auditoria de presença.\n\n` +
                `### 🔄 Loops de Scraping (Tempo Real)\n` +
                `O bot executa rotinas automáticas de raspagem de dados diretamente do site do RubinOT:\n` +
                `• 🟢 **Guilda Aliada:** Scrape a cada **10 segundos** para atualizar níveis, status de membros online, last seen e tempo online total.\n` +
                `• 🔴 **Guilda Inimiga:** Scrape a cada **30 segundos** para monitorar inimigos online e atualizar contadores de radar.\n` +
                `• 🏆 **Highscores:** Loop contínuo (com intervalo de 3s) monitorando as 20 primeiras páginas do highscore do mundo para detectar variações de XP (aliados e inimigos).\n` +
                `• ☠️ **Mortes:** Scrape a cada **15 segundos** monitorando os logs de mortes globais para identificar frags aliados e mortes aliadas.\n` +
                `• 👁️ **Hunted List:** Scrape a cada **30 segundos** nos jogadores adicionados ao radar individual.\n\n` +
                `### 📲 Integração WhatsApp\n` +
                `Permite que membros registrados usem comandos (\`!claim\`, \`!liberar\`, \`!caçando\`) diretamente pelo celular. ` +
                `As mensagens automáticas em massa (Masslog/Aviso de Peles) são enviadas usando greetings customizados e um delay randômico entre **3 e 7 segundos** por contato para evitar bloqueios de spam.`
            )
            .setFooter({ text: 'Ascended Bot • Manual de Operações (1/4)' });

        // Embed 2: Claims de Respawns & Fila (Next)
        const embed2 = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🏰 Módulo 1: Reservas de Respawns (Claims & Next)')
            .setDescription(
                `O bot possui um gerenciador interativo de reservas de hunts (claims) atualizado em tempo real.\n\n` +
                `### 🟢 Regras de Reserva\n` +
                `• **Duração do Claim:** O tempo máximo é definido por cargos configurados no Discord (ex: cargos permitindo 1h30 ou 3h).\n` +
                `• **Requisito de Voz:** O usuário **precisa estar conectado a um canal de voz** no Discord para conseguir reservar ou entrar na fila de um respawn.\n` +
                `• **Penalidade de Voz (5min):** Se um jogador com reserva ativa sair dos canais de voz do Discord, ele recebe um aviso (no Discord e WhatsApp). Se ele não retornar a um canal de voz em **5 minutos**, a reserva é cancelada automaticamente.\n\n` +
                `### ⏳ Funcionamento da Fila (Next)\n` +
                `• Se um respawn estiver ocupado, outros jogadores podem entrar na fila usando \`!next <código>\`.\n` +
                `• Quando o atual dono libera ou expira, o próximo da fila é promovido para o status **Pendente**.\n` +
                `• O jogador promovido recebe avisos no WhatsApp/Discord e tem **10 minutos** para aceitar a reserva usando \`!claim <código>\`. Se não aceitar no prazo, perde a vez e o próximo da fila é promovido.`
            )
            .setFooter({ text: 'Ascended Bot • Manual de Operações (2/4)' });

        // Embed 3: Monitoramento de Pelegos, Evasão e Anti-Spy
        const embed3 = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('⚔️ Módulo 2: Pelegos, Evasão (Massivos) e Anti-Spy')
            .setDescription(
                `Ferramentas focadas em guerra ativa e auditoria de presença em chamadas de combate.\n\n` +
                `### 🚨 Detecção de Combat Massivo (Massivo)\n` +
                `O status de **Massivo** é ativado automaticamente pelo bot quando **$\\ge 50\\%$** de todos os membros registrados que estão online no jogo entram no canal de voz de guerra (mínimo de 4 aliados online).\n\n` +
                `### 🏃 Auditoria de Evasão de Combate\n` +
                `Durante o período em que o status de Massivo está ativo, o bot audita duas atitudes:\n` +
                `1. **Ignorou Pelego:** Aliados que estão online no jogo mas continuam fora da call de guerra (${warVoiceLabel}) acumulam tempo de evasão.\n` +
                `2. **Deslogou em Pelego:** Aliados que deslogam do jogo (saem do status Online para Offline) enquanto o Massivo está ativo e eles não estão na call de guerra incrementam o contador de logoffs em pelego.\n` +
                `• *O comando \`!presenca\` permite auditar esses dados de forma detalhada.*\n\n` +
                `### 🕵️ Detector de Espiões (Anti-Spy)\n` +
                `Executa varreduras de segurança no momento do registro do jogador:\n` +
                `• Compara o ID do Discord com registros anteriores.\n` +
                `• Analisa se o jogador possui histórico de mortes causadas por aliados (frags) na guerra.\n` +
                `• Limpa tags de ranqueamento (ex: \`One da Ascended Auroria\` -> \`Ascended Auroria\`) e alerta se o jogador pertencer à guilda inimiga.`
            )
            .setFooter({ text: 'Ascended Bot • Manual de Operações (3/4)' });

        // Embed 4: Comandos Úteis do Bot
        const embed4 = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('⚙️ Guia Completo de Comandos')
            .setDescription(
                `### 👮 Comandos de Administração (Apenas Admins)\n` +
                `• \`!registro Nick, @membro, EK/ED/RP/MS/EM, Bomba, WhatsApp\` — Efetua o cadastro completo e vincula cargos/apelidos.\n` +
                `• \`!registro permissoes\` — Cria o cargo **Caller**, tranca canais ocultando de guests e configura Speak do canal de guerra.\n` +
                `• \`!registro painel\` — Envia o painel com o botão de auto-registro no canal de registro.\n` +
                `• \`!presenca [dias]\` — Relatório de presença (tempo em call, tempo fora de call, ignorou pelego, deslogou em pelego).\n` +
                `• \`!inativos [dias]\` — Lista membros que não entram no jogo há X dias.\n` +
                `• \`!config\` — Exibe todas as configurações e canais definidos.\n` +
                `• \`!config guilda/guilda-inimiga/mundo <nome>\` — Altera configurações do clã no RubinOT.\n` +
                `• \`!config cargo-claim-90/cargo-claim-180 @Cargo\` — Permissões de tempo de reservas.\n` +
                `• \`!config canal-<tipo> #canal\` — Configura canais de logs (mortes, radar, relatórios, painel, etc).\n` +
                `• \`!config hunted <nome>\` — Adiciona inimigo ao radar individual.\n` +
                `• \`!pause\` / \`!resume\` — Pausa/retoma o sistema de reservas (limpa claims e filas).\n` +
                `• \`!massmove\` — Move todos conectados em voz para o seu canal de voz atual.\n` +
                `• \`!masskick\` — Desconecta todos os membros de todos os canais de voz do servidor.\n\n` +
                `### 👥 Comandos do Jogador (Públicos)\n` +
                `• \`!claim <código>\` / \`!next <código>\` — Reservar ou entrar na fila de um respawn.\n` +
                `• \`!liberar\` — Libera seu respawn ativo.\n` +
                `• \`!respawns\` / \`!listahunts\` — Mostra hunts ocupadas e códigos das hunts.\n` +
                `• \`!jogador <nome>\` / \`!oraculo <nome>\` — Dados do personagem e tempo estimado para upar.\n` +
                `• \`!online\` — Mostra membros da guilda online no Tibia.\n` +
                `• \`!top\` / \`!semana\` — Ranking de XP diário e semanal.\n` +
                `• \`!mortes\` / \`!matadores\` / \`!guerra\` — Placar e logs PvP do dia.\n` +
                `• \`!radar\` — Exibe o radar de inimigos online no RubinOT.\n` +
                `• \`!boss <nome>\` — Registra kill de boss (cooldown de 20 horas com alerta DM).`
            )
            .setFooter({ text: 'Ascended Bot • Manual de Operações (4/4)' })
            .setTimestamp();

        return [embed1, embed2, embed3, embed4];
    }
};
