// Globale Variablen
let currentDownloadId = null;

// DOM-Elemente
const downloadBtn = document.getElementById('downloadBtn');
const cancelBtn = document.getElementById('cancelBtn');
const storyUrlInput = document.getElementById('storyUrl');
const statusElement = document.getElementById('status');
const logElement = document.getElementById('log');
const versionElement = document.getElementById('version');

// Lade die Version aus dem manifest.json
fetch(chrome.runtime.getURL('manifest.json'))
  .then(response => response.json())
  .then(manifest => {
    versionElement.textContent = manifest.version;
  })
  .catch(() => {
    versionElement.textContent = 'Unknown';
  });

// Lade die aktuelle Tab-URL als Standard
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0] && tabs[0].url.includes('fanfiction.net')) {
    storyUrlInput.value = tabs[0].url;
  }
});

// Event-Listener für die Buttons
downloadBtn.addEventListener('click', startDownload);
cancelBtn.addEventListener('click', cancelDownload);

// Höre auf Nachrichten vom Background-Script
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateProgress') {
    updateProgress(request.progress, request.message, request.logEntry);
  } else if (request.action === 'downloadComplete') {
    if (request.success && request.data) {
      startFileDownload(request.filename, request.data);
    } else {
      downloadComplete(request.success, request.message);
    }
  } else if (request.action === 'downloadCancelled') {
    downloadCancelled();
  }
});

// Starte den Download
async function startDownload() {
  const url = storyUrlInput.value.trim();

  if (!url) {
    showStatus('Bitte gib eine URL ein.', 'error');
    logMessage('Fehler: Keine URL angegeben', 'error');
    return;
  }

  if (!url.includes('fanfiction.net')) {
    showStatus('Bitte gib eine gültige FanFiction.net-URL ein.', 'error');
    logMessage('Fehler: Ungültige URL', 'error');
    return;
  }

  // UI zurücksetzen
  resetUI();
  showStatus('Starte Download...', 'info');
  logMessage(`Download gestartet für: ${url}`, 'info');
  
  downloadBtn.disabled = true;
  cancelBtn.disabled = false;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'startDownload',
      url: url
    });

    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }

    if (response && response.downloadId) {
      currentDownloadId = response.downloadId;
    }
  } catch (error) {
    showStatus('Fehler: ' + error.message, 'error');
    logMessage(`Fehler: ${error.message}`, 'error');
    downloadBtn.disabled = false;
    cancelBtn.disabled = true;
  }
}

// Breche den Download ab
function cancelDownload() {
  if (currentDownloadId) {
    chrome.runtime.sendMessage({ action: 'cancelDownload', downloadId: currentDownloadId });
    showStatus('Abbruch angefordert...', 'info');
    logMessage('Download wird abgebrochen...', 'info');
  }
}

// Starte den Download mit Base64-Daten (PDF)
function startFileDownload(filename, base64Data) {
  const dataUrl = `data:application/pdf;base64,${base64Data}`;
  
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  downloadComplete(true, `PDF gespeichert als: ${filename}`);
  
  // Popup automatisch schließen
  setTimeout(() => window.close(), 1500);
}

// Aktualisiere den Fortschritt
function updateProgress(progress, message, logEntry) {
  if (message) {
    showStatus(message, 'info');
  }

  if (logEntry) {
    logMessage(logEntry.message, logEntry.type);
  }
}

// Download abgeschlossen
function downloadComplete(success, message) {
  currentDownloadId = null;
  downloadBtn.disabled = false;
  cancelBtn.disabled = true;

  if (success) {
    showStatus(message, 'success');
    logMessage(message, 'success');
  } else {
    showStatus(message, 'error');
    logMessage(message, 'error');
  }
}

// Download abgebrochen
function downloadCancelled() {
  currentDownloadId = null;
  downloadBtn.disabled = false;
  cancelBtn.disabled = true;
  showStatus('Download abgebrochen.', 'error');
  logMessage('Download abgebrochen.', 'error');
}

// Zeige Status an
function showStatus(message, type = 'info') {
  statusElement.textContent = message;
  statusElement.className = 'status ' + type;
}

// Füge eine Log-Nachricht hinzu
function logMessage(message, type = 'debug') {
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${type}`;
  logEntry.textContent = message;
  logElement.appendChild(logEntry);
  logElement.scrollTop = logElement.scrollHeight;

  // Begrenze die Anzahl der Log-Einträge
  while (logElement.children.length > 50) {
    logElement.removeChild(logElement.firstChild);
  }
}

// Setze die UI zurück
function resetUI() {
  statusElement.textContent = '';
  statusElement.className = 'status';
  logElement.innerHTML = '';
}
