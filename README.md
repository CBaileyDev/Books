# Books

A local, dark-themed, page-by-page book reader with highlights and notes.

## Features

- **Library view** of all PDFs dropped into the `Content/` folder
- **Page-by-page reading** (no scroll) with smooth flip animations
- **Dark theme** that's still easy on the eyes (PDF pages rendered with an inverted dark filter)
- **Highlight** selected text in 4 colors
- **Notes** attached to highlights, persisted to disk
- **Last-page memory** so each book reopens where you left off
- **Keyboard navigation**: ←/→ pages, +/− zoom, N notes panel, Esc back
- All local — your annotations live in `data/annotations.json`

## Setup

```sh
npm install
npm start
```

Then open <http://localhost:3000>.

## Adding books

Drop any `.pdf` file into the `Content/` folder. Filenames like
`Some-Title-by-Author-Name.pdf` are auto-parsed for title and author.
Refresh the library to see new books.
