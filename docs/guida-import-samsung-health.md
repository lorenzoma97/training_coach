# Guida: Import dati da Samsung Health

> Last updated: 2026-05-09
> Audience: utente diario-coach con Galaxy Watch / smartphone Samsung che vuole importare workout, FC, sleep e peso senza inserimento manuale.

---

## 1. Perche esportare da Samsung Health

| Vantaggio | Dettaglio |
|---|---|
| **Risparmi tempo** | Nessun inserimento manuale per ogni allenamento (workout corsa, palestra, sport). |
| **Dati piu precisi** | FC media e max reali misurate dal cardiofrequenzimetro, splits per km, durata effettiva al secondo (vs stima a memoria). |
| **Sleep & HRV** | Importi automaticamente ore dormite, sleep stages (deep/REM se disponibili) e HRV (RMSSD da Galaxy Watch 5+) — alimentano il **readiness score** del coach. |
| **Peso** | Se hai bilancia Samsung/connessa, anche il peso entra nel diario senza pensarci. |

Il coach usa questi dati per:
- Calcolare il **readiness score** giornaliero (HRV trend + sleep + soggettivo).
- Validare il **carico settimanale** (volume reale vs pianificato).
- Suggerire **deload** se i pattern di sleep/FC indicano overtraining.

---

## 2. Come fare l'export da Samsung Health (Android)

> Funziona da Samsung Health v6.20+ (2024+). Su iPhone non e disponibile (Samsung Health iOS limitato).

Procedura step-by-step:

1. Apri l'app **Samsung Health** sul telefono.
2. Tap sull'icona **profilo** in basso a destra (o icona ingranaggio in alto a destra a seconda della versione).
3. Tap su **Settings / Impostazioni** (icona ingranaggio).
4. Scrolla in basso e tap su **About Samsung Health / Informazioni su Samsung Health**.
5. Tap su **Download personal data / Esporta dati personali**.
6. **Seleziona cosa esportare**: spunta **tutto** (workout, heart rate, sleep, weight, HRV se disponibile). Consigliato selezionare tutto anche se ora ti serve solo workout — costa zero, riempie meglio il diario.
7. Tap **Download / Scarica**.
8. Aspetta la **mail di Samsung** con il link al download. Tipicamente arriva in **5-30 minuti**, in casi rari fino a 24h se il volume dati e alto.
9. Apri la mail dal telefono o dal PC, tap sul link e **scarica il file ZIP** (nome tipico: `samsunghealth_<userid>_YYYYMMDD.zip`, dimensione 1-50 MB).
10. Salva lo ZIP in una cartella accessibile (Download, OneDrive, Google Drive — quello che preferisci).

**Suggerimento**: se sei sul PC, scarica il ZIP direttamente li — l'upload nell'app diario-coach e piu veloce da desktop.

---

## 3. Come importare in diario-coach

