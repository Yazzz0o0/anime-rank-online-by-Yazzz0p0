#!/usr/bin/env node
'use strict';
// Usage :
//   node tools/import.js nouveaux.json            ajoute les nouveaux personnages (ignore les doublons)
//   node tools/import.js nouveaux.json --update   met aussi à jour les personnages existants
//   node tools/import.js noms.txt                 une ligne "Nom | Anime" par personnage -> fiche « stub »
// Un stub (stats = null) est enregistré mais NON jouable tant que ses 5 stats ne sont pas renseignées.
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'characters.json');
const CATS = ['force', 'speed', 'abilities', 'iq', 'durability'];
const slug = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const keyOf = (c) => `${slug(c.anime)}--${slug(c.name)}`;

function normalize(raw) {
  if (!raw.name || !raw.anime) throw new Error('name et anime sont obligatoires');
  const stats = raw.stats && CATS.every((k) => raw.stats[k] != null) ? Object.fromEntries(CATS.map((k) => [k, Number(raw.stats[k])])) : null;
  if (stats) for (const k of CATS) if (!(stats[k] >= 1 && stats[k] <= 100)) throw new Error(`${raw.name} : stat ${k} hors de 1-100`);
  return {
    id: raw.id || keyOf(raw).slice(0, 80),
    name: raw.name.trim(), anime: raw.anime.trim(), version: raw.version || null,
    image: raw.image || null,                       // jamais d'URL inventée : null = avatar de remplacement
    description: raw.description || '', powers: raw.powers || [],
    stats, statStatus: raw.statStatus || (stats ? 'estimate' : 'missing'),   // 'confirmed' | 'estimate' | 'missing'
    confidence: raw.confidence || 'low', sources: raw.sources || [], notes: raw.notes || '',
  };
}

function parseInput(file) {
  const txt = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return JSON.parse(txt);
  return txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [name, anime] = l.split('|').map((s) => s.trim());
    if (!name || !anime) throw new Error(`Ligne invalide (attendu "Nom | Anime") : ${l}`);
    return { name, anime, notes: 'Fiche à compléter : statistiques, sources et image à rechercher.' };
  });
}

const [input, ...flags] = process.argv.slice(2);
if (!input) { console.error('Usage : node tools/import.js <fichier.json|.txt> [--update]'); process.exit(1); }
const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const index = new Map(db.map((c, i) => [keyOf(c), i]));
let added = 0, updated = 0, skipped = 0;
for (const raw of parseInput(input)) {
  const c = normalize(raw);
  const k = keyOf(c);
  if (index.has(k)) {
    if (flags.includes('--update')) { db[index.get(k)] = { ...db[index.get(k)], ...c, id: db[index.get(k)].id }; updated++; } else skipped++;
  } else { index.set(k, db.length); db.push(c); added++; }
}
const ids = db.map((c) => c.id);
if (new Set(ids).size !== ids.length) { console.error('Identifiants en double : import annulé.'); process.exit(1); }
fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1));
fs.renameSync(FILE + '.tmp', FILE);
console.log(`Ajoutés : ${added}, mis à jour : ${updated}, doublons ignorés : ${skipped}. Jouables : ${db.filter((c) => c.stats).length}/${db.length}.`);
