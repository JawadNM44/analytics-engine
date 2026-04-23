# Feature Roadmap — Analytics Engine

> Dit document beschrijft alle geplande features in detail.
> Bedoeld voor Jawad (eerstejaars student, engineering mindset aan het ontwikkelen)
> én voor Claude (Code of Chat) om direct te begrijpen wat er staat en wat de intentie is.
>
> Lees PROJECT.md eerst voor de volledige projectcontext.

---

## Feature 1 — GitHub Secrets instellen (CI/CD voltooien)

### Wat is het?
De GitHub Actions workflow (`.github/workflows/deploy.yml`) is volledig geschreven en staat in de repo. Maar hij kan nog niet echt deployen naar GCP omdat drie geheimen ontbreken in GitHub.

### Waarom ontbreekt dit nog?
De geheimen (`WIF_PROVIDER` en `WIF_SA_EMAIL`) worden pas bekend **nadat** Terraform de Workload Identity pool aanmaakt. Dat is nu gedaan — dus de waarden bestaan, ze moeten alleen nog in GitHub worden ingevoerd.

### Wat zijn de drie secrets?

| Secret | Waarde | Waar vandaan |
|--------|--------|--------------|
| `GCP_PROJECT_ID` | `project-1f299b47-8676-4148-acb` | Bekend |
| `WIF_PROVIDER` | `projects/35630345943/locations/global/workloadIdentityPools/github-pool/providers/github-provider` | Terraform output |
| `WIF_SA_EMAIL` | `sa-github-cicd@project-1f299b47-8676-4148-acb.iam.gserviceaccount.com` | Terraform output |

### Wat gebeurt er daarna?
Elke keer dat Jawad code pusht naar `main` op GitHub:
1. Tests draaien automatisch
2. Terraform plan wordt gemaakt (preview van wijzigingen)
3. Na handmatige goedkeuring: Terraform apply deployt naar GCP

**Dit is de definitie van CI/CD.** Geen handmatige stappen meer.

### Hoe te implementeren?
1. Ga naar github.com/JawadNM44/analytics-engine
2. Settings → Secrets and variables → Actions → New repository secret
3. Voeg de drie secrets toe
4. Settings → Environments → New environment → naam: `production` → Required reviewers: JawadNM44

### Moeilijkheid: ⭐ (makkelijkst, geen code)
### Impact: ⭐⭐⭐⭐⭐ (maakt het project professioneel compleet)

---

## Feature 2 — Looker Studio Dashboard

### Wat is het?
Een gratis, visueel dashboard dat rechtstreeks op de BigQuery tabellen connecteert. Geen code. Drag-and-drop grafieken. Deelbaar via een link — iedereen kan het zien zonder GCP toegang.

### Waarom is dit de "business laag"?
Nu heb je:
- **Technische laag**: Cloud Monitoring (latency, errors, instance count)
- **Data laag**: BigQuery (ruwe rijen, SQL queries)

Wat ontbreekt:
- **Business laag**: "Hoeveel fraude was er gisteren? Welk land heeft het hoogste risicobedrag? Welke merchant wordt het vaakst geflagd?"

Dat is Looker Studio. Het antwoord op vragen die een CEO of analist zou stellen, niet een engineer.

### Welke grafieken zouden er komen?
- **Scorecards** bovenaan: totaal transacties vandaag, totaal volume, % high-risk
- **Tijdlijn**: transacties per uur over de afgelopen 7 dagen
- **Staafdiagram**: high-risk count per land (CN, RU, NG springen eruit)
- **Taartdiagram**: verdeling per card type (VISA vs MASTERCARD vs AMEX)
- **Tabel**: top 10 merchants op volume
- **Geo-kaart**: transactievolume per land op een wereldkaart

### Hoe te implementeren?
1. Ga naar lookerstudio.google.com
2. Maak een nieuwe rapport aan
3. Voeg BigQuery als data source toe → selecteer `transactions_ds.all_transactions`
4. Bouw grafieken met drag-and-drop
5. Deel de link publiek

### Moeilijkheid: ⭐⭐ (geen code, wel logisch nadenken over wat je wil zien)
### Impact: ⭐⭐⭐⭐⭐ (het mooiste onderdeel om te laten zien aan recruiters)

---

## Feature 3 — Velocity Detection (fraudedetectie upgrade)

### Wat is het?
Nu detecteert de Cloud Function fraude op basis van twee simpele regels:
- Bedrag > $500
- Land = hoog-risico

**Velocity detection** is een derde regel: detecteer wanneer dezelfde gebruiker meerdere transacties doet binnen een korte tijdspanne. Bijvoorbeeld: user_042 doet 8 transacties in 30 seconden — dat is geen normaal gedrag, dat is een gestolen kaart die getest wordt.