1. Apri l'app **diario-coach** (browser o PWA installata).
2. Vai su **Settings → "Import wearable data"** [nome esatto da confermare in Wave 3.2].
3. Tap su **"Carica file Samsung Health"** [da confermare].
4. Seleziona il file **ZIP** scaricato (NON estrarlo prima, l'app legge direttamente lo ZIP).
5. Aspetta il **parsing**: 30 secondi per file piccoli (solo ultimi 30 giorni), fino a **2 minuti** per file grandi (anni di storia). Vedrai un loader.
6. **Anteprima**: ti viene mostrata una tabella con i sample estratti, divisi per tipo:

   | Tipo | Conteggio | Status |
   |---|---|---|
   | Workout | 23 | 18 nuovi · 5 duplicati (skip) |
   | Heart rate | 145 | Tutti nuovi |
   | Sleep | 14 | 14 nuovi |
   | Weight | 8 | 6 nuovi · 2 duplicati |

7. **Dedup automatico**: se hai gia registrato manualmente un workout della stessa **data + tipo + durata (±2 min)**, viene marcato come **"duplicato — skip"** e non viene reimportato. Algoritmo dettagliato:
   - `dedupKey = sha1(date_iso_minute | mappedType | round(duration_min/2)*2)`
   - Esempio: workout corsa 2026-05-08 18:30, 45 min → match con workout manuale stesso giorno tipo "corsa" durata 44-46 min.
8. (Opzionale) Espandi le righe per vedere il dettaglio sample-per-sample. Puoi **deselezionare** singole righe se non vuoi importarle.
9. Conferma con **"Importa N nuovi sample, M skip duplicati"**.
10. L'app scrive nel diario. I nuovi workout appaiono in **Diario → Storico** con badge "Da Samsung Health".

---

## 4. Frequenza consigliata

| Cadenza | Pro | Contro |
|---|---|---|
| **1 volta a settimana** (es. domenica sera) | Routine semplice, chiudi la settimana e generi il piano della settimana successiva con dati freschi | Se ti dimentichi, dati arretrati |
| Dopo evento importante (gara, lungo, partita) | Dati subito disponibili al coach per feedback proattivo | Lo dimentichi facilmente |
| Mensile | Massimo risparmio tempo | Il coach non ha dati recenti per readiness/feedback nel frattempo |

**Consigliato**: cadenza settimanale. Si abbina bene al **report settimanale del lunedi** del coach (che cosi ha i dati Samsung dell'ultima settimana per analisi piu accurata).

---

## 5. Cosa NON viene importato

| Stream | Status | Perche |
|---|---|---|
| **Sleep stages dettagliate** (deep/REM/light) | Parziale, dipende da versione | Samsung Health non sempre include lo sleep stages nel CSV. Galaxy Watch 5+ con app aggiornata: SI. Modelli vecchi o solo telefono: solo `total_sleep_min`. |
| **HRV (RMSSD)** | Solo se misurato da Galaxy Watch 5+ | Il telefono da solo non misura HRV. Se non hai un Watch compatibile, manca. |
| **Workout privati / "non condividere"** | Non importati | Samsung Health li esclude **dall'export stesso**. Non c'e workaround. |
| **GPS track / route** | Non importato | Solo distanza totale e splits per km, non la traccia. Usa Strava se ti serve la mappa. |
| **Composizione corporea** (massa magra, % grasso) | Solo se hai bilancia BIA Samsung | Senza bilancia compatibile, manca. |

---

## 6. Troubleshooting

### "Errore parsing CSV / formato non riconosciuto"
- **Causa probabile**: versione Samsung Health diversa da quelle testate (cambia formato CSV header, encoding UTF-16 LE → UTF-8).
- **Cosa fare**:
  1. Apri il ZIP, controlla che dentro ci siano file `.csv` (non solo `.json`).
  2. Apri uno dei CSV con Excel o text editor: deve iniziare con header tipo `com.samsung.health.exercise.exercise_type,com.samsung.health.exercise.start_time,...`.
  3. Se i nomi colonna sono diversi, **allega screenshot del file e segnala come bug** sul repo (issue su GitHub o messaggio diretto).
  4. Workaround temporaneo: importa solo il sub-CSV che funziona (workout) saltando heart_rate/sleep.

### "Workout type sconosciuto / mappato a 'sport (Altro)'"
- **Causa**: Samsung Health usa codici interi per il workout type (es. `1001 = Walking`, `1002 = Running`, `9999 = Custom workout`). La mapping table dell'app copre i ~30 tipi piu comuni; se hai un tipo raro o custom, viene mappato al fallback **"sport (Altro)"**.
- **Cosa fare**: dopo l'import, vai in Diario → trova il workout → **"Modifica"** → cambia il tipo manualmente. Il valore corretto resta salvato.

### "Tutti i workout sono marcati come duplicati"
- **Causa**: hai gia registrato manualmente quegli stessi workout (la dedup funziona).
- **Cosa fare**: conferma "**skip tutti**" e l'import e completato senza creare doppioni. Il vantaggio: i dati Samsung **arricchiscono** comunque il workout esistente (FC media/max, splits — vengono uniti).
- Se invece pensi che la dedup sia sbagliata (es. due allenamenti distinti stessa data e tipo), deseleziona manualmente le righe da importare.

### "L'import dura piu di 5 minuti / il browser si blocca"
- **Causa**: ZIP molto grande (anni di storia) parsato in single-thread.
- **Cosa fare**:
  1. Estrai il ZIP, importa solo i CSV degli ultimi 90 giorni (rinomina o elimina i piu vecchi).
  2. In alternativa, fai due import separati su finestre temporali ridotte.
  3. Bug noto in v2: parser non e ancora streaming. In roadmap v3.

### "Ho HRV nel Galaxy Watch ma non vedo HRV nei sample importati"
- **Causa**: HRV su Samsung Health e in un sub-stream separato (`com.samsung.shealth.tracker.heart_rate.heart_rate_variability`) che alcune versioni non includono di default.
- **Cosa fare**: in Samsung Health → Settings → Permessi → assicurati che HRV sia abilitato. Re-export. Se persiste, e una limitazione del firmware Watch — non c'e workaround app-side.

---

## 7. Privacy

- Il file ZIP **resta solo sul tuo dispositivo** (browser localStorage / IndexedDB).
- **Nessun dato e inviato a server esterni** durante import e parsing — tutto avviene in JavaScript locale.
- I sample importati sono salvati nelle stesse storage keys del diario (`workouts`, `wearable-samples-v1`, `readiness-history`).
- Se vuoi cancellare tutti i dati importati: **Settings → "Pulisci diario"** [da confermare] o, granulare, **Settings → "Cancella dati wearable"**.
- Lo ZIP originale **non e conservato** nell'app: dopo il parsing viene scartato. Se ti serve, tienilo da parte tu (utile per re-import o archivio).

---

## TL;DR operativo

1. **Esporta da Samsung Health**: Settings → About → Download personal data → tutto → aspetta mail → scarica ZIP.
2. **Importa in diario-coach**: Settings → "Import wearable data" → carica ZIP → preview → conferma.
3. **Frequenza**: 1 volta a settimana (es. domenica sera).
4. **Dedup automatica**: workout gia registrato manualmente non viene duplicato.
5. **Limitazioni note**: no GPS track, no workout privati, HRV solo Galaxy Watch 5+, sleep stages dipendono dal modello.
6. **Privacy**: tutto resta sul dispositivo, nessun upload server.
