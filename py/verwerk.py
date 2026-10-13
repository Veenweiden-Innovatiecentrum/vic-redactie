#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""De gepubliceerde correcties uit de tekstlaag bijschrijven in de bron.

Wat de redacteur in de redactiemodus bewaart of goedkeurt, staat meteen online:
de tekstlaag ligt over de gepubliceerde tekst en iedereen leest zijn versie. Maar
de bron van het document staat in git en die moet blijven kloppen, anders zegt de
repo iets anders dan de site. Dit script is de brug: het schrijft de laag in de
bron bij. Daarna klopt `was` niet meer met de gepubliceerde tekst en dooft de
laagregel uit zichzelf.

Gebruik, vanuit de wortel van de documentrepo (waar redactie.json staat):

    python3 <pakket>/py/verwerk.py                      lokaal, alleen kijken
    python3 <pakket>/py/verwerk.py --schrijf            lokaal, en toepassen
    python3 <pakket>/py/verwerk.py --van https://<site>
    python3 <pakket>/py/verwerk.py --van <url> --schrijf --opruimen

Twee soorten bron (redactie.json, `soort`):
  html  één bestand; blokken via `telling`, vet en cursief gaan als <b>/<i> terug.
  md    een map met Markdown-bestanden, één per hoofdstuk; de sleutel is
        "<bestand>#<plaats>" en de alinea wordt op platte tekst gezocht.

Wat het niet kan: een blok herstellen dat in de bron méér opmaak draagt dan vet
en cursief (een span, een link, een fiche). De browser levert die als platte
tekst, dus daar zou opmaak verloren gaan. Zulke regels worden gemeld en niet stil
platgeslagen; die verwerk je met de hand, met de melding als aanwijzing.

Voorstellen (stand "voorgesteld") komen alleen mee met REDACTIE_WACHTWOORD in de
omgeving, worden gemeld en nooit geschreven: alleen wat gepubliceerd is, gaat de
bron in. De herkomst van elke regel (wie, bron) staat in de melding en hoort in
de commit.
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from laag import (Endpoint, lees_instellingen, plat_html, plat_md, md_naar_html,  # noqa: E402
                  blokken_in_html, alleen_bi)


def haal_laag(cfg, van, wachtwoord):
    if van:
        return Endpoint(van, wachtwoord).laag()
    try:
        with open(cfg['laag'], encoding='utf-8') as f:
            return json.load(f)
    except OSError:
        return {'versie': '0', 'blokken': {}}


def vergeet(cfg, van, sleutel, wachtwoord):
    site = van or f'http://localhost:{cfg["poort"]}'
    return Endpoint(site, wachtwoord).vraag('/api/tekstlaag?actie=vergeten', {'sleutel': sleutel})


def lezing_van(attrs):
    klassen = (re.search(r'class="([^"]*)"', attrs) or [None, ''])[1].split()
    if 'lang' in klassen: return 'lang'
    if 'kort' in klassen: return 'kort'
    return ''


def md_alineas(tekst):
    uit, pos = [], 0
    for stuk in re.split(r'(\n\s*\n)', tekst):
        if stuk.strip() and not re.match(r'^\s*\n', stuk):
            uit.append((pos, pos + len(stuk), stuk))
        pos += len(stuk)
    return uit


