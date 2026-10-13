// Tekstlaag — de gepubliceerde tekst van een document met correcties eroverheen.
//
// Dit is de generieke versie van het endpoint dat in de repo's veenweide-visie
// en melk-en-meer is ontstaan. Een documentrepo maakt er een Vercel-functie van
// in drie regels:
//
//     const maak = require('@veenweiden-innovatiecentrum/vic-redactie');
//     module.exports = maak({ prefix: 'mm:' });
//
// Hoe het werkt. De pagina haalt bij het laden deze laag op en legt hem over de
// gepubliceerde tekst. Eén alinea is één regel in de laag, met een sleutel
// (kop + plaats), de tekst zoals die gepubliceerd staat (`was`) en de tekst zoals
// hij moet worden (`wordt`). Een lege `wordt` betekent: dit blok weglaten.
//
// Waarom de laag en niet rechtstreeks in de bron: de bron van het document staat
// in git, en de diff daar hoort exact te tonen wat er veranderde. Daarom schrijft
// de browser nooit in de bron. De correctie ligt erbovenop, meteen zichtbaar voor
// iedereen, en py/verwerk.py schrijft hem later in de bron bij. Zodra dat gebeurd
// is klopt `was` niet meer met de gepubliceerde tekst en dooft de regel uit zichzelf.
//
// Twee bakken, drie standen:
//   <prefix>laag          gepubliceerd — iedereen leest het.
//   <prefix>laag:voorstel voorgesteld  — ligt klaar voor de redacteur; alleen zichtbaar
//                                        met een sleutel. Akkoord verplaatst de regel naar
//                                        de laag; afwijzen naar <prefix>laag:afgewezen, met reden.
// Een regel draagt zijn herkomst: `wie`, `bron`, en bij akkoord `akkoord_tijd`.
//
// Twee sleutels, twee rollen (header x-redactie-sleutel):
//   REDACTIE_WACHTWOORD     — de redacteur: alles.
//   REDACTIE_AGENT_SLEUTEL  — de agent (bv. een projectmanager-sessie): mag voorstellen,
//                             alles lezen en een eigen voorstel intrekken; mag NIET
//                             publiceren, akkoord geven of afwijzen.
//
// Nodig in Vercel (Settings → Environment Variables):
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN   (Storage → Connect)
//   REDACTIE_WACHTWOORD, REDACTIE_AGENT_SLEUTEL
//
// GET  /api/tekstlaag                 → { versie, blokken }  alleen gepubliceerd, gecachet
// GET  /api/tekstlaag  (met sleutel)  → { versie, blokken, voorgesteld, afgewezen, rol }  niet gecachet
// POST /api/tekstlaag                 → bewaren; body { wijzigingen: [ { sleutel, hoofdstuk, was, wordt, bron?, stand? } ] }
//                                       redacteur: stand uit de body, standaard gepubliceerd; agent: altijd voorgesteld
// POST /api/tekstlaag?actie=akkoord   → body { sleutel, wordt? }  voorstel → gepubliceerd (alleen redacteur;
//                                       `wordt` meegeven is "anders": de eigen formulering van de redacteur)
// POST /api/tekstlaag?actie=afwijzen  → body { sleutel, reden }   voorstel → afgewezen (alleen redacteur)
// POST /api/tekstlaag?actie=vergeten  → body { sleutel?, bak? }   een regel wissen; bak = "laag" (standaard)
//                                       of "voorstel". Zonder sleutel: die hele bak (alleen redacteur).
//                                       De agent mag alleen een eigen voorstel intrekken.

const MAX_TEKST = 20000;