### Waarom is dit de meest interessante feature?
Het huidige systeem kijkt naar **één transactie tegelijk** (stateless). Velocity detection vereist dat je **meerdere transacties over tijd** bekijkt. Dat is fundamenteel anders — het is de stap van regelgebaseerde detectie naar gedragsanalyse.

Echte fraude-engines bij Stripe, Adyen en Mastercard doen precies dit, maar dan met machine learning.

### Hoe werkt het technisch?
We hebben een tijdelijk geheugen nodig per gebruiker. Opties:

**Optie A: Redis (Memorystore)** — de professionele aanpak
- Sla per user_id op: lijst van timestamps van recente transacties
- Bij elke nieuwe transactie: haal de lijst op, tel hoeveel er in de laatste 60 seconden zijn
- Als dat > 5 is: flag als high-risk met reden "velocity breach"
- Redis is in-memory, dus microseconde snelheid

**Optie B: BigQuery lookup** — eenvoudiger, maar trager
- Doe een BigQuery query bij elke transactie: "hoeveel transacties had deze user in de laatste 60 seconden?"
- Trager (100-500ms per query) maar geen extra infrastructuur

**Optie C: Cloud Function instance memory** — hacky, niet schaalbaar
- Sla een dict op in geheugen van de functie instantie
- Werkt alleen als dezelfde instantie dezelfde user ziet — niet betrouwbaar

### Aanbevolen aanpak voor dit project
Begin met Optie B (BigQuery lookup). Simpel, bewijst het concept. Later upgraden naar Redis als je wil laten zien dat je schaalbaarheidsproblemen begrijpt.

### Wat verandert er in de code?
In `function/main.py` — nieuwe functie naast `is_high_risk`:

