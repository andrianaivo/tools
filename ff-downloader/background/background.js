import JSZip from './jszip.js';
import { generateEpub } from './epubGenerator.js';

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

    sendProgress(5, `Gefunden: ${chapterUrls.length} Kapitel`, { message: `Kapitel gefunden: ${chapterUrls.length}`, type: 'info' });

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

    // Erstelle das EPUB Buch für Apple Books
    sendProgress(85, 'Erstelle EPUB-Buch für Apple Books...', { message: 'EPUB3-Archiv wird generiert & optimiert', type: 'info' });
    const filename = `${sanitizeFilename(storyTitle)}.epub`;
    
    const epubBytes = await generateEpub(JSZip, storyId, storyTitle, chapters);
    const base64Data = arrayBufferToBase64(epubBytes);

    sendProgress(100, 'EPUB bereit!', { message: `EPUB Buch fertig: ${filename}`, type: 'success' });
    chrome.runtime.sendMessage({
      action: 'downloadComplete',
      success: true,
      filename: filename,
      data: base64Data,
      mimeType: 'application/epub+zip',
      storyTitle: storyTitle,
      chaptersCount: chapters.length
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

    // Sicherheitsabbruch nach 250 Kapiteln
    if (chapterNum > 250) {
      sendProgress(0, 'Maximale Kapitelanzahl erreicht', { message: 'Abbruch nach 250 Kapiteln', type: 'warn' });
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
        if (errorMessage && (errorMessage.innerHTML.includes('Chapter not found') || errorMessage.innerHTML.includes('Story Not Found'))) {
          return false;
        }

        const storyText = document.getElementById('storytext') || 
                         document.querySelector('.storytext') ||
                         document.getElementById('story');
        if (storyText) {
          return true;
        }

        if (document.title && !document.title.includes('Chapter not found') && !document.title.includes('Story Not Found')) {
          return true;
        }

        return false;
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

// Hilfsfunktion: Konvertiere Uint8Array zu Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
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

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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
