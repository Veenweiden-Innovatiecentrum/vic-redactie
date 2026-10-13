# -*- coding: utf-8 -*-
"""Gedeelde onderdelen van de Python-kant van vic-redactie.

- de instellingen van een documentrepo (`redactie.json`);
- platte tekst zoals de browser hem teruggeeft;
- de telling van blokken in een HTML-bron, dezelfde als client/laag.js;
- praten met het endpoint.

Instellingen (`redactie.json` in de wortel van de documentrepo):

    {
      "site": "https://melk-en-meer.veenweiden.online",
      "soort": "html",                       html: één bronbestand; md: een map met Markdown
      "bron": "voorstel.html",               of bij md de map, bv. "content"
      "webapp": "webapp",                    de map die naar Vercel gaat
      "index": "webapp/index.html",          de gebouwde pagina
      "laag": "werk/tekstlaag.json",         de lokale laag
      "spoor": "werk",                       map voor redactie-<datum>.md
      "poort": 18630,
      "nabouw": "python3 bouw.py",           wat er na het schrijven in de bron moet draaien
      "telling": { ... }                     zie hieronder; alleen bij soort html
    }

`telling` beschrijft hoe een pagina haar blokken telt, en is letterlijk dezelfde
structuur die client/laag.js leest:

    { "binnen": "main",
      "koppen": [ { "tag": "h2", "klasse": "sectie", "nummer": ".n" }, { "tag": "h4", "nummer": "span" } ],
      "blokken": [ "p", "li", "td" ],
      "eerste": "kop" }

Een kop zet de teller terug en levert het nummer uit het element dat `nummer`
aanwijst (alleen een tagnaam of een klasse: ".n", "span", "span.nummer"); elk
ander element telt door; vóór de eerste kop heet het `eerste`.
"""
import html as htmlmod
import json, os, re, sys, urllib.error, urllib.request

STANDAARD_TELLING = {
    'binnen': 'main',
    'koppen': [{'tag': 'h2', 'klasse': 'sectie', 'nummer': '.n'}, {'tag': 'h4', 'nummer': 'span'}],
    'blokken': ['p', 'li', 'td'],
    'eerste': 'kop',
}


def lees_instellingen(pad=None):
    pad = pad or os.environ.get('REDACTIE_INSTELLINGEN') or 'redactie.json'
    try:
        with open(pad, encoding='utf-8') as f:
            cfg = json.load(f)
    except OSError:
        sys.exit(f'{pad} niet gevonden; draai dit vanuit de wortel van de documentrepo, of zet REDACTIE_INSTELLINGEN')
    cfg.setdefault('soort', 'html')
    cfg.setdefault('webapp', 'webapp')
    cfg.setdefault('index', os.path.join(cfg['webapp'], 'index.html'))
    cfg.setdefault('laag', 'werk/tekstlaag.json')
    cfg.setdefault('spoor', os.path.dirname(cfg['laag']) or '.')
    cfg.setdefault('poort', 18630)
    cfg.setdefault('telling', STANDAARD_TELLING)
    cfg['site'] = os.environ.get('REDACTIE_SITE') or cfg.get('site') or ''
    return cfg


# ---- platte tekst --------------------------------------------------------

def plat_html(binnen):
    """De binnenkant van een HTML-blok zoals de browser hem als `was` teruggeeft:
    b/strong naar **, i/em naar *, andere tags weg, entiteiten uitgepakt."""
    t = re.sub(r'<(b|strong)\b[^>]*>(.*?)</\1>', r'**\2**', binnen, flags=re.S)
    t = re.sub(r'<(i|em)\b[^>]*>(.*?)</\1>', r'*\2*', t, flags=re.S)
    t = re.sub(r'<[^>]+>', '', t)
    t = htmlmod.unescape(t)
    return ' '.join(t.split())


def plat_md(tekst):
    """Een Markdown-alinea zoals de React-lezer van de visie hem toont: markdown en
    HTML weg, witruimte gelijkgetrokken. (Daar levert de browser geen sterretjes.)"""
    t = re.sub(r'<[^>]+>', '', tekst)
    t = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', t)
    t = re.sub(r'\{\{[^}]*\}\}', '', t)
    t = t.replace('**', '').replace('__', '')
    t = re.sub(r'(?<!\w)[*_`](?=\S)|(?<=\S)[*_`](?!\w)', '', t)
    return ' '.join(t.split())


def md_naar_html(t):
    s = str(t).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    s = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(^|[^*])\*([^*\s][^*]*)\*(?!\*)', r'\1<i>\2</i>', s)
    return s