```python
def check_velocity(user_id: str, window_seconds: int = 60, threshold: int = 5) -> tuple[bool, str]:
    query = f"""
        SELECT COUNT(*) as cnt
        FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ALL}`
        WHERE user_id = '{user_id}'
        AND processed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {window_seconds} SECOND)
    """
    result = list(bq().query(query))
    count = result[0].cnt if result else 0
    if count >= threshold:
        return True, f"velocity breach: {count} transactions in {window_seconds}s"
    return False, ""
```

### Nieuwe unit tests nodig
- Test: user met 3 transacties in 60s → geen velocity breach
- Test: user met 6 transacties in 60s → velocity breach
- Test: user met 6 transacties verspreid over 2 uur → geen breach

### Moeilijkheid: ⭐⭐⭐ (eerste echte code feature, Jawad schrijft dit zelf met begeleiding)
### Impact: ⭐⭐⭐⭐ (toont begrip van stateful detectie — grote stap in engineering mindset)

---

## Feature 4 — Producer als Cloud Run Job

### Wat is het?
De producer (`producer/main.py`) draait nu alleen lokaal op Jawads MacBook. Als Cloud Run Job kan hij vanuit GCP zelf getriggerd worden — geen laptop nodig.

### Waarom maakt dit uit?
Stel je voor: je wil elke dag om 09:00 een testrun van 100k transacties sturen om te verifiëren dat de pipeline werkt. Nu moet je daarvoor je laptop aanzetten en het script handmatig draaien. Als Cloud Run Job kan dat geautomatiseerd worden via Cloud Scheduler — volledig zonder menselijke tussenkomst.

Dit is ook waarom het systeem "zelfherstellend" is — het kan zichzelf testen.

### Wat is een Cloud Run Job?
Verschil met Cloud Run Service:
- **Service**: draait continu, wacht op HTTP verzoeken (zoals de Cloud Function)
- **Job**: draait eenmalig, doet zijn werk, stopt. Geen idle kosten.

Perfect voor batch producers, data migrations, periodieke exports.

### Wat verandert er?
1. `producer/Dockerfile` aanmaken
2. `producer/main.py` licht aanpassen (al klaar voor omgevingsvariabelen)
3. Terraform: `google_cloud_run_v2_job` resource toevoegen
4. Terraform: `google_cloud_scheduler_job` toevoegen voor dagelijkse trigger
5. GitHub Actions: Docker image builden en pushen naar Artifact Registry

### Hoe ziet de Terraform resource eruit?
```hcl
resource "google_cloud_run_v2_job" "producer" {
  name     = "transaction-producer"
  location = var.region

  template {
    template {
      containers {
        image = "us-central1-docker.pkg.dev/${var.project_id}/analytics/producer:latest"
        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }
        env {
          name  = "TOTAL_MESSAGES"
          value = "100000"
        }
      }
      service_account = google_service_account.producer_sa.email
    }
  }
}
```

### Moeilijkheid: ⭐⭐⭐ (Docker + Terraform uitbreiding)
### Impact: ⭐⭐⭐ (volledig cloudnative, geen lokale afhankelijkheid meer)

---

## Feature 5 — Meerdere Pub/Sub Consumers

### Wat is het?
Nu heeft Pub/Sub één subscriber: de Cloud Function die alles naar BigQuery schrijft. Je kan meerdere subscribers toevoegen op hetzelfde topic — elk krijgt een kopie van elk bericht.

### Waarom is dit architectureel belangrijk?
Dit heet het **fan-out patroon**. Het is de reden waarom grote systemen Pub/Sub gebruiken in plaats van directe API calls.

Zonder fan-out:
```
Producer → Cloud Function A (BigQuery)
```
Als je later ook naar Elasticsearch wil schrijven, moet je Cloud Function A aanpassen.

Met fan-out:
```
Producer → Pub/Sub Topic → Subscription A → Cloud Function (BigQuery)
                        → Subscription B → Cloud Function (Elasticsearch)
                        → Subscription C → Cloud Function (Email alerts)
```
Elke consumer is onafhankelijk. Je voegt een nieuwe toe zonder bestaande code aan te raken.

### Welke consumers zouden we toevoegen?

**Consumer B: Real-time email alerts**
- Triggert alleen voor transacties met amount > $5000
- Stuurt een email via SendGrid of Gmail API
- "Grote transactie gedetecteerd: $8,432 van user_042341 in Nigeria"

**Consumer C: Aggregatie naar Firestore**
- Schrijft per user_id een live counter: totaal transacties, totaal volume, laatste activiteit
- Kan gebruikt worden voor een real-time user dashboard

### Wat verandert er in Terraform?
```hcl
resource "google_pubsub_subscription" "alert_sub" {
  name  = "transactions-alert-sub"
  topic = google_pubsub_topic.transactions.name
  # ... push config naar nieuwe Cloud Function
}
```

### Moeilijkheid: ⭐⭐⭐ (nieuwe Cloud Function + Terraform subscription)
### Impact: ⭐⭐⭐⭐ (toont begrip van event-driven architecture — dé skill voor distributed systems)

---

## Feature 6 — Load Testing Rapport

### Wat is het?
Een formeel meetrapport: hoeveel berichten per seconde kan het systeem aan, wat is de P99 latency bij 10k/s vs 50k/s vs 100k/s, waar knijpt het?

### Waarom is dit indrukwekkend?
Iedereen kan zeggen "mijn systeem is schaalbaar." Niemand kan het bewijzen zonder cijfers. Een load testing rapport met grafieken zegt:
- Bij 10,000 msg/s: P99 latency = 45ms, 0 errors
- Bij 50,000 msg/s: P99 latency = 120ms, 0 errors
- Bij 100,000 msg/s: P99 latency = 380ms, 0.02% errors

Dat zijn de getallen die je in een presentatie of interview gebruikt.

### Hoe te implementeren?
1. Producer uitbreiden met configureerbare burst rates
2. 5 test runs doen: 1k, 10k, 50k, 100k, 200k msg/s
3. Na elke run: BigQuery + Cloud Monitoring uitlezen voor metrics
4. Resultaten in een tabel + grafiek in README

### Moeilijkheid: ⭐⭐ (geen nieuwe code, wel methodisch testen)
### Impact: ⭐⭐⭐ (maakt het verhaal concreet met harde data)

---

## Aanbevolen volgorde

```
Nu →  [1] GitHub Secrets    (10 min, geen code, CI/CD compleet)
     [2] Looker Studio      (30 min, geen code, mooiste output)
     [3] Velocity detection (2-3 uur, Jawad schrijft dit zelf)
     [6] Load testing       (1 uur, methodisch testen)
     [4] Cloud Run Job      (halve dag, Docker + Terraform)
     [5] Fan-out consumers  (halve dag, architectuur uitbreiden)
```

---

## Hoe dit aan Claude Chat uitleggen

Plak dit bovenaan een nieuwe chat op claude.ai:

> "Ik ben Jawad, eerstejaars student. Ik heb een live GCP analytics pipeline
> gebouwd (zie PROJECT.md en FEATURES.md op github.com/JawadNM44/analytics-engine).
> Help me [specifieke feature] bouwen / uitleggen.
> Leg het uit op een manier die me helpt de engineering mindset te ontwikkelen,
> niet alleen de code te kopiëren."
