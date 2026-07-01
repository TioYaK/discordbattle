'use strict';

const RPG_ITEMS = {
    // Weapons
    giant_sword: { id: 'giant_sword', name: 'Giant Sword 🗡️', type: 'weapon', atk: 15, def: 0, cost: 500 },
    magic_sword: { id: 'magic_sword', name: 'Magic Sword (SOV) 🗡️', type: 'weapon', atk: 25, def: 5, cost: 1200 },
    stonecutter_axe: { id: 'stonecutter_axe', name: 'Stonecutter Axe 🪓', type: 'weapon', atk: 27, def: 3, cost: 1300 },
    warsinger_bow: { id: 'warsinger_bow', name: 'Warsinger Bow 🏹', type: 'weapon', atk: 24, def: 2, cost: 1000 },
    crystal_wand: { id: 'crystal_wand', name: 'Crystal Wand 🪄', type: 'weapon', atk: 20, def: 0, cost: 600 },
    
    // Shields
    demon_shield: { id: 'demon_shield', name: 'Demon Shield 🛡️', type: 'shield', atk: 0, def: 15, cost: 600 },
    mastermind_shield: { id: 'mastermind_shield', name: 'Mastermind Shield 🛡️', type: 'shield', atk: 0, def: 25, cost: 1200 },
    blessed_shield: { id: 'blessed_shield', name: 'Blessed Shield 🛡️', type: 'shield', atk: 0, def: 40, cost: 5000 },
    
    // Armors
    drakonite_armor: { id: 'drakonite_armor', name: 'Drakonite Armor 👕', type: 'armor', atk: 5, def: 15, cost: 800 },
    magic_plate_armor: { id: 'magic_plate_armor', name: 'Magic Plate Armor (MPA) 👕', type: 'armor', atk: 5, def: 30, cost: 2000 },
    
    // Amulets
    platinum_amulet: { id: 'platinum_amulet', name: 'Platinum Amulet 🛡️', type: 'amulet', atk: 2, def: 5, cost: 400 },
    demon_amulet: { id: 'demon_amulet', name: 'Demon Amulet 🛡️', type: 'amulet', atk: 8, def: 8, cost: 1500 },

    // Utilitários / Materiais
    megafone_guilda: { id: 'megafone_guilda', name: 'Megafone da Guilda 📢', type: 'material', atk: 0, def: 0, cost: 5000 },

    // --- Novas Armas ---
    fire_sword: { id: 'fire_sword', name: 'Fire Sword 🗡️', type: 'weapon', atk: 18, def: 1, cost: 700 },
    skull_staff: { id: 'skull_staff', name: 'Skull Staff 🪄', type: 'weapon', atk: 22, def: 0, cost: 900 },
    
    // --- Novos Escudos ---
    dragon_shield: { id: 'dragon_shield', name: 'Dragon Shield 🛡️', type: 'shield', atk: 0, def: 18, cost: 800 },
    vampire_shield: { id: 'vampire_shield', name: 'Vampire Shield 🛡️', type: 'shield', atk: 0, def: 22, cost: 1000 },
    
    // --- Novas Armaduras ---
    crown_armor: { id: 'crown_armor', name: 'Crown Armor 👕', type: 'armor', atk: 2, def: 20, cost: 1100 },
    golden_armor: { id: 'golden_armor', name: 'Golden Armor 👕', type: 'armor', atk: 3, def: 25, cost: 1500 },
    
    // --- Novos Amuletos ---
    amulet_of_loss: { id: 'amulet_of_loss', name: 'Amulet of Loss 📿', type: 'amulet', atk: 5, def: 10, cost: 1000 },

    // --- FORGED WEAPONS ---
    shadow_blade: { id: 'shadow_blade', name: 'Shadow Blade 🗡️', type: 'weapon', atk: 35, def: 0, cost: 0 },
    dragon_slayer: { id: 'dragon_slayer', name: 'Dragon Slayer Axe 🪓', type: 'weapon', atk: 38, def: 2, cost: 0 },
    demonic_bow: { id: 'demonic_bow', name: 'Demonic Bow 🏹', type: 'weapon', atk: 34, def: 0, cost: 0 },
    nature_wand: { id: 'nature_wand', name: 'Staff of Nature 🪄', type: 'weapon', atk: 30, def: 5, cost: 0 },
    
    // --- FORGED ARMORS ---
    wolf_armor: { id: 'wolf_armor', name: 'Wolf Pelt Armor 👕', type: 'armor', atk: 2, def: 18, cost: 0 },
    dragon_armor: { id: 'dragon_armor', name: 'Dragon Scale Mail 👕', type: 'armor', atk: 8, def: 40, cost: 0 },


    // --- Potions (Alchemy) ---
    minor_potion: { id: 'minor_potion', name: 'Poção Menor de HP 🧪', type: 'consumable', heal: 50, cost: 0 },
    major_potion: { id: 'major_potion', name: 'Poção Maior de HP 🧪', type: 'consumable', heal: 150, cost: 0 },
    elixir_berserker: { id: 'elixir_berserker', name: 'Elixir do Berserker 🩸', type: 'consumable', buff: 'atk', duration: 3, value: 0.2, cost: 0 },

    // --- Divine Weapons ---
    ice_rapier: { id: 'ice_rapier', name: 'Ice Rapier 🗡️', type: 'weapon', atk: 45, def: 0, cost: 0 },
    earth_bow: { id: 'earth_bow', name: 'Earth Bow 🏹', type: 'weapon', atk: 42, def: 0, cost: 0 },
    thunder_wand: { id: 'thunder_wand', name: 'Thunder Wand 🪄', type: 'weapon', atk: 40, def: 5, cost: 0 },

    // --- Elite Shields & Amulets ---
    aegis_shield: { id: 'aegis_shield', name: 'Aegis Shield 🛡️', type: 'shield', atk: 0, def: 45, cost: 0 },
    amulet_life: { id: 'amulet_life', name: 'Amulet of Life 📿', type: 'amulet', atk: 0, def: 0, extraHp: 100, cost: 0 },
    scarab_amulet: { id: 'scarab_amulet', name: 'Scarab Amulet 📿', type: 'amulet', atk: 0, def: 15, cost: 0 },

};

module.exports = RPG_ITEMS;
