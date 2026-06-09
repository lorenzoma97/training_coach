---
name: product-ui-system
description: Build/maintain a coherent PRODUCT UI for an app — design tokens (spacing/type/radius/color), component consistency, mobile patterns, accessibility. Use when implementing or refactoring app screens so they feel professionally designed and uncluttered (utility app, NOT a flashy marketing page).
license: adapted for diario-coach
---

# Product UI System

Origine: adattata dal ruleset di nextlevelbuilder/ui-ux-pro-max-skill
(priority rule categories) + standard comuni di product design.
Filosofia: per un'app utility la qualità = chiarezza + consistenza + ritmo,
non distintività. Decidi tutto con TOKEN, mai numeri sparsi.

## Priorità (alto→basso)

1. **Accessibilità (CRITICA)** — contrasto 4.5:1 (corpo) / 3:1 (grande),
   label descrittive, focus order coerente, supporto reduced-motion.
2. **Touch & interazione (CRITICA)** — target ≥44×44px, spacing ≥8px,
   feedback pressione 80-150ms.
3. **Layout & responsive (ALTA)** — mobile-first, niente scroll orizzontale,
   safe-area, ritmo spaziale 4/8.
4. **Navigazione (ALTA)** — ≤5 voci bottom-nav, "indietro" prevedibile,
   un percorso ovvio per ogni task ("dove trovo cosa").
5. **Tipografia & colore (MEDIA)** — base 16px, line-height 1.5, scala
   tipografica con ruoli, token colore semantici.
6. **Forms & feedback (MEDIA)** — label visibili, errori vicino al campo,
   helper text, empty-state utili (non card vuote: raggruppa i "non
   disponibili" in una riga).
7. **Animazione (MEDIA)** — 150-300ms, il movimento veicola significato.
8. **Icone (MEDIA)** — SVG/vettoriali con stroke e dimensione coerenti,
   NON emoji come icone UI.

## Token (fonte unica di verità)

- **Spacing**: scala 4 → 4,8,12,16,20,24,32 (px). Gap/padding solo da qui.
- **Radius**: 8 (controlli), 12 (card), 999 (pill).
- **Type**: scala con ruoli — title 20-22 / 700, section 15-16 / 700,
  body 14-15 / 400-500, secondary 13 / 500, label 11 / 700 uppercase.
  line-height 1.4-1.6.
- **Color**: token semantici (primary/info/attention/success/danger/neutral);
  superfici separate dai significati; colori-dato (zone/serie) = legenda a parte.

## Regole anti-clutter (specifiche del nostro contesto)

- Una card si renderizza SOLO se ha dati; i "non disponibili" → una riga sola.
- Max 1 banner di stato per volta, a priorità (danger > attention > info).
- Dettaglio/avanzato collassato di default.
- Una sola fonte per ogni informazione (no doppioni: es. settimana mostrata
  una volta, zone in un solo posto).
- Riduci i bordi: preferisci spazio bianco e raggruppamento ai riquadri.

## Workflow di applicazione
1. Definisci/aggiorna i token in un modulo theme.
2. Crea primitive condivise (Card, SectionTitle, Button, Badge) basate sui token.
3. Rifattorizza UNA schermata di riferimento; falla validare; poi propaga.
4. Verifica con la rubrica `design-review`.
