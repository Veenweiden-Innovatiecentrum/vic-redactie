# vic-redactie — de redactietafel als bibliotheek

Eén pakket voor de tekstlaag en de redactiemodus van een VIC-document, zoals
`vic-huisstijl` dat is voor de huisstijl. Een documentrepo pint een git-tag en
levert alleen configuratie; het endpoint, het script in de pagina, de Python-
scripts en de skill komen hiervandaan. Ontstaan in `veenweide-visie` (augustus
2026), overgenomen in `melk-en-meer`, en in oktober 2026 hierheen gelicht toen
de twee kopieën begonnen uiteen te lopen.

## Het idee in vier regels

1. **De browser schrijft nooit in de bron.** De bron van een document staat in
   git, en de diff daar toont exact en alleen wat er veranderde.
2. **Een correctie is een laagregel** over de gepubliceerde tekst: de tekst zoals
   hij staat (`was`) en zoals hij moet worden (`wordt`). Iedereen die de pagina
   open heeft, leest hem binnen twintig seconden.
3. **Een laagregel dooft uit zichzelf.** Zodra een sessie hem in de bron heeft
   geschreven en er opnieuw is gebouwd, klopt `was` niet meer. Bron en laag
   kunnen niet stil uit elkaar lopen.
4. **Drie standen, twee sleutels.** Een regel is *voorgesteld* (alleen zichtbaar
   met een sleutel), *gepubliceerd*, of *afgewezen* met reden. De redacteur mag
   alles; een agent (bijvoorbeeld een projectmanager-sessie) mag alleen
   voorstellen. Elke regel draagt wie hem plaatste en uit welke bron hij komt.

## Installeren in een documentrepo

Het pakket heeft geen build-stap en geen dependencies. Installeer het in de map
die naar Vercel gaat (daar staat `package.json`), gepind op een tag:

```sh
cd webapp
npm install github:Veenweiden-Innovatiecentrum/vic-redactie#v0.1.0
```

Daarna vijf dingen, eenmalig:

**1. Het endpoint**, `webapp/api/tekstlaag.js`, drie regels:

```js
const maak = require('@veenweiden-innovatiecentrum/vic-redactie');
module.exports = maak({ prefix: 'mm:' });   // de prefix in Redis, per document anders
```

**2. Het script in de pagina**, onderaan, vóór `</body>`. Vercel serveert niets uit
`node_modules`, dus de bouwstap kopieert het bestand (`npx vic-redactie client
webapp/vic-redactie/laag.js`) en zet de telling erbij:

```html
<script src="vic-redactie/laag.js" data-config='{"telling":{...}}'></script>
```

Het script zet de knop, de balk en hun opmaak zelf neer. Kleuren volgen
`--vic-blue`, `--vic-green` en `--vic-red` uit vic-huisstijl als die er zijn.

**3. De instellingen**, `redactie.json` in de wortel van de repo:

```json
{
  "site": "https://melk-en-meer.veenweiden.online",
  "soort": "html",
  "bron": "voorstel.html",
  "webapp": "webapp",
  "index": "webapp/index.html",
  "laag": "werk/tekstlaag.json",
  "spoor": "werk",
  "poort": 18630,
  "nabouw": "python3 bouw.py",
  "telling": {
    "binnen": "main",
    "koppen": [ { "tag": "h2", "klasse": "sectie", "nummer": ".n" }, { "tag": "h4", "nummer": "span" } ],
    "blokken": [ "p", "li", "td" ],
    "eerste": "kop"
  }
}
```

`telling` zegt hoe de pagina haar blokken nummert: een kop zet de teller terug
en levert het nummer, elk ander element telt door, dus `3.2/4`. Het script in de
pagina en de Python-scripts lezen dezelfde structuur, zodat zij dezelfde
sleutels geven. `soort` is `html` (één bronbestand) of `md` (een map met één
Markdown-bestand per hoofdstuk, zoals de visie; de telling komt dan uit de lezer
zelf en de sleutel is `bestand#plaats`).

