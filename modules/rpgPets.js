'use strict';

const RPG_PETS = {
    // Comun
    lobo_feroz: { 
        id: 'lobo_feroz', name: 'Lobo Feroz', emoji: '🐺', rarity: 'common', buff: 'atk', value: 0.10, desc: '+10% Dano de Ataque',
        evolvesTo: 'lobo_alfa', evolvesAt: 10,
        active_skill: { name: 'Mordida Selvagem', type: 'atk', power: 1.5, cd: 4, msg: 'O Lobo Feroz rasgou a carne do inimigo com uma Mordida Selvagem!' }
    },
    lobo_alfa: { 
        id: 'lobo_alfa', name: 'Lobo Alfa Sangrento', emoji: '🐺🩸', rarity: 'rare', buff: 'atk', value: 0.20, desc: '+20% Dano de Ataque',
        active_skill: { name: 'Fúria da Alcatéia', type: 'atk_bleed', power: 2.0, cd: 3, msg: 'O Lobo Alfa chamou sua alcatéia e dilacerou o inimigo!' }
    },
    javali_brutal: { 
        id: 'javali_brutal', name: 'Javali Brutal', emoji: '🐗', rarity: 'common', buff: 'def', value: 0.10, desc: '+10% de Defesa',
        active_skill: { name: 'Investida', type: 'atk', power: 1.2, cd: 3, msg: 'O Javali Brutal deu uma Investida atordoante!' }
    },
    
    // Incomum
    coruja_sabia: { 
        id: 'coruja_sabia', name: 'Coruja Sábia', emoji: '🦉', rarity: 'uncommon', buff: 'xp', value: 0.15, desc: '+15% RPG XP nas caçadas',
        active_skill: { name: 'Ataque de Rapina', type: 'atk_blind', power: 0.8, cd: 4, msg: 'A Coruja Sábia mergulhou e cegou temporariamente o alvo!' }
    },
    corvo_negro: { 
        id: 'corvo_negro', name: 'Corvo Negro', emoji: '🐦‍⬛', rarity: 'uncommon', buff: 'drop', value: 0.10, desc: '+10% chance de dropar Materiais',
        active_skill: { name: 'Bicada Sombria', type: 'atk', power: 1.5, cd: 3, msg: 'O Corvo Negro atacou os olhos do inimigo impiedosamente!' }
    },
    
    // Raro
    fada_curandeira: { 
        id: 'fada_curandeira', name: 'Fada Curandeira', emoji: '🧚', rarity: 'rare', buff: 'heal', value: 15, desc: 'Cura 15 HP a cada rodada de defesa',
        active_skill: { name: 'Pó de Fada', type: 'heal', power: 0.3, cd: 5, msg: 'A Fada Curandeira banhou seu mestre em um brilho restaurador mágico!' } // power 0.3 = 30% max HP heal
    },
    tartaruga_ancia: { 
        id: 'tartaruga_ancia', name: 'Tartaruga Anciã', emoji: '🐢', rarity: 'rare', buff: 'def', value: 0.25, desc: '+25% de Defesa',
        active_skill: { name: 'Casco de Pedra', type: 'def', power: 0.8, cd: 4, msg: 'A Tartaruga bloqueou 80% do dano recebido neste turno com seu Casco impenetrável!' }
    },
    
    // Épico
    fenrir: { 
        id: 'fenrir', name: 'Fenrir', emoji: '🐺✨', rarity: 'epic', buff: 'atk', value: 0.25, desc: '+25% Dano de Ataque',
        active_skill: { name: 'Uivo do Caos', type: 'atk_bleed', power: 2.0, cd: 4, msg: 'Fenrir destroçou o inimigo deixando sangramentos graves!' }
    },
    
    // Lendário
    dragao_filhote: { 
        id: 'dragao_filhote', name: 'Dragão Filhote', emoji: '🐉', rarity: 'legendary', buff: 'all', value: 0.20, desc: '+20% Dano e Defesa',
        active_skill: { name: 'Sopro Flamejante', type: 'atk_fire', power: 3.5, cd: 5, msg: 'O Dragão exalou um SOPRO FLAMEJANTE derretendo o campo de batalha!' }
    }
};

// Logica de Gacha (Chocar)
function getRandomPetId(eggRarity) {
    let pool = [];
    const keys = Object.keys(RPG_PETS);
    
    // Pesos:
    // Egg comum: 70% comum, 25% incomum, 5% raro
    // Egg raro: 50% incomum, 40% raro, 10% epico
    // Egg epico: 60% raro, 35% epico, 5% lendario

    let r = Math.random();
    let targetRarity = 'common';

    if (eggRarity === 'common') {
        if (r < 0.70) targetRarity = 'common';
        else if (r < 0.95) targetRarity = 'uncommon';
        else targetRarity = 'rare';
    } else if (eggRarity === 'rare') {
        if (r < 0.50) targetRarity = 'uncommon';
        else if (r < 0.90) targetRarity = 'rare';
        else targetRarity = 'epic';
    } else if (eggRarity === 'epic') {
        if (r < 0.60) targetRarity = 'rare';
        else if (r < 0.95) targetRarity = 'epic';
        else targetRarity = 'legendary';
    }

    pool = keys.filter(k => RPG_PETS[k].rarity === targetRarity);
    if (pool.length === 0) pool = keys.filter(k => RPG_PETS[k].rarity === 'common'); // fallback
    
    return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
    RPG_PETS,
    getRandomPetId
};
