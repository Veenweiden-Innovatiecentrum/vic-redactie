/* vic-redactie — de tekstlaag en de redactiemodus, voor in de pagina.
   Overgenomen uit de lezer van veenweide-visie en het voorstel van melk-en-meer.

   Eén scripttag onderaan de pagina is genoeg:

     <script src="vic-redactie/laag.js" data-config='{ ... }'></script>

   De knop, de balk en hun opmaak zet dit script zelf neer. De instellingen komen
   uit data-config (JSON) of window.VIC_REDACTIE_CONFIG; wat ontbreekt krijgt een
   standaardwaarde. `telling` is dezelfde structuur die py/laag.py leest, zodat
   pagina en scripts dezelfde sleutels geven:

     binnen    de omheining van de telling (standaard "main"); niet nodig als de
               selectors van koppen en blokken al volledig zijn
     koppen    [{tag, klasse?, nummer?}] voor een statische pagina: een kop zet de
               teller terug en levert het nummer uit het element dat `nummer`
               aanwijst; of [{selector, attribuut}] voor een lezer die zijn
               hoofdstukken als sectie met een attribuut draagt (de visie:
               [data-hoofdstuk]); dan telt alles binnen die sectie
     blokken   tagnamen ("p") of volledige selectors ("[data-nt-sectie] p")
     tekstDivs true: een div telt mee als hij zelf tekst draagt en geen blok bevat
     eerste    de naam vóór de eerste kop (standaard "kop")
     scheider  tussen kop en plaats, standaard "/" (de visie: "#")
     vanaf     eerste plaats, standaard 1 (de visie: 0)
     plat      "md" (standaard): vet en cursief gaan als **zo** en *zo* mee in de
               laag en komen als <b>/<i> terug; "tekst": alleen de platte tekst,
               zoals de visie het altijd deed
     wachtOp   selector waarop het script wacht voor het begint (een lezer die
               zijn tekst nog moet opbouwen, zoals React)
     volgDom   true: bij elke verandering in de pagina opnieuw tellen en de laag
               opnieuw leggen (een lezer die herrendert, zoals bij lang/kort)

   Wat het doet. De laag wordt bij het openen opgehaald en daarna elke twintig
   seconden; een gepubliceerde regel wordt over de tekst gelegd zodra `was` nog
   klopt met wat er staat. Wie de sleutel heeft (lokaal altijd via window.VIC_HERZIENING,
   online met ?redactie=<wachtwoord>) krijgt de redactiemodus: typen in de tekst,
   Bewaren publiceert. Voorstellen van een agent worden niet over de tekst gelegd
   maar geteld en rood gemarkeerd; beoordelen gaat via de redactietafel (py/tafel.py). */