def verwerk(cfg, laag, schrijven, van, wachtwoord, opruimen):
    voorgesteld = laag.get('voorgesteld') or {}
    if voorgesteld:
        print(f'VOORGESTELD — {len(voorgesteld)} regel(s) wachten op de redacteur en blijven buiten de bron:')
        for k, r in sorted(voorgesteld.items()):
            print(f'  {k}  door {r.get("wie", "?")}' + (f', bron: {r.get("bron")}' if r.get('bron') else ''))
            print(f'      {(str(r.get("wordt")) or "(weggehaald)")[:110]}')
        print('  (beoordelen: tafel.py akkoord|afwijzen, of in de chat)\n')
    blokken = laag.get('blokken') or {}
    if not blokken:
        print('De tekstlaag is leeg: er staat niets gepubliceerd dat nog niet in de bron zit.')
        return 0
    print(f'Tekstlaag versie {laag.get("versie")}, {len(blokken)} gepubliceerde regel(s).\n')

    gelukt, met_de_hand, niet_gevonden = [], [], []   # gelukt: (kop, pad, a, b, nieuw, sleutel, waarschuwing)

    if cfg['soort'] == 'html':
        pad = cfg['bron']
        bron = open(pad, encoding='utf-8').read()
        kandidaten = list(blokken_in_html(bron, cfg['telling'], met_positie=True).values())
        for sleutel, regel in sorted(blokken.items()):
            was, wordt = regel.get('was', ''), regel.get('wordt', '')
            herkomst = ', '.join(x for x in (regel.get('wie'), regel.get('bron')) if x)
            kop = f'{sleutel}  ({regel.get("tijd", "?")}' + (f'; {herkomst}' if herkomst else '') + ')'
            treffers = [k for k in kandidaten if k['tekst'] == ' '.join(str(was).split())]
            if len(treffers) != 1:
                niet_gevonden.append((kop, f'{len(treffers)} blok(ken) in {pad} passen op deze tekst'))
                continue
            k = treffers[0]
            nieuw = '' if not str(wordt).strip() else f'<{k["tag"]}{k["attrs"]}>{md_naar_html(wordt)}</{k["tag"]}>'
            waarschuwing = ''
            lezing = lezing_van(k['attrs'])
            if lezing:
                andere = 'kort' if lezing == 'lang' else 'lang'
                waarschuwing = f'let op: dit blok is de {lezing}e lezing — kijk of de {andere}e tweeling ernaast mee moet veranderen'
            if alleen_bi(k['binnen']) or not str(wordt).strip():
                gelukt.append((kop, pad, k['a'], k['b'], nieuw, sleutel, waarschuwing))
            else:
                met_de_hand.append((kop, pad, k['heel'], wordt, waarschuwing))
    else:
        for sleutel, regel in sorted(blokken.items()):
            hoofdstuk = regel.get('hoofdstuk') or sleutel.split('#')[0]
            pad = os.path.join(cfg['bron'], hoofdstuk + '.md')
            was, wordt = regel.get('was', ''), regel.get('wordt', '')
            herkomst = ', '.join(x for x in (regel.get('wie'), regel.get('bron')) if x)
            kop = f'{sleutel}  ({regel.get("tijd", "?")}' + (f'; {herkomst}' if herkomst else '') + ')'
            if not os.path.exists(pad):
                niet_gevonden.append((kop, f'{pad} bestaat niet'))
                continue
            bron = open(pad, encoding='utf-8').read()
            doel = plat_md(was)
            treffers = [(a, b, s) for a, b, s in md_alineas(bron) if plat_md(s) == doel]
            if len(treffers) != 1:
                niet_gevonden.append((kop, f'{len(treffers)} alinea(s) in {pad} passen op deze tekst'))
                continue
            a, b, stuk = treffers[0]
            schoon = stuk.strip() == plat_md(stuk)
            nieuw = '' if not wordt.strip() else stuk.replace(stuk.strip(), wordt.strip(), 1)
            if schoon or not wordt.strip():
                gelukt.append((kop, pad, a, b, nieuw, sleutel, ''))
            else:
                met_de_hand.append((kop, pad, stuk.strip(), wordt, ''))

    if gelukt:
        print(f'TOE TE PASSEN — {len(gelukt)} regel(s) staan één-op-één in de bron:')
        for kop, pad, _, _, nieuw, _, waarschuwing in gelukt:
            print(f'  {kop}  →  {pad}')
            print(f'      {((plat_html(nieuw) if cfg["soort"] == "html" else nieuw.strip()) or "(weggehaald)")[:110]}')
            if waarschuwing: print(f'      {waarschuwing}')
        print()
    if met_de_hand:
        print(f'MET DE HAND — {len(met_de_hand)} regel(s): het bronblok draagt méér opmaak')
        print('dan vet en cursief; zet die terug in plaats van haar te verliezen:')
        for kop, pad, oud, wordt, waarschuwing in met_de_hand:
            print(f'  {kop}  →  {pad}')
            print(f'      bron:   {oud[:110]}')
            print(f'      wordt:  {str(wordt)[:110]}')
            if waarschuwing: print(f'      {waarschuwing}')
        print()
    if niet_gevonden:
        print(f'NIET GEVONDEN — {len(niet_gevonden)} regel(s):')
        for kop, waarom in niet_gevonden:
            print(f'  {kop}: {waarom}')
        print('  (waarschijnlijk staat de correctie al in de bron)')
        print()

    if not schrijven:
        print('Niets geschreven. Wil je dat wel: --schrijf')
        return len(gelukt)

    per_bestand = {}
    for kop, pad, a, b, nieuw, sleutel, _ in gelukt:
        per_bestand.setdefault(pad, []).append((a, b, nieuw, sleutel))
    for pad, stukken in per_bestand.items():
        bron = open(pad, encoding='utf-8').read()
        for a, b, nieuw, _ in sorted(stukken, reverse=True):   # van achter naar voren
            bron = bron[:a] + nieuw + bron[b:]
        bron = re.sub(r'\n[ \t]*\n[ \t]*\n+', '\n\n', bron) if cfg['soort'] == 'html' else re.sub(r'\n{4,}', '\n\n\n', bron)
        open(pad, 'w', encoding='utf-8').write(bron)
        print(f'geschreven: {pad} ({len(stukken)} wijziging(en))')

    if opruimen:
        for _, _, _, _, _, sleutel, _ in gelukt:
            try:
                vergeet(cfg, van, sleutel, wachtwoord)
                print(f'uit de laag gehaald: {sleutel}')
            except Exception as e:
                print(f'kon {sleutel} niet uit de laag halen: {e}')
    else:
        print('\nDe laag is niet opgeruimd. Dat hoeft ook niet: zodra de nieuwe tekst')
        print('gepubliceerd is, klopt `was` niet meer en dooft de regel uit zichzelf.')
    print(f'\nHierna: {cfg.get("nabouw") or "bouwen"}, en dan committen en pushen met de bron van de regel in de titel.')
    return len(gelukt)


if __name__ == '__main__':
    args = sys.argv[1:]
    cfg = lees_instellingen()
    van = args[args.index('--van') + 1] if '--van' in args else None
    wachtwoord = os.environ.get('REDACTIE_WACHTWOORD', '')
    verwerk(cfg, haal_laag(cfg, van, wachtwoord), '--schrijf' in args, van, wachtwoord, '--opruimen' in args)
