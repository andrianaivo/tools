# ff-downloader

Eine Chrome-Erweiterung, die FanFiction.net-Stories als **PDF-Dateien** herunterlädt.

---

## 📥 Installation

1. Öffne **Google Chrome**.
2. Gehe zu:
   ```
   chrome://extensions/
   ```
3. Aktiviere den **Entwicklermodus** (Schalter oben rechts).
4. Klicke auf **"Entpackte Erweiterung laden"**.
5. Wähle den Ordner `ff-downloader` aus.

---

## 🚀 Verwendung

1. Gehe zu einer FanFiction.net-Story (z. B. [https://www.fanfiction.net/s/6959397/7/Rescued](https://www.fanfiction.net/s/6959397/7/Rescued)).
2. Klicke auf das **Erweiterungs-Symbol** in der Chrome-Leiste.
3. Die URL wird **automatisch eingefüllt** (falls du auf einer FanFiction.net-Seite bist).
4. Klicke auf **"PDF herunterladen"**.
5. Der Fortschritt wird im **Log-Bereich** angezeigt.
6. Die **HTML-Datei** wird heruntergeladen und das Popup schließt sich.
7. **Konvertiere die HTML-Datei in PDF**:
   - Öffne die heruntergeladene `.html`-Datei in Chrome.
   - Drücke **`Strg+P`** (oder **Cmd+P** auf macOS).
   - Wähle **"Als PDF speichern"** aus.

---

## 📌 Funktionen

- **Automatische URL-Erkennung**: Die URL wird automatisch aus dem aktuellen Tab übernommen.
- **Inkrementelle Kapitel-Suche**: Findet alle Kapitel durch Inkrementieren der Kapitelnummer.
- **Fortschrittsanzeige**: Zeigt den aktuellen Stand im Log-Bereich an.
- **Automatisches Schließen**: Das Popup schließt sich nach erfolgreichem Download.
- **Fehlerbehandlung**: Zeigt Fehler an, falls etwas schiefgeht.

---

## 📁 Projektstruktur

```
ff-downloader/
├── manifest.json          # Erweiterungs-Konfiguration
├── README.md              # Diese Datei
├── popup/
│   ├── popup.html         # Benutzeroberfläche
│   ├── popup.css          # Stile
│   └── popup.js           # UI-Logik
└── background/
    └── background.js      # Hintergrund-Script
```

---

## 🔧 Technische Details

### Berechtigungen
- `activeTab`: Zugriff auf den aktuellen Tab.
- `scripting`: Zum Injizieren von Content Scripts.
- `downloads`: Zum Herunterladen der ePub-Datei.
- `storage`: Zum Speichern von Einstellungen.
- `tabs`: Zum Ändern der Tab-URL.
- `host_permissions` für `fanfiction.net`: Zugriff auf FanFiction.net.

### PDF-Inhalt
Die erstellte HTML-Datei (für PDF-Konvertierung) enthält:
- Eine **kombinierte HTML-Datei** mit allen Kapiteln.
- **Stile für bessere Lesbarkeit** (Schriftart, Seitenumbrüche, etc.).
- **Hinweis zur PDF-Konvertierung** (Anleitung im Dokument).

---

## ⚠️ Einschränkungen

- **Maximale Kapitelanzahl**: 100 (Sicherheitsabbruch).
- **Maximale Dateigröße**: 5 MB (für den direkten Download).
- **Cloudflare-Challenges**: Falls FanFiction.net eine Challenge anzeigt, musst du sie manuell lösen.

---

## 🐛 Fehlerbehebung

### Problem: URL wird nicht automatisch eingefüllt
- **Lösung**: Stelle sicher, dass du auf einer **FanFiction.net-Seite** bist.
- **Lösung**: Lade die Erweiterung neu (`chrome://extensions/` → Neu laden).

### Problem: Download startet nicht
- **Lösung**: Prüfe die **Log-Nachrichten** im Popup.
- **Lösung**: Stelle sicher, dass die **URL korrekt** ist.

### Problem: PDF-Konvertierung funktioniert nicht
- **Lösung**: Öffne die `.html`-Datei in **Chrome** und drucke sie als PDF (Strg+P → Als PDF speichern).
- **Lösung**: Verwende einen **PDF-Drucker** wie Adobe Acrobat oder einen Online-Konverter.

---

## 📜 Lizenz

Dieses Projekt ist **Open Source** und kann frei verwendet, modifiziert und weitergegeben werden.