(function(){
  'use strict';

  /* ---- instellingen ---- */
  var eigen = document.currentScript;
  var cfg = {};
  try { cfg = JSON.parse((eigen && eigen.getAttribute('data-config')) || '{}'); } catch (e) { cfg = {}; }
  if (window.VIC_REDACTIE_CONFIG) { for (var k in window.VIC_REDACTIE_CONFIG) cfg[k] = window.VIC_REDACTIE_CONFIG[k]; }
  var LAAG_PAD = cfg.pad || '/api/tekstlaag';
  var SLEUTELNAAM = cfg.sleutelnaam || 'vic-redactie-sleutel';
  var COOKIENAAM = cfg.cookienaam || 'vicRedactie';
  var INTERVAL = cfg.interval || 20000;
  var T = cfg.telling || {};
  var TELLING = {
    binnen: T.binnen !== undefined ? T.binnen : 'main',
    koppen: T.koppen || [{ tag: 'h2', klasse: 'sectie', nummer: '.n' }, { tag: 'h4', nummer: 'span' }],
    blokken: T.blokken || ['p', 'li', 'td'],
    tekstDivs: !!T.tekstDivs,
    eerste: T.eerste || 'kop',
    scheider: T.scheider || '/',
    vanaf: T.vanaf !== undefined ? T.vanaf : 1,
    plat: T.plat || 'md',
    wachtOp: T.wachtOp || '',
    volgDom: !!T.volgDom
  };
  var TEKST = Object.assign({
    knop: 'Redactiemodus', knopAan: 'Redactiemodus staat aan', bewaren: 'Bewaren',
    kopieer: 'Kopieer wijzigingen', reset: 'Alles terugzetten', gewijzigd: 'gewijzigd',
    bewaard: 'bewaard — iedereen leest dit nu zo'
  }, cfg.tekst || {});

  /* ---- de sleutel: localStorage én een cookie van 180 dagen ----
     Reden (visie, 27-8): bij Tim verdween de balk bij elke ververs omdat zijn browser
     localStorage niet vasthield. ?redactie= (leeg) wist bewust allebei. */
  function leesCookie(){
    try { var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIENAAM + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; }
  }
  function schrijfCookie(w){
    try {
      if (w) document.cookie = COOKIENAAM + '=' + encodeURIComponent(w) + ';path=/;max-age=' + (60*60*24*180) + ';SameSite=Lax';
      else document.cookie = COOKIENAAM + '=;path=/;max-age=0;SameSite=Lax';
    } catch (e) {}
  }
  function redactieSleutel(){
    var uit = null;
    try { uit = new URLSearchParams(location.search).get('redactie'); } catch (e) {}
    if (uit !== null) {
      try { if (uit) localStorage.setItem(SLEUTELNAAM, uit); else localStorage.removeItem(SLEUTELNAAM); } catch (e) {}
      schrijfCookie(uit);
    }
    var s = '';
    try { s = localStorage.getItem(SLEUTELNAAM) || ''; } catch (e) {}
    if (!s) { s = leesCookie(); if (s) { try { localStorage.setItem(SLEUTELNAAM, s); } catch (e) {} } }
    else if (!leesCookie()) { schrijfCookie(s); }
    return s;
  }
  var BESCHIKBAAR = !!window.VIC_HERZIENING || !!redactieSleutel();

  /* ---- opmaak en balk: het script zet ze zelf neer ---- */
  var CSS = [
    ':root{--vr-accent:var(--vic-blue,var(--blauw,#1d3176));--vr-ok:var(--vic-green,var(--groen,#3ea635));',
    '--vr-rood:var(--vic-red,var(--rood,#cd1719));--vr-lijn:var(--grijslijn,#dcdcd8);--vr-grijs:var(--grijstekst,#6b6b66)}',
    '.vr-knop{position:fixed;left:22px;bottom:22px;z-index:31;display:inline-flex;padding:3px;background:#fff;border:1px solid var(--vr-lijn);border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.10)}',
    '.vr-knop button{font-family:inherit;font-size:12px;padding:5px 14px;border:0;border-radius:999px;background:transparent;color:var(--vr-grijs);cursor:pointer}',
    '.vr-knop button:hover{color:var(--vr-accent)}.vr-knop button.aan{background:var(--vr-accent);color:#fff;font-weight:500}',
    '.vr-balk{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--vr-accent);color:#fff;padding:9px 20px;display:none;align-items:center;gap:14px;flex-wrap:wrap;font-size:13px;font-family:inherit}',
    'body.redactie .vr-balk{display:flex}body.redactie .vr-knop{bottom:64px}body.redactie{padding-bottom:64px}',
    '.vr-balk button{font-family:inherit;font-size:12.5px;padding:6px 13px;border-radius:4px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;cursor:pointer}',
    '.vr-balk button:hover{background:rgba(255,255,255,.14)}.vr-balk button.prim{background:#fff;color:var(--vr-accent);border-color:#fff;font-weight:700}',
    '.vr-balk .teller{margin-left:auto;opacity:.85}.vr-balk .waarsch{opacity:.7;font-size:12px}',
    'body.redactie [data-blok]{outline:1px dashed var(--vr-lijn);outline-offset:3px;border-radius:2px}',
    'body.redactie [data-blok].voorgesteld{outline:2px solid var(--vr-rood);outline-offset:3px}',
    'body.redactie [data-blok]:focus{outline:2px solid var(--vr-ok);background:#fbfdfa}',
    '[data-blok].gewijzigd{background:#fdf8e3;box-shadow:-10px 0 0 #fdf8e3,10px 0 0 #fdf8e3}',
    '.vr-kopie{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:30px}',
    '.vr-kopie .doos{background:#fff;border-radius:6px;padding:20px;max-width:760px;width:100%;max-height:80vh;display:flex;flex-direction:column;gap:12px}',
    '.vr-kopie textarea{width:100%;flex:1;min-height:280px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;border:1px solid var(--vr-lijn);border-radius:4px;padding:12px;resize:none}',
    '.vr-kopie .rij{display:flex;gap:10px;align-items:center}.vr-kopie button{font-family:inherit;font-size:13px;padding:8px 16px;border-radius:4px;cursor:pointer}'
  ].join('\n');

  function el(tag, attrs, kinderen){
    var e = document.createElement(tag);
    for (var a in (attrs || {})) { if (a === 'text') e.textContent = attrs[a]; else e.setAttribute(a, attrs[a]); }
    (kinderen || []).forEach(function(k){ e.appendChild(k); });
    return e;
  }
  document.head.appendChild(el('style', { text: CSS }));
  var knop = el('button', { type: 'button', id: 'vrToggle', text: TEKST.knop });
  var knopDiv = el('div', { 'class': 'vr-knop' }, [knop]);
  var bewaarKnop = el('button', { type: 'button', 'class': 'prim', text: TEKST.bewaren });
  var tellerEl = el('span', { text: '0 ' + TEKST.gewijzigd });
  var kopieerKnop = el('button', { type: 'button', text: TEKST.kopieer });
  var resetKnop = el('button', { type: 'button', text: TEKST.reset });
  var voorstelEl = el('span', { 'class': 'waarsch' });
  var meldEl = el('span', { 'class': 'teller' });
  var balk = el('div', { 'class': 'vr-balk' }, [bewaarKnop, tellerEl, kopieerKnop, resetKnop, voorstelEl, meldEl]);
  document.body.appendChild(knopDiv); document.body.appendChild(balk);
  if (!BESCHIKBAAR) knopDiv.style.display = 'none';

  /* ---- platte tekst heen en terug ---- */
  function naarMd(e){
    if (TELLING.plat === 'tekst') return (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
    var k = e.cloneNode(true);
    k.querySelectorAll('b,strong').forEach(function(x){ x.replaceWith('**' + x.textContent + '**'); });
    k.querySelectorAll('i,em').forEach(function(x){ x.replaceWith('*' + x.textContent + '*'); });
    return k.textContent.replace(/\s+/g, ' ').trim();
  }
  function mdNaarHtml(t){
    var s = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<i>$2</i>');
    return s;
  }
  function zetTekst(e, wordt){
    if (TELLING.plat === 'tekst') e.textContent = wordt; else e.innerHTML = mdNaarHtml(wordt);
  }

  /* ---- de telling: elk blok een sleutel, kop + plaats ---- */
  function volledig(s){ return /[\[\s.#>:]/.test(s) || !TELLING.binnen ? s : TELLING.binnen + ' ' + s; }
  function kopSelector(h){ return h.selector || (h.tag + (h.klasse ? '.' + h.klasse : '')); }
  function isTekstDiv(e){
    if (e.tagName !== 'DIV') return true;
    if (!TELLING.tekstDivs) return false;
    if (e.querySelector('p, li, td, table, div, h1, h2, h3, h4, h5')) return false;
    return (e.innerText || '').trim().length > 0;
  }
  var kopSel = TELLING.koppen.map(function(h){ return volledig(kopSelector(h)); }).join(', ');
  var blokSel = TELLING.blokken.map(volledig).join(', ');
  var blokken = [], perSleutel = {};

  function stempel(){
    blokken = []; perSleutel = {};
    var huidig = TELLING.eerste, teller = TELLING.vanaf;
    var sectieKop = TELLING.koppen.some(function(h){ return h.selector && h.attribuut; });
    var alles = document.querySelectorAll(kopSel + ', ' + blokSel);
    alles.forEach(function(e){
      for (var i = 0; i < TELLING.koppen.length; i++) {
        var h = TELLING.koppen[i];
        if (e.matches(kopSelector(h))) {
          if (h.attribuut) { huidig = e.getAttribute(h.attribuut) || '?'; teller = TELLING.vanaf; return; }
          var n = h.nummer ? e.querySelector(h.nummer) : null;
          if (n) { huidig = n.textContent.trim(); teller = TELLING.vanaf; }
          else if (!h.nummer) { huidig = e.getAttribute('data-nummer') || e.id || '?'; teller = TELLING.vanaf; }
          return;
        }
      }
      if (!isTekstDiv(e)) return;
      if (sectieKop) {
        // een blok hoort bij de sectie waar het in staat, niet bij de laatst geziene
        var sec = null;
        for (var j = 0; j < TELLING.koppen.length && !sec; j++) if (TELLING.koppen[j].attribuut) sec = e.closest(TELLING.koppen[j].selector);
        var naam = sec ? (sec.getAttribute(TELLING.koppen[0].attribuut) || '?') : TELLING.eerste;
        if (naam !== huidig) { huidig = naam; teller = TELLING.vanaf; }
      }
      var sleutel = huidig + TELLING.scheider + teller; teller++;
      e.setAttribute('data-blok', sleutel);
      var md = e.dataset.laagWas !== undefined ? e.dataset.laagWas : naarMd(e);
      var b = { el: e, sleutel: sleutel, hoofdstuk: huidig, origineelMd: md, origineelHtml: e.dataset.laagWas !== undefined ? (e.dataset.laagOrigineel || e.innerHTML) : e.innerHTML, stand: naarMd(e) };
      blokken.push(b); perSleutel[sleutel] = b;
    });
  }

  /* ---- de laag toepassen: dit doet elke bezoeker ---- */
  var eigenWijziging = false;
  function pasToe(regels){
    eigenWijziging = true;
    blokken.forEach(function(b){
      var regel = regels[b.sleutel];
      if (!regel) {
        if (b.el.dataset.laagWas !== undefined) {
          b.el.innerHTML = b.origineelHtml; b.el.style.display = '';
          delete b.el.dataset.laagWas; delete b.el.dataset.laagOrigineel; b.stand = b.origineelMd;
        }
        return;
      }
      var gepubliceerd = b.el.dataset.laagWas !== undefined ? b.el.dataset.laagWas : naarMd(b.el);
      if (gepubliceerd.trim() !== String(regel.was).trim()) return;   // de bron is al bij
      if (b.el.dataset.laagWas === undefined) { b.el.dataset.laagWas = gepubliceerd; b.el.dataset.laagOrigineel = b.el.innerHTML; }
      if (!String(regel.wordt).trim()) { b.el.style.display = 'none'; b.stand = ''; }
      else { b.el.style.display = ''; zetTekst(b.el, regel.wordt); b.stand = naarMd(b.el); }
    });
    setTimeout(function(){ eigenWijziging = false; }, 0);
  }
  function toonVoorstellen(voorgesteld){
    var n = 0;
    blokken.forEach(function(b){
      var v = voorgesteld[b.sleutel];
      b.el.classList.toggle('voorgesteld', !!v);
      if (v) { n++; b.el.title = 'Voorstel van ' + (v.wie || '?') + (v.bron ? ' · ' + v.bron : '') + ' — beoordelen via de redactietafel'; }
      else if (b.el.title && b.el.title.indexOf('Voorstel van') === 0) b.el.removeAttribute('title');
    });
    voorstelEl.textContent = n ? n + ' voorstel' + (n === 1 ? '' : 'len') + ' wacht op de redacteur' : '';
  }

  var laagVersie = null, laagStop = false, laagEerste = true, laatsteLaag = null;
  function haalLaag(opnieuw){
    var kop = {}; var sl = redactieSleutel(); if (sl) kop['x-redactie-sleutel'] = sl;
    fetch(LAAG_PAD, { cache: 'no-store', headers: kop })
      .then(function(r){ if (!r.ok) throw 0; return r.json(); })
      .then(function(d){
        laagEerste = false;
        if (d && (opnieuw || d.versie !== laagVersie)) { laagVersie = d.versie; laatsteLaag = d; pasToe(d.blokken || {}); toonVoorstellen(d.voorgesteld || {}); }
      })
      .catch(function(){ if (laagEerste) laagStop = true; });
  }

  /* ---- starten: meteen, of pas als de lezer zijn tekst heeft opgebouwd ---- */
  var gestart = false;
  function start(){
    if (gestart) return; gestart = true;
    stempel();
    try { haalLaag(true); } catch (e) { laagStop = true; }
    var laagKlok = setInterval(function(){
      if (laagStop) { clearInterval(laagKlok); return; }
      if (document.hidden) return;
      if (!window.VIC_REDACTIE) haalLaag();
    }, INTERVAL);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden && !laagStop && !window.VIC_REDACTIE) haalLaag(); });
    if (TELLING.volgDom) {
      var wacht = null;
      new MutationObserver(function(){
        if (eigenWijziging || window.VIC_REDACTIE) return;
        clearTimeout(wacht);
        wacht = setTimeout(function(){
          var n = document.querySelectorAll(blokSel).length;
          if (n === blokken.length && blokken.every(function(b){ return document.contains(b.el); })) return;
          stempel();
          if (laatsteLaag) { pasToe(laatsteLaag.blokken || {}); toonVoorstellen(laatsteLaag.voorgesteld || {}); }
        }, 300);
      }).observe(document.body, { childList: true, subtree: true });
    }
    if (BESCHIKBAAR) redactie();
  }
  if (TELLING.wachtOp) {
    var wachter = setInterval(function(){
      if (document.querySelector(TELLING.wachtOp)) { clearInterval(wachter); start(); }
    }, 200);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* ---- redactiemodus: typen, tellen, bewaren ---- */
  function redactie(){
    function meld(t){ meldEl.textContent = t || ''; }
    var aan = false;
    function zetBewerkbaar(){ blokken.forEach(function(b){ b.el.contentEditable = aan ? 'true' : 'false'; }); }
    knop.addEventListener('click', function(){
      aan = !aan; window.VIC_REDACTIE = aan;
      document.body.classList.toggle('redactie', aan);
      knop.classList.toggle('aan', aan);
      knop.textContent = aan ? TEKST.knopAan : TEKST.knop;
      zetBewerkbaar();
      meld('');
    });

    function gewijzigd(){
      var uit = [];
      blokken.forEach(function(b){
        if (b.el.style.display === 'none') return;
        var nu = naarMd(b.el);
        if (nu === b.stand) return;
        var was = b.el.dataset.laagWas !== undefined ? b.el.dataset.laagWas : b.origineelMd;
        uit.push({ sleutel: b.sleutel, hoofdstuk: b.hoofdstuk, was: was, wordt: nu, blok: b });
      });
      return uit;
    }
    function herteken(){
      var n = 0;
      blokken.forEach(function(b){
        var gew = b.el.style.display !== 'none' && naarMd(b.el) !== b.stand;
        b.el.classList.toggle('gewijzigd', gew);
        if (gew) n++;
      });
      tellerEl.textContent = n + ' ' + TEKST.gewijzigd;
    }
    document.addEventListener('input', function(e){ if (e.target.closest && e.target.closest('[data-blok]')) herteken(); });

    function dump(rij){
      return rij.map(function(w){ return '### ' + w.sleutel + '\nWAS: ' + w.was + '\nWORDT: ' + (w.wordt || '(weggehaald)'); }).join('\n\n');
    }

    var bezig = false;
    bewaarKnop.addEventListener('click', function(){
      var rij = gewijzigd();
      if (!rij.length || bezig) { if (!rij.length) meld('geen wijzigingen'); return; }
      bezig = true; meld('bewaren…');
      fetch(LAAG_PAD, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-redactie-sleutel': redactieSleutel() },
        body: JSON.stringify({ wijzigingen: rij.map(function(w){ return { sleutel: w.sleutel, hoofdstuk: w.hoofdstuk, was: w.was, wordt: w.wordt }; }) }) })
        .then(function(r){ return r.json(); })
        .then(function(a){
          if (!a.ok) throw new Error(a.fout || 'onbekende fout');
          rij.forEach(function(w){
            if (w.wordt.trim() === w.was.trim()) { delete w.blok.el.dataset.laagWas; delete w.blok.el.dataset.laagOrigineel; }
            else if (w.blok.el.dataset.laagWas === undefined) { w.blok.el.dataset.laagWas = w.was; w.blok.el.dataset.laagOrigineel = w.blok.origineelHtml; }
            w.blok.stand = w.wordt;
            if (!w.wordt.trim()) w.blok.el.style.display = 'none';
          });
          herteken();
          meld((a.bewaard || rij.length) + ' ' + TEKST.bewaard);
        })
        .catch(function(e){ meld('bewaren lukte niet (' + e.message + ') — kopieer hieronder, dan is er niets weg'); toonKopie(dump(rij)); })
        .then(function(){ bezig = false; });
    });
    kopieerKnop.addEventListener('click', function(){ var rij = gewijzigd(); toonKopie(rij.length ? dump(rij) : 'Nog geen wijzigingen.'); });
    resetKnop.addEventListener('click', function(){ if (confirm('Alle niet-bewaarde wijzigingen in dit venster terugzetten?')) location.reload(); });

    function toonKopie(tekst){
      var ta = el('textarea', { spellcheck: 'false' }); ta.value = tekst;
      var okKnop = el('button', { type: 'button', text: 'Kopieer naar klembord' });
      var dicht = el('button', { type: 'button', text: 'Sluiten' });
      var laag = el('div', { 'class': 'vr-kopie' }, [el('div', { 'class': 'doos' }, [ta, el('div', { 'class': 'rij' }, [okKnop, dicht,
        el('span', { style: 'font-size:12.5px;color:var(--vr-grijs)', text: 'Lukt kopiëren niet, selecteer dan handmatig.' })])])]);
      document.body.appendChild(laag); ta.select();
      okKnop.addEventListener('click', function(){
        ta.select(); var gelukt = false;
        try { gelukt = document.execCommand('copy'); } catch (e) {}
        if (!gelukt && navigator.clipboard) navigator.clipboard.writeText(tekst).catch(function(){});
        okKnop.textContent = 'Gekopieerd';
      });
      dicht.addEventListener('click', function(){ laag.remove(); });
      laag.addEventListener('click', function(e){ if (e.target === laag) laag.remove(); });
    }

    // na een herrender (volgDom) moeten nieuwe blokken ook bewerkbaar zijn
    if (TELLING.volgDom) new MutationObserver(function(){ if (aan && !eigenWijziging) zetBewerkbaar(); }).observe(document.body, { childList: true, subtree: true });
    herteken();
  }
})();
