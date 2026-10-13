#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Een document lokaal serveren, met de redactiemodus aan.

Gebruik, vanuit de wortel van de documentrepo: python3 <pakket>/py/serveer.py [poort]

Drie dingen die een kale `python3 -m http.server` niet doet:

- `Cache-Control: no-store` bij elk antwoord, anders blijft de browser de oude
  tekst tonen na een herbouw.
- `/__stamp`: de wijzigingstijd van de gebouwde inhoud; de pagina vraagt die op en
  herlaadt zichzelf zodra hij verandert.
- `/api/tekstlaag`: dezelfde tekstlaag als online (api/tekstlaag.js), maar dan in
  het JSON-bestand uit redactie.json (`laag`), met dezelfde drie standen en
  dezelfde acties. Lokaal is er geen wachtwoord: wie bij deze server kan, kan ook
  bij de bestanden. Wie de header x-redactie-sleutel meegeeft met de waarde van
  REDACTIE_AGENT_SLEUTEL, wordt als agent behandeld en kan alleen voorstellen.
  Elke bewaaractie van de redacteur laat een leesbaar spoor achter in
  <spoor>/redactie-<datum>.md.

De server zet in de pagina die hij uitlevert de vlag `VIC_HERZIENING`, waarop de
redactieknop verschijnt. Start hem los van je sessie: nohup python3 ... &
"""
import datetime, functools, http.server, json, os, socket, socketserver, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from laag import lees_instellingen  # noqa: E402

CFG = lees_instellingen()
VLAG = '<script>window.VIC_HERZIENING = true;</script>\n'


def stempel():
    paden = [CFG['index']] + ([CFG['bron']] if CFG['soort'] == 'html' else [])
    tijden = [os.path.getmtime(p) for p in paden if os.path.exists(p)]
    return f'{max(tijden):.3f}' if tijden else '0'


def lees_laag():
    try:
        with open(CFG['laag'], encoding='utf-8') as f:
            gegevens = json.load(f)
    except (OSError, ValueError):
        gegevens = {}
    gegevens.setdefault('versie', '0')
    gegevens.setdefault('blokken', {})
    gegevens.setdefault('voorgesteld', {})
    gegevens.setdefault('afgewezen', {})
    return gegevens


def schrijf_laag(gegevens):
    os.makedirs(os.path.dirname(CFG['laag']) or '.', exist_ok=True)
    with open(CFG['laag'], 'w', encoding='utf-8') as f:
        json.dump(gegevens, f, ensure_ascii=False, indent=1)


def rol_van(headers):
    sleutel = headers.get('x-redactie-sleutel') or ''
    agent = os.environ.get('REDACTIE_AGENT_SLEUTEL')
    return 'agent' if (agent and sleutel == agent) else 'redacteur'


def naam(rol):
    return 'projectmanager' if rol == 'agent' else 'redacteur'


def bewaar_in_laag(wijzigingen, rol='redacteur'):
    laag = lees_laag()
    tijd = datetime.datetime.now().isoformat(timespec='seconds')
    bewaard, overgeslagen = 0, []
    for w in wijzigingen:
        k = str(w.get('sleutel') or '')
        was, wordt = w.get('was'), w.get('wordt')
        if not k or not isinstance(was, str) or not isinstance(wordt, str):
            overgeslagen.append({'sleutel': k, 'waarom': 'sleutel, was of wordt ontbreekt'}); continue
        voorstel = rol == 'agent' or str(w.get('stand') or '') == 'voorgesteld'
        gepubliceerd = laag['blokken'].get(k)
        if voorstel and gepubliceerd and was.strip() != str(gepubliceerd.get('wordt', '')).strip():
            overgeslagen.append({'sleutel': k, 'waarom': 'was klopt niet met de gepubliceerde laagregel',
                                 'gepubliceerd': gepubliceerd.get('wordt')}); continue
        regel = {'was': was, 'wordt': wordt, 'hoofdstuk': str(w.get('hoofdstuk') or ''), 'tijd': tijd,
                 'stand': 'voorgesteld' if voorstel else 'gepubliceerd', 'wie': naam(rol), 'bron': str(w.get('bron') or '')}
        if voorstel: laag['voorgesteld'][k] = regel
        elif wordt.strip() == was.strip(): laag['blokken'].pop(k, None)
        else: laag['blokken'][k] = regel
        bewaard += 1
    laag['versie'] = str(int(laag.get('versie') or 0) + 1)
    schrijf_laag(laag)
    return bewaard, overgeslagen, laag['versie']


def beslis(actie, gegevens):
    laag = lees_laag()
    k = str(gegevens.get('sleutel') or '')
    r = laag['voorgesteld'].pop(k, None)
    if not r:
        raise ValueError('geen voorstel met deze sleutel')
    tijd = datetime.datetime.now().isoformat(timespec='seconds')
    if actie == 'afwijzen':
        laag['afgewezen'][f'{k}@{tijd}'] = {**r, 'sleutel': k, 'stand': 'afgewezen',
                                            'reden': str(gegevens.get('reden') or ''), 'afgewezen_tijd': tijd}
    else:
        nieuw = {**r, 'stand': 'gepubliceerd', 'akkoord_tijd': tijd}
        if isinstance(gegevens.get('wordt'), str):
            nieuw['voorgesteld_wordt'] = r['wordt']; nieuw['wordt'] = gegevens['wordt']
        if nieuw['wordt'].strip() == nieuw['was'].strip(): laag['blokken'].pop(k, None)
        else: laag['blokken'][k] = nieuw
    laag['versie'] = str(int(laag.get('versie') or 0) + 1)
    schrijf_laag(laag)
    return laag['versie']


def schrijf_spoor(wijzigingen):
    dag = datetime.date.today().isoformat()
    pad = os.path.join(CFG['spoor'], f'redactie-{dag}.md')
    nieuw = not os.path.exists(pad)
    klok = datetime.datetime.now().strftime('%H:%M')
    regels = []
    if nieuw:
        regels += [f'# Redactiecorrecties van {dag}', '',
                   '*Getypt in de redactiemodus en bewaard in de tekstlaag. verwerk.py',
                   'schrijft ze in de bron bij; dit bestand is het spoor en niet de bron.*', '']
    regels += [f'## {klok} — {len(wijzigingen)} wijziging(en)', '']
    for w in wijzigingen:
        regels += [f'- **{w.get("sleutel", "?")}**', '',
                   '  **was:**', '', '  > ' + (w.get('was') or '').replace('\n', ' '), '',
                   '  **wordt:**', '', '  > ' + (w.get('wordt') or '(weggehaald)').replace('\n', ' '), '']
    os.makedirs(CFG['spoor'], exist_ok=True)
    with open(pad, 'a', encoding='utf-8') as f:
        f.write('\n'.join(regels) + '\n')
    return pad


class GeenCache(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        pad = self.path.split('?')[0]
        if pad != '/api/tekstlaag':
            self.send_error(404); return
        try:
            lengte = int(self.headers.get('Content-Length') or 0)
            gegevens = json.loads(self.rfile.read(lengte) or b'{}')
            rol = rol_van(self.headers)
            if 'actie=vergeten' in self.path:
                laag = lees_laag()
                bak = 'voorgesteld' if str(gegevens.get('bak') or '') == 'voorstel' else 'blokken'
                if gegevens.get('sleutel'):
                    k = str(gegevens['sleutel'])
                    if rol == 'agent' and (bak != 'voorgesteld' or laag[bak].get(k, {}).get('wie') != naam('agent')):
                        raise ValueError('de agent mag alleen een eigen voorstel intrekken')
                    laag[bak].pop(k, None)
                else:
                    if rol == 'agent': raise ValueError('een hele bak wissen kan alleen de redacteur')
                    laag[bak] = {}
                laag['versie'] = str(int(laag.get('versie') or 0) + 1)
                schrijf_laag(laag)
                antwoord = {'ok': True, 'versie': laag['versie']}
            elif 'actie=akkoord' in self.path or 'actie=afwijzen' in self.path:
                if rol == 'agent': raise ValueError('akkoord of afwijzen is aan de redacteur')
                antwoord = {'ok': True, 'versie': beslis('afwijzen' if 'actie=afwijzen' in self.path else 'akkoord', gegevens)}
            else:
                wijzigingen = gegevens.get('wijzigingen') or []
                if not wijzigingen: raise ValueError('geen wijzigingen meegestuurd')
                bewaard, overgeslagen, versie = bewaar_in_laag(wijzigingen, rol)
                if rol != 'agent': schrijf_spoor(wijzigingen)
                antwoord = {'ok': True, 'bewaard': bewaard, 'overgeslagen': overgeslagen, 'versie': versie}
                print(f'tekstlaag: {bewaard} blok(ken) bewaard door {naam(rol)}, versie {versie}')
        except Exception as e:
            body = json.dumps({'ok': False, 'fout': str(e)}).encode(); self.send_response(400)
            print(f'tekstlaag: mislukt — {e}')
        else:
            body = json.dumps(antwoord).encode(); self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        pad = self.path.split('?')[0]
        if pad == '/__stamp':
            self._stuur(stempel().encode(), 'text/plain; charset=utf-8'); return
        if pad == '/api/tekstlaag':
            laag = lees_laag()
            if not self.headers.get('x-redactie-sleutel'):
                laag = {'versie': laag['versie'], 'blokken': laag['blokken']}
            else:
                laag['rol'] = rol_van(self.headers)
            self._stuur(json.dumps(laag, ensure_ascii=False).encode(), 'application/json; charset=utf-8'); return
        if pad in ('/', '/index.html'):
            try:
                html = open(CFG['index'], encoding='utf-8').read()
            except OSError:
                self.send_error(404, f'{CFG["index"]} niet gevonden — bouw eerst'); return
            self._stuur(html.replace('</head>', VLAG + '</head>', 1).encode('utf-8'), 'text/html; charset=utf-8'); return
        super().do_GET()

    def _stuur(self, body, soort):
        self.send_response(200)
        self.send_header('Content-Type', soort)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache'); self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    poort = int(sys.argv[1]) if len(sys.argv) > 1 else int(CFG['poort'])
    handler = functools.partial(GeenCache, directory=CFG['webapp'])
    with Server(('0.0.0.0', poort), handler) as httpd:
        print(f'Het document staat klaar op poort {poort} (host {socket.gethostname()}).')
        print(f'Redactiemodus bewaart naar {CFG["laag"]}; live herladen staat aan.')
        httpd.serve_forever()
