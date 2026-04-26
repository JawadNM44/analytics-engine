# Project Defense — Serverless Real-Time Analytics Engine

**Wat is dit document?**
Een gestructureerd referentie-script om dit project in een 30–60 minuten "project deep dive" interview te kunnen verdedigen. Opbouw volgt het frame uit Alexey Grigorev's [AI Engineering Field Guide](https://github.com/alexeygrigorev/ai-engineering-field-guide):

1. Business problem
2. Solution architecture
3. Key decisions (met trade-offs)
4. Problems encountered (postmortems)
5. Outcome (concrete metrics)
6. What I'd do differently
7. Follow-up Q&A bank (20 vragen die recruiters echt stellen)

**Hoe te gebruiken**: open dit document tijdens voorbereiding. **Niet** voorlezen in een interview — je moet de antwoorden zelf interneerderen. Het script is je netwerk-vangst, niet je verhaal.

---

## 1. Business problem

> "Build a system that ingests live financial market data and surfaces statistically significant anomalies in <2 seconds, on serverless infrastructure that scales to zero when idle."

**Waarom dit probleem?** Twee redenen:

1. **Real-time anomaly detection op streaming data** is een herkenbare use case (fraude, market manipulation, system monitoring). Het is generiek genoeg dat de skills overdraagbaar zijn naar fintech, ad-tech, observability.
2. **Cost-conscious cloud architecture** — kunnen aantonen dat je een productie-systeem ontwerpt dat €50/maand kost in plaats van €5000, is een seniority-signaal.

**Klantfocus**: in dit project ben ik zelf de klant (portfolio), maar de architectuur is identiek aan wat je bij een trading-firm, een payments-provider of een ad-platform zou bouwen.

---

## 2. Solution architecture

```
[ Coinbase Exchange WebSocket (public) ]
              │  matches channel, BTC-USD / ETH-USD / SOL-USD
              ▼
┌─────────────────────────────────┐
│  Cloud Run: coinbase-producer   │  always-on (min=1, no-cpu-throttling)
│  - asyncio + websockets lib     │  ← single instance, sufficient for 3 symbols
│  - SIGTERM graceful shutdown    │
│  - aiohttp /health on $PORT     │
│  - exponential backoff reconnect│
└─────────────┬───────────────────┘
              │  per-message ordering key = product_id
              ▼
┌─────────────────────────────────┐
│ Pub/Sub topic: crypto-trades    │  message ordering enabled
│ + dead-letter topic             │  retention 7 days
└─────────────┬───────────────────┘
              │  Eventarc trigger (managed subscription)
              ▼
┌─────────────────────────────────┐
│ Cloud Function 2nd Gen:         │  scales to zero
│ process-crypto-trade            │
│  - schema validation            │
│  - insertId = trade_id          │  ← idempotent dedup
│  - bigquery.insert_rows_json    │
└─────────────┬───────────────────┘
              ▼
┌─────────────────────────────────┐
│ BigQuery                        │
│  table: crypto_trades           │  partitioned by ingestion day
│  cluster: (product_id, side)    │  cheap per-symbol filtering
│                                 │
│  views (Layer 1 — statistical): │
│   - view_crypto_volume_1m       │
│   - view_crypto_anomalies_zscore│
│   - view_crypto_whale_trades    │
│   - view_crypto_market_summary  │
│                                 │
│  model (Layer 2 — ML):          │
│   - model_crypto_volume_forecast│  ARIMA_PLUS, retrained nightly
└─────────────────────────────────┘
              │
              ▼
   ML.DETECT_ANOMALIES queries on demand
   ML.FORECAST queries on demand
```

**Parallelle (oudere) pipeline**: synthetische `transactions`-stroom met dezelfde architectuur (producer → Pub/Sub → function → BigQuery, met risk scoring) — bewijs dat de pipeline polymorph is voor verschillende data-domeinen.

---

## 3. Key decisions (met trade-offs)

### 3.1 Pub/Sub vs Kafka

