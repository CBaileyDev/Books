const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'Content');
const DATA_DIR = path.join(ROOT, 'data');
const ANNOTATIONS_FILE = path.join(DATA_DIR, 'annotations.json');

if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(ANNOTATIONS_FILE)) fs.writeFileSync(ANNOTATIONS_FILE, '{}');

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/pdfjs', express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist')));
app.use('/content', express.static(CONTENT_DIR));

function prettifyTitle(filename) {
  let base = filename.replace(/\.pdf$/i, '');
  // Strip common library markers before splitting words
  base = base
    .replace(/[\s_-]*\(?z[-_]?lib(\.org)?\)?[\s_-]*/gi, ' ')
    .replace(/[\s_-]*libgen[\s_-]*/gi, ' ');
  const cleaned = base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const byMatch = cleaned.match(/^(.*?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return { title: byMatch[1].trim(), author: byMatch[2].trim() };
  }
  return { title: cleaned, author: '' };
}

function readAnnotations() {
  try {
    return JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAnnotations(data) {
  fs.writeFileSync(ANNOTATIONS_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/books', (req, res) => {
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'));
  const all = readAnnotations();
  const books = files.map((f) => {
    const fnMeta = prettifyTitle(f);
    const stored = all[f] || {};
    const annotations = stored.annotations || [];
    const stMeta = stored.metadata || {};
    return {
      id: f,
      title: (stMeta.title && String(stMeta.title).trim()) || fnMeta.title,
      author: (stMeta.author && String(stMeta.author).trim()) || fnMeta.author,
      file: '/content/' + encodeURIComponent(f),
      lastPage: stored.lastPage || 1,
      totalPages: stored.totalPages || null,
      highlightsCount: annotations.filter((a) => !a.note).length,
      notesCount: annotations.filter((a) => a.note).length,
      hasMetadata: !!stored.metadata,
    };
  });
  res.json(books);
});

app.get('/api/annotations/:bookId', (req, res) => {
  const all = readAnnotations();
  const data = all[req.params.bookId] || {
    annotations: [],
    lastPage: 1,
    totalPages: null,
  };
  res.json(data);
});

app.post('/api/annotations/:bookId', (req, res) => {
  const all = readAnnotations();
  const existing = all[req.params.bookId] || {};
  all[req.params.bookId] = { ...existing, ...req.body };
  writeAnnotations(all);
  res.json({ ok: true });
});

app.post('/api/books/:bookId/metadata', (req, res) => {
  const { title, author } = req.body || {};
  const all = readAnnotations();
  const existing = all[req.params.bookId] || {};
  existing.metadata = {
    title: (title || '').toString().trim(),
    author: (author || '').toString().trim(),
  };
  all[req.params.bookId] = existing;
  writeAnnotations(all);
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n  Books Reader running at:  http://localhost:' + PORT + '\n');
});
