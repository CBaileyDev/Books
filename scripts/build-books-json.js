#!/usr/bin/env node
// Generates books.json from the Content/ folder.
// Used by the GitHub Pages build (the static site has no server).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'Content');
const outFile = process.argv[2] || path.join(ROOT, 'public', 'books.json');

function prettifyTitle(filename) {
  let base = filename.replace(/\.pdf$/i, '');
  base = base
    .replace(/[\s_-]*\(?z[-_]?lib(\.org)?\)?[\s_-]*/gi, ' ')
    .replace(/[\s_-]*libgen[\s_-]*/gi, ' ');
  const cleaned = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const byMatch = cleaned.match(/^(.*?)\s+by\s+(.+)$/i);
  if (byMatch) return { title: byMatch[1].trim(), author: byMatch[2].trim() };
  return { title: cleaned, author: '' };
}

if (!fs.existsSync(CONTENT_DIR)) {
  console.error('No Content/ folder at', CONTENT_DIR);
  process.exit(1);
}

const files = fs
  .readdirSync(CONTENT_DIR)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort();

const books = files.map((f) => {
  const meta = prettifyTitle(f);
  return {
    id: f,
    title: meta.title,
    author: meta.author,
    file: 'content/' + encodeURIComponent(f),
    lastPage: 1,
    totalPages: null,
    highlightsCount: 0,
    notesCount: 0,
    hasMetadata: false,
  };
});

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(books, null, 2) + '\n');
console.log('Wrote', books.length, 'book(s) to', path.relative(ROOT, outFile));