| | Pub/Sub | Kafka (managed: Confluent / MSK) |
|---|---|---|
| Operationeel werk | nul (managed by Google) | substantieel zelfs op managed |
| Kosten op kleine schaal | €0 onder 10 GB/maand | €100+/maand minimaal |
| Doorvoer plafond | hoog genoeg voor de meeste use cases | hoger, maar niet relevant hier |
| Ordering | per ordering key | per partition |
| **Conclusie** | **Gekozen** voor scale-down naar nul | overkill voor 5 trades/sec |

**Verdediging**: "Bij 100x het volume zou ik Kafka herevalueren — maar over-engineering vooraf is geen seniority, het is verspilling."

### 3.2 Cloud Run vs GKE vs App Engine voor de WebSocket-worker

| | Cloud Run | GKE | App Engine |
|---|---|---|---|
| Cold start | n.v.t. (min-instances=1) | n.v.t. | langzaam |
| Always-on cost | ~€50/maand | ~€100+/maand cluster fee | onnodig duur |
| Operations | container = unit, geen Pods | volledige cluster te managen | beperkt control |
| **Conclusie** | **Gekozen** | overkill | te restrictief |

### 3.3 Cloud Function vs Dataflow voor de processing step

**Gekozen**: Cloud Function 2nd Gen.

**Waarom**: bij 5 trades/sec is een functie-per-message goedkoper en simpeler dan een Dataflow-pipeline. Bij 5000 trades/sec zou ik switchen naar Dataflow of Beam (batched windowed aggregations zijn dan exponentieel goedkoper dan per-message functies).

**Eerlijke kanttekening**: ik heb dit project **niet** geschaald naar 5000/s — dus de Dataflow-claim is theoretisch. In een interview erken ik dat.

### 3.4 BigQuery ML vs Vertex AI vs externe ML pipeline

**Gekozen**: BigQuery ML met ARIMA_PLUS.

**Waarom**:
- Data zit al in BigQuery → geen export/import nodig
- Training is een SQL-statement, geen Python container, geen Vertex pipeline
- Cost: ~€0.005/training-run vs ~€2/run voor Vertex AI custom training
- ARIMA_PLUS auto-tunet (p,d,q) en seizoenscomponenten → geen hyperparameter search nodig

**Trade-off**: BQML mist de flexibiliteit van Python (geen custom layers, geen transformer-architecturen). Voor dit probleem (univariate time-series forecasting per symbol) is dat niet nodig — voor een NLP-probleem zou ik wel Vertex of een eigen container kiezen.

### 3.5 Ordering keys op Pub/Sub

**Gekozen**: per `product_id` als ordering key.

**Waarom**: voorkomt out-of-order verwerking binnen één symbol (een sell op tijd T+1 mag niet voor de buy op T verwerkt worden). Tussen symbolen is ordering niet relevant.

**Kost**: ordering keys forceren single-threaded delivery per key → lagere parallelisme. Bij grote schaal kan dit een bottleneck worden — dan moet je ordering binnen de consumer afhandelen ipv via Pub/Sub.

### 3.6 Workload Identity Federation vs JSON service-account keys

**Gekozen**: WIF.

**Waarom**: JSON keys zijn de #1 oorzaak van GCP-breaches (zie de bekende "$82k Gemini-key leak" verhalen op Reddit). Met WIF heeft GitHub Actions een short-lived token (ruil OIDC-token van GitHub voor GCP-token), geen statisch geheim om te lekken.

**Kost**: complexere initiële setup (workload identity pool + provider + binding). Maar one-time cost voor permanent veiligere posture.

### 3.7 Idempotente inserts via `insertId`

**Gekozen**: BigQuery `insert_rows_json` met `insertId = trade_id`.

**Waarom**: Pub/Sub levert "at-least-once". Bij duplicate delivery (bv. function timeout + retry) zou de trade twee keer in BigQuery komen. Door `insertId` te zetten dedupliceert BigQuery automatisch binnen het 1-minuut-window.

