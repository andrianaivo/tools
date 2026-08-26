#!/usr/bin/env python3
"""
FanFiction.net zu ePub Konverter

Verwendung:
    python fanfiction_to_epub.py <URL>

Beispiel:
    python fanfiction_to_epub.py https://www.fanfiction.net/s/6959397/7/Rescued

Benötigte Pakete:
    pip install requests beautifulsoup4 ebooklib
"""

import sys
import re
import os
from urllib.parse import unquote

import requests
from bs4 import BeautifulSoup
from ebooklib import epub


def get_session():
    """Erstelle eine Session mit User-Agent Header"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    })
    return session


def parse_url(url):
    """Extrahiere Story-ID und Titel aus der URL"""
    url = url.rstrip('/')
    parts = url.split('/')
    
    # Erwarte Format: https://www.fanfiction.net/s/<story_id>/<chapter>/<title>
    if len(parts) < 6 or parts[3] != 's':
        raise ValueError(f"Ungültige FanFiction.net URL: {url}")
    
    story_id = parts[4]
    story_title = unquote(parts[-1]) if parts[-1] else f"Story_{story_id}"
    
    return story_id, story_title


def get_chapter_number_from_url(url):
    """Extrahiere die Kapitelnummer aus einer FanFiction.net URL"""
    parts = url.rstrip('/').split('/')
    try:
        return int(parts[5])
    except (IndexError, ValueError):
        return 0


def get_all_chapter_urls(story_id, session):
    """Finde alle Kapitel-URLs für eine Story"""
    base_url = f"https://www.fanfiction.net/s/{story_id}/1/"
    
    try:
        response = session.get(base_url, timeout=15)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"  Fehler beim Laden der Story-Seite: {e}")
        return []
    
    soup = BeautifulSoup(response.text, 'html.parser')
    chapter_urls = []
    
    # Methode 1: Kapitel-Dropdown (häufigster Fall)
    chap_select = soup.find('select', {'name': 'chapter'})
    if not chap_select:
        chap_select = soup.find('select', id=lambda x: x and 'chap' in x.lower())
    
    if chap_select:
        for option in chap_select.find_all('option'):
            value = option.get('value', '')
            if value and value != '#':
                if not value.startswith('http'):
                    value = f"https://www.fanfiction.net{value}"
                chapter_urls.append(value)
    
    # Methode 2: Direkte Links mit Story-ID Muster
    if not chapter_urls:
        pattern = re.compile(rf'/s/{story_id}/\d+/')
        for a in soup.find_all('a', href=pattern):
            href = a.get('href', '')
            if href:
                if not href.startswith('http'):
                    href = f"https://www.fanfiction.net{href}"
                chapter_urls.append(href)
    
    # Dedupliziere und sortiere nach Kapitelnummer
    chapter_urls = list(set(chapter_urls))
    chapter_urls.sort(key=get_chapter_number_from_url)
    
    return chapter_urls


def extract_chapter_content(url, session):
    """Extrahiere Titel und HTML-Inhalt eines Kapitels"""
    try:
        response = session.get(url, timeout=15)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"  Fehler beim Laden von {url}: {e}")
        return "", "<p>Fehler beim Laden des Kapitels</p>"
    
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Kapitel-Titel extrahieren
    chapter_title = ""
    title_elem = soup.find('title')
    if title_elem:
        title_text = title_elem.get_text()
        # Entferne " - FanFiction" Suffix
        chapter_title = title_text.replace(' - FanFiction', '').strip()
    
    # Haupttext extrahieren (div#storytext ist Standard)
    storytext = soup.find('div', id='storytext')
    if not storytext:
        storytext = soup.find('div', class_='storytext')
    if not storytext:
        storytext = soup.find('div', id='story')
    if not storytext:
        # Suche nach div mit 'story' in der Klasse
        storytext = soup.find('div', class_=re.compile(r'story', re.I))
    
    if storytext:
        # Entferne unerwünschte Elemente
        for tag in storytext.find_all(['script', 'style', 'iframe', 'noscript', 'form', 'input', 'select']):
            tag.decompose()
        
        # Entferne Werbung und andere unerwünschte Divs
        for tag in storytext.find_all('div'):
            tag_class = tag.get('class', [])
            tag_id = tag.get('id', '')
            if any(c in ['ads', 'advertisement', 'banner'] for c in tag_class) or \
               any(c in ['ads', 'advertisement', 'banner'] for c in [tag_id]):
                tag.decompose()
        
        content = str(storytext)
    else:
        # Fallback: versuche den gesamten body
        body = soup.find('body')
        if body:
            for tag in body.find_all(['script', 'style', 'iframe', 'noscript', 'form', 'input']):
                tag.decompose()
            content = str(body)
        else:
            content = "<p>Konnte den Story-Text nicht finden.</p>"
    
    return chapter_title, content


def sanitize_filename(filename):
    """Entferne ungültige Zeichen aus Dateinamen"""
    # Entferne ungültige Zeichen
    filename = re.sub(r'[\\/*?:"<>|]', '_', filename)
    # Begrenze Länge
    filename = filename[:150]
    # Entferne führende/trailing Leerzeichen und Punkte
    filename = filename.strip().strip('.')
    return filename


def create_epub(story_id, story_title, chapters):
    """Erstelle eine ePub-Datei aus den Kapiteln"""
    book = epub.EpubBook()
    
    # Metadata
    book.set_identifier(f'fanfiction_{story_id}')
    book.set_title(story_title)
    book.set_language('en')
    
    spine_items = []
    toc_items = []
    
    for i, (chap_title, content, url) in enumerate(chapters):
        # Kapitel-Name bereinigen
        if not chap_title or chap_title == story_title:
            chap_title = f"Chapter {i+1}"
        
        # HTML-Inhalt für ePub (XHTML)
        html_content = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>{chap_title}</title>
    <meta charset="utf-8"/>
</head>
<body>
    <h1>{chap_title}</h1>
    {content}
</body>
</html>
"""
        
        chapter_file = f'chap_{i+1}.xhtml'
        chapter = epub.EpubHtml(
            title=chap_title,
            file_name=chapter_file,
            lang='en'
        )
        chapter.content = html_content
        
        book.add_item(chapter)
        spine_items.append(chapter)
        toc_items.append(epub.Link(chapter_file, chap_title, f'chap_{i+1}'))
    
    # Spine (Reihenfolge der Kapitel)
    book.spine = spine_items
    
    # Table of Contents
    book.toc = tuple(toc_items)
    
    # Navigation
    book.add_item(epub.EpubNcx())
    
    # Dateiname
    safe_title = sanitize_filename(story_title)
    output_filename = f"{safe_title}.epub"
    
    # Schreibe die ePub-Datei
    epub.write_epub(output_filename, book, {})
    
    return output_filename


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ['--help', '-h']:
        print("Verwendung: python fanfiction_to_epub.py <URL>")
        print("\nBeispiel:")
        print("  python fanfiction_to_epub.py https://www.fanfiction.net/s/6959397/7/Rescued")
        print("\nBenötigte Pakete:")
        print("  pip install requests beautifulsoup4 ebooklib")
        sys.exit(1 if len(sys.argv) < 2 else 0)
    
    url = sys.argv[1].strip()
    
    print(f"Verarbeite: {url}")
    print("-" * 60)
    
    # Parse URL
    try:
        story_id, story_title = parse_url(url)
        print(f"Story-ID: {story_id}")
        print(f"Titel: {story_title}")
    except ValueError as e:
        print(f"Fehler: {e}")
        sys.exit(1)
    
    # Session erstellen
    session = get_session()
    
    # Alle Kapitel-URLs finden
    print("\nSuche nach Kapiteln...")
    chapter_urls = get_all_chapter_urls(story_id, session)
    
    if not chapter_urls:
        print("  Keine Kapitel gefunden! Verwende die angegebene URL als einziges Kapitel.")
        chapter_urls = [url]
    else:
        print(f"  Gefunden: {len(chapter_urls)} Kapitel")
    
    # Kapitel herunterladen
    print("\nLade Kapitel herunter...")
    chapters = []
    for i, chap_url in enumerate(chapter_urls):
        chap_num = get_chapter_number_from_url(chap_url)
        print(f"  [{i+1}/{len(chapter_urls)}] Kapitel {chap_num}: {chap_url}")
        chap_title, content = extract_chapter_content(chap_url, session)
        chapters.append((chap_title, content, chap_url))
    
    # ePub erstellen
    print("\nErstelle ePub-Datei...")
    output_file = create_epub(story_id, story_title, chapters)
    
    # Fertig
    print(f"\n✓ Fertig!")
    print(f"  ePub gespeichert als: {os.path.abspath(output_file)}")
    print(f"  Kapitel: {len(chapters)}")


if __name__ == "__main__":
    main()
