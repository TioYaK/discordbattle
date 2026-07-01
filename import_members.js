'use strict';

// Script de importação em massa dos membros registrados
// Roda direto da pasta do Discord

const Database = require('./node_modules/better-sqlite3');
const db = new Database('./data/ascended_bot.db');

const members = [
    { char_name: 'Majin Ascended',              discord_id: '1008043091556581386', class_code: 'EK', bomba: 'Kit Immortal',                    phone: '5519989448376'   },
    { char_name: 'Haudex',                       discord_id: '304796129801797643',  class_code: 'EK', bomba: 'Gigio TFR',                        phone: '5511971424708'   },
    { char_name: 'Kit Immortal',                 discord_id: '551112319313117201',  class_code: 'ED', bomba: 'Lady Alleria',                     phone: '5511993872282'   },
    { char_name: 'Malevolent Edzinha',           discord_id: '131607824890462208',  class_code: 'ED', bomba: null,                               phone: null              },
    { char_name: 'Somelier De Casadass',         discord_id: '149721551653175296',  class_code: 'EM', bomba: 'Somelier de Casadas',              phone: null              },
    { char_name: 'Ly Nuxx Ascended',             discord_id: '162415670464610305',  class_code: 'MS', bomba: null,                               phone: null              },
    { char_name: 'Assukah',                      discord_id: '272112484276633605',  class_code: 'EK', bomba: null,                               phone: null              },
    { char_name: 'Drux Skillado',                discord_id: '523598900632879105',  class_code: 'RP', bomba: null,                               phone: '5534991798257'   },
    { char_name: 'Oligonn Ascended',             discord_id: '392424191405719552',  class_code: 'MS', bomba: null,                               phone: '5511951320602'   },
    { char_name: 'Torvii Ascended',              discord_id: '915796903185235989',  class_code: 'EM', bomba: null,                               phone: '5511989668224'   },
    { char_name: 'Conceitto Ek',                 discord_id: '469601605843419147',  class_code: 'EK', bomba: null,                               phone: '5567996152520'   },
    { char_name: 'Dragomazze',                   discord_id: '692802093224034325',  class_code: 'ED', bomba: 'Dragomazze Voidwalker',            phone: '5512981150450'   },
    { char_name: 'Rewp',                         discord_id: '605542268790636572',  class_code: 'RP', bomba: 'Atirador do Mal',                  phone: '5554993006713'   },
    { char_name: 'Dorion Millon',                discord_id: '922624536988483595',  class_code: 'RP', bomba: 'Dorion Millon',                    phone: '5591983061911'   },
    { char_name: 'Luan Ascended',                discord_id: '996741645716422686',  class_code: 'ED', bomba: 'Luan Ascended',                    phone: '5517997373504'   },
    { char_name: 'Goku Ascended',                discord_id: '446749490632982529',  class_code: 'ED', bomba: 'Henrique alma',                    phone: '5511958672262'   },
    { char_name: 'Proxy Lass',                   discord_id: '164158128949166080',  class_code: 'RP', bomba: 'Proxy Zaundar',                    phone: '5521996503918'   },
    { char_name: 'Rick Ascended',                discord_id: '692418197621833829',  class_code: 'RP', bomba: 'Zyrtec',                           phone: '553288100267'    },
    { char_name: 'King Pedrao',                  discord_id: '554960115950813196',  class_code: 'EK', bomba: 'The Elder Druid',                  phone: '5514991051140'   },
    { char_name: 'Sheik Immortal',               discord_id: '277922188349145090',  class_code: 'RP', bomba: 'Opqrst Shellpatrocina',            phone: '5513981955666'   },
    { char_name: 'Shakalsz Ascended',            discord_id: '196715915335696387',  class_code: 'MS', bomba: 'Shakal Ascended',                  phone: '5548991604237'   },
    { char_name: 'Sanders Knight',               discord_id: '713512829415850024',  class_code: 'EK', bomba: 'Euro',                             phone: '5549988146369'   },
    { char_name: 'Mine Gringo',                  discord_id: '388010114310995968',  class_code: 'RP', bomba: 'Genuz',                            phone: '5534996674938'   },
    { char_name: 'Head Paladin',                 discord_id: '388982224298704897',  class_code: 'ED', bomba: 'Head Paladin',                     phone: '5519995062878'   },
    { char_name: 'Meza Bomba Baiakero',          discord_id: '229046292976893962',  class_code: 'EK', bomba: 'Me za',                            phone: '528332941866'    },
    { char_name: 'Boxxy',                        discord_id: '634519918888353802',  class_code: 'MS', bomba: 'Mitira Mitira',                    phone: '5519987242075'   },
    { char_name: 'Attax',                        discord_id: '308672523438915589',  class_code: 'ED', bomba: 'Shiirozada',                       phone: '5519993564805'   },
    { char_name: 'Tapa di Qualidade',            discord_id: '318200879758966790',  class_code: 'EM', bomba: 'Mestre Dos Wizzard',               phone: '5521986245435'   },
    { char_name: 'Eleru Immortal',               discord_id: '220668790818603008',  class_code: 'RP', bomba: 'Tdemuner',                         phone: '5521972842484'   },
    { char_name: 'Cadu Ascended',                discord_id: '346053226413555712',  class_code: 'RP', bomba: 'Cadu Sbp Ascendido',               phone: '5543991409215'   },
    { char_name: 'Platypus Shooter',             discord_id: '1293957590669070386', class_code: 'RP', bomba: 'Eo Th',                            phone: '5512992050787'   },
    { char_name: 'Bolapehz',                     discord_id: '214141719262920705',  class_code: 'ED', bomba: 'Bolaed',                           phone: '5515981100016'   },
    { char_name: 'Anniel Ascended',              discord_id: '780147068156772363',  class_code: 'RP', bomba: 'Anniel Ascended Defender',         phone: '5532998115946'   },
    { char_name: 'Pipoca Mengao',                discord_id: '492153832659222528',  class_code: 'RP', bomba: 'Stormrage Pipoca',                 phone: '5561991795355'   },
    { char_name: 'Lauw Boeingsietetressiete',    discord_id: '952604548034338876',  class_code: 'ED', bomba: 'Lauw Boeingsietetressiete',        phone: '584241360373'    },
    { char_name: 'Yami Clover',                  discord_id: '595583735282532353',  class_code: 'ED', bomba: 'Yami Clover',                      phone: '5511952058627'   },
    { char_name: 'Schuttao',                     discord_id: '269250528280576003',  class_code: 'ED', bomba: 'Paramax Leave',                    phone: '5521971821113'   },
    { char_name: 'Baccizor Bomba Baiakero',      discord_id: '536681728987627532',  class_code: 'MS', bomba: 'Bacci Zor',                        phone: '5515997247898'   },
    { char_name: 'Kaifuku Jutsushi',             discord_id: '847837911344218142',  class_code: 'ED', bomba: 'Hunterzyn',                        phone: '5524999301755'   },
    { char_name: 'Fegolex',                      discord_id: '647492147620085761',  class_code: 'EK', bomba: 'Fegolexx Auroria Defender',        phone: '5541996424598'   },
    { char_name: 'Budah Ascended',               discord_id: '354477981680271360',  class_code: 'RP', bomba: 'Anniel Panqmeuqueixo',             phone: '5512988860478'   },
    { char_name: 'King Setzer',                  discord_id: '1093709914976817203', class_code: 'RP', bomba: 'Cadu Monoball',                    phone: '5521983062949'   },
    { char_name: 'Leo Deliriious',               discord_id: '1225215974324834305', class_code: 'RP', bomba: 'Leow Sorczin',                     phone: '5517988303847'   },
    { char_name: 'Babalu Opressor',              discord_id: '266684643007266816',  class_code: 'RP', bomba: 'Atirador de Elitee',               phone: '5581995712950'   },
    { char_name: 'Naotimetii',                   discord_id: '327569450159177729',  class_code: 'EK', bomba: 'Naotimeti',                        phone: '5548984841949'   },
    { char_name: 'Kakaroto Commander',           discord_id: '691296457994666055',  class_code: 'ED', bomba: 'Kakaroto Kid',                     phone: '5511976337734'   },
    { char_name: 'Petr Cech',                    discord_id: '281199896063639553',  class_code: 'ED', bomba: 'Petr Cech',                        phone: '5547996405513'   },
    { char_name: 'Lynka Xava',                   discord_id: '1420866276342890529', class_code: 'MS', bomba: 'Lynka Xava',                       phone: '5549991297638'   },
    { char_name: 'Cebum Ed',                     discord_id: '412234470410682369',  class_code: 'ED', bomba: 'Cebum cake',                       phone: '5554996335773'   },
    { char_name: 'Robertin mata otaku',          discord_id: '658425324626903040',  class_code: 'RP', bomba: 'Kuzumake Ed',                      phone: '5535998872265'   },
    { char_name: 'Anchors The Bad',              discord_id: '1067948738783481956', class_code: 'EK', bomba: 'Lord Niftt',                       phone: '5535910148660'   },
    { char_name: 'Gordinho Da City',             discord_id: '352967763620265986',  class_code: 'EK', bomba: null,                               phone: '5564996256256'   },
    { char_name: 'Terah',                        discord_id: '781171045969166357',  class_code: 'ED', bomba: null,                               phone: '553172121201'    },
    { char_name: 'Papato Wardog',                discord_id: '694001639908180048',  class_code: 'ED', bomba: null,                               phone: '5561998727559'   },
];

const stmt = db.prepare(`
    INSERT OR REPLACE INTO registered_members (discord_id, char_name, class_code, bomba, phone, registered_at)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const now = Date.now();
let inserted = 0;
let updated = 0;

for (const m of members) {
    const existing = db.prepare('SELECT discord_id FROM registered_members WHERE discord_id = ?').get(m.discord_id);
    stmt.run(
        m.discord_id,
        m.char_name,
        m.class_code,
        m.bomba || null,
        m.phone || null,
        now
    );
    if (existing) updated++;
    else inserted++;
}

console.log(`\n✅ Importação concluída!`);
console.log(`   Inseridos: ${inserted}`);
console.log(`   Atualizados: ${updated}`);
console.log(`   Total: ${inserted + updated} membros\n`);

const all = db.prepare('SELECT char_name, phone FROM registered_members ORDER BY char_name').all();
const comFone = all.filter(m => m.phone);
console.log(`📱 Com telefone: ${comFone.length}/${all.length}`);
comFone.forEach(m => console.log(`   - ${m.char_name}: ${m.phone}`));
