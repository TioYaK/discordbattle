'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../modules/database');
const cityInvasions = require('../modules/cityInvasions'); // For getPlayerTotalAtk
const rpgPets = require('../modules/rpgPets');

module.exports = {
    name: 'duelar',
    aliases: ['duel', 'pvp'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('duelar')
        .setDescription('Desafie outro jogador para um duelo mortal apostando AC!')
        .addUserOption(opt => opt.setName('alvo').setDescription('O jogador que você quer desafiar').setRequired(true))
        .addIntegerOption(opt => opt.setName('aposta').setDescription('Quantas AC você quer apostar').setRequired(true)),

    async execute(msg, args) {
        if (args.length < 2) {
            return msg.channel.send('Uso correto: `!duelar @jogador <quantia_AC>`');
        }
        const targetMember = msg.mentions.members.first();
        if (!targetMember) return msg.channel.send('Você precisa mencionar o jogador alvo!');
        
        const amount = parseInt(args[1], 10);
        return handleDuel(msg.author.id, targetMember.id, amount, msg.channel, msg.author);
    },

    async executeSlash(interaction) {
        const targetUser = interaction.options.getUser('alvo');
        const amount = interaction.options.getInteger('aposta');
        return handleDuel(interaction.user.id, targetUser.id, amount, interaction.channel, interaction.user, interaction);
    }
};

function getPlayerStats(userId) {
    const char = db.getRpgCharacter(userId);
    if (!char) return null;

    const maxHp = db.getPlayerMaxHp(char);
    let atk = cityInvasions.getPlayerTotalAtk(char); // Base + Items
    let def = 0; // We need to calculate def from items too, let's use a simplified approach since items give def.
    
    // In cityInvasions.getPlayerTotalAtk we only sum ATK.
    // Let's manually sum DEF here for PvP
    const inventory = db.db.prepare('SELECT item_id, upgrade_level FROM member_inventory WHERE discord_id = ?').all(userId);
    const RPG_ITEMS = require('../modules/rpgItems');
    inventory.forEach(inv => {
        const itemDef = RPG_ITEMS[inv.item_id];
        if (itemDef && itemDef.def) def += itemDef.def + ((inv.upgrade_level || 0) * 2);
    });

    let dmgMult = 1;
    let defMult = 1;
    let heal = 0;

    if (char.vocation === 'Mago') dmgMult += 0.30;
    if (char.vocation === 'Cavaleiro') defMult += 0.30;
    if (char.vocation === 'Arqueiro') dmgMult += 0.15;

    const activePet = db.getActivePet(userId);
    if (activePet) {
        const petDef = rpgPets.RPG_PETS[activePet.pet_id];
        if (petDef) {
            if (petDef.buff === 'atk' || petDef.buff === 'all') dmgMult += petDef.value;
            if (petDef.buff === 'def' || petDef.buff === 'all') defMult += petDef.value;
            if (petDef.buff === 'heal') heal += petDef.value;
        }
    }

    return {
        char,
        petDef: activePet ? rpgPets.RPG_PETS[activePet.pet_id] : null,
        maxHp,
        currentHp: char.current_hp === -1 ? maxHp : char.current_hp,
        atk: Math.floor(atk * dmgMult),
        def: Math.floor(def * defMult),
        heal
    };
}

async function handleDuel(challengerId, targetId, amount, channel, challengerUser, interaction = null) {
    if (isNaN(amount) || amount <= 0) {
        const err = 'A aposta deve ser um valor maior que zero.';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    if (challengerId === targetId) {
        const err = 'Você não pode duelar contra si mesmo!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    const chalStats = getPlayerStats(challengerId);
    const targStats = getPlayerStats(targetId);

    if (!chalStats) {
        const err = 'Você precisa ter um personagem registrado no RPG!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }
    if (!targStats) {
        const err = 'O seu adversário não possui um personagem no RPG!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    if (chalStats.currentHp <= 0 || chalStats.char.death_time > 0) {
        const err = 'Você está morto e não pode duelar!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }
    if (targStats.currentHp <= 0 || targStats.char.death_time > 0) {
        const err = 'O seu adversário está morto e não pode aceitar duelos agora!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    const regChal = db.getRegisteredMember(challengerId);
    const regTarg = db.getRegisteredMember(targetId);

    if (!regChal || regChal.coins < amount) {
        const err = `Você não tem **${amount} AC** para apostar!`;
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }
    if (!regTarg || regTarg.coins < amount) {
        const err = `O alvo não tem **${amount} AC** para cobrir a aposta!`;
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('⚔️ DESAFIO DE DUELO!')
        .setDescription(`<@${challengerId}> desafiou <@${targetId}> para um combate até a morte!\n\n💰 **Aposta:** ${amount} AC\n\nO alvo tem 60 segundos para aceitar.`);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept_duel').setLabel('Aceitar Duelo').setEmoji('⚔️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('decline_duel').setLabel('Recusar').setStyle(ButtonStyle.Secondary)
    );

    let msg;
    if (interaction) {
        msg = await interaction.reply({ content: `<@${targetId}>`, embeds: [embed], components: [row], fetchReply: true });
    } else {
        msg = await channel.send({ content: `<@${targetId}>`, embeds: [embed], components: [row] });
    }

    const filter = i => i.user.id === targetId;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        if (i.customId === 'decline_duel') {
            await i.update({ content: 'O duelo foi recusado pelo alvo.', embeds: [], components: [] });
            return collector.stop();
        }

        if (i.customId === 'accept_duel') {
            // Double check balances
            const ch = db.getRegisteredMember(challengerId);
            const tg = db.getRegisteredMember(targetId);
            if (!ch || ch.coins < amount || !tg || tg.coins < amount) {
                await i.update({ content: 'Um dos jogadores não tem mais os fundos necessários!', embeds: [], components: [] });
                return collector.stop();
            }

            await i.deferUpdate();
            collector.stop();

            // Run Combat Simulation
            const pvpSession = {
                amount,
                p1: { 
                    id: challengerId, 
                    name: chalStats.char.nickname, 
                    vocation: chalStats.char.vocation,
                    stats: chalStats, 
                    hp: chalStats.currentHp, 
                    maxHp: chalStats.maxHp,
                    cooldowns: { s1: 0, s2: 0, pet: 0 }, 
                    status: [], vuln: false, wall: false, frozen: false 
                },
                p2: { 
                    id: targetId, 
                    name: targStats.char.nickname, 
                    vocation: targStats.char.vocation,
                    stats: targStats, 
                    hp: targStats.currentHp, 
                    maxHp: targStats.maxHp,
                    cooldowns: { s1: 0, s2: 0, pet: 0 }, 
                    status: [], vuln: false, wall: false, frozen: false 
                },
                turn: 1,
                currentPlayer: 1, // 1 = p1, 2 = p2
                combatLog: 'O duelo começou! Que vença o melhor!\n'
            };

            return renderPvPTurn(i, msg, pvpSession);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            msg.edit({ content: '⏳ O desafio expirou ou o jogador demorou muito para responder.', embeds: [], components: [] }).catch(()=>{});
        }
    });
}

async function renderPvPTurn(inter, msg, session) {
    const activePlayer = session.currentPlayer === 1 ? session.p1 : session.p2;
    const targetPlayer = session.currentPlayer === 1 ? session.p2 : session.p1;

    // Apply pre-turn status effects
    if (activePlayer.frozen) {
        session.combatLog = `🧊 **${activePlayer.name}** está congelado e não pode agir neste turno!\n`;
        activePlayer.frozen = false;
        
        // Skip turn
        session.currentPlayer = session.currentPlayer === 1 ? 2 : 1;
        session.turn++;
        return renderPvPTurn(null, msg, session); // Recursive skip
    }

    if (activePlayer.status.includes('poison')) {
        const pDmg = Math.floor(activePlayer.maxHp * 0.05);
        activePlayer.hp -= pDmg;
        session.combatLog += `☠️ O veneno drenou **${pDmg} HP** de ${activePlayer.name}!\n`;
    }

    // Check Death from Poison
    if (activePlayer.hp <= 0) return endPvP(msg, session);

    const embed = new EmbedBuilder()
        .setColor(session.currentPlayer === 1 ? 0x3498DB : 0xE74C3C)
        .setTitle(`⚔️ Turno ${session.turn}: Ação de ${activePlayer.name}`)
        .setDescription(`${session.combatLog}`)
        .addFields(
            { name: `🟦 ${session.p1.name}`, value: `HP: **${Math.floor(session.p1.hp)}** / ${session.p1.maxHp}`, inline: true },
            { name: `🟥 ${session.p2.name}`, value: `HP: **${Math.floor(session.p2.hp)}** / ${session.p2.maxHp}`, inline: true }
        );

    let buttons = [
        new ButtonBuilder().setCustomId('pvp_atk').setLabel('Atacar').setEmoji('🗡️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('pvp_def').setLabel('Defender').setEmoji('🛡️').setStyle(ButtonStyle.Primary)
    ];

    // Class Skills
    if (activePlayer.vocation === 'Mago') {
        buttons.push(new ButtonBuilder().setCustomId('pvp_s1').setLabel('Bola de Fogo (CD: ' + activePlayer.cooldowns.s1 + ')').setEmoji('🔥').setStyle(ButtonStyle.Success).setDisabled(activePlayer.cooldowns.s1 > 0));
        buttons.push(new ButtonBuilder().setCustomId('pvp_s2').setLabel('Congelar (CD: ' + activePlayer.cooldowns.s2 + ')').setEmoji('❄️').setStyle(ButtonStyle.Success).setDisabled(activePlayer.cooldowns.s2 > 0));
    } else if (activePlayer.vocation === 'Cavaleiro') {
        buttons.push(new ButtonBuilder().setCustomId('pvp_s1').setLabel('Golpe Demolidor (CD: ' + activePlayer.cooldowns.s1 + ')').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(activePlayer.cooldowns.s1 > 0));
        buttons.push(new ButtonBuilder().setCustomId('pvp_s2').setLabel('Muralha (CD: ' + activePlayer.cooldowns.s2 + ')').setEmoji('🧱').setStyle(ButtonStyle.Success).setDisabled(activePlayer.cooldowns.s2 > 0));
    } else if (activePlayer.vocation === 'Arqueiro') {
        buttons.push(new ButtonBuilder().setCustomId('pvp_s1').setLabel('Flecha Venenosa (CD: ' + activePlayer.cooldowns.s1 + ')').setEmoji('🏹').setStyle(ButtonStyle.Success).setDisabled(activePlayer.cooldowns.s1 > 0));
        buttons.push(new ButtonBuilder().setCustomId('pvp_s2').setLabel('Tiro na Cabeça (CD: ' + activePlayer.cooldowns.s2 + ')').setEmoji('🎯').setStyle(ButtonStyle.Success).setDisabled(activePlayer.cooldowns.s2 > 0));
    }

    if (activePlayer.stats.petDef && activePlayer.stats.petDef.active_skill) {
        const askill = activePlayer.stats.petDef.active_skill;
        buttons.push(new ButtonBuilder().setCustomId('pvp_pet').setLabel(`${askill.name} (CD: ${activePlayer.cooldowns.pet})`).setEmoji('🐾').setStyle(ButtonStyle.Secondary).setDisabled(activePlayer.cooldowns.pet > 0));
    }

    const row = new ActionRowBuilder().addComponents(buttons);
    
    if (inter) {
        await inter.editReply({ embeds: [embed], components: [row] }).catch(()=>{});
    } else {
        await msg.edit({ embeds: [embed], components: [row] }).catch(()=>{});
    }

    const filter = i => i.user.id === activePlayer.id;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async interClick => {
        try { await interClick.deferUpdate(); } catch(e) { return; }
        collector.stop();

        const action = interClick.customId;
        session.combatLog = "";
        let dmgDealt = 0;
        let isDefending = false;

        // Decrease Cooldowns
        if (activePlayer.cooldowns.s1 > 0) activePlayer.cooldowns.s1--;
        if (activePlayer.cooldowns.s2 > 0) activePlayer.cooldowns.s2--;
        if (activePlayer.cooldowns.pet > 0) activePlayer.cooldowns.pet--;

        // Action Logic
        if (action === 'pvp_atk') {
            dmgDealt = Math.max(5, Math.floor(activePlayer.stats.atk * (0.8 + Math.random() * 0.4)));
            session.combatLog += `🗡️ **${activePlayer.name}** atacou causando **${dmgDealt} dano**.\n`;
        } 
        else if (action === 'pvp_s1') {
            if (activePlayer.vocation === 'Mago') {
                activePlayer.cooldowns.s1 = 2;
                dmgDealt = Math.floor(activePlayer.stats.atk * 1.8);
                session.combatLog += `🔥 **${activePlayer.name}** lançou Bola de Fogo causando **${dmgDealt} dano**!\n`;
            } else if (activePlayer.vocation === 'Cavaleiro') {
                activePlayer.cooldowns.s1 = 3;
                dmgDealt = Math.floor(activePlayer.stats.atk * 2.2);
                activePlayer.vuln = true;
                session.combatLog += `⚔️ **${activePlayer.name}** usou Golpe Demolidor causando **${dmgDealt} dano**, mas abriu sua guarda!\n`;
            } else if (activePlayer.vocation === 'Arqueiro') {
                activePlayer.cooldowns.s1 = 3;
                dmgDealt = Math.floor(activePlayer.stats.atk * 1.2);
                targetPlayer.status.push('poison');
                session.combatLog += `🏹 **${activePlayer.name}** usou Flecha Venenosa e envenenou ${targetPlayer.name}!\n`;
            }
        }
        else if (action === 'pvp_s2') {
            if (activePlayer.vocation === 'Mago') {
                activePlayer.cooldowns.s2 = 4;
                dmgDealt = Math.floor(activePlayer.stats.atk * 1.0);
                targetPlayer.frozen = true;
                session.combatLog += `❄️ **${activePlayer.name}** causou **${dmgDealt} dano** e congelou o inimigo!\n`;
            } else if (activePlayer.vocation === 'Cavaleiro') {
                activePlayer.cooldowns.s2 = 4;
                activePlayer.wall = true;
                isDefending = true;
                session.combatLog += `🧱 **${activePlayer.name}** levantou uma Muralha impenetrável!\n`;
            } else if (activePlayer.vocation === 'Arqueiro') {
                activePlayer.cooldowns.s2 = 3;
                const isCrit = Math.random() < 0.20;
                dmgDealt = Math.floor(activePlayer.stats.atk * (isCrit ? 3.0 : 1.0));
                session.combatLog += isCrit ? `🎯 **${activePlayer.name}** deu um TIRO NA CABEÇA (CRÍTICO) causando **${dmgDealt} dano**!\n` : `🎯 **${activePlayer.name}** atirou causando **${dmgDealt} dano**.\n`;
            }
        }
        else if (action === 'pvp_def') {
            isDefending = true;
            session.combatLog += `🛡️ **${activePlayer.name}** está defendendo.\n`;
            if (activePlayer.stats.heal > 0) {
                activePlayer.hp = Math.min(activePlayer.maxHp, activePlayer.hp + activePlayer.stats.heal);
                session.combatLog += `🧚 O pet de ${activePlayer.name} curou **${activePlayer.stats.heal} HP**.\n`;
            }
        }
        else if (action === 'pvp_pet') {
            const askill = activePlayer.stats.petDef.active_skill;
            activePlayer.cooldowns.pet = askill.cd;
            session.combatLog += `🐾 **${activePlayer.name}** comanda seu pet: ${askill.msg}\n`;

            if (askill.type.includes('atk')) {
                dmgDealt = Math.floor(activePlayer.stats.atk * askill.power);
                session.combatLog += ` (Dano estimado da habilidade: **${dmgDealt}**) \n`;
                if (askill.type === 'atk_fire') targetPlayer.hp -= Math.floor(dmgDealt * 0.2);
                if (askill.type === 'atk_blind') targetPlayer.blind = true;
            } else if (askill.type === 'heal') {
                const heal = Math.floor(activePlayer.maxHp * askill.power);
                activePlayer.hp = Math.min(activePlayer.maxHp, activePlayer.hp + heal);
                session.combatLog += ` (Curou **${heal} HP**!) \n`;
            } else if (askill.type === 'def') {
                activePlayer.petDefBlock = true;
            }
        }

        // Apply Damage Mitigation to Target
        if (dmgDealt > 0) {
            let defValue = targetPlayer.stats.def;
            if (targetPlayer.vuln) defValue = Math.floor(defValue * 0.5);
            
            // Defesa baseada em subtração para PvP (antigo sistema) ou podemos usar mitigação %:
            // Usaremos mitigação % para bater com o novo padrão:
            let finalDmg = Math.max(1, dmgDealt - Math.floor(defValue * 0.5));
            if (targetPlayer.petDefBlock) {
                finalDmg = Math.floor(finalDmg * 0.2); // Tartaruga block 80%
                session.combatLog += `🐢 O Casco de Pedra de ${targetPlayer.name} bloqueou 80% do dano recebido!\n`;
                targetPlayer.petDefBlock = false;
            }
            else if (targetPlayer.wall) {
                finalDmg = Math.floor(finalDmg * 0.3); // Muralha = 70% reducao extra
            }
            
            targetPlayer.hp -= finalDmg;

            session.combatLog += `🩸 ${targetPlayer.name} sofreu **${finalDmg} de dano líquido**.\n`;

            // Refletir dano da muralha
            if (targetPlayer.wall && finalDmg > 0) {
                const reflect = Math.floor(finalDmg * 0.5);
                activePlayer.hp -= reflect;
                session.combatLog += `🧱 A Muralha de ${targetPlayer.name} refletiu **${reflect} dano**!\n`;
            }
        }

        // Reset target's defensive buffs from last turn
        targetPlayer.vuln = false;
        targetPlayer.wall = false;

        // Check death
        if (activePlayer.hp <= 0 || targetPlayer.hp <= 0) {
            return endPvP(msg, session, interClick);
        }

        // Next Turn
        session.currentPlayer = session.currentPlayer === 1 ? 2 : 1;
        session.turn++;
        return renderPvPTurn(interClick, msg, session);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            session.combatLog = `⏳ **${activePlayer.name}** demorou muito para jogar e perdeu por WO!`;
            activePlayer.hp = 0; // Kills the AFK player
            endPvP(msg, session, null);
        }
    });
}

async function endPvP(msg, session, inter) {
    db.updateHp(session.p1.id, Math.max(0, session.p1.hp));
    db.updateHp(session.p2.id, Math.max(0, session.p2.hp));

    if (session.p1.hp <= 0) db.handleDeath(session.p1.id);
    if (session.p2.hp <= 0) db.handleDeath(session.p2.id);

    let winner = null;
    let loser = null;

    if (session.p1.hp <= 0 && session.p2.hp <= 0) {
        // Tie
    } else if (session.p2.hp <= 0) {
        winner = session.p1; loser = session.p2;
    } else if (session.p1.hp <= 0) {
        winner = session.p2; loser = session.p1;
    }

    if (winner) {
        db.removeCoins(loser.id, session.amount);
        db.addCoins(winner.id, session.amount);
        db.progressQuest(winner.id, 'duel', 1);
        
        const winEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🏆 O COLISEU TEM UM CAMPEÃO!')
            .setDescription(`${session.combatLog}\n\nO Coliseu vibra! **${winner.name}** esmagou **${loser.name}**!\n💰 ${winner.name} levou a aposta de **${session.amount} AC**!`);
        
        if (inter) {
            await inter.editReply({ embeds: [winEmbed], components: [] }).catch(()=>{});
        } else {
            await msg.edit({ embeds: [winEmbed], components: [] }).catch(()=>{});
        }
    } else {
        const tieEmbed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('⚖️ EMPATE SANGRENTO')
            .setDescription(`${session.combatLog}\n\nAmbos os guerreiros caíram! Ninguém levou o ouro.`);
        if (inter) {
            await inter.editReply({ embeds: [tieEmbed], components: [] }).catch(()=>{});
        } else {
            await msg.edit({ embeds: [tieEmbed], components: [] }).catch(()=>{});
        }
    }
}

