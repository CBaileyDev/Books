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

To publish:

1. Push to the `main` branch (the workflow at `.github/workflows/pages.yml`
   builds the static site automatically).
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
3. The first push to `main` (or a manual run from the Actions tab) will
   deploy to `https://<your-username>.github.io/<repo>/`.

The Action assembles a `_site/` folder containing:

- `public/*` (HTML / CSS / JS)
- `Content/*` PDFs copied to `_site/content/`
- a generated `books.json` listing the books
- the PDF.js runtime files copied from `node_modules/pdfjs-dist/`

In the static deploy:

- All annotations and highlights live in the browser's `localStorage`
  (per device, per browser).
- PDFs are committed to the repo and served as static files (GitHub Pages
  has a 100 MB per-file limit and ~1 GB site limit).
