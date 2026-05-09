# Diario & Coach

Web app mobile-first (PWA) per il diario di allenamento con **coach AI** integrato (Gemini 2.0 Flash).

## Caratteristiche

- **Diario**: tracciamento sessioni (corsa, forza, sport, mobilità), check giornaliero (peso, sonno, stanchezza), scala dolore polpaccio, RPE, export CSV.
- **Coach AI**:
  - Onboarding guidato con intervista + obiettivi SMART e feasibility check
  - Generazione automatica di un microciclo di 2 settimane personalizzato
  - Feedback proattivo dopo ogni sessione salvata
  - Alert immediati su red flag (dolore, overtraining, FC troppo alta)
  - Report settimanale automatico (lunedì) con rigenerazione piano
  - Chat libera con contesto completo del diario
- **Privacy-first**: dati in localStorage, chiave Gemini sul dispositivo, nessun backend.
- **PWA**: installabile da mobile, diario usabile offline.

## Deploy online con GitHub Pages (nessun Node richiesto localmente)

Il progetto è configurato per buildare e deployare automaticamente su GitHub Pages via GitHub Actions.

### Passi (setup una-tantum)

1. **Crea un repo VUOTO** su https://github.com/new
   - Nome: `training_coach`
   - Visibilità: **Public** (per GitHub Pages gratuito). Se vuoi privato → usa Cloudflare Pages (vedi sotto).
   - **Non spuntare** "Add README" / "Add .gitignore" / "Add license" (lascia tutto vuoto).
2. **Push automatico** da git-bash, dentro questa cartella:
   ```bash
   bash push-to-github.sh
   ```
   Lo script fa init + add + commit + remote + push. Alla prima esecuzione Git Credential Manager potrebbe aprire il browser per login.
3. **Abilita GitHub Pages**:
   - Repo → Settings → Pages → "Source" = **GitHub Actions**.
4. **Il workflow parte da solo** al primo push. Controlla su "Actions" (~2 min).
5. URL finale: `https://<tuo-user>.github.io/training_coach/`

### Aggiornamenti successivi

Modifichi i file, poi:
```bash
git add . && git commit -m "descrizione" && git push
```
Il workflow ri-builda e ri-deploya in automatico.

### Dopo il deploy