**4. De omgevingsvariabelen** op het Vercel-project: `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN` (Storage → Connect; één store mag meerdere documenten
dragen, de prefix houdt ze uit elkaar), `REDACTIE_WACHTWOORD` (de redacteur) en
`REDACTIE_AGENT_SLEUTEL` (de agent).

**5. De skill**, voor de repo van de sessie die voorstellen doet:
`npx vic-redactie skill` zet hem in `.claude/skills/redactietafel/`. Doe dit
opnieuw bij een nieuwe tag; Claude Code leest geen skills uit `node_modules`.

## De scripts

Alle drie draaien vanuit de wortel van de documentrepo en lezen `redactie.json`.
Een documentrepo houdt er meestal korte wrappers voor aan onder een eigen naam.

| Script | Wat |
|---|---|
| `py/verwerk.py` | De gepubliceerde laag in de bron bijschrijven. Deelt regels in: toe te passen, met de hand (het bronblok draagt meer opmaak dan vet en cursief), niet gevonden. Meldt voorstellen, schrijft ze nooit. `--van <site>`, `--schrijf`, `--opruimen`. |
| `py/tafel.py` | De tafel vanuit de chat: `stand`, `zoek`, `blok`, `voorstel`, `akkoord`, `afwijzen`, `intrek`, `logboek`. Sleutel uit `REDACTIE_AGENT_SLEUTEL` of `REDACTIE_WACHTWOORD`. |
| `py/serveer.py` | Lokale server met hetzelfde endpoint in een JSON-bestand, `/__stamp` voor autoverversen en een leesbaar spoor per dag. |

## Het endpoint

| | |
|---|---|
| `GET /api/tekstlaag` | `{ versie, blokken }`: alleen gepubliceerd, met randcaching |
| `GET` met `x-redactie-sleutel` | ook `voorgesteld`, `afgewezen` en `rol`; niet gecachet |
| `POST` `{ wijzigingen: [{ sleutel, hoofdstuk, was, wordt, bron?, stand? }] }` | redacteur publiceert (of stelt voor met `stand`), agent stelt altijd voor. Een voorstel op een verouderde `was` wordt geweigerd. |
| `POST ?actie=akkoord` `{ sleutel, wordt? }` | voorstel → gepubliceerd; met `wordt` is het de eigen formulering van de redacteur |
| `POST ?actie=afwijzen` `{ sleutel, reden }` | voorstel → afgewezen |
| `POST ?actie=vergeten` `{ sleutel?, bak? }` | wissen; de agent alleen een eigen voorstel |

Opslag in Redis: `<prefix>laag`, `<prefix>laag:voorstel`, `<prefix>laag:afgewezen`,
`<prefix>laag:log`, `<prefix>laag:versie`.

## Zelftest en release

`npm test` draait `scripts/check.mjs`: het endpoint tegen een nep-Redis, alle
rollen en standen, kale Node. Faalt hard.

Release = versie ophogen in `package.json` (nieuwe mogelijkheden minor, fixes
patch), mergen, git-tag `vX.Y.Z`. Apps pinnen op de tag. Een wijziging aan de
telling of aan het laagformaat is een minor en vraagt om `bouwen` in elke
documentrepo die de tag ophoogt.

## Wat er bewust niet in zit

- Geen scherm. De tafel is een chatgesprek plus de redactiemodus in de pagina.
- Geen login. Toegang gaat met twee sleutels; wie typt heet "redacteur" of
  "projectmanager". Koppeling aan `vic-login` is de volgende stap en verandert
  dit pakket, niet de documentrepo's.
- Geen structuurwerk. Toevoegen, verplaatsen of een kop maken is bronwerk voor
  een sessie; de laag zegt dat en verzint er geen lapmiddel voor.
