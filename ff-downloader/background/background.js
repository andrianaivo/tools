// Globale Variablen
let currentDownload = null;
let cancelRequested = false;
let downloadIdCounter = 0;

// Höre auf Nachrichten vom Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDownload') {
    const downloadId = ++downloadIdCounter;
    startDownload(request.url, downloadId, sendResponse);
    return true; // Asynchrone Antwort
  } else if (request.action === 'cancelDownload') {
    if (currentDownload && currentDownload.id === request.downloadId) {
      cancelRequested = true;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Download nicht gefunden' });
    }
  }
});

// Starte den Download-Prozess
async function startDownload(url, downloadId, initialSendResponse) {
  currentDownload = { id: downloadId };
  cancelRequested = false;

  // Sende die downloadId sofort zurück
  initialSendResponse({ success: true, downloadId });

  try {
    sendProgress(0, 'Verarbeite URL...', { message: `URL: ${url}`, type: 'debug' });

    // Extrahiere Story-ID und Titel aus der URL
    const { storyId, storyTitle } = parseUrl(url);
    if (!storyId) {
      throw new Error('Ungültige FanFiction.net-URL');
    }

    sendProgress(0, `Verarbeite: ${storyTitle}`, { message: `Story-ID: ${storyId}`, type: 'debug' });

    // Lade alle Kapitel-URLs durch inkrementelle Suche
    sendProgress(0, 'Suche nach Kapiteln...', { message: 'Starte inkrementelle Suche', type: 'debug' });
    const chapterUrls = await getAllChapterUrls(storyId, storyTitle);
    
    if (!chapterUrls.length) {
      throw new Error('Keine Kapitel gefunden');
    }

    sendProgress(5, `Gefunden: ${chapterUrls.length} Kapitel`, { message: `Kapitel: ${chapterUrls.length}`, type: 'info' });

    // Lade alle Kapitel herunter
    const chapters = [];
    for (let i = 0; i < chapterUrls.length; i++) {
      if (cancelRequested) {
        throw new Error('Download abgebrochen');
      }

      const progress = 10 + Math.round((i / chapterUrls.length) * 70);
      const chapterUrl = chapterUrls[i];
      sendProgress(progress, `Lade Kapitel ${i + 1}/${chapterUrls.length}...`, {
        message: `Lade: ${chapterUrl}`,
        type: 'debug'
      });

      const { title, content } = await extractChapterContent(chapterUrl);
      chapters.push({ title, content, url: chapterUrl });
    }

    // Erstelle die PDF-Datei (als HTML)
    sendProgress(80, 'Erstelle PDF-Datei...', { message: 'PDF wird generiert', type: 'info' });
    const filename = `${sanitizeFilename(storyTitle)}.html`;
    const htmlContent = createHtmlContent(storyId, storyTitle, chapters);
    
    // Konvertiere HTML zu Base64
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(htmlContent);
    const base64Data = arrayBufferToBase64(htmlBytes);

    sendProgress(100, 'Fertig!', { message: `PDF bereit: ${filename}`, type: 'success' });
    chrome.runtime.sendMessage({
      action: 'downloadComplete',
      success: true,
      filename: filename,
      data: base64Data
    });

  } catch (error) {
    sendProgress(0, 'Fehler', { message: `Fehler: ${error.message}`, type: 'error' });
    chrome.runtime.sendMessage({
      action: 'downloadComplete',
      success: false,
      message: error.message
    });
  } finally {
    currentDownload = null;
  }
}

// Sende Fortschritt an das Popup
function sendProgress(progress, message, logEntry) {
  chrome.runtime.sendMessage({
    action: 'updateProgress',
    progress: progress,
    message: message,
    logEntry: logEntry
  });
}

// Parse die FanFiction.net-URL
function parseUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(part => part);

    if (pathParts.length < 3 || pathParts[0] !== 's') {
      return { storyId: null, storyTitle: null };
    }

    const storyId = pathParts[1];
    const storyTitle = decodeURIComponent(pathParts[pathParts.length - 1]) || `Story_${storyId}`;

    return { storyId, storyTitle };
  } catch (error) {
    return { storyId: null, storyTitle: null };
  }
}

// Lade alle Kapitel-URLs durch inkrementelle Suche
async function getAllChapterUrls(storyId, storyTitle) {
  const chapterUrls = [];
  let chapterNum = 1;

  while (true) {
    if (cancelRequested) {
      break;
    }

    const chapterUrl = `https://www.fanfiction.net/s/${storyId}/${chapterNum}/${encodeURIComponent(storyTitle)}`;
    sendProgress(0, `Suche Kapitel ${chapterNum}...`, { message: `Prüfe: ${chapterUrl}`, type: 'debug' });

    const chapterExists = await checkChapterExists(chapterUrl);

    if (chapterExists) {
      chapterUrls.push(chapterUrl);
      sendProgress(0, `Kapitel ${chapterNum} gefunden`, { message: `Gültig: ${chapterUrl}`, type: 'success' });
      chapterNum++;
    } else {
      sendProgress(0, `Kein Kapitel ${chapterNum} gefunden`, { message: 'Suche beendet', type: 'info' });
      break;
    }

    // Sicherheitsabbruch nach 100 Kapiteln
    if (chapterNum > 100) {
      sendProgress(0, 'Maximale Kapitelanzahl erreicht', { message: 'Abbruch nach 100 Kapiteln', type: 'warn' });
      break;
    }
  }

  return chapterUrls.length > 0 ? chapterUrls : [`https://www.fanfiction.net/s/${storyId}/1/${encodeURIComponent(storyTitle)}`];
}

