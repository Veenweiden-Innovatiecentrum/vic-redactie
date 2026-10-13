#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""De redactietafel vanuit de chat: voorstellen, beoordelen, overzien.

Het instrument waarmee een sessie (een projectmanager, of de redacteur via een
sessie) met de tekstlaag praat zonder scherm. Het kent de tekst zoals de lezer
hem ziet (de gebouwde site plus de gepubliceerde laag), geeft elk blok zijn
sleutel, en praat met /api/tekstlaag in dezelfde taal als de redactiemodus.

Vanuit de wortel van de documentrepo (waar redactie.json staat):

    tafel.py stand                        wat ligt er: voorgesteld, gepubliceerd, afgewezen
    tafel.py blok 6.2/3                   één blok, zoals de lezer hem nu ziet
    tafel.py zoek "beproefde bouwstenen"  welk blok draagt deze woorden
    tafel.py voorstel 6.2/3 --wordt "..." --bron "Wim, gesprek 23-09 [36:07]"
    tafel.py voorstel 6.2/3 --weg --bron "..."         het blok weghalen
    tafel.py voorstel --uit voorstellen.json           meerdere tegelijk: [{sleutel, wordt, bron}]
    tafel.py akkoord 6.2/3 [--wordt "eigen formulering van de redacteur"]
    tafel.py afwijzen 6.2/3 --reden "..."
    tafel.py intrek 6.2/3                              eigen voorstel terugnemen
    tafel.py logboek                                   de beslissingen, voor de terugkoppeling

