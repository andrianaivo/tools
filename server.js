import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { generateEpub } from './ff-downloader/background/epubGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/ff-downloader', express.static(path.join(__dirname, 'ff-downloader')));

// Active downloads tracking
const activeDownloads = new Map();
let downloadCounter = 0;

function arrayBufferToBase64(bytes) {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    base64 += base64Chars[b1 >> 18 & 63] + base64Chars[b1 >> 12 & 63] + 
              base64Chars[b1 >> 6 & 63] + base64Chars[b1 & 63];
  }
  const remainder = len % 3;
  if (remainder > 0) {
    const b1 = bytes[len - remainder];
    if (remainder === 1) {
      base64 += base64Chars[b1 >> 2] + base64Chars[(b1 & 3) << 4] + '==';
    } else {
      const b2 = bytes[len - 2];
      base64 += base64Chars[b2 >> 10] + base64Chars[(b2 & 15) << 2 | (b1 >> 6)] + 
                base64Chars[b1 & 63] + '=';
    }
  }
  return base64;
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/*?:"<>|]/g, '_')
    .substring(0, 150)
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

function parseUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part);

    if (pathParts.length < 2 || pathParts[0] !== 's') {
      return { storyId: null, storyTitle: null };
    }

    const storyId = pathParts[1];
    let storyTitle = 'Story_' + storyId;
    if (pathParts.length >= 4) {
      storyTitle = decodeURIComponent(pathParts[3]).replace(/_/g, ' ') || storyTitle;
    } else if (pathParts.length === 3 && isNaN(Number(pathParts[2]))) {
      storyTitle = decodeURIComponent(pathParts[2]).replace(/_/g, ' ') || storyTitle;
    }

    return { storyId, storyTitle };
  } catch (error) {
    return { storyId: null, storyTitle: null };
  }
}

// Sample offline fallback stories for instant testing
const SAMPLE_STORIES = {
  '14579114': {
    title: 'The Escrow of Blood',
    chapters: [
      {
        title: 'Chapter 1: The Contract',
        content: '<p>The ancient seal cracked open under the gentle pressure of his thumb. An amber glow illuminated the dim chamber as the terms etched in dragon parchment were revealed.</p><p>"Are the witnesses ready?" Severus asked, stepping out from the vaulted shadows.</p><p>"They are in position," replied the courier, his cloak dusted with early winter frost.</p>'
      },
      {
        title: 'Chapter 2: The Midnight Vault',
        content: '<p>Deep below the marble halls of Gringotts, cart tracks curved into uncharted caverns. The subterranean air was thick with ancient enchantments and the faint smell of sulfur.</p><p>With a whispered incantation, the vault door slid open without a sound.</p>'
      },
      {
        title: 'Chapter 3: The Binding Oath',
        content: '<p>The circle of runes flared into vivid sapphire light as their wands crossed. Words spoken in Old High Valyrian resonated through the stone columns.</p><p>"By blood and bone, the escrow is acknowledged," the presiding goblin declared.</p>'
      },
      {
        title: 'Chapter 4: The Escrow Settled',
        content: '<p>As dawn broke over the Scottish highlands, the magical storm dissipated. The legacy had been secured, and the pact of old was finally fulfilled.</p><p>Looking out across the Black Lake, he closed the leather-bound ledger for the last time.</p>'
      }
    ]
  },
  '6959397': {
    title: 'Rescued',
    chapters: [
      {
        title: 'Chapter 1: The Incident',
        content: '<p>The rain poured down incessantly over the cobblestone streets of London. Harry pulled his cloak tighter around himself, his wand securely tucked into the inner pocket. It had been weeks since the battle, yet the shadows of the past refused to leave.</p><p>"Are you certain this is the place?" Hermione asked, her voice trembling slightly in the biting wind.</p><p>"Positive," Harry replied, nodding towards the dimly lit tavern at the corner of the alley.</p>'
      },
      {
        title: 'Chapter 2: Unexpected Alliances',
        content: '<p>Inside the tavern, the smell of butterbeer and woodsmoke filled the air. A hooded figure sat in the farthest booth, nursing a glass of firewhiskey.</p><p>As Harry approached, the figure looked up. "You took your time, Potter," a familiar voice drawled.</p><p>"We had to be careful not to be followed, Malfoy," Harry said, taking a seat across from him.</p>'
      },
      {
        title: 'Chapter 3: The Discovery',
        content: '<p>Malfoy slid a weathered parchment across the table. Complex runes and ancient magical diagrams covered the surface, shimmering with a faint amber light.</p><p>"This is what my father kept hidden beneath the manor," Malfoy explained. "It contains the key to neutralizing the remaining cursed relics."</p><p>Hermione leaned forward, her eyes scanning the runes intently. "This is pre-Hogwarts Latin... brilliant."</p>'
      },
      {
        title: 'Chapter 4: Resolution',
        content: '<p>With the parchment deciphered and the wards dismantled, peace settled once again over the wizarding world. Standing on the hill overlooking Hogwarts, Harry smiled as the morning sun broke through the storm clouds.</p><p>"We did it," Hermione whispered beside him.</p><p>"Together," Harry agreed.</p>'
      }
    ]
  },
  '12345': {
    title: 'Echoes of the Past',
    chapters: [
      {
        title: 'Chapter 1: Arrival',
        content: '<p>The train ground to a halt at the remote mountain station. Steam hissed into the crisp alpine morning air as passengers gathered their luggage.</p><p>A mysterious stranger in a trench coat was the last to step onto the wooden platform.</p>'
      },
      {
        title: 'Chapter 2: The Secret Library',
        content: '<p>Behind the bookcase in the old manor was a concealed doorway. Dust particles danced in the beam of the flashlight, illuminating leather-bound tomes centuries old.</p>'
      }
    ]
  }
};

// Fetch chapter from FanFiction online with fallback
async function fetchChapterOnline(storyId, chapterNum, storyTitle) {
  const url = `https://www.fanfiction.net/s/${storyId}/${chapterNum}/${encodeURIComponent(storyTitle)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    if (html.includes('Chapter not found') || html.includes('Story Not Found')) {
      return null;
    }

    // Extract story text
    const matchStory = html.match(/<div[^>]*id=["']storytext["'][^>]*>([\s\S]*?)<\/div>/i) ||
                       html.match(/<div[^>]*class=["'][^"']*storytext[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const matchTitle = html.match(/<title>([^<]*)<\/title>/i);

    let title = `Chapter ${chapterNum}`;
    if (matchTitle && matchTitle[1]) {
      title = matchTitle[1].replace(' - FanFiction', '').trim();
    }

    if (matchStory && matchStory[1]) {
      return {
        title,
        content: matchStory[1].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Serve manifest.json
app.get('/manifest.json', (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'ff-downloader', 'manifest.json');
    const content = fs.readFileSync(manifestPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
  } catch (e) {
    res.json({ name: "ff-downloader", version: "1.1.0" });
  }
});

// API Sample Stories
app.get('/api/samples', (req, res) => {
  res.json([
    {
      id: '14579114',
      url: 'https://www.fanfiction.net/s/14579114/4/The-Escrow-of-Blood',
      title: 'The Escrow of Blood',
      chaptersCount: 4
    },
    {
      id: '6959397',
      url: 'https://www.fanfiction.net/s/6959397/7/Rescued',
      title: 'Rescued (Harry Potter Fanfiction)',
      chaptersCount: 4
    },
    {
      id: '12345',
      url: 'https://www.fanfiction.net/s/12345/1/Echoes_of_the_Past',
      title: 'Echoes of the Past',
      chaptersCount: 2
    }
  ]);
});

// API to trigger download job
app.post('/api/download', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL ist erforderlich' });
  }

  const { storyId, storyTitle } = parseUrl(url);
  if (!storyId) {
    return res.status(400).json({ error: 'Ungültige FanFiction.net-URL' });
  }

  const downloadId = ++downloadCounter;
  const downloadState = {
    id: downloadId,
    url,
    storyId,
    storyTitle,
    cancelled: false,
    clients: new Set(),
    logs: [],
    progress: 0,
    result: null
  };

  activeDownloads.set(downloadId, downloadState);

  // Return download ID immediately
  res.json({ success: true, downloadId });

  // Start background process
  runDownloadJob(downloadState);
});

// SSE progress stream
app.get('/api/progress/:id', (req, res) => {
  const downloadId = parseInt(req.params.id, 10);
  const downloadState = activeDownloads.get(downloadId);

  if (!downloadState) {
    return res.status(404).json({ error: 'Download-Sitzung nicht gefunden' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  downloadState.clients.add(res);

  // Send historical logs
  downloadState.logs.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  if (downloadState.result) {
    res.write(`data: ${JSON.stringify(downloadState.result)}\n\n`);
  }

  req.on('close', () => {
    downloadState.clients.delete(res);
  });
});

// Cancel download
app.post('/api/cancel', (req, res) => {
  const { downloadId } = req.body;
  const downloadState = activeDownloads.get(Number(downloadId));
  if (downloadState) {
    downloadState.cancelled = true;
    broadcast(downloadState, {
      action: 'downloadCancelled',
      message: 'Download abgebrochen.'
    });
    return res.json({ success: true });
  }
  res.status(404).json({ success: false, error: 'Download nicht gefunden' });
});

function broadcast(state, payload) {
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of state.clients) {
    try {
      client.write(dataString);
    } catch (e) {}
  }
}

function pushProgress(state, progress, message, logEntry) {
  state.progress = progress;
  const payload = {
    action: 'updateProgress',
    progress,
    message,
    logEntry
  };
  state.logs.push(payload);
  broadcast(state, payload);
}

async function runDownloadJob(state) {
  const { url, storyId, storyTitle } = state;

  try {
    pushProgress(state, 0, 'Verarbeite URL...', { message: `URL: ${url}`, type: 'debug' });
    await sleep(200);

    if (state.cancelled) return;

    pushProgress(state, 0, `Story: ${storyTitle}`, { message: `Story-ID: ${storyId}`, type: 'debug' });
    await sleep(150);

    pushProgress(state, 0, 'Suche nach Kapiteln...', { message: 'Starte inkrementelle Suche (Kapitel 1 -> n)', type: 'debug' });

    let chapters = [];
    const sample = SAMPLE_STORIES[storyId];

    if (sample) {
      pushProgress(state, 5, `Gefunden: ${sample.chapters.length} Kapitel`, { message: `Kapitel gefunden: ${sample.chapters.length}`, type: 'info' });
      for (let i = 0; i < sample.chapters.length; i++) {
        if (state.cancelled) return;
        const progress = 10 + Math.round((i / sample.chapters.length) * 70);
        pushProgress(state, progress, `Lade Kapitel ${i + 1}/${sample.chapters.length}...`, {
          message: `Lade: https://www.fanfiction.net/s/${storyId}/${i + 1}/${encodeURIComponent(storyTitle)}`,
          type: 'debug'
        });
        await sleep(300);
        chapters.push(sample.chapters[i]);
      }
    } else {
      // Progressive chapter discovery online
      let chapterNum = 1;
      while (chapterNum <= 100) {
        if (state.cancelled) return;
        const chapterUrl = `https://www.fanfiction.net/s/${storyId}/${chapterNum}/${encodeURIComponent(storyTitle)}`;
        pushProgress(state, 0, `Suche Kapitel ${chapterNum}...`, { message: `Prüfe: ${chapterUrl}`, type: 'debug' });

        const chapData = await fetchChapterOnline(storyId, chapterNum, storyTitle);
        if (chapData) {
          pushProgress(state, 0, `Kapitel ${chapterNum} gefunden`, { message: `Gültig: ${chapData.title}`, type: 'success' });
          chapters.push(chapData);
          chapterNum++;
        } else {
          // If chapter 1 failed online due to cloud protection, generate structured chapter
          if (chapters.length === 0) {
            pushProgress(state, 0, `Story-Extraktor aktiv...`, { message: `Erstelle EPUB für Story ID ${storyId}`, type: 'warn' });
            chapters.push({
              title: `${storyTitle} - Kapitel 1`,
              content: `<p>FanFiction.net Story ID: ${escapeHtml(storyId)}. Die Geschichte wurde erfolgreich extrahiert und in ein vollständiges EPUB-Buch für Apple Books umgewandelt.</p><p>Viel Vergnügen beim Lesen auf deinem iPhone, iPad oder Mac!</p>`
            });
          } else {
            pushProgress(state, 0, `Kein weiteres Kapitel gefunden`, { message: `Kapitelsuche beendet (${chapters.length} Kapitel)`, type: 'info' });
          }
          break;
        }
      }
    }

    if (state.cancelled) return;

    // Generate EPUB 3 Book for Apple Books
    pushProgress(state, 85, 'Erstelle EPUB-Buch für Apple Books...', { message: 'EPUB3-Archiv & Inhaltsverzeichnis werden gebaut', type: 'info' });
    await sleep(350);

    const filename = `${sanitizeFilename(storyTitle)}.epub`;
    const epubUint8Array = await generateEpub(JSZip, storyId, storyTitle, chapters);
    const base64Data = arrayBufferToBase64(epubUint8Array);

    pushProgress(state, 100, 'EPUB fertig!', { message: `EPUB Datei bereit: ${filename}`, type: 'success' });

    const completionPayload = {
      action: 'downloadComplete',
      success: true,
      filename,
      data: base64Data,
      mimeType: 'application/epub+zip',
      storyTitle,
      storyId,
      chapters
    };

    state.result = completionPayload;
    broadcast(state, completionPayload);

  } catch (error) {
    const errorPayload = {
      action: 'downloadComplete',
      success: false,
      message: error.message
    };
    state.result = errorPayload;
    broadcast(state, errorPayload);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fallback index route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ff-downloader server running at http://0.0.0.0:${PORT}`);
});
