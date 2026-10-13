#!/usr/bin/env node
/* Zelftest van het endpoint tegen een nep-Redis in het geheugen. Geen
   dependencies, kale Node (>=18). Gebruik: npm test. Faalt hard (exitcode 1). */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = { h: {}, l: {}, s: {} };
globalThis.fetch = async (url, { body }) => {
  const [cmd, ...a] = JSON.parse(body);
  let result = null;
  switch (cmd) {
    case 'HGETALL': result = Object.entries(db.h[a[0]] || {}).flat(); break;
    case 'HGET': result = (db.h[a[0]] || {})[a[1]] ?? null; break;
    case 'HSET': (db.h[a[0]] ||= {})[a[1]] = a[2]; result = 1; break;
    case 'HDEL': if (db.h[a[0]]) delete db.h[a[0]][a[1]]; result = 1; break;
    case 'DEL': delete db.h[a[0]]; result = 1; break;
    case 'GET': result = db.s[a[0]] ?? null; break;
    case 'INCR': db.s[a[0]] = String((+db.s[a[0]] || 0) + 1); result = +db.s[a[0]]; break;
    case 'LPUSH': (db.l[a[0]] ||= []).unshift(a[1]); result = db.l[a[0]].length; break;
    case 'LTRIM': result = 'OK'; break;
    default: throw new Error('onbekende redis-opdracht ' + cmd);
  }
  return { ok: true, json: async () => ({ result }) };
};

const maak = createRequire(import.meta.url)(join(root, 'api/tekstlaag.js'));
const handler = maak({
  prefix: 'test:',
  env: { UPSTASH_REDIS_REST_URL: 'x', UPSTASH_REDIS_REST_TOKEN: 'y', REDACTIE_WACHTWOORD: 'tim', REDACTIE_AGENT_SLEUTEL: 'pm' },
});

async function call(method, { sleutel, query = {}, body } = {}) {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(o) { this.o = o; return this; } };
  await handler({ method, headers: sleutel ? { 'x-redactie-sleutel': sleutel } : {}, query, body }, res);
  return res;
}

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

let r = await call('GET');
ok('bezoeker leest een lege laag', r.c === 200 && Object.keys(r.o.blokken).length === 0);
ok('bezoeker krijgt randcaching', /s-maxage/.test(r.h['Cache-Control'] || ''));

r = await call('POST', { sleutel: 'pm', body: { wijzigingen: [{ sleutel: '6.2/3', hoofdstuk: '6.2', was: 'oud', wordt: 'nieuw', bron: 'Wim 23-09' }] } });
ok('agent plaatst een voorstel', r.c === 200 && r.o.bewaard === 1);
r = await call('GET');
ok('bezoeker ziet het voorstel niet', Object.keys(r.o.blokken).length === 0);
r = await call('GET', { sleutel: 'pm' });
ok('agent ziet zijn voorstel, met herkomst', r.o.voorgesteld['6.2/3'].wie === 'projectmanager' && r.o.voorgesteld['6.2/3'].bron === 'Wim 23-09');
ok('met sleutel geen caching', r.h['Cache-Control'] === 'no-store');

r = await call('POST', { sleutel: 'pm', query: { actie: 'akkoord' }, body: { sleutel: '6.2/3' } });
ok('agent mag geen akkoord geven', r.c === 403);
r = await call('POST', { sleutel: 'tim', query: { actie: 'akkoord' }, body: { sleutel: '6.2/3', wordt: 'tims tekst' } });
ok('redacteur geeft akkoord met eigen formulering', r.c === 200);
r = await call('GET');
ok('bezoeker leest de gepubliceerde regel', r.o.blokken['6.2/3'] && r.o.blokken['6.2/3'].wordt === 'tims tekst');
ok('het oorspronkelijke voorstel blijft bewaard', r.o.blokken['6.2/3'].voorgesteld_wordt === 'nieuw');

r = await call('POST', { sleutel: 'pm', body: { wijzigingen: [{ sleutel: '6.2/3', was: 'oud', wordt: 'x' }] } });
ok('voorstel op verouderde tekst wordt geweigerd', r.o.bewaard === 0 && r.o.overgeslagen.length === 1);
r = await call('POST', { sleutel: 'pm', body: { wijzigingen: [{ sleutel: '6.2/3', was: 'tims tekst', wordt: 'nog nieuwer', bron: 'LBI' }] } });
ok('voorstel op de gepubliceerde laagregel lukt', r.o.bewaard === 1);
r = await call('POST', { sleutel: 'tim', query: { actie: 'afwijzen' }, body: { sleutel: '6.2/3', reden: 'smaak' } });
ok('redacteur wijst af', r.c === 200);
r = await call('GET', { sleutel: 'tim' });
ok('afwijzing bewaart de reden', Object.values(r.o.afgewezen)[0].reden === 'smaak');
ok('de gepubliceerde regel bleef staan', r.o.blokken['6.2/3'].wordt === 'tims tekst');

r = await call('POST', { sleutel: 'tim', body: { wijzigingen: [{ sleutel: '1/1', was: 'a', wordt: 'b' }] } });
ok('redacteur publiceert rechtstreeks (redactiemodus)', r.c === 200 && r.o.bewaard === 1);
r = await call('POST', { sleutel: 'tim', body: { wijzigingen: [{ sleutel: '1/1', was: 'a', wordt: 'a' }] } });
r = await call('GET');
ok('terug naar de bron wist de regel', !r.o.blokken['1/1']);
r = await call('POST', { sleutel: 'pm', query: { actie: 'vergeten' }, body: { sleutel: '6.2/3' } });
ok('agent mag geen gepubliceerde regel wissen', r.c === 403);
r = await call('POST', { sleutel: 'nee', body: { wijzigingen: [] } });
ok('verkeerde sleutel is geen toegang', r.c === 401);
r = await call('DELETE');
ok('andere methodes zijn dicht', r.c === 405);

console.log(failures ? `\n${failures} controle(s) gefaald` : '\nalles in orde');
process.exit(failures ? 1 : 0);
