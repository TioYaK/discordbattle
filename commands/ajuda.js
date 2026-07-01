'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'ajuda',
    aliases: ['help', 'comandos'],
    adminOnly: false,
    
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Exibe a lista de todos os comandos do bot organizados por categoria'),

    async execute(msg, args, { config }) {
        const embeds = buildHelpEmbeds(config);
        await msg.reply({ embeds: [embeds[0]] });
        return msg.channel.send({ embeds: [embeds[1]] });
    },

    async executeSlash(interaction, { config }) {
        const embeds = buildHelpEmbeds(config);
        await interaction.reply({ embeds: [embeds[0]] });
        return interaction.followUp({ embeds: [embeds[1]] });
    }
};

function buildHelpEmbeds(config) {
    const embed1 = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📖 Ascended Bot — Comandos')
        .setDescription(`Prefixos aceitos: **!**, **.**, **/**\nGuilda: **${config.guildName || 'Não configurada'}** | Mundo: **${config.worldName || 'Não configurado'}**`)
        .addFields(
            {
                name: '🧑 Personagens',
                value: [
                    '`!jogador <nome>` — Busca dados de um personagem',
                    '`!oraculo <nome>` — Previsão de próximo level',
                    '`!eu` — Mostra suas informações de registro e conquistas',
                ].join('\n'),
                inline: false,
            },
            {
                name: '🏰 Guilda',
                value: [
                    '`!online` — Membros da guilda online agora',
                    '`!top [n]` — Top XP do dia (máx. 10)',
                    '`!semana` — Relatório semanal da guilda (top XP, frags, K/D)',
                    '`!criarpt <local>, <vagas>, <inicio>` — Painel de PT interativo',
                    '`!relatorio` — Relatório diário completo',
                    '`!inativos <dias>` — Lista membros da guilda inativos (Admin)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚔️ PvP & Guerra',
                value: [
                    '`!mortes` — Mortes PvP do dia',
                    '`!matadores` — Ranking de frags do dia',
                    '`!topmatadores` — Ranking histórico de frags',
                    '`!guerra` — Placar de guerra (dia)',
                    '`!guerrafull` — Placar acumulado',
                    '`!radar` — Inimigos online no momento',
                    '`!bounty listar` — Lista todas as recompensas ativas',
                    '`!hunted` — Mostra a lista de procurados do radar (Admin)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '🏰 Reservas (Claims & Next)',
                value: [
                    '`!claim <código/nome>` — Reserva um respawn (1h30 ou 3h)',
                    '`!next <código/nome>` — Entra na fila (Next) de um respawn ocupado',
                    '`!liberar` — Libera a sua reserva atual',
                    '`!respawns` — Mostra todos os respawns ocupados',
                    '`!extend` — Aumenta o tempo da sua reserva',
                    '`!listahunts [categoria]` — Lista todas as hunts e seus códigos',
                    '`!mapa` — Mostra o mapa dos respawns do servidor',
                    '`!planilhado listar` — Lista os respawns planilhados ativos',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⏰ Bosses (Timers)',
                value: [
                    '`!boss <nome>` — Registra kill de boss diário (cooldown 20h, avisa por DM)',
                    '`!bosses` — Mostra seus cooldowns de boss ativos',
                ].join('\n'),
                inline: false,
            },
            {
                name: '🎰 Diversão & Loot',
                value: [
                    '`!roleta <n1> <n2>...` — Sorteia entre nomes',
                    '`!ativaroleta` — Coleta participantes pelo chat',
                    '`!roleta sortear` — Sorteia entre participantes',
                    '`!desativaroleta` — Encerra a roleta',
                    '`!reputacao [@membro]` — Mostra a reputação de um membro',
                    '`!reputacao adicionar [@membro] <pontos>` — Adiciona reputação (Admin)',
                    '`!dividirloot <copie o Analyzer>` — Calcula a divisão de loot da party',
                ].join('\n'),
                inline: false,
            },
            {
                name: '💸 Livro de Dívidas (Ledger)',
                value: [
                    '`!divida dever @credor <valor> [descrição]` — Registra que você deve a outro membro',
                    '`!divida cobrar @devedor <valor> [descrição]` — Registra que outro membro deve a você',
                    '`!divida balanco` — Mostra o seu balanço de dívidas e créditos ativos',
                    '`!divida pagar @credor` — Quita todas as suas dívidas com um credor',
                    '`!divida receber @devedor` — Dá baixa em todas as dívidas que o devedor tem com você',
                    '`!divida liquidar <id>` — Quita uma dívida específica pelo ID (Devedor ou Credor)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '🪙 Economia & Gamificação',
                value: [
                    '`!carteira` — Exibe seu saldo de Ascended Coins (AC) e estatísticas',
                    '`!carteira banner <URL>` — Altera imagem de fundo da carteira (Requer upgrade)',
                    '`!loja` — Exibe a loja virtual da guilda para compras de upgrades',
                    '`!inventario` — Mostra o seu inventário de itens adquiridos',
                    '`!booster usar` — Ativa 1 Spawn Booster para estender claim por +60 min',
                    '`!sorteio criar <prêmio> | <preco> | <duração>` — Cria um sorteio (Staff apenas)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚔️ Bastião de Aethelgard (RPG Minigame)',
                value: [
                    '`/rpg-registrar <apelido> <classe> <genero>` — Cria seu avatar virtual no Bastião (EK, RP, ED, MS | M, F)',
                    '`/rpg-perfil` — Exibe atributos, equipamentos e estatísticas de combate do seu avatar',
                    '`/equipar <item_id>` — Veste uma arma, escudo, armadura ou amuleto do seu inventário',
                    '`/desequipar <slot>` — Desequipa o item do slot e o devolve ao seu inventário',
                    '`/duelar @jogador [aposta]` — Desafia outro jogador registrado para um duelo na Arena apostando AC',
                    '`!atacar` — Ataca o monstro invasor do Bastião de Aethelgard (ou Boss de Guilda ativo)',
                    '`!cacar` — Caça monstros nos arredores de Aethelgard por XP e AC (Cooldown: 10m)',
                    '`!ranking-invasoes` — Ranking global de guerreiros que mais defenderam o Bastião',
                ].join('\n'),
                inline: false,
            }
        )
        .setFooter({ text: 'Ascended Bot • Parte 1' })
        .setTimestamp();

    const embed2 = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('⚙️ Ascended Bot — Comandos Administrativos')
        .addFields(
            {
                name: '💰 Guerra & Taxas',
                value: [
                    '`!taxa enviar <anexe comprovante>` — Envia o comprovante da taxa semanal',
                    '`!taxa pendentes` — Lista membros que não pagaram no ciclo (Admin)',
                    '`!taxa status` — Exibe a saúde financeira do clã na semana (Admin)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '💬 Suporte & WhatsApp',
                value: [
                    '`!ticket criar <assunto>` — Abre um novo ticket de suporte',
                    '`!whatsapp iniciar` — Inicia vinculação do WhatsApp com o bot',
                    '`!whatsapp link <id>` — Vincula o WhatsApp ao bot',
                    '`!whatsapp status` — Mostra o status do WhatsApp (Admin)',
                    '`!zapall <mensagem>` — Envia mensagem WhatsApp para todos (Admin)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚙️ Admin — Configuração Geral',
                value: [
                    '`!config` — Exibe configuração atual',
                    '`!config guilda <nome>` — Define guilda monitorada',
                    '`!config guilda-inimiga <nome>` — Define guilda inimiga',
                    '`!config mundo <nome>` — Define mundo monitorado',
                    '`!config guerra on/off` — Ativa/desativa modo guerra',
                    '`!config cargo-claim-90 @Cargo` — Cargo permitido reservar 1h30',
                    '`!config cargo-claim-180 @Cargo` — Cargo permitido reservar 3h',
                    '`!config hunted <nome>` — Adiciona à lista de radar',
                    '`!config remove-hunted <nome>` — Remove do radar',
                    '`!config hunted-list` — Lista do radar',
                    '`!config taxa-ativa <on/off>` — Ativa/desativa cobrança de taxa',
                    '`!config taxa-valor <valor>` — Define valor da taxa regular (Ex: 500 RC)',
                    '`!config taxa-planilhado <valor>` — Define taxa para planilhados (Ex: 1000 RC)',
                    '`!config taxa-destino <nome>` — Define personagem para depósito (Ex: Bank Ascended)',
                    '`!config taxa-canal #canal` — Define canal de auditoria de taxas',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚙️ Admin — Canais de Alerta',
                value: [
                    '`!config canal-mortes #canal` — Alertas de mortes',
                    '`!config canal-relatorio #canal` — Canal de relatório diário',
                    '`!config canal-inimigos #canal` — Canal de radar de inimigos',
                    '`!config canal-frags #canal` — Canal de frags de aliados',
                    '`!config canal-guerra #canal` — Alertas de modo guerra',
                    '`!config canal-comandos #canal` — Canal de comandos de claim',
                    '`!config canal-painel #canal` — Canal do painel em tempo real',
                    '`!config canal-limpo #canal/off` — Canal com auto-limpeza',
                    '`!config canal-gerador-voz #canal/off` — Canal gerador de salas',
                    '`!config canal-registros #canal/off` — Canal de logs de registros',
                    '`!config canal-monitor-inimigos #canal` — Monitoramento de caça inimiga',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚙️ Admin — Comandos de Controle',
                value: [
                    '`!registro Nick, @membro, EK, Bomba, Tel` — Registra membro',
                    '`!desregistrar <nome/mention>` — Remove o registro de um membro',
                    '`!presenca [dias]` — Relatório de presença e evasão de combate',
                    '`!guiaadmin` — Gera o manual detalhado de administrador',
                    '`!pause` — Pausa o sistema de reservas (limpa claims e filas)',
                    '`!resume` — Retoma o sistema de reservas',
                    '`!massmove` — Move todos de voz para o seu canal atual',
                    '`!masskick` — Desconecta todos de canais de voz do servidor',
                    '`!planilhado criar <respawn> <slot> <@leader> <@members...>` — Cria planilhado',
                    '`!planilhado remover <id>` — Remove planilhado',
                    '`!bounty criar <alvo> <recompensa>` — Cria recompensa',
                    '`!bounty cancelar <id>` — Cancela recompensa',
                    '`!forceinvasion` — Força o spawn de uma invasão de monstros da cidade imediatamente (Admin)',
                    '`!forceboss` — Força o spawn de um Boss de Guilda imediatamente (Admin)',
                ].join('\n'),
                inline: false,
            },
            {
                name: '🔧 Sistema',
                value: '`!ping` — Verifica latência do bot',
                inline: false,
            },
        )
        .setFooter({ text: 'Ascended Bot • Parte 2 | RubinOT' })
        .setTimestamp();

    return [embed1, embed2];
}