**Trade-off**: dedup window is ~1 minuut. Voor edge cases (function-execution > 1 min) bestaat een theoretisch risico. Voor onze workload (ms-scale) onproblematisch.

### 3.8 Two-layer anomaly detection (statistisch + ML)

**Gekozen**: layer 1 (z-score, werkt direct) **plus** layer 2 (ARIMA_PLUS, kicks in na ~24u data).

**Waarom**: dit is hoe Netflix, Stripe en grote payment-fraud systems werken — snelle/goedkope baseline + duurder model voor de hogere-recall gevallen. Pure ML zonder baseline is breekbaar (cold start: model doet eerste 24u niks). Pure statistiek mist seizoenspatronen.

---

## 4. Problems encountered (postmortems)

Vijf échte productie-incidenten tijdens de bouw, elk hier als case study.

### Incident #1 — Function-zip artifact lost in CI

**Symptoom**: Terraform Apply faalde op runner met `path .build/function.zip not found`.
**Root cause**: Plan- en Apply-jobs draaien op **verschillende GitHub Actions runners**. Een file gegenereerd in Plan bestaat niet automatisch in Apply.
**Fix**: `actions/upload-artifact` in Plan, `actions/download-artifact` in Apply. Maar: **`.build/` is een hidden directory** (`.` prefix), en upload-artifact v4 excludeert die default → `include-hidden-files: true` toevoegen.
**Lesson**: lees release-notes van CI-actions; subtiele defaults breken stille assumpties.

### Incident #2 — Cloud Run weigert deploy (memory <512Mi)

**Symptoom**: `Total memory < 512 Mi is not supported with cpu always allocated`.
**Root cause**: bij `--no-cpu-throttling` (CPU altijd toegewezen) eist Cloud Run minimaal 512Mi geheugen. Wij vroegen 256Mi.
**Fix**: bump naar 512Mi.
**Lesson**: cloud-provider-specifieke business rules zijn vaak alleen in error-messages te vinden, niet in de UI/docs.

### Incident #3 — Cloud Build SA permissions

**Symptoom**: `35630345943-compute@developer.gserviceaccount.com does not have storage.objects.get`.
**Root cause**: source-based `gcloud run deploy --source` gebruikt Cloud Build, dat default als de **compute-default-SA** draait. Sinds 2024 starten nieuwe GCP-projecten met die SA op nul rechten (security hardening).
**Fix**: pas `--build-service-account` met onze dedicated `sa-function-build` SA (al voorzien via Terraform).
**Lesson**: default SA's zijn een legacy footgun — maak altijd dedicated SA's per workload.

### Incident #4 — IAM eventual-consistency

**Symptoom**: nieuwe `serviceAccountAdmin` rol verleend aan CI-SA, daarna direct gebruikt → `403 setIamPolicy denied`.
**Root cause**: GCP IAM is **eventually consistent** — een nieuwe role-binding propageert in ~60s door de globale IAM-systemen. Terraform vuurde de afhankelijke operatie meteen → race condition.
**Fix**: `time_sleep` resource (90s) tussen role-grant en role-gebruik.
**Lesson**: cloud APIs lijken synchroon maar zijn eventueel-consistent. Bij role-management altijd buffer-time inbouwen.

### Incident #5 — Lekkende Pub/Sub-subscription

**Symptoom**: alert "backlog > 10k", binnen uren opgelopen tot **322k unacked messages**.
**Root cause**: een Pub/Sub-subscription gedeclareerd "voor inspectie" had geen consumer. Cloud Function gebruikt zijn eigen Eventarc-managed subscription — onze inspection-sub stapelde elke trade op met 7-dagen retentie.
**Fix**: subscription resource verwijderd uit Terraform; `pubsub subscriptions seek` om live backlog te draineren.
**Lesson**: declare nooit Pub/Sub-subscriptions zonder geplande consumer. Voor ad-hoc debugging gebruik je `gcloud pubsub subscriptions create temp-*` en `delete` na gebruik.

### Incident #6 (bonus) — BigQuery scheduled query in verkeerde regio

