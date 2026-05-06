# Project Presentation

`PROJECT_PRESENTATION.md` is a [Marp](https://marp.app/) slide deck that walks through the entire project: every architectural choice, the key code lines, the six production incidents, and the cost story.

## Render the slides

### Option A — VS Code (easiest)

1. Install the [Marp for VS Code](https://marketplace.visualstudio.com/items?itemName=marp-team.marp-vscode) extension.
2. Open `PROJECT_PRESENTATION.md`.
3. Click the "Marp: Open Preview" icon, or export to PDF/HTML/PPTX via the command palette.

### Option B — CLI

```bash
npx @marp-team/marp-cli PROJECT_PRESENTATION.md --pdf       # → PROJECT_PRESENTATION.pdf
npx @marp-team/marp-cli PROJECT_PRESENTATION.md --html      # → PROJECT_PRESENTATION.html
npx @marp-team/marp-cli PROJECT_PRESENTATION.md --pptx      # → PROJECT_PRESENTATION.pptx
```

### Option C — read it in raw markdown

The file is structured for human reading too. Each `---` is a slide boundary. Open it in any markdown viewer.

## Audience

Designed for a 30-45 minute project deep-dive interview. Slides are dense by design — they double as speaker notes. For a presentation you would advance one slide per ~60-90 seconds and elaborate verbally.

## What the deck covers

- Architecture overview and tech-stack rationale
- Each pipeline layer with its key code (producer, function, BigQuery, BQML, API, dashboard)
- Terraform structure and IAM least-privilege model
- Workload Identity Federation (keyless CI/CD)
- All six production incidents — symptom, root cause, fix, lesson
- Cost breakdown
- "What I'd do differently" honest reflection
- Live demo URLs

For a denser interview script (Q&A + 8 architectural decisions with trade-offs), see `docs/PROJECT_DEFENSE.md` (kept locally).
