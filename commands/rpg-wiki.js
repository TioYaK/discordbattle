'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'rpg-wiki',
    aliases: ['setup-rpg', 'wikirpg'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('rpg-wiki')
        .setDescription('Comando administrativo para gerar os canais de Wiki e Tutorial do RPG.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(msg) {
        return handleWikiSetup(msg.channel, msg.guild);
    },

    async executeSlash(interaction) {
        await interaction.deferReply({ ephemeral: true });
        return handleWikiSetup(interaction, interaction.guild, true);
    }
};

async function handleWikiSetup(context, guild, isSlash = false) {
    try {
        const infoCat = guild.channels.cache.find(c => c.name === '📁 INFO & REGISTRO' && c.type === ChannelType.GuildCategory);

        let tutorialChannel = guild.channels.cache.find(c => c.name === '🎓-tutorial-rpg');
        if (!tutorialChannel) {
            tutorialChannel = await guild.channels.create({
                name: '🎓-tutorial-rpg',
                type: ChannelType.GuildText,
                parent: infoCat ? infoCat.id : null,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] }
                ]
            });
        } else if (infoCat && tutorialChannel.parentId !== infoCat.id) {
            await tutorialChannel.setParent(infoCat.id).catch(() => {});
        }

        let wikiChannel = guild.channels.cache.find(c => c.name === '📚-wiki-rpg');
        if (!wikiChannel) {
            wikiChannel = await guild.channels.create({
                name: '📚-wiki-rpg',
                type: ChannelType.GuildText,
                parent: infoCat ? infoCat.id : null,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] }
                ]
            });
        } else if (infoCat && wikiChannel.parentId !== infoCat.id) {
            await wikiChannel.setParent(infoCat.id).catch(() => {});
        }

        // --- ENVIAR TUTORIAL ---
        await tutorialChannel.bulkDelete(100).catch(() => {});
        
        const tutEmbed1 = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🔰 Como Começar no Aethelgard RPG')
            .setDescription('Bem-vindo aventureiro! Para entrar no minigame oficial da guilda, o primeiro passo é criar o seu personagem.\n\n**1.** Digite `!rpg-registrar` em qualquer chat de bot.\n**2.** Automaticamente seu Level 1 será criado.\n**3.** A sua jornada começa! Use `!rpg-perfil` a qualquer momento para ver o seu HP, Força, Level e XP acumulada.');

        const tutEmbed2 = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('⚔️ Caçando e Ficando Mais Forte')
            .setDescription('Para subir de nível, você precisa matar monstros e acumular XP.\n\nUse o comando `!cacar`. Você verá uma lista com várias criaturas (Lobos, Goblins, etc).\nSelecione um monstro no nível adequado para você e o combate será travado.\nSe você vencer, ganha RPG XP. Se falhar, seu HP será drenado!');

        
        const tutEmbed3 = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🔮 As Vocações e Classes')
            .setDescription('Ao atingir o Nível 10, você escolhe seu destino (`!classe`). Cada classe possui **Habilidades Exclusivas** ativas nas batalhas e Masmorras!\n\n🛡️ **Cavaleiro:** +20% HP Máximo e +30% Defesa. Skills nas Dungeons: *Golpe Demolidor* e *Muralha de Escudos*.\n🧙‍♂️ **Mago:** +30% Dano de Magia e -20% HP. Skills nas Dungeons: *Bola de Fogo* e *Congelar*.\n🏹 **Arqueiro:** +15% Dano, +10% de achar ovos. Skills nas Dungeons: *Flecha Venenosa* e *Tiro na Cabeça*.');

        const tutEmbed4 = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('🍻 A Taverna de Caçadores')
            .setDescription('Todos os dias, a guilda publica **3 contratos de recompensa** distintos. Use `!taverna` para visualizar e aceitar suas Missões Diárias!\n\n⚤️ **Missão de Caça:** Derrote entre 10 e 20 monstros usando `!cacar`.\n🗡️ **Missão de Duelo:** Vitórias na Arena PvP com `!duelar`.\n💰 **Missão de Taxa:** Pague a taxa do ciclo com `!taxa enviar`.\n\nComplete todas as 3 para **recompensas máximas**! O timer reseta diariamente.');

        await tutorialChannel.send({ embeds: [tutEmbed1, tutEmbed2, tutEmbed3, tutEmbed4] });

        // --- ENVIAR WIKI ---
        await wikiChannel.bulkDelete(100).catch(() => {});

        const wEmbed1 = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('💀 Sobrevivência: Vida e Morte')
            .setDescription('**O HP (Pontos de Vida)** do seu personagem é persistente. Toda vez que você caça monstros, explora masmorras ou defende a cidade nas Invasões, você perde HP.\n\n**Como se Curar?**\nUse `!templo` e pague uma taxa em AC para ser curado imediatamente, ou espere. O Bot cura 5% do seu HP automaticamente a cada hora.\n\n**O que acontece se o HP zerar?**\nVocê **MORRE**. Uma morte significa que você não poderá lutar por 1 HORA inteira, além de perder uma grande penalidade de XP!');

        const wEmbed2 = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('⚒️ A Forja e os Materiais')
            .setDescription('Itens comprados na `!loja` são úteis, mas as verdadeiras relíquias são criadas na **Forja**.\n\n**1. Coleta:** Use `!coletar`. Isso gastará 10 da sua Stamina (que regenera passivamente) para que você extraia Minério de Ferro, Madeira ou Pó Mágico da natureza.\n**2. Monstros:** Monstros no `!cacar` também dropam materiais (Pele de Lobo, Garra de Dragão).\n**3. Inventário:** Use `!materiais` para checar seu estoque.\n**4. Criação:** Use `!forjar`, selecione um item lendário (ex: Shadow Blade) e, se você tiver os materiais brutos, a arma será construída e enviada para o seu `!inventario`!');

        const wEmbed3 = new EmbedBuilder()
            .setColor(0x8E44AD)
            .setTitle('🏰 As Masmorras Sombrias (Roguelike)')
            .setDescription('Masmorras são expedições interativas de alto risco e alta recompensa!\n\n**1. Chaves:** Use Chaves de Cobre, Prata ou Ouro. Chaves mais raras geram masmorras maiores, com monstros piores, mas com chances de **Drops Reais de Equipamentos** nos Chefões!\n**2. Combate Tático:** Você usará as **Habilidades da sua Classe**, devendo gerenciar os Cooldowns (Tempos de recarga).\n**3. Relíquias (Rogue-like):** Santuários e Baús podem te dar Relíquias provisórias (*Presa de Vampiro*, *Pólvora Instável*, etc) que valem apenas para aquela expedição e dão bônus insanos.\n**4. Chefes Inteligentes:** Preste atenção no texto! Se o Chefe "puxar o fôlego", ele vai soltar um ataque devastador. Use o botão **Defender** ou morra instantaneamente!');

        const wEmbed4 = new EmbedBuilder()
            .setColor(0x27AE60)
            .setTitle('🐾 Companheiros (Pets) e Evolução')
            .setDescription('Monstros fortes no jogo têm chance de dropar **Ovos Misteriosos**.\n\nUse o comando `!pets`. Através dele você pode gastar AC para chocar o seu ovo em uma incubadora. O ovo pode revelar Pets de raridades **Comum até Lendário**.\n\n🗺️ **Sistema de Nível de Pet:**\nTodo Companheiro equipado ganha XP junto com você nas caçadas! A cada Nível (máx. 20), os buffs passivos ficam mais fortes. Pets com um caminho de evolução se transformam em criaturas mais raras ao atingir o Nível 10 — use o botão **Evoluir** no `!pets`!\n\n👾 **Raridades:** Comum → Incomum → Raro → Épico → Lendário. Pets mais raros possuem habilidades ativas mais devastadoras.\n🔮 **Dica:** A profissão **Domador** reduz 50% o custo de chocar ovos!');

        
        const wEmbed5 = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('⚔️ O Coliseu PvP')
            .setDescription('Acha que o seu personagem é o mais forte de Aethelgard? Prove no Coliseu!\n\nUse `!duelar @jogador <quantia>` para desafiar alguém. Vocês apostam uma quantia de AC.\n**Combate Interativo:** O duelo não é mais decidido na sorte! Vocês batalharão em um sistema **Turno-a-Turno** usando as mesmas **Habilidades de Classe** das Masmorras (como *Bola de Fogo* e *Muralha*). Administre seus Cooldowns, escolha quando Atacar ou Defender, e destrua seu inimigo.\nO vencedor leva todo o ouro apostado e o perdedor sofre a penalidade de morte e perde o HP!');

        const wEmbed6 = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('🔥 O Refinamento Mágico')
            .setDescription('Itens da Loja ou da Forja podem ser melhorados permanentemente!\n\nNo comando `!refinar`, você usa **Pó Mágico** e moedas AC para bater um item na bigorna mágica. Ele poderá subir para +1, +2 ou +3.\n**Aviso:** Tentar refinar para +3 tem uma alta chance de falha, e o seu equipamento amado pode simplesmente **quebrar e virar cinzas** para sempre!');

        const wEmbed7 = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🛠️ Profissões Secundárias')
            .setDescription('No Nível 15, você pode escolher uma **Profissão Permanente** usando `!profissao`:\n\n🧪 **Alquimista:** O único capaz de forjar Poções (HP e Buffs) no `!forjar`. Consuma as poções usando `!beber`.\n🔨 **Ferreiro:** Coleta recursos em dobro (`!coletar`) e tem chance bônus de 15% ao usar `!refinar`!\n🐾 **Domador:** 30% a mais de chance de achar ovos raros no `!cacar`, além de pagar a metade do preço no `!pets`.');

        const wEmbed8 = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('🏰 Cercos e Catapultas (Invasões Globais)')
            .setDescription('Ocasionalmente, **Exércitos Inimigos** farão um Cerco ao Bastião de Aethelgard. Isso não é um monstro comum!\n\n**1. Portões de Aethelgard:** O exército inimigo atacará os portões do Bastião e drenará sua vida gradualmente. Se o portão quebrar, a invasão falha e vocês são saqueados.\n**2. Máquinas de Guerra (`!construir`):** Qualquer jogador pode gastar recursos do seu inventário (`!inventario`) para construir defesas de cerco durante a invasão!\n🪵 **`!construir barricada`**: Gasta Toras de Madeira e Minério de Ferro para curar o HP dos Portões.\n☄️ **`!construir catapulta`**: Gasta Madeira e Ferro para jogar uma rocha flamejante no exército inimigo, causando **MUITO DANO**!\nDefendam a cidade em conjunto para glória e espólios massivos!');

        await wikiChannel.send({ embeds: [wEmbed1, wEmbed2, wEmbed3, wEmbed4, wEmbed5, wEmbed6, wEmbed7, wEmbed8] });

        const successMsg = '✅ Canais de Tutorial e Wiki gerados e populados com sucesso!';
        if (isSlash) {
            return context.editReply({ content: successMsg });
        } else {
            return context.send({ content: successMsg });
        }
    } catch (err) {
        console.error('[WikiSetup] Erro ao criar canais:', err);
        const errMsg = '❌ Ocorreu um erro ao criar os canais. Verifique minhas permissões no servidor!';
        if (isSlash) return context.editReply({ content: errMsg });
        return context.send({ content: errMsg });
    }
}
