# Books

A dark-themed, page-by-page PDF reader with highlights, notes, table of
contents and in-book search. Runs locally with a small Node server *or* as
a fully-static site on GitHub Pages.

## Features

- Library with real first-page cover thumbnails (lazy-rendered, cached)
- Page-by-page reading (no scroll) with smooth transitions
- Dark theme with an inverted filter on the page canvas only — text, selection
  and highlight colors stay natural
- Highlight selected text in four colors; attach notes that persist
- Contents panel built from the PDF outline (`T`)
- In-book search with background indexing and highlighted snippets (`Ctrl/Cmd+F`)
- Last-page-per-book memory
- PDF metadata (title/author) extracted automatically with filename fallback
- Keyboard nav: `←/→`, `Space`, `PageUp/Down`, `Home/End`, `+/-`, `N`, `T`, `Esc`

## Run locally (with persistence to disk)

```sh
npm install
npm start
# http://localhost:3000
```

Annotations are written to `data/annotations.json`.

## Add books

Drop any `.pdf` into the `Content/` folder. Filenames like
`Some-Title-by-Author-Name.pdf` are auto-parsed; embedded PDF metadata
(title/author) wins when present.

## Publish to GitHub Pages

The frontend works without the Node server — it falls back to `localStorage`
for annotations when no `/api/*` endpoints are reachable.

The workflow at `.github/workflows/pages.yml` runs on every push to `main`
and publishes the site **two ways at once** so either Pages source mode
works:

1. via the standard `actions/deploy-pages` flow (needs **Pages source =
   "GitHub Actions"**), and
2. by force-pushing the built `_site/` to a `gh-pages` branch (needs
   **Pages source = "Deploy from a branch", branch `gh-pages`, folder `/`**).

### One-time setup

In the repo on GitHub: **Settings → Pages → Build and deployment → Source**.
Pick whichever you prefer:

- **GitHub Actions** (recommended). Save. The next push to `main` (or a
  manual re-run from the Actions tab) deploys.
- **Deploy from a branch** → branch `gh-pages` → folder `/ (root)`. Save.
  Same thing.

> If Pages source is left at the default "Deploy from a branch / `main` /
> `/ (root)`", the README is rendered as the homepage instead of the app.
> Either of the two options above fixes it.

### What the workflow assembles

The `_site/` folder contains:

- `public/*` (HTML / CSS / JS)
- `Content/*` PDFs copied to `_site/content/`
- a generated `books.json` listing the books
- the PDF.js runtime + `cmaps/` + `standard_fonts/` from `node_modules/pdfjs-dist/`

### Static-mode caveats

- All annotations and highlights live in the browser's `localStorage`
  (per device, per browser).
- PDFs are committed to the repo and served as static files (GitHub Pages
  has a 100 MB per-file limit and ~1 GB site limit).