Waar hij tegen praat: `site` uit redactie.json, te overschrijven met --site of
REDACTIE_SITE (bv. http://localhost:18630 voor de lokale server). De sleutel komt
uit REDACTIE_AGENT_SLEUTEL (agent: mag alleen voorstellen) of REDACTIE_WACHTWOORD
(redacteur: mag alles); de redacteur wint als beide gezet zijn, tenzij
--als agent het anders zegt.

Een voorstel draagt altijd `was`: de tekst zoals de lezer hem nu ziet. Dit script
haalt die zelf op, dus je geeft alleen de sleutel, de nieuwe tekst en de bron.
`zoek` en `blok` werken alleen bij soort html (een statische pagina); bij een
React-lezer (soort md) is de laag zelf de enige bron van `was`.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from laag import Endpoint, lees_instellingen, blokken_in_html, sleutel_uit_omgeving  # noqa: E402


class Tafel:
    def __init__(self, cfg, site, sleutel, rol):
        self.cfg = cfg
        self.ep = Endpoint(site, sleutel)
        self.rol = rol
        self._laag = None
        self._bron = None

    def laag(self):
        if self._laag is None:
            self._laag = self.ep.laag()
            if self.ep.sleutel and 'voorgesteld' not in self._laag:
                sys.exit('de sleutel wordt niet herkend: zet REDACTIE_AGENT_SLEUTEL of REDACTIE_WACHTWOORD')
        return self._laag

    def bron(self):
        if self.cfg['soort'] != 'html':
            sys.exit('zoek en blok werken alleen bij een statische HTML-pagina (soort html)')
        if self._bron is None:
            self._bron = blokken_in_html(self.ep.pagina(), self.cfg['telling'])
        return self._bron

    def zichtbaar(self, sleutel):
        """Bron plus gepubliceerde laag: wat de lezer nu ziet."""
        if self.cfg['soort'] == 'html':
            b = self.bron().get(sleutel)
            if not b:
                return None
            regel = (self.laag().get('blokken') or {}).get(sleutel)
            if regel and regel.get('was', '').strip() == b['tekst'].strip():
                return {'hoofdstuk': b['hoofdstuk'], 'tekst': regel['wordt'], 'laag': regel}
            return {'hoofdstuk': b['hoofdstuk'], 'tekst': b['tekst'], 'laag': None}
        regel = (self.laag().get('blokken') or {}).get(sleutel)
        if regel:
            return {'hoofdstuk': regel.get('hoofdstuk', ''), 'tekst': regel['wordt'], 'laag': regel}
        return None

    def stand(self):
        l = self.laag()
        v, g, a = l.get('voorgesteld') or {}, l.get('blokken') or {}, l.get('afgewezen') or {}
        print(f'Laag versie {l.get("versie")} op {self.ep.site}' + (f' (als {l.get("rol")})' if l.get('rol') else ''))
        print(f'\nVOORGESTELD — {len(v)} regel(s) wachten op de redacteur')
        for k, r in sorted(v.items()):
            print(f'  {k}  door {r.get("wie", "?")}, {r.get("tijd", "")[:16]}' + (f'  bron: {r["bron"]}' if r.get('bron') else ''))
            print(f'      nu:    {r.get("was", "")[:120]}')
            print(f'      wordt: {(r.get("wordt") or "(weggehaald)")[:120]}')
        print(f'\nGEPUBLICEERD — {len(g)} regel(s) liggen over de tekst, nog niet in de bron')
        for k, r in sorted(g.items()):
            print(f'  {k}  door {r.get("wie", "redacteur")}, {r.get("tijd", "")[:16]}' + (f'  bron: {r["bron"]}' if r.get('bron') else ''))
            print(f'      {(r.get("wordt") or "(weggehaald)")[:120]}')
        if a:
            print(f'\nAFGEWEZEN — {len(a)} regel(s), met reden')
            for k, r in sorted(a.items()):
                print(f'  {k.split("@")[0]}  {r.get("afgewezen_tijd", "")[:16]}  reden: {r.get("reden") or "(geen)"}')
        if not self.ep.sleutel:
            print('\n(zonder sleutel zie je alleen wat gepubliceerd is)')

    def blok(self, sleutel):
        z = self.zichtbaar(sleutel)
        if not z:
            sys.exit(f'geen blok met sleutel {sleutel}')
        print(f'{sleutel}  (sectie {z["hoofdstuk"]})')
        print(f'  zichtbaar: {z["tekst"]}')
        if z['laag']:
            print(f'  (via de laag; in de bron staat nog: {z["laag"]["was"][:120]})')
        v = (self.laag().get('voorgesteld') or {}).get(sleutel)
        if v:
            print(f'  voorstel van {v.get("wie")}' + (f' ({v["bron"]})' if v.get('bron') else '') + f': {v.get("wordt") or "(weghalen)"}')

    def zoek(self, woorden):
        w = woorden.lower()
        treffers = [(k, b) for k, b in self.bron().items() if w in b['tekst'].lower()]
        for k, b in treffers:
            print(f'{k}  {b["tekst"][:140]}')
        if not treffers:
            print('niets gevonden; let op: de tekst is plat, met **vet** en *cursief* als sterretjes')

    def voorstel(self, items):
        rij = []
        for it in items:
            z = self.zichtbaar(it['sleutel'])
            if not z:
                sys.exit(f'geen blok met sleutel {it["sleutel"]}')
            if it['wordt'].strip() == z['tekst'].strip():
                print(f'{it["sleutel"]}: wordt is gelijk aan wat er staat, overgeslagen')
                continue
            rij.append({'sleutel': it['sleutel'], 'hoofdstuk': z['hoofdstuk'], 'was': z['tekst'],
                        'wordt': it['wordt'], 'bron': it.get('bron', ''), 'stand': 'voorgesteld'})
        if not rij:
            return
        a = self.ep.vraag('/api/tekstlaag', {'wijzigingen': rij})
        print(f'{a.get("bewaard", 0)} voorstel(len) geplaatst, laag versie {a.get("versie")}')
        for o in a.get('overgeslagen') or []:
            print(f'  niet geplaatst: {o.get("sleutel")}: {o.get("waarom")}')

    def akkoord(self, sleutel, wordt=None):
        self._eis_redacteur()
        g = {'sleutel': sleutel}
        if wordt is not None:
            g['wordt'] = wordt
        a = self.ep.vraag('/api/tekstlaag?actie=akkoord', g)
        print(f'{sleutel}: gepubliceerd, iedereen leest dit nu zo (laag versie {a.get("versie")})')

    def afwijzen(self, sleutel, reden):
        self._eis_redacteur()
        a = self.ep.vraag('/api/tekstlaag?actie=afwijzen', {'sleutel': sleutel, 'reden': reden})
        print(f'{sleutel}: afgewezen, reden bewaard voor de terugkoppeling (laag versie {a.get("versie")})')

    def intrek(self, sleutel):
        a = self.ep.vraag('/api/tekstlaag?actie=vergeten', {'sleutel': sleutel, 'bak': 'voorstel'})
        print(f'{sleutel}: voorstel ingetrokken (laag versie {a.get("versie")})')

    def logboek(self):
        l = self.laag()
        rijen = []
        for k, r in (l.get('blokken') or {}).items():
            if r.get('akkoord_tijd'):
                rijen.append((r['akkoord_tijd'], 'akkoord', k, r))
        for k, r in (l.get('afgewezen') or {}).items():
            rijen.append((r.get('afgewezen_tijd', ''), 'afgewezen', k.split('@')[0], r))
        for tijd, wat, k, r in sorted(rijen, reverse=True):
            regel = f'{tijd[:16]}  {wat:9}  {k:8}'
            if r.get('bron'): regel += f'  bron: {r["bron"]}'
            if wat == 'afgewezen' and r.get('reden'): regel += f'  reden: {r["reden"]}'
            if wat == 'akkoord' and r.get('voorgesteld_wordt'): regel += '  (anders dan voorgesteld)'
            print(regel)
        if not rijen:
            print('nog geen beslissingen in de laag')

    def _eis_redacteur(self):
        if self.rol != 'redacteur':
            sys.exit('akkoord en afwijzen zijn aan de redacteur: zet REDACTIE_WACHTWOORD, of leg het de redacteur voor')


def main():
    p = argparse.ArgumentParser(description='De redactietafel vanuit de chat.')
    p.add_argument('--site')
    p.add_argument('--als', choices=['redacteur', 'agent'])
    sub = p.add_subparsers(dest='wat', required=True)
    sub.add_parser('stand'); sub.add_parser('logboek')
    s = sub.add_parser('blok'); s.add_argument('sleutel')
    s = sub.add_parser('zoek'); s.add_argument('woorden')
    s = sub.add_parser('voorstel')
    s.add_argument('sleutel', nargs='?'); s.add_argument('--wordt'); s.add_argument('--weg', action='store_true')
    s.add_argument('--bron', default=''); s.add_argument('--uit')
    s = sub.add_parser('akkoord'); s.add_argument('sleutel'); s.add_argument('--wordt')
    s = sub.add_parser('afwijzen'); s.add_argument('sleutel'); s.add_argument('--reden', required=True)
    s = sub.add_parser('intrek'); s.add_argument('sleutel')
    a = p.parse_args()

    cfg = lees_instellingen()
    site = a.site or cfg['site']
    if not site:
        sys.exit('geen site: zet "site" in redactie.json of geef --site')
    sleutel, rol = sleutel_uit_omgeving(a.als)
    if not sleutel and a.wat not in ('stand', 'blok', 'zoek'):
        sys.exit('geen sleutel: zet REDACTIE_AGENT_SLEUTEL (agent) of REDACTIE_WACHTWOORD (redacteur)')

    t = Tafel(cfg, site, sleutel, rol)
    if a.wat == 'stand': t.stand()
    elif a.wat == 'logboek': t.logboek()
    elif a.wat == 'blok': t.blok(a.sleutel)
    elif a.wat == 'zoek': t.zoek(a.woorden)
    elif a.wat == 'voorstel':
        if a.uit:
            with open(a.uit, encoding='utf-8') as f:
                items = json.load(f)
            for it in items:
                it.setdefault('wordt', '')
        else:
            if not a.sleutel or (a.wordt is None and not a.weg):
                sys.exit('geef een sleutel en --wordt "..." of --weg, of --uit bestand.json')
            items = [{'sleutel': a.sleutel, 'wordt': '' if a.weg else a.wordt, 'bron': a.bron}]
        t.voorstel(items)
    elif a.wat == 'akkoord': t.akkoord(a.sleutel, a.wordt)
    elif a.wat == 'afwijzen': t.afwijzen(a.sleutel, a.reden)
    elif a.wat == 'intrek': t.intrek(a.sleutel)


if __name__ == '__main__':
    main()