# ---- de telling in een HTML-bron -----------------------------------------

def _klassen(attrs):
    m = re.search(r'class="([^"]*)"', attrs)
    return (m.group(1) if m else '').split()


def _nummer_uit(binnen, aanwijzing):
    """`nummer` is een tagnaam, een klasse (".n") of allebei ("span.n")."""
    if not aanwijzing:
        return None
    tag, _, klasse = aanwijzing.partition('.')
    tag = tag or r'[a-zA-Z0-9]+'
    for m in re.finditer(r'<(%s)\b([^>]*)>(.*?)</\1>' % tag, binnen, re.S):
        if not klasse or klasse in _klassen(m.group(2)):
            return plat_html(m.group(3))
    return None


def blokken_in_html(tekst, telling=None, met_positie=False):
    """Spiegel van de telling in client/laag.js. Geeft {sleutel: {hoofdstuk, tekst}}
    of, met `met_positie`, {sleutel: {hoofdstuk, tekst, a, b, tag, attrs, binnen, heel}}
    met de posities in `tekst`, zodat verwerk.py erin kan schrijven."""
    t = telling or STANDAARD_TELLING
    binnen_tag = t.get('binnen') or 'main'
    begin = tekst.index('<' + binnen_tag)
    einde = tekst.index('</' + binnen_tag + '>')
    deel = tekst[begin:einde]
    koppen = {h['tag']: h for h in t['koppen']}
    tags = '|'.join(sorted(set(list(koppen) + list(t['blokken']))))
    uit, huidig, teller = {}, t.get('eerste', 'kop'), 0
    for m in re.finditer(r'<(%s)\b([^>]*)>(.*?)</\1>' % tags, deel, re.S):
        tag, attrs, inhoud = m.group(1), m.group(2), m.group(3)
        if tag in koppen:
            h = koppen[tag]
            if h.get('klasse') and h['klasse'] not in _klassen(attrs):
                if tag not in t['blokken']:
                    continue
            else:
                n = _nummer_uit(inhoud, h.get('nummer'))
                if n is None and not h.get('nummer'):
                    idm = re.search(r'id="([^"]*)"', attrs)
                    n = idm.group(1) if idm else '?'
                if n is not None:
                    huidig, teller = n, 0
                continue
        if tag not in t['blokken']:
            continue
        teller += 1
        sleutel = f'{huidig}/{teller}'
        rec = {'hoofdstuk': huidig, 'tekst': plat_html(inhoud)}
        if met_positie:
            rec.update({'a': begin + m.start(), 'b': begin + m.end(), 'tag': tag, 'attrs': attrs,
                        'binnen': inhoud, 'heel': m.group(0)})
        uit[sleutel] = rec
    return uit


def alleen_bi(binnen):
    """Waar: dit blok draagt geen andere opmaak dan vet en cursief, dus de platte
    tekst uit de laag kan zonder verlies terug."""
    kaal = re.sub(r'</?(b|strong|i|em)\b[^>]*>', '', binnen)
    return not re.search(r'<[a-zA-Z]', kaal)


# ---- het endpoint ----------------------------------------------------------

class Endpoint:
    def __init__(self, site, sleutel=''):
        self.site = site.rstrip('/')
        self.sleutel = sleutel

    def vraag(self, pad, gegevens=None):
        kop = {'Content-Type': 'application/json'}
        if self.sleutel:
            kop['x-redactie-sleutel'] = self.sleutel
        data = json.dumps(gegevens).encode() if gegevens is not None else None
        req = urllib.request.Request(self.site + pad, data=data, headers=kop, method='POST' if data else 'GET')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                fout = json.loads(e.read()).get('fout')
            except Exception:
                fout = str(e)
            sys.exit(f'de tafel antwoordde {e.code}: {fout}')

    def laag(self):
        return self.vraag('/api/tekstlaag')

    def pagina(self):
        req = urllib.request.Request(self.site + '/', headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode('utf-8')


def sleutel_uit_omgeving(als=None):
    """Welke sleutel, en welke rol. De redacteur wint als beide gezet zijn,
    tenzij `als` het anders zegt."""
    redacteur = os.environ.get('REDACTIE_WACHTWOORD', '')
    agent = os.environ.get('REDACTIE_AGENT_SLEUTEL', '')
    if als == 'redacteur' or (als is None and redacteur):
        return redacteur, ('redacteur' if redacteur else '')
    return agent, ('agent' if agent else '')
