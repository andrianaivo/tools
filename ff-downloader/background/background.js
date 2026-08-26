import JSZip from './jszip.js';
import { generateEpub } from './epubGenerator.js';

// Globale Konfiguration
const DELAY_BETWEEN_CHAPTERS_MS = 1500; // 1,5 Sekunden Pause zwischen Kapiteln gegen Cloudflare-Sperren
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

// Starte den optimierten 1-Pass Download-Prozess
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

    sendProgress(0, `Story: ${storyTitle}`, { message: `Story-ID: ${storyId}`, type: 'debug' });

    const chapters = [];
    let chapterNum = 1;

    sendProgress(5, 'Starte Kapitelsuche (1 Request pro Kapitel)...', { 
      message: `Starte direkt bei Kapitel 1 mit ${DELAY_BETWEEN_CHAPTERS_MS}ms Schutzpause zwischen Anfragen`, 
      type: 'info' 
    });

    // Inkrementelle Schleife mit nur 1 Abruf pro Kapitel
    while (true) {
      if (cancelRequested) {
        throw new Error('Download abgebrochen');
      }

      const chapterUrl = `https://www.fanfiction.net/s/${storyId}/${chapterNum}/${encodeURIComponent(storyTitle)}`;
      sendProgress(
        Math.min(85, 5 + chapterNum * 3), 
        `Lade Kapitel ${chapterNum}...`, 
        { message: `[1-Pass] Lade & Extrahiere: ${chapterUrl}`, type: 'debug' }
      );

      // Direkter Lade- und Extraktionsversuch
      const result = await loadAndExtractChapter(chapterUrl);

      if (result.notFound) {
        // Fehlerseite oder Kapitel existiert nicht -> Story ist zu Ende
        if (chapters.length === 0) {
          throw new Error(`Kapitel 1 konnte nicht geladen werden (${result.reason || 'Nicht gefunden'}). Bitte prüfe die Story-URL.`);
        }

        sendProgress(85, `Kapitelsuche abgeschlossen`, { 
          message: `Kein Kapitel ${chapterNum} mehr vorhanden (${result.reason || 'Ende der Story'}). Insgesamt ${chapters.length} Kapitel gefunden.`, 
          type: 'info' 
        });
        break;
      }

      // Kapitel erfolgreich gelesen
      chapters.push({
        title: result.title || `Kapitel ${chapterNum}`,
        content: result.content,
        url: chapterUrl
      });

      sendProgress(
        Math.min(85, 5 + chapterNum * 5),
        `Kapitel ${chapterNum} geladen`,
        { message: `✓ Kapitel ${chapterNum} gespeichert: "${result.title || 'Kapitel ' + chapterNum}"`, type: 'success' }
      );

      chapterNum++;

      // Sicherheitsbegrenzung
      if (chapterNum > 300) {
        sendProgress(85, 'Maximale Kapitelanzahl erreicht', { message: 'Abbruch nach 300 Kapiteln', type: 'warn' });
        break;
      }

      // Kurze Verzögerung zur Vermeidung von Cloudflare Rate Limits / Bot-Blockaden
      if (DELAY_BETWEEN_CHAPTERS_MS > 0) {
        sendProgress(
          Math.min(85, 5 + (chapterNum - 1) * 5),
          `Warte kurz vor Kapitel ${chapterNum} (Cloudflare-Schutz)...`,
          { message: `Pause (${DELAY_BETWEEN_CHAPTERS_MS}ms) gegen Cloudflare Rate-Limits...`, type: 'debug' }
        );
        await sleep(DELAY_BETWEEN_CHAPTERS_MS);
      }
    }

    if (cancelRequested) {
      throw new Error('Download abgebrochen');
    }

    // Erstelle das EPUB Buch für Apple Books
    sendProgress(90, 'Erstelle EPUB-Buch für Apple Books...', { message: 'Generiere EPUB3-Archiv mit Inhaltsverzeichnis & Apple Books-Formatierung', type: 'info' });
    const filename = `${sanitizeFilename(storyTitle)}.epub`;
    
    const epubBytes = await generateEpub(JSZip, storyId, storyTitle, chapters);
    const base64Data = arrayBufferToBase64(epubBytes);

    sendProgress(100, 'EPUB bereit!', { message: `EPUB Buch erfolgreich erstellt (${chapters.length} Kapitel): ${filename}`, type: 'success' });
    
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

// Direkte Lade- und Extraktionsfunktion (1 einzelner Tab-Request)
async function loadAndExtractChapter(url) {
  try {
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url: url });
    await waitForTabLoad(tab.id, url);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 1. Prüfe auf Fehlermeldungen ("Chapter not found" / "Story Not Found")
        const errorMessage = document.querySelector('.panel_normal');
        if (errorMessage && (errorMessage.innerHTML.includes('Chapter not found') || errorMessage.innerHTML.includes('Story Not Found'))) {
          return { notFound: true, reason: 'Chapter/Story Not Found in panel_normal' };
        }

        if (document.title && (document.title.includes('Chapter not found') || document.title.includes('Story Not Found'))) {
          return { notFound: true, reason: 'Titel signalisiert Kapitel-Ende' };
        }

        // 2. Prüfe auf Cloudflare Challenge Page
        if (document.title && document.title.includes('Just a moment...') && document.querySelector('#challenge-running')) {
          return { notFound: true, reason: 'Cloudflare Sicherheitsabfrage aktiv. Bitte im Tab bestätigen.' };
        }

        // 3. Suche den Storytext
        let storyText = document.getElementById('storytext');
        if (!storyText) storyText = document.querySelector('.storytext');
        if (!storyText) storyText = document.getElementById('story');
        if (!storyText) storyText = document.querySelector('div[class*="story" i]');

        if (!storyText) {
          // Kein Storytext auffindbar -> Kapitel existiert nicht
          return { notFound: true, reason: 'Kein Story-Text Element gefunden' };
        }

        let title = document.title.replace(' - FanFiction', '').trim();
        const clone = storyText.cloneNode(true);
        
        // Unerwünschte Tags entfernen
        clone.querySelectorAll('script, style, iframe, noscript, form, input, select, button').forEach(el => el.remove());
        clone.querySelectorAll('div').forEach(div => {
          const classList = Array.from(div.classList || []);
          const id = div.id || '';
          if (classList.some(c => ['ads', 'advertisement', 'banner', 'ad-container'].includes(c.toLowerCase())) ||
              ['ads', 'advertisement', 'banner', 'ad-container'].includes(id.toLowerCase())) {
            div.remove();
          }
        });

        const content = clone.innerHTML;
        if (!content || content.trim().length === 0) {
          return { notFound: true, reason: 'Leerer Kapitel-Inhalt' };
        }

        return {
          notFound: false,
          title: title || '',
          content: content
        };
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }

    return { notFound: true, reason: 'Kein Ergebnis vom Content-Script' };
  } catch (error) {
    return { notFound: true, reason: error.message };
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
    }, 400);

    setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error('Timeout beim Laden der Seite (30s)'));
    }, 30000);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
