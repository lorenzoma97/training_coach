---
name: design-review
description: Review a web app or screen for visual design QUALITY — layout, spacing, typography, colour/contrast, hierarchy, component consistency, interaction patterns and responsive behaviour. Use when judging whether a UI looks professional, polished and easy to navigate (NOT for adding flashy/distinctive styling).
license: adapted for diario-coach
---

# Design Review

Origine: adattata da jezweb/claude-skills (plugins/frontend/skills/design-review)
e dagli standard product-UI di nextlevelbuilder/ui-ux-pro-max-skill.
Scopo: rispondere a "una persona attenta al design lo percepirebbe come ben fatto
e facile da usare?" — NON aggiungere stile distintivo/bold.

## Come si usa
Per ogni schermata: passa in rassegna le 7 categorie, assegna severità
(Alta = rotto/poco professionale · Media = poco rifinito · Bassa = nitpick),
poi proponi i fix in ordine di impatto. Niente "abbellimenti": l'obiettivo è
chiarezza, gerarchia e consistenza.

## 7 categorie

1. **Layout & spaziatura**
   - Ritmo spaziale su scala 4/8px (no valori arbitrari 6/10/14 misti).
   - Allineamento a griglia, gutters coerenti, padding card uniforme.
   - Spazio bianco generoso > densità: se una schermata "urla tutta uguale",
     manca gerarchia. Una azione/contenuto primario per schermata.

2. **Tipografia**
   - Scala tipografica chiara (es. 22/17/15/13/11) con ruoli netti:
     titolo schermata > titolo sezione > corpo > secondario > label.
   - Corpo ≥15-16px, line-height 1.5-1.6. Evita muri di testo a 10-12px.
   - Max 2 pesi per livello; non usare grassetto su tutto.
   - Lunghezza riga 50-75 caratteri.

3. **Colore & contrasto**
   - Token SEMANTICI (un colore = un significato): primary/info/attention/
     success/danger/neutral. Niente stesso colore per significati diversi.
   - WCAG AA: testo corpo ≥4.5:1, testo grande ≥3:1. Verifica anche in dark.
   - Colori-DATO (zone, serie grafici, categorie) sono una legenda separata:
     NON vanno collassati nei token semantici.

4. **Gerarchia visiva**
   - "Squint test": socchiudendo gli occhi, l'azione/informazione primaria
     deve emergere. Il resto sottotono.
   - Progressive disclosure: dettaglio/avanzato collassato di default.
   - Niente pile di banner: max 1 stato per volta, a priorità.

5. **Consistenza componenti**
   - Stesso stile per card/bottoni/input/badge in tutta l'app (un solo
     componente Card, un solo Button primario/secondario, un solo Badge).
   - **Icone**: usa un set coerente di SVG, NON emoji come icone UI. Le emoji
     hanno stile/rendering incoerente cross-OS e danno aspetto amatoriale.

6. **Interazione**
   - Stati hover/focus/active visibili. Transizioni 150-200ms.
   - Feedback pressione 80-150ms. Stati di loading espliciti.
   - Touch target ≥44×44px, spacing ≥8px tra target.

7. **Responsive / mobile**
   - Mobile-first, niente scroll orizzontale, rispetta le safe-area.
   - Nav: ≤5 voci, "indietro" prevedibile.

## Output
Tabella `| Categoria | Problema | Severità | Fix |`, ordinata per severità,
poi implementa i fix Alta→Bassa. Misura il risultato (es. "card prima: 9,
dopo: 4").