function maak(opties) {
  const o = Object.assign({
    prefix: 'vic:',
    agentNaam: 'projectmanager',
    redacteurNaam: 'redacteur',
    env: process.env,
  }, opties || {});

  const LAAG = o.prefix + 'laag';
  const VOORSTEL = o.prefix + 'laag:voorstel';
  const AFGEWEZEN = o.prefix + 'laag:afgewezen';
  const LOG = o.prefix + 'laag:log';
  const VERSIE = o.prefix + 'laag:versie';

  const redisUrl = () => o.env.UPSTASH_REDIS_REST_URL || o.env.KV_REST_API_URL;
  const redisToken = () => o.env.UPSTASH_REDIS_REST_TOKEN || o.env.KV_REST_API_TOKEN;

  async function redis(cmd) {
    const r = await fetch(redisUrl(), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + redisToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    if (!r.ok) throw new Error('database antwoordde ' + r.status);
    return (await r.json()).result;
  }

  function hashNaarObject(plat) {
    const uit = {};
    for (let i = 0; i < (plat || []).length; i += 2) {
      try { uit[plat[i]] = JSON.parse(plat[i + 1]); } catch (e) {}
    }
    return uit;
  }

  async function haal(bak, k) {
    const r = await redis(['HGET', bak, k]);
    try { return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }

  function rol(req) {
    const sleutel = req.headers['x-redactie-sleutel'] || '';
    if (!sleutel) return '';
    if (o.env.REDACTIE_WACHTWOORD && sleutel === o.env.REDACTIE_WACHTWOORD) return 'redacteur';
    if (o.env.REDACTIE_AGENT_SLEUTEL && sleutel === o.env.REDACTIE_AGENT_SLEUTEL) return 'agent';
    return '';
  }

  const naam = (wie) => (wie === 'agent' ? o.agentNaam : o.redacteurNaam);

  async function log(regel) {
    await redis(['LPUSH', LOG, JSON.stringify(regel)]);
    await redis(['LTRIM', LOG, 0, 1999]);
  }

  const nieuweVersie = async () => String(await redis(['INCR', VERSIE]));

  return async function tekstlaag(req, res) {
    try {
      if (!redisUrl() || !redisToken()) {
        return res.status(500).json({ fout: 'Database niet gekoppeld: verbind de Upstash Redis-store met dit project (Storage → Connect).' });
      }

      const wie = rol(req);

      if (req.method === 'GET') {
        const blokken = hashNaarObject(await redis(['HGETALL', LAAG]));
        const versie = (await redis(['GET', VERSIE])) || '0';
        if (!wie) {
          res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=10');
          return res.status(200).json({ versie, blokken });
        }
        const voorgesteld = hashNaarObject(await redis(['HGETALL', VOORSTEL]));
        const afgewezen = hashNaarObject(await redis(['HGETALL', AFGEWEZEN]));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ versie, blokken, voorgesteld, afgewezen, rol: wie });
      }

      if (req.method !== 'POST') return res.status(405).json({ fout: 'alleen GET en POST' });

      if (!o.env.REDACTIE_WACHTWOORD) {
        return res.status(500).json({ fout: 'REDACTIE_WACHTWOORD is nog niet ingesteld bij Vercel (Settings → Environment Variables).' });
      }
      if (!wie) return res.status(401).json({ fout: 'geen toegang' });

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const actie = String((req.query && req.query.actie) || '');
      const tijd = new Date().toISOString();

      if (actie === 'vergeten') {
        const bak = String(body.bak || '') === 'voorstel' ? VOORSTEL : LAAG;
        const bakNaam = bak === VOORSTEL ? 'voorstel' : 'laag';
        if (body.sleutel) {
          const k = String(body.sleutel);
          if (wie === 'agent') {
            const r = bak === VOORSTEL ? await haal(VOORSTEL, k) : null;
            if (!r || r.wie !== o.agentNaam) {
              return res.status(403).json({ fout: 'de agent mag alleen een eigen voorstel intrekken' });
            }
          }
          await redis(['HDEL', bak, k]);
          await log({ actie: 'vergeten', bak: bakNaam, sleutel: k, door: naam(wie), tijd });
        } else {
          if (wie !== 'redacteur') return res.status(403).json({ fout: 'een hele bak wissen kan alleen de redacteur' });
          await redis(['DEL', bak]);
          await log({ actie: 'alles vergeten', bak: bakNaam, door: naam(wie), tijd });
        }
        return res.status(200).json({ ok: true, versie: await nieuweVersie() });
      }

      if (actie === 'akkoord' || actie === 'afwijzen') {
        if (wie !== 'redacteur') return res.status(403).json({ fout: 'akkoord of afwijzen is aan de redacteur' });
        const k = String(body.sleutel || '');
        const r = await haal(VOORSTEL, k);
        if (!r) return res.status(404).json({ fout: 'geen voorstel met deze sleutel' });
        if (actie === 'afwijzen') {
          const reden = String(body.reden || '');
          await redis(['HSET', AFGEWEZEN, k + '@' + tijd, JSON.stringify({ ...r, sleutel: k, stand: 'afgewezen', reden, afgewezen_tijd: tijd })]);
          await redis(['HDEL', VOORSTEL, k]);
          await log({ actie: 'afgewezen', sleutel: k, reden, door: naam(wie), tijd });
          return res.status(200).json({ ok: true, versie: await nieuweVersie() });
        }
        const nieuw = { ...r, stand: 'gepubliceerd', akkoord_tijd: tijd };
        if (typeof body.wordt === 'string') {
          if (body.wordt.length > MAX_TEKST) return res.status(400).json({ fout: 'tekst te lang' });
          nieuw.voorgesteld_wordt = r.wordt;
          nieuw.wordt = body.wordt;
        }
        await redis(['HDEL', VOORSTEL, k]);
        if (String(nieuw.wordt).trim() === String(nieuw.was).trim()) await redis(['HDEL', LAAG, k]);
        else await redis(['HSET', LAAG, k, JSON.stringify(nieuw)]);
        await log({ actie: 'akkoord', sleutel: k, ...nieuw, door: naam(wie) });
        return res.status(200).json({ ok: true, versie: await nieuweVersie() });
      }

      const wijzigingen = Array.isArray(body.wijzigingen) ? body.wijzigingen : [];
      if (!wijzigingen.length) return res.status(400).json({ fout: 'geen wijzigingen meegestuurd' });
      if (wijzigingen.length > 200) return res.status(400).json({ fout: 'te veel wijzigingen in één keer' });

      let bewaard = 0;
      const overgeslagen = [];
      for (const w of wijzigingen) {
        const k = String(w.sleutel || '');
        if (!k || typeof w.was !== 'string' || typeof w.wordt !== 'string') { overgeslagen.push({ sleutel: k, waarom: 'sleutel, was of wordt ontbreekt' }); continue; }
        if (w.was.length > MAX_TEKST || w.wordt.length > MAX_TEKST) { overgeslagen.push({ sleutel: k, waarom: 'tekst te lang' }); continue; }

        const voorstel = wie === 'agent' || String(w.stand || '') === 'voorgesteld';
        const gepubliceerd = await haal(LAAG, k);
        if (voorstel && gepubliceerd && w.was.trim() !== String(gepubliceerd.wordt).trim()) {
          overgeslagen.push({ sleutel: k, waarom: 'was klopt niet met de gepubliceerde laagregel', gepubliceerd: gepubliceerd.wordt });
          continue;
        }

        const regel = {
          was: w.was, wordt: w.wordt, hoofdstuk: String(w.hoofdstuk || ''), tijd,
          stand: voorstel ? 'voorgesteld' : 'gepubliceerd',
          wie: naam(wie),
          bron: String(w.bron || ''),
        };
        if (voorstel) await redis(['HSET', VOORSTEL, k, JSON.stringify(regel)]);
        else if (w.wordt.trim() === w.was.trim()) await redis(['HDEL', LAAG, k]);
        else await redis(['HSET', LAAG, k, JSON.stringify(regel)]);
        await log({ actie: voorstel ? 'voorgesteld' : 'bewaard', sleutel: k, ...regel, door: naam(wie) });
        bewaard++;
      }
      return res.status(200).json({ ok: true, bewaard, overgeslagen, versie: await nieuweVersie() });
    } catch (e) {
      return res.status(500).json({ fout: String((e && e.message) || e) });
    }
  };
}

module.exports = maak;
module.exports.maak = maak;
