# ff-downloader: FanFiction.net to EPUB (Apple Books)

Ein Chrome Browser-Extension-Tool zum automatischen Herunterladen von kompletten Geschichten von [FanFiction.net](https://www.fanfiction.net) als vollwertiges **EPUB 3** E-Book, speziell optimiert für **Apple Books** (iPhone, iPad, Mac) sowie alle gängigen E-Reader.

## 📖 Funktionsweise

1. **URL-Eingabe:** Als Basis dient eine FanFiction.net-URL im Format:  
   `https://www.fanfiction.net/s/<story_id>/<chapter_nr>/<story_title>`  
   *(z.B. `https://www.fanfiction.net/s/14579114/4/The-Escrow-of-Blood`)*
2. **Inkrementelle Kapitelsuche:**  
   Die Extension startet automatisch bei Kapitel 1 (`https://www.fanfiction.net/s/<story_id>/1/<story_title>`) und inkrementiert die Kapitelnummer schrittweise (`/1/`, `/2/`, `/3/`, ...), bis FanFiction.net meldet, dass kein weiteres Kapitel mehr existiert.
3. **EPUB 3 Buch-Erstellung:**  
   Alle Kapitel werden bereinigt und zu einem vollständigen EPUB 3 Archiv mit:
   - Titelblatt mit Metadaten (Story-ID, Autor, Datum)
   - Interaktivem Inhaltsverzeichnis (`nav.xhtml` & `toc.ncx`)
   - Sauberen XHTML-Kapiteln mit lesefreundlicher Buch-Typografie
   - Dunkelmodus- und Hellmodus-Unterstützung für Apple Books
4. **Download:**  
   Die fertige Datei wird als `<Story-Titel>.epub` auf deinen Rechner heruntergeladen.

## 🍎 Öffnen in Apple Books

- **Auf dem Mac:** Einfach doppelt auf die heruntergeladene `.epub`-Datei klicken. Sie wird automatisch in die *Apple Books* Mediathek importiert.
- **Auf iPhone & iPad:** Sende die `.epub`-Datei via AirDrop an dein Gerät oder speichere sie in iCloud Drive / Dateien und öffne sie mit Apple Books.

## 🚀 Installation als Chrome Extension

1. Öffne Chrome und navigiere zu `chrome://extensions/`.
2. Aktiviere oben rechts den **Entwicklermodus** (*Developer mode*).
3. Klicke auf **"Entpackte Erweiterung laden"** (*Load unpacked*).
4. Wähle den Ordner `ff-downloader` aus.
5. Klicke auf das Extension-Icon in der Browser-Leiste, gib deine URL ein und klicke auf **"EPUB Buch herunterladen"**.
