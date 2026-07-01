'use strict';

const RPG_RECIPES = {
    // Weapons
    shadow_blade: {
        id: 'shadow_blade',
        result_item: 'shadow_blade',
        name: 'Shadow Blade 🗡️',
        costAc: 2500,
        materials: [
            { id: 'iron_ore', qty: 10 },
            { id: 'shadow_essence', qty: 1 },
            { id: 'magic_dust', qty: 5 }
        ]
    },
    dragon_slayer: {
        id: 'dragon_slayer',
        result_item: 'dragon_slayer',
        name: 'Dragon Slayer Axe 🪓',
        costAc: 4000,
        materials: [
            { id: 'iron_ore', qty: 15 },
            { id: 'dragon_scale', qty: 3 },
            { id: 'wood_log', qty: 10 }
        ]
    },
    demonic_bow: {
        id: 'demonic_bow',
        result_item: 'demonic_bow',
        name: 'Demonic Bow 🏹',
        costAc: 3500,
        materials: [
            { id: 'wood_log', qty: 20 },
            { id: 'demon_horn', qty: 2 },
            { id: 'shadow_essence', qty: 1 }
        ]
    },
    nature_wand: {
        id: 'nature_wand',
        result_item: 'nature_wand',
        name: 'Staff of Nature 🪄',
        costAc: 2800,
        materials: [
            { id: 'wood_log', qty: 15 },
            { id: 'magic_dust', qty: 10 },
            { id: 'wolf_pelt', qty: 5 }
        ]
    },

    // Armors
    wolf_armor: {
        id: 'wolf_armor',
        result_item: 'wolf_armor',
        name: 'Wolf Pelt Armor 👕',
        costAc: 1000,
        materials: [
            { id: 'wolf_pelt', qty: 10 },
            { id: 'iron_ore', qty: 2 }
        ]
    },
    dragon_armor: {
        id: 'dragon_armor',
        result_item: 'dragon_armor',
        name: 'Dragon Scale Mail 👕',
        costAc: 5000,
        materials: [
            { id: 'dragon_scale', qty: 5 },
            { id: 'iron_ore', qty: 20 },
            { id: 'magic_dust', qty: 5 }
        ]
    },

    // --- Alchemy (Requires Alchemist) ---
    minor_potion: {
        id: 'minor_potion', result_item: 'minor_potion', name: 'Poção Menor de HP 🧪', costAc: 100,
        reqProfession: 'Alquimista',
        materials: [{ id: 'medicinal_herb', qty: 3 }]
    },
    major_potion: {
        id: 'major_potion', result_item: 'major_potion', name: 'Poção Maior de HP 🧪', costAc: 300,
        reqProfession: 'Alquimista',
        materials: [{ id: 'medicinal_herb', qty: 5 }, { id: 'slime_drop', qty: 2 }]
    },
    elixir_berserker: {
        id: 'elixir_berserker', result_item: 'elixir_berserker', name: 'Elixir do Berserker 🩸', costAc: 500,
        reqProfession: 'Alquimista',
        materials: [{ id: 'slime_drop', qty: 5 }, { id: 'demon_horn', qty: 1 }]
    },

    // --- Divine Crafts ---
    ice_rapier: {
        id: 'ice_rapier', result_item: 'ice_rapier', name: 'Ice Rapier 🗡️', costAc: 10000,
        materials: [{ id: 'divine_crystal', qty: 1 }, { id: 'iron_ore', qty: 50 }, { id: 'magic_dust', qty: 20 }]
    },
    earth_bow: {
        id: 'earth_bow', result_item: 'earth_bow', name: 'Earth Bow 🏹', costAc: 10000,
        materials: [{ id: 'divine_crystal', qty: 1 }, { id: 'wood_log', qty: 80 }, { id: 'magic_dust', qty: 20 }]
    },
    thunder_wand: {
        id: 'thunder_wand', result_item: 'thunder_wand', name: 'Thunder Wand 🪄', costAc: 10000,
        materials: [{ id: 'divine_crystal', qty: 1 }, { id: 'wood_log', qty: 50 }, { id: 'magic_dust', qty: 30 }]
    },
    aegis_shield: {
        id: 'aegis_shield', result_item: 'aegis_shield', name: 'Aegis Shield 🛡️', costAc: 15000,
        materials: [{ id: 'divine_crystal', qty: 2 }, { id: 'iron_ore', qty: 100 }, { id: 'dragon_scale', qty: 10 }]
    },

};

module.exports = RPG_RECIPES;