**Symptoom**: scheduled query liep, faalde 0.4s later met `Dataset transactions_ds was not found in location us-central1`.
**Root cause**: dataset zit in multi-region `US`, scheduled query was aangemaakt in `us-central1`. BQ-jobs moeten in dezelfde locatie als het dataset draaien.
**Fix**: `location = google_bigquery_dataset.transactions.location` ipv hardcoded region.
**Lesson**: in BigQuery is `US` (multi-region) ≠ `us-central1` (single region). Dit verschil bijt vaak.

---

## 5. Outcome — concrete metrics

| Metric | Waarde | Hoe gemeten |
|---|---|---|
| End-to-end latency (trade → BQ) | <2s | timestamp diff `trade_time` vs `processed_at` |
| Throughput | ~5 trades/s sustained | heartbeat logs |
| Volume verwerkt (eerste sessie) | ~2000 trades, $1.3M USD | BQ aggregatie |
| Pipeline errors | 0 | publish_errors counter + dead-letter sub |
| Productie-incidenten gehad én opgelost | 6 | git log van fix-PRs (#4, #7, #8, #10, #11, #14) |
| Maandelijkse infrastructuur-kosten (zonder credits) | ~€50-65 | dominantly Cloud Run always-on worker |
| ML model training kosten | <€0.01/run | BQ-job slot-time |
| BQML model trained on | 991 minuten data per symbol | post-deploy verificatie |
| Tests | 25/25 passing, geen flaky tests | CI |
| CI-tijd (PR → main) | 2-5 min | GitHub Actions metrics |
| Cold start van API (toekomstig) | <1s door min-instances=0 + Python | meten bij Feature 3 |

---

## 6. What I'd do differently

Wees eerlijk hierover — recruiters herkennen wanneer je defensive bent.

1. **Monitoring vanaf dag 1, niet erbij gebouwd**. We hadden de Pub/Sub-backlog alert toevallig — als we incident #5 een dag later hadden opgemerkt, was de retentie-duur de volle 7 dagen geweest.
2. **Subscription resources alleen toevoegen mét consumer**. Incident #5 was een **architectuurfout in de Terraform-code**, niet een bug in een script.
3. **BigQuery dataset location aan een variabele koppelen**. We hadden `var.bq_location` moeten introduceren — nu is het impliciet "US" via default. Bij multi-region migratie zou dat moeten worden aangepast op meerdere plekken.
4. **Producer testen uitbreiden**. Onze 25 tests dekken validation + dedup, maar niet de WebSocket reconnect-logica. Dat is risicovol — een bug in `consume_once` zou pas in productie zichtbaar zijn.
5. **Cost dashboard inrichten vóór resources aanzetten**, niet erna. Beter een €5 budget alert hebben en die gebroken zien dan onverwacht een credit-spike.
6. **Schema versioning aanhangen aan Pub/Sub messages** (bijv. `schema_version` veld). Bij future schema-evolutie is migratie dan trivial; nu zou een breaking change consumers stilletjes laten breken.

---

## 7. Follow-up Q&A bank (20 vragen — pak de top-10 voor interview)

### Architectuur & decisions

**Q1: Waarom Pub/Sub en niet Kafka?**
A: Bij 5 trades/sec is Kafka over-engineered en duurder (€100+/maand cluster vs €0 op Pub/Sub onder 10 GB free tier). Pub/Sub levert at-least-once met optionele ordering keys — voldoende voor deze workload. Bij 100× het volume zou ik Kafka herevalueren omdat per-message kosten dan opwegen tegen cluster overhead.

**Q2: Waarom Cloud Function en geen Dataflow?**
A: Per-message functie is goedkoper bij dit volume. Dataflow loont bij batched windowed aggregations of complexe stream-joins — onze processor is stateless validation+insert. Bij 1000+ trades/s zou ik switchen.

**Q3: Waarom BigQuery ML en geen Vertex AI?**
A: Data zit al in BQ — geen export-import, training is één SQL-statement, kost is een fractie. ARIMA_PLUS auto-tunet hyperparameters. Voor problemen waar ik custom layers nodig heb (bijv. transformer-modellen) zou ik Vertex of een eigen container kiezen.

**Q4: Hoe schaal je dit naar 100 symbolen?**
A: Producer: één instance kan honderden symbolen bedienen op één WebSocket-connectie (Coinbase WS multiplexed). Pub/Sub: schaalt automatisch. BQ: rijen partitioned + clustered op product_id, dus per-symbol queries blijven goedkoop. Bottleneck: BQML model — training tijd schaalt met aantal time-series. Bij 100 symbolen zou ik time-series clusteren of per groep modellen trainen.

**Q5: Wat als Coinbase down gaat?**
A: Producer's `consume_once` heeft exponential backoff (1s → 60s) op disconnect. Healthcheck endpoint retourneert 503 als geen trade in 60s. Cloud Run liveness probe rolt de container. Geen data-verlies tenzij downtime > Pub/Sub retention (7 dagen). Voor échte HA zou je een tweede WebSocket-feed (Binance, Kraken) als fallback kunnen toevoegen.

### Reliability & operations

**Q6: Hoe voorkom je dubbele rijen bij retry?**
A: BigQuery `insertId = trade_id` (Coinbase trade-id namespaced met product). Dedup window is ~1 minuut. Voor functie-executions >1 min zou een idempotente UPSERT via MERGE in BQ veiliger zijn — maar dat heeft geen schaalvoordeel onder onze latency.

**Q7: Wat gebeurt er bij een traag of falend BigQuery insert?**
A: Function retried. Na max delivery attempts (5) gaat het bericht naar de dead-letter topic. We monitoren backlog op dead-letter sub. In productie zou ik daar een Slack-alert aan hangen.

**Q8: Hoe ga je om met schema-evolutie?**
A: Eerlijk: nu suboptimaal. Producer en consumer kennen het schema impliciet. Ideaal: een `schema_version` field per message + consumers die backwards-compat zijn. Voor de huidige fase acceptabele tech-debt.

**Q9: Hoe debug je een productie-incident?**
A: Praktijk-voorbeeld geven (Pub/Sub backlog incident): alert ontvangen → `gcloud monitoring metrics` per subscription → root cause vinden (orphan sub) → tijdelijke mitigatie (`seek`) → permanente fix in code (resource verwijderd uit Terraform) → postmortem note in PR-body.

**Q10: Hoe zou je dit testen?**
A: Drie lagen: (1) unit tests op `transform_match` en `validate` — pure functies; (2) integration test met mock Pub/Sub message + mock BQ client; (3) end-to-end smoke test via een test-topic. Onze CI dekt 1 en 2 (25/25 tests), 3 zit nog op TODO.

### Cost & engineering

**Q11: Wat kost dit per maand?**
A: ~€50-65, gedomineerd door één always-on Cloud Run worker (CPU altijd toegewezen voor WebSocket). Rest scales-to-zero en past in free tiers. Bij 100× volume blijft het <€200/maand omdat alleen BQ storage en queries lineair groeien.

**Q12: Hoe zou je kosten halveren als nodig?**
A: Drie hefbomen: (a) WebSocket producer naar `--cpu-throttling` met heartbeat-pings → riskant voor connectie-stabiliteit, ~50% CPU-besparing; (b) BigQuery partition expiration aanzetten op crypto_trades (oude data verwijderen) → marginal storage saving; (c) Een EC2-spot of Hetzner-VM voor de producer → ~€5/maand maar verliest serverless voordelen.

**Q13: Waarom Workload Identity Federation?**
A: JSON service-account keys zijn de #1 oorzaak van GCP-breaches. WIF gebruikt GitHub's OIDC-token om short-lived GCP-tokens te krijgen — geen statisch geheim. Setup is eenmalig complexer, daarna nul onderhoud en veiliger.

### ML specifiek

**Q14: Waarom ARIMA en niet een neural net?**
A: Voor univariate time-series forecasting met seizoenspatronen is ARIMA de gevestigde, interpreteerbare keuze. Voor onze data (one minute volume per symbol) zijn LSTMs of Transformers overkill — meer parameters dan datapunten. ARIMA_PLUS heeft auto-tuning + seizoensdecompositie ingebouwd. Bij multivariate inputs (sentiment, news, macro) zou ik gradient boosting of een transformer overwegen.

**Q15: Hoe weet je dat het ML-model goed is?**
A: Nu nog niet — model is net getraind, confidence intervals zijn breed. Pas na 7+ dagen data heeft ARIMA echt seasonal patterns. Voor evaluatie: hold-out de laatste dag, vergelijk forecast vs werkelijkheid (MAPE, MAE). Anomaly detectie evalueren is moeilijker zonder gelabelde anomalies — een typische aanpak is synthetic injection (bekende anomalies inserten en checken of het model ze pakt).

**Q16: Wat is het verschil tussen jouw z-score en ML.DETECT_ANOMALIES?**
A: Z-score gaat ervan uit dat data normaal verdeeld is en het patroon stationair is. Mist: seizoenen, trends, regime shifts. ARIMA_PLUS leert seizoenspatronen → "drukke maandagochtend" wordt niet als anomaly geflagd, maar "even drukke woensdagnacht" wel. Layer 1 is fast/cheap, Layer 2 is high-recall.

### Process & ownership

**Q17: Wat was je rol in dit project?**
A: Ik bouwde alles zelf — architectuur, Terraform, Python, CI/CD, monitoring. Ik gebruik Claude als pair-programmer voor brainstorming en boilerplate, maar elke decision en elk fix-PR is mijn eigen analyse en uitleg. **Belangrijk om dit eerlijk te zeggen — recruiters appreciëren transparantie en weten dat AI-assistance now norm is.**

**Q18: Hoeveel tijd heeft dit gekost?**
A: Eerlijk antwoorden — geen verkeerde verwachtingen wekken.

**Q19: Wat heb je geleerd dat je verrast heeft?**
A: GCP eventual-consistency op IAM. Ik dacht dat een role-grant onmiddellijk effect had, maar het is propagatie van ~60s. Dat is hoe Incident #4 ontstond. Inzicht: cloud APIs lijken synchroon, zijn niet altijd zo.

**Q20: Wat zou je toevoegen als je 2 weken extra had?**
A: (1) Publieke REST API met rate limiting + caching; (2) Looker Studio dashboard met live anomaly feed; (3) Slack-webhook bij high-confidence anomaly; (4) Tweede data-bron (Binance) om de pipeline-polymorphisme te bewijzen; (5) BQML model uitbreiden met multivariate inputs (cross-symbol features).

---

## 8. Hoe je dit document gebruikt voor een interview

1. **Week ervoor**: lees alles, maak losse mind-maps van architectuur (probeer het uit het hoofd te tekenen).
2. **2 dagen ervoor**: oefen Q1–Q10 hardop. Spreek het uit, niet alleen denken.
3. **1 dag ervoor**: lees nogmaals sectie 4 (incidenten) — dit is je sterkste differentiator.
4. **Tijdens interview**: wanneer je een vraag krijgt, neem **3 seconden om te denken**. Beter een goed antwoord na 3 seconden dan een rommelige na 0 seconden.
5. **Frame altijd op impact + trade-off, niet op tech-namen**:
   - Slecht: "ik gebruikte Pub/Sub"
   - Goed: "ik koos Pub/Sub omdat we onder 10 GB/maand zaten waar het free is — bij Kafka was het minimaal €100/maand cluster fee zonder voordeel bij dit volume"

---

## 9. Verwijzingen

- Repository: https://github.com/JawadNM44/analytics-engine
- Inspiratie interview-frame: [Alexey Grigorev — AI Engineering Field Guide](https://github.com/alexeygrigorev/ai-engineering-field-guide), specifiek `interview/questions/03-project-deep-dive.md`
- Sources van interview-vragen in dit document: bovenstaande repo + Anthropic / OpenAI / Meta interview write-ups
