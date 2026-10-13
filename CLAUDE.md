# vic-redactie — werkinstructie voor Claude Code

Dit is een bibliotheek, geen document. Lees `README.md`: daar staat wat het is,
hoe een documentrepo het gebruikt en hoe je een versie uitbrengt.

Harde regels:

- **Niets documentspecifieks hier.** Geen prefix, geen sitenaam, geen
  bloktelling als vaste waarde: alles komt uit `maak({...})`, `data-config` of
  `redactie.json` in de documentrepo. Wat Melk en Meer of de visie nodig heeft
  en een ander document niet, hoort in die repo.
- **Pagina en Python tellen gelijk.** `client/laag.js` en `py/laag.py` lezen
  dezelfde `telling`-structuur en moeten dezelfde sleutels geven. Raak je de
  telling aan, meet dan beide na op een echte pagina (headless: de
  `data-blok`-attributen tegen `blokken_in_html`).
- **`npm test` vóór elke commit.** Nieuwe mogelijkheden in het endpoint krijgen
  een controle in `scripts/check.mjs`, in dezelfde stijl.
- **Eén branch, tags voor versies.** Een tag is een belofte: documentrepo's
  pinnen erop. Verander nooit een bestaande tag.
- **Nederlands,** in code-commentaar en in de uitvoer van de scripts, zoals in
  de documentrepo's.