1. Apri l'URL dal telefono → "Aggiungi a home"
2. Vai in **Impostazioni** → incolla la chiave Gemini (gratuita: https://aistudio.google.com/apikey)
3. Completa l'**onboarding**
4. Usa il **Diario** — il coach reagisce automaticamente ad ogni allenamento

### Aggiornamenti

Ogni volta che modifichi un file e fai commit su `main`, il workflow ri-builda e ri-deploya in automatico.

## Struttura

```
src/
  App.tsx                   — router + bottom nav
  main.tsx, styles.css
  pages/
    OnboardingWizard.tsx    — 4 step: profilo, obiettivi, disclaimer, piano
    CoachPage.tsx           — tab Piano / Feed / Chat
    SettingsPage.tsx        — chiave Gemini, reset dati
  components/
    DiaryApp.tsx            — diario (portato da diario_completo.jsx)
    CoachChat.tsx           — chat streaming
    TrainingPlanView.tsx    — piano settimanale con evidenza sessione di oggi
    CoachFeedList.tsx       — feed cronologico coach
    ProactiveFeedback.tsx   — subscriber workout:saved → feedback automatico
  lib/
    storage.ts              — wrapper localStorage
    events.ts               — event bus tipato
    gemini.ts               — client Gemini (JSON + streaming)
    diaryContext.ts         — serializza dati per il coach
    scheduler.ts            — report settimanale automatico
    types.ts
    coach/
      safetyRules.ts        — regole sicurezza hardcoded + check locali red flag
      systemPrompts.ts      — prompt per ogni modalità
      feasibility.ts        — valutazione obiettivi con controproposta SMART
      planGenerator.ts      — generazione + rigenerazione piano
      sessionFeedback.ts    — feedback post-workout
      weeklyReport.ts       — report lunedì mattina
.github/workflows/deploy.yml — build + deploy automatico a GH Pages
```

## Come funziona il coach

Il coach opera in **5 modalità**, ciascuna con un prompt dedicato in `lib/coach/systemPrompts.ts`:

1. **Feasibility check** (onboarding): valuta obiettivi utente, propone versioni SMART se non realistici
2. **Plan generation**: crea microciclo 2 settimane con JSON strutturato validato Zod
3. **Session feedback** (proattivo): analisi post-sessione con red flags
4. **Weekly report** (lunedì): sommario + rigenerazione piano
5. **Chat libera**: streaming con accesso a profilo + piano + storico

Regole di sicurezza (`safetyRules.ts`) iniettate in tutti i prompt:
- Dolore ≥3 → STOP
- Progressione volume max +10%/settimana
- Neofita: corsa max 25min/sessione
- Combo sonno/stanchezza → deload
- FC Z2 max 75% FCmax (Tanaka)

## Alternative di deploy

Se GitHub Pages non ti piace, il workflow si può adattare a:
- **Cloudflare Pages**: collega il repo GitHub, build command `npm run build`, output dir `dist`, nessun workflow yml necessario (Cloudflare builda lato suo)
- **Netlify**: stessa cosa, "New site from Git"
- **Vercel**: "Import project" dal repo

Tutti hanno piano gratuito sufficiente per uso personale.

## Limiti & roadmap

- **Multi-device**: attualmente no (localStorage per device). Fase 2 = Supabase sync.
- **Grafici trend**: non implementati (fase 2 con Recharts).
- **Notifiche push**: non implementate (fase 2).
- **Icone PNG PWA**: al momento solo SVG (funziona su Android/desktop; iOS installa comunque ma con icona meno raffinata — si può aggiungere dopo).

## Roadmap v2 — "Personal Trainer Pro"

**Stato: in sviluppo (v2 in arrivo).** Estensione da wellness coach a coach prescrittivo per atleta amatoriale serio. Design doc completo in `ARCHITECTURE.md`.

Feature in arrivo:

- **Forza completa**: database esercizi (≥80 esercizi catalogati con pattern, equipment, alternative), tracking 1RM (tested + estimated via Brzycki), storia carichi, prescrizione carico per sessione (`Squat 4×8 @70% 1RM`). Guida utente: `docs/guida-test-1rm.md`.
- **Wearable Samsung Health import**: parser CSV ZIP (workout, heart rate, sleep, weight, HRV se Galaxy Watch 5+), dedup automatica vs workout manuali. Guida utente: `docs/guida-import-samsung-health.md`.
- **Macrocicli + race calendar**: aggiungi gare/eventi (corsa, calcio, trail) con data e priorità A/B/C → il coach genera macrociclo 12-24 settimane con fasi `base/build/peak/taper`.
- **Mobility library**: ≥6 routine pre-strutturate (FIFA 11+, Movement Prep, Dynamic Flow Runner, Foam Rolling, Yoga Recovery 20', Calf+Achilles Protocol) selezionabili come warmup/cooldown.
- **HRV / readiness scoring**: score giornaliero 0-100 da HRV trend 7gg vs baseline 30gg + sleep + soggettivo. Auto-adjust del piano (downgrade Z4-Z5 → Z2-Z3) se readiness <50.
- **Equipment substitution**: cambi equipment in profilo → il piano corrente ri-renderizza l'esercizio sostitutivo (es. squat-barbell → goblet-squat) senza ri-chiamare l'LLM.

Architettura tecnica chiave: orchestrator multi-pass (skeleton → detail per sessione → validation), RAG context routing per query mirate, validator estesi (load progression, pct1RM coherence, polarization, readiness). Dettagli in `ARCHITECTURE.md`.
