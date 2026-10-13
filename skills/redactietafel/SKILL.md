---
name: redactietafel
description: Commentaar en besluiten omzetten in voorstellen in de tekstlaag van een document, en die in de chat aan de redacteur voorleggen, één blok tegelijk. Gebruik bij "redactietafel", "leg voor", "wat ligt er", bij een verwerkt commentaar, bij een genomen besluit dat tekst raakt, en bij elke vraag over een zin in het document.
---

De tekst leeft op de site van het document; de bron staat in de documentrepo
(zie `redactie.json` daar: `bron` en `soort`). Jij schrijft nooit in die bron.
Jij stelt regels voor in de **tekstlaag**, de redacteur beslist, en een sessie
op de documentrepo schrijft wat gepubliceerd is in de bron bij.

Het instrument is `tafel.py` uit het pakket vic-redactie, te draaien vanuit de
wortel van de documentrepo (waar `redactie.json` staat):
`python3 <webapp>/node_modules/@veenweiden-innovatiecentrum/vic-redactie/py/tafel.py`.
Een documentrepo heeft daar meestal een korte wrapper voor (`redactietafel.py`).
Je sleutel is `REDACTIE_AGENT_SLEUTEL` in je omgeving; daarmee kun je voorstellen,
lezen en een eigen voorstel intrekken, en niets anders. Akkoord en afwijzen zijn
aan de redacteur, met zijn eigen sleutel.

## Wat je omgeving nodig heeft

`REDACTIE_AGENT_SLEUTEL` als omgevingsvariabele (gezet door de eigenaar in de
omgevingsinstellingen, niet via de chat), het pakket geïnstalleerd (`cd webapp
&& npm install`), en toegang tot het domein van de site. Faalt `tafel.py stand`
met een 403 op de verbinding, dan staat het domein niet in de netwerkinstellingen
van de omgeving (*Allowed domains*); meld dat aan de redacteur en ga niet
om de tafel heen werken.

## Een voorstel maken

1. Zoek het blok: `tafel.py zoek "<woorden uit de zin>"`, dan `tafel.py blok <sleutel>`
   om te zien wat de lezer nú ziet (bron plus gepubliceerde laag). Werk altijd
   vanuit die tekst, niet uit een kopie elders.
2. Schrijf de nieuwe tekst van het hele blok. Vet is `**zo**`, cursief `*zo*`;
   andere opmaak kan de laag niet dragen. Een blok weghalen is `--weg`.
   Toevoegen, verplaatsen, splitsen of een kop maken kan de laag niet: dat is
   een **opdracht aan de redactie**, geen voorstel.
3. Toets vóór je plaatst, zoals de schrijfregels van het document vragen:
   omkeertest (zou iemand het tegendeel beweren?), weglaattest (mist er iets
   zonder deze zin?), de terminologie van het project, geen ongunstige
   positionering van een partij. Heeft het blok een lang/kort-tweeling, stel dan
   beide voor.
4. Plaats: `tafel.py voorstel <sleutel> --wordt "..." --bron "<wie, wat, datum>"`.
   De bron is het commentaar, de mail, het gesprek met tijdstip, of het
   besluitnummer. Zonder bron geen voorstel. Meerdere tegelijk: `--uit bestand.json`.
5. Zet de regel in het logboek van het project op `voorgesteld`, met de sleutel.

Raakt een voorstel een open besluit, dan volgt de tekst het advies en zeg je dat
erbij; de redacteur neemt eerst het besluit.

## Voorleggen in de chat

Eén blok per beurt, hoogstens drie per bericht, in deze vorm en niet langer:

> **6.2/3** · Wim, gesprek 23-09 [36:07] · logboek r.14
> Nu: *…de tekst zoals hij staat…*
> Wordt: *…de voorgestelde tekst…*
> Tweeling kort gaat mee. Raakt B9 niet.
> **1** akkoord · **2** anders · **3** niet

Het antwoord geldt per nummer: "1" of "1, 3" is akkoord; "2: …" is de eigen
formulering van de redacteur, die je letterlijk doorgeeft; "3" of "niet, want …"
is afwijzen met die reden. "1 behalve 7.5" en "alles 1" zijn ook antwoorden. Jij
voert niets uit op de sleutel van de redacteur: na zijn keuze geef je hem de
regel klaar om te plakken, of hij doet het zelf in de redactiemodus:

    tafel.py akkoord 6.2/3
    tafel.py akkoord 6.2/3 --wordt "…"
    tafel.py afwijzen 6.2/3 --reden "…"

Draait de redacteur die opdracht niet, dan blijft het voorstel staan; dat is
geen fout. Herhaal het hoogstens één keer, in het vaste overzicht van het project.

## Na een beslissing

- Werk het logboek bij: `online verwerkt`, `afgewezen` met reden, of `besluit
  nodig`. De stand van de laag is leidend: `tafel.py stand` en `tafel.py logboek`.
- Een afwijzing met reden en een "anders" zijn materiaal voor de terugkoppeling
  aan wie het commentaar gaf, als concept; de redacteur verstuurt.
- Wat gepubliceerd is, hoort in de bron. Dat doet een sessie op de documentrepo
  met `verwerk.py`; vraag erom als er meer dan tien gepubliceerde regels liggen,
  of een regel die opmaak draagt.

## Wat je nooit doet

- In de bron of in de gebouwde site schrijven.
- Een regel voorstellen zonder bron, of met een bron die je niet hebt gelezen.
- Een ontwerpkeuze als formulering voorstellen: die gaat naar het besluitenbord.
- De sleutel van de redacteur gebruiken of vragen.