// Prüfe, ob ein Kapitel existiert
async function checkChapterExists(url) {
  try {
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url: url });
    await waitForTabLoad(tab.id, url);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const errorMessage = document.querySelector('.panel_normal');
        if (errorMessage && errorMessage.innerHTML.includes('Chapter not found')) {
          return false;
        }

        const storyText = document.getElementById('storytext') || 
                         document.querySelector('.storytext') ||
                         document.getElementById('story');
        if (storyText) {
          return true;
        }

        if (document.title && !document.title.includes('Chapter not found')) {
          return true;
        }

        return true;
      }
    });

    return results[0]?.result === true;
  } catch (error) {
    return false;
  }
}

// Warte, bis der Tab die URL geladen hat
function waitForTabLoad(tabId, url) {
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          clearInterval(checkInterval);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (tab.url && tab.url.includes(url) && tab.status === 'complete') {
          clearInterval(checkInterval);
          resolve();
        }
      });
    }, 500);

    setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error('Timeout beim Laden der Seite'));
    }, 30000);
  });
}

// Lade den Inhalt eines Kapitels
async function extractChapterContent(url) {
  try {
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url: url });
    await waitForTabLoad(tab.id, url);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        let title = document.title.replace(' - FanFiction', '').trim();
        let content = '';

        let storyText = document.getElementById('storytext');
        if (!storyText) storyText = document.querySelector('.storytext');
        if (!storyText) storyText = document.getElementById('story');
        if (!storyText) storyText = document.querySelector('div[class*="story" i]');

        if (storyText) {
          const clone = storyText.cloneNode(true);
          clone.querySelectorAll('script, style, iframe, noscript, form, input, select, button').forEach(el => el.remove());
          clone.querySelectorAll('div').forEach(div => {
            const classList = Array.from(div.classList || []);
            const id = div.id || '';
            if (classList.some(c => ['ads', 'advertisement', 'banner', 'ad-container'].includes(c.toLowerCase())) ||
                ['ads', 'advertisement', 'banner', 'ad-container'].includes(id.toLowerCase())) {
              div.remove();
            }
          });
          content = clone.innerHTML;
        } else {
          const bodyClone = document.body.cloneNode(true);
          bodyClone.querySelectorAll('script, style, iframe, noscript, form, input, select, button, header, footer, nav').forEach(el => el.remove());
          content = bodyClone.innerHTML;
        }

        return { title, content };
      }
    });

    if (results[0]?.result) {
      return results[0].result;
    }

    return { title: '', content: '<p>Fehler beim Laden des Kapitels</p>' };
  } catch (error) {
    return { title: '', content: `<p>Fehler: ${error.message}</p>` };
  }
}

// Erstelle den HTML-Inhalt
function createHtmlContent(storyId, storyTitle, chapters) {
  const chapterHtml = chapters.map((chap, i) => {
    const chapNum = i + 1;
    const title = chap.title || `Chapter ${chapNum}`;
    return `
      <div style="page-break-before: always;">
        <h1 style="text-align: center; font-size: 24px; margin-bottom: 20px; border-bottom: 1px solid #ccc; padding-bottom: 10px;">${escapeHtml(title)}</h1>
        <div style="font-size: 14px; line-height: 1.6; margin: 0 20px;">
          ${chap.content}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(storyTitle)}</title>
  <style>
    body {
      font-family: Georgia, serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    h1 {
      text-align: center;
      font-size: 24px;
      margin-bottom: 20px;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    @media print {
      body { font-size: 12pt; }
      h1 { font-size: 18pt; }
      div { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(storyTitle)}</h1>
  <p style="text-align: center; color: #666; margin-bottom: 30px;">
    FanFiction.net Story (ID: ${storyId})<br>
    <small>Generiert mit ff-downloader. Drucke diese Seite als PDF (Strg+P → Als PDF speichern).</small>
  </p>
  ${chapterHtml}
</body>
</html>
  `;
}

// Hilfsfunktion: Konvertiere Uint8Array zu Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let base64 = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    base64 += base64Chars[b1 >> 18 & 63] + base64Chars[b1 >> 12 & 63] + 
              base64Chars[b1 >> 6 & 63] + base64Chars[b1 & 63];
  }
  const remainder = bytes.length % 3;
  if (remainder > 0) {
    const b1 = bytes[bytes.length - remainder];
    if (remainder === 1) {
      base64 += base64Chars[b1 >> 2] + base64Chars[(b1 & 3) << 4] + '==';
    } else {
      const b2 = bytes[bytes.length - 2];
      base64 += base64Chars[b2 >> 10] + base64Chars[(b2 & 15) << 2 | (b1 >> 6)] + 
                base64Chars[b1 & 63] + '=';
    }
  }
  return base64;
}

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hilfsfunktionen
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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('Kein aktiver Tab gefunden');
  }
  return tab;
}
