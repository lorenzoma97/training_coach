// Catalogo mobility routines diario-coach v2 — Wave 2.1
// Owner: kb-content-specialist
//
// Format e contract definiti in ARCHITECTURE.md §2.1 (MobilityRoutine).
// Step ordinati con cue tecnico in 1 frase. Citation peer-reviewed dove esiste.
//
// Coverage minimo (verificata in __tests__/mobilityRoutines.test.ts):
//   ≥6 routine totali · ogni routine ≥3 step · FIFA 11+ con citation obbligatoria.
//
// NOTA import: `MobilityRoutine` da `../types/mobility.ts` (Schema Specialist
// in parallelo, Wave 2.1). Se al checkout non esiste ancora, vedere fallback.

import type { MobilityRoutine } from "../types/mobility";

export const MOBILITY_ROUTINES: MobilityRoutine[] = [
  // ===========================================================================
  // 1. FIFA 11+ — warm-up calcio (citation obbligatoria)
  // ===========================================================================
  {
    id: "fifa-11plus",
    name: "FIFA 11+",
    purpose: "warmup",
    duration_min: 20,
    sport: "calcio",
    citation: "Soligard et al. BMJ 2008 (RCT cluster su 1892 calciatrici 13-17 anni: -35% infortuni totali, -50% infortuni gravi vs warm-up standard); Silvers-Granelli 2017 JSCR (validato anche su maschi adulti).",
    steps: [
      // PARTE 1 — Corsa lenta (8 min)
      { name: "Corsa avanti", duration_sec: 30, cue: "Corsa lenta in linea retta tra coni separati 8-10m, 2 ripetizioni." },
      { name: "Corsa con anche aperte", duration_sec: 30, cue: "Corsa lenta sollevando ginocchio + rotazione anca esterna ad ogni passo." },
      { name: "Corsa con anche chiuse", duration_sec: 30, cue: "Corsa lenta sollevando ginocchio + rotazione anca interna ad ogni passo." },
      { name: "Corsa laterale con contatto spalla", duration_sec: 30, cue: "Coppia, corsa laterale shuttle con leggero contatto spalla in saltello a metà." },
      { name: "Corsa avanti-indietro veloce", duration_sec: 30, cue: "Corsa veloce 6-8 passi avanti, decelerazione + retro a 2/3 di velocità." },
      // PARTE 2 — Forza, equilibrio, pliometria (10 min)
      { name: "Plank statico", duration_sec: 30, cue: "Avambracci a terra, corpo allineato. 3×30s o 1×60-90s, addome contratto." },
      { name: "Side plank", duration_sec: 30, cue: "Avambraccio a terra, anca alta, 3×30s per lato. Anche cadenti = errore." },
      { name: "Nordic Hamstring", reps: 5, cue: "Inginocchiati con caviglie bloccate, discesa lenta in avanti controllando con femorali. 3×5 eccentriche." },
      { name: "Single-leg balance", duration_sec: 30, cue: "Mantenere equilibrio su una gamba 30s, occhi aperti. Progressione: passare palla con compagno." },
      { name: "Squat statico (mezzo squat)", reps: 30, cue: "30 mezzi squat lenti, ginocchia in linea con piedi, NO valgismo." },
      { name: "Vertical jump (squat con salto)", reps: 10, cue: "10 squat con salto verticale, atterraggio morbido in flexion ginocchio + anca." },
      // PARTE 3 — Corsa con calcio (2 min)
      { name: "Corsa con cambio direzione", duration_sec: 60, cue: "Corsa media intensità con cambio direzione 90° a comando, decelerazione controllata." },
      { name: "Corsa + accelerazione", duration_sec: 60, cue: "Allunghi 30-40m al 75% velocità, recupero camminato al ritorno." },
    ],
  },

  // ===========================================================================
  // 2. Movement Prep — warm-up generale (10 min)
  // ===========================================================================
  {
    id: "movement-prep",
    name: "Movement Prep (warm-up generale)",
    purpose: "warmup",
    duration_min: 10,
    citation: "Verstegen & Williams 2004 (Core Performance protocol); McGowan et al. Sports Med 2015 (warm-up review: dynamic > static per performance acuta).",
    steps: [
      { name: "Knee hugs", reps: 8, cue: "Camminata avanti, ad ogni passo abbracciare ginocchio al petto. 8 per gamba." },
      { name: "Walking quad stretch", reps: 8, cue: "Camminata avanti, afferrare caviglia dietro al gluteo + step avanti contemporaneo. 8 per gamba." },
      { name: "Frankenstein walks", reps: 8, cue: "Camminata avanti calciando gamba tesa verso mano opposta tesa. 8 per gamba." },
      { name: "Walking lunges con rotazione", reps: 6, cue: "Affondo + rotazione busto verso ginocchio anteriore. 6 per gamba." },
      { name: "Inchworm", reps: 5, cue: "Toccare terra mani vicino ai piedi, walk out a plank, push-up opzionale, walk back." },
      { name: "Hip circles + leg swings", duration_sec: 60, cue: "10 cerchi anca per direzione + 10 leg swings avanti/dietro + 10 laterali per gamba." },
      { name: "Skip A + skip B", duration_sec: 60, cue: "20m A-skip (ginocchio alto a 90°) + 20m B-skip (estensione gamba bassa)." },
      { name: "Allunghi progressivi", reps: 3, cue: "3 allunghi 40m al 60-70-80% velocità, recupero camminato." },
    ],
  },

  // ===========================================================================
  // 3. Dynamic Flow Runner — pre-corsa (8 min)
  // ===========================================================================
  {
    id: "dynamic-flow-runner",
    name: "Dynamic Flow Runner (pre-corsa)",
    purpose: "warmup",
    duration_min: 8,
    sport: "corsa",
    citation: "Behm & Chaouachi Eur J Appl Physiol 2011 (dynamic stretching review: meglio di static per performance corsa); Opplert & Babault Sports Med 2018.",
    steps: [
      { name: "Cammino veloce", duration_sec: 120, cue: "2 minuti cammino brisk per innalzare temperatura corporea." },
      { name: "Leg swings frontali", reps: 10, cue: "Tenendosi a un palo: 10 swing avanti-dietro per gamba, range progressivo." },
      { name: "Leg swings laterali", reps: 10, cue: "10 swing laterali per gamba, busto fisso, mobilità adduttori/abduttori." },
      { name: "Walking knee hugs + ankle prep", reps: 8, cue: "8 knee hugs + 8 cavigliere (sollevamenti tallone + punta in piedi) per attivare polpaccio." },
      { name: "Walking lunges", reps: 8, cue: "8 affondi avanzanti per gamba, mantieni busto eretto." },
      { name: "Carioca laterale", duration_sec: 30, cue: "30s carioca (passo incrociato laterale) per attivare anca e mobilità." },
      { name: "A-skip + B-skip drill", duration_sec: 60, cue: "30s A-skip + 30s B-skip, focus running form." },
      { name: "Allunghi progressivi", reps: 3, cue: "3 allunghi 50m al 60-75-85% pace gara, recupero camminato 30s." },
    ],
  },

  // ===========================================================================
  // 4. Foam Rolling Protocol Post-Workout (recovery, 15 min)
  // ===========================================================================
  {
    id: "foam-rolling-post-workout",
    name: "Foam Rolling Protocol Post-Workout",
    purpose: "recovery",
    duration_min: 15,
    citation: "Wiewelhove et al. Front Physiol 2019 (meta-analisi 21 studi: foam rolling post-exercise riduce DOMS effect size 0.34, accelera recupero percepito); Dupuy et al. Front Physiol 2018.",
    steps: [
      { name: "Quadricipiti", duration_sec: 90, cue: "Prono, foam roller sotto coscia. Roll lento dal ginocchio all'anca, soffermarsi su trigger points 20-30s." },
      { name: "IT band (laterale coscia)", duration_sec: 60, cue: "Decubito laterale, roll dalla cresta iliaca al ginocchio. Lento, respira nei punti tesi." },
      { name: "Glutei", duration_sec: 90, cue: "Seduto su roller, gamba accavallata. Roll piriforme + grande gluteo, pause 20s sui punti rigidi." },
      { name: "Femorali", duration_sec: 90, cue: "Seduto a terra, roller sotto coscia posteriore. Roll dal ginocchio al gluteo, mani indietro come supporto." },
      { name: "Polpacci", duration_sec: 90, cue: "Seduto a terra, roller sotto polpaccio. Roll dalla caviglia al cavo popliteo, lento. Una gamba alla volta." },
      { name: "Adduttori", duration_sec: 60, cue: "Prono con gamba aperta laterale, roll inguine-ginocchio interno. Solo se non doloroso (zona delicata)." },
      { name: "Lombari (con cautela)", duration_sec: 30, cue: "NO roll diretto su lombare bassa. Mira parte alta lombare e dorsale media." },
      { name: "Dorsali laterali (lats)", duration_sec: 60, cue: "Decubito laterale, roller sotto ascella, braccio teso. Roll su latissimus dorsi." },
      { name: "Dorsale media (T-spine extension)", duration_sec: 90, cue: "Schiena su roller a metà schiena. Estensione dorsale controllata + roll lento, mira mobilità T-spine." },
      { name: "Pettorali (corner stretch)", duration_sec: 60, cue: "Posizione corner-stretch braccio appoggiato a stipite, ruotare via per allungare pettorali. 30s per lato." },
    ],
  },

  // ===========================================================================
  // 5. Yoga Recovery 20' (recovery, 20 min)
  // ===========================================================================
  {
    id: "yoga-recovery-20",
    name: "Yoga Recovery 20 minuti",
    purpose: "recovery",
    duration_min: 20,
    citation: "Cramer et al. Sports Med 2019 (systematic review yoga & athletes: miglioramenti flexibility + balance + parasympathetic recovery); Polsgrove et al. Int J Yoga 2016.",
    steps: [
      { name: "Child pose (Balasana)", duration_sec: 90, cue: "Ginocchia aperte, glutei sui talloni, fronte a terra, braccia estese avanti. Respirazione profonda diaframmatica." },
      { name: "Cat-cow", reps: 10, cue: "A 4 zampe, alterna inarcamento dorsale (cat) ed estensione (cow), 10 cicli al ritmo del respiro." },
      { name: "Downward dog (Adho Mukha Svanasana)", duration_sec: 90, cue: "Mani e piedi a terra, anche sollevate, schiena lunga. Pedalata talloni alternata per stretching polpacci." },
      { name: "Low lunge (Anjaneyasana)", duration_sec: 60, cue: "Affondo basso con ginocchio posteriore a terra, braccia sopra la testa. 60s per lato. Stretching flessori anca." },
      { name: "Pigeon pose (Eka Pada Rajakapotasana)", duration_sec: 90, cue: "Ginocchio anteriore piegato a 90° davanti a busto, gamba posteriore estesa indietro. Stretching profondo gluteo. 90s per lato." },
      { name: "Seated forward fold (Paschimottanasana)", duration_sec: 90, cue: "Seduto, gambe estese, busto verso piedi senza forzare. Mantieni schiena lunga (vs curva). Stretching catena posteriore." },
      { name: "Supine spinal twist (Supta Matsyendrasana)", duration_sec: 60, cue: "Sdraiato schiena, ginocchio piegato che cade lateralmente, testa al lato opposto. 60s per lato. Mobilità T-spine + lombare." },
      { name: "Happy baby (Ananda Balasana)", duration_sec: 60, cue: "Schiena a terra, afferra esterno piedi con ginocchia aperte verso ascelle. Rilassa lombare." },
      { name: "Reclined butterfly (Supta Baddha Konasana)", duration_sec: 90, cue: "Sdraiato schiena, piante piedi a contatto, ginocchia aperte. Apertura anche passiva. Respirazione lenta." },
      { name: "Savasana (rilassamento finale)", duration_sec: 180, cue: "3 minuti supino, braccia leggermente staccate dal corpo, occhi chiusi. Respirazione naturale, parasympathetic shift." },
    ],
  },

  // ===========================================================================
  // 6. Calf+Achilles Protocol (injury prevention, 10 min)
  // ===========================================================================
  {
    id: "calf-achilles-protocol",
    name: "Calf+Achilles Protocol (Alfredson HSR)",
    purpose: "injury_prevention",
    duration_min: 10,
    sport: "corsa",
    citation: "Alfredson et al. Am J Sports Med 1998 (eccentric heel-drop protocol per tendinopatia achillea); Silbernagel et al. Am J Sports Med 2007 (pain-monitoring); Kongsgaard Scand J Med Sci Sports 2009 (HSR).",
    steps: [
      { name: "Warm-up cammino", duration_sec: 120, cue: "2 minuti cammino brisk per innalzare temperatura locale." },
      { name: "Single-leg calf raise eccentrico (gastrocnemio)", reps: 15, cue: "Su gradino, sollevarsi su entrambi piedi, scaricare su un solo piede e scendere lento 3-5s. 3×15 per lato. Ginocchio esteso = mira gastrocnemio." },
      { name: "Single-leg calf raise eccentrico (soleo)", reps: 15, cue: "Identica al precedente MA con ginocchio piegato a 30° (riduce contributo gastrocnemio, mira soleo). 3×15 per lato." },
      { name: "Calf stretch al muro (gastrocnemio)", duration_sec: 60, cue: "Affondo posteriore con tallone a terra, gamba posteriore tesa. 30s per lato. Stretching gastrocnemio." },
      { name: "Calf stretch al muro (soleo)", duration_sec: 60, cue: "Identico ma gamba posteriore con ginocchio piegato. 30s per lato. Stretching soleo." },
      { name: "Pain monitoring check", duration_sec: 30, cue: "Valutazione dolore 0-10 secondo Silbernagel: ≤5 OK continuare, deve tornare a baseline entro 24h. ≥6 = stop e rivalutare." },
    ],
  },

  // ===========================================================================
  // 7. Cooldown Post-Corsa (cooldown, 6 min)
  // ===========================================================================
  {
    id: "cooldown-post-corsa",
    name: "Cool-down post-corsa",
    purpose: "cooldown",
    duration_min: 6,
    sport: "corsa",
    citation: "Van Hooren & Peake Sports Med 2018 (static stretching post-exercise non aumenta recupero ma riduce muscle tension percepita); ACSM Position Stand 2011 (cool-down attivo 5-10min Z1 facilita clearance lattato).",
    steps: [
      { name: "Camminata Z1", duration_sec: 180, cue: "3 minuti camminata brisk a respiro nasale, abbassa progressivamente FC verso baseline." },
      { name: "Stretching polpacci al muro", duration_sec: 60, cue: "Affondo posteriore, tallone a terra, gamba tesa per gastrocnemio (30s/lato). Sensazione di stretch, NON dolore." },
      { name: "Stretching femorali in piedi", duration_sec: 60, cue: "Piede su superficie bassa, busto inclinato avanti mantenendo schiena lunga, 30s/lato. Mira ischio-crurali." },
      { name: "Stretching quadricipiti in piedi", duration_sec: 60, cue: "Tieni caviglia con mano omolaterale, ginocchia vicine, bacino in avanti. 30s/lato per quadricipite + flessori anca." },
    ],
  },

  // ===========================================================================
  // 8. Cooldown Post-Forza Lower (cooldown, 8 min)
  // ===========================================================================
  {
    id: "cooldown-post-forza-lower",
    name: "Cool-down post-forza (gambe)",
    purpose: "cooldown",
    duration_min: 8,
    citation: "Behm & Chaouachi Eur J Appl Physiol 2011 (stretching statico post-allenamento NON peggiora performance se >30s post hoc); Apostolopoulos et al. J Bodyw Mov Ther 2015 (sub-DOMS recovery con stretching moderato).",
    steps: [
      { name: "Camminata leggera + scuotere gambe", duration_sec: 120, cue: "2 min cammino lento + scuotere alternatamente le gambe per dissipare tensione muscolare." },
      { name: "Stretching glutei (figura 4 supina)", duration_sec: 90, cue: "Sdraiato, caviglia su ginocchio opposto, tira la coscia verso il petto. 45s/lato. Apre il gluteo profondo." },
      { name: "Stretching flessori anca (low lunge)", duration_sec: 90, cue: "Affondo basso con ginocchio posteriore a terra, bacino spinto in avanti. 45s/lato. Critico post-squat/stacco." },
      { name: "Stretching adduttori (butterfly)", duration_sec: 60, cue: "Seduto, piante piedi unite, ginocchia aperte. Inclina busto leggermente avanti senza forzare. Rilascia tensione interna coscia." },
      { name: "Child pose finale", duration_sec: 120, cue: "Ginocchia aperte, fronte a terra, braccia estese avanti. 2 minuti di respirazione diaframmatica per attivare parasimpatico." },
    ],
  },

  // ===========================================================================
  // 9. Cooldown Post-Forza Upper (cooldown, 6 min)
  // ===========================================================================
  {
    id: "cooldown-post-forza-upper",
    name: "Cool-down post-forza (busto)",
    purpose: "cooldown",
    duration_min: 6,
    citation: "Sands et al. J Strength Cond Res 2013 (static stretching shoulder post-pressing protocol); Page Int J Sports Phys Ther 2012 (current concepts stretching).",
    steps: [
      { name: "Spalle: shoulder rolls", reps: 10, cue: "10 rotazioni lente delle spalle indietro, ampiezza massima. Drena tensione cervicale-trapezi." },
      { name: "Stretching pettorali (corner stretch)", duration_sec: 60, cue: "Avambraccio appoggiato a stipite/angolo muro a 90°, ruotare il busto via. 30s/lato. Apre pettorali post-bench." },
      { name: "Stretching dorsali (lat stretch al muro)", duration_sec: 60, cue: "In piedi, mani al muro alte, ancanche indietro mantenendo braccia tese. 30s/2 ripetizioni. Stretching lats post-row/pull." },
      { name: "Stretching tricipiti dietro la testa", duration_sec: 60, cue: "Braccio sopra la testa, mano dietro il collo, tira gomito col braccio opposto. 30s/lato. Post-OHP/press." },
      { name: "Doorway chest opener + collo", duration_sec: 120, cue: "Mani su stipite alto, busto avanti per pettorali (60s). Poi lateroflessioni cervicali (30s/lato)." },
    ],
  },

  // ===========================================================================
  // 10. Cooldown Generale Breve (cooldown, 4 min)
  // ===========================================================================
  {
    id: "cooldown-generale-breve",
    name: "Cool-down generale (breve)",
    purpose: "cooldown",
    duration_min: 4,
    citation: "Hotfiel et al. Sportverletz Sportschaden 2018 (active cool-down 5min Z1 efficace per lactate clearance); usato come fallback default quando non ci sono routine sport-specific.",
    steps: [
      { name: "Camminata respirazione profonda", duration_sec: 90, cue: "90s cammino lento + respirazione 4-7-8 (inspira 4s, trattieni 7s, espira 8s). Attiva parasimpatico." },
      { name: "Stretching catena posteriore (forward fold)", duration_sec: 60, cue: "In piedi, piega busto avanti rilassato, lascia pendere braccia/testa. Stretching globale catena posteriore." },
      { name: "Stretching catena anteriore (cobra/upward dog)", duration_sec: 60, cue: "Prono, mani a terra sotto spalle, estensione dorsale. 2× 30s. Apre catena anteriore." },
      { name: "Box breathing finale", duration_sec: 30, cue: "4 cicli 4-4-4-4 (inspira 4s, trattieni 4s, espira 4s, trattieni 4s). HRV boost finale." },
    ],
  },
];

/**
 * Lookup O(1) per id.
 */
export const ROUTINES_BY_ID: Record<string, MobilityRoutine> = Object.fromEntries(
  MOBILITY_ROUTINES.map(r => [r.id, r])
);

/**
 * Lista degli ID validi (per validazione runtime + injection prompt).
 */
export const ROUTINE_IDS: ReadonlySet<string> = new Set(MOBILITY_ROUTINES.map(r => r.id));
