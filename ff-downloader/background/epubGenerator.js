// Helper for XML and XHTML escaping
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Cleans raw HTML content extracted from FanFiction.net to be well-formed XHTML
function cleanHtmlToXhtml(html) {
  if (!html) return '<p></p>';
  
  let cleaned = html
    // Remove unwanted tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Fix self-closing tags for XHTML compatibility
    .replace(/<hr\b([^>]*)(?<!\/)>/gi, '<hr$1/>')
    .replace(/<br\b([^>]*)(?<!\/)>/gi, '<br$1/>')
    .replace(/<img\b([^>]*)(?<!\/)>/gi, '<img$1/>')
    // Fix unescaped ampersands that are not already part of XML entities
    .replace(/&(?!(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  // Ensure content is wrapped in paragraph if raw text
  if (!cleaned.trim().startsWith('<')) {
    cleaned = `<p>${cleaned}</p>`;
  }
  return cleaned;
}

const CSS_CONTENT = `
@charset "UTF-8";

@namespace "http://www.w3.org/1999/xhtml";
@namespace epub "http://www.idpf.org/2007/ops";

html, body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Charter", "Georgia", "Palatino Linotype", "Palatino", serif;
  font-size: 1em;
  line-height: 1.68;
  color: #1a1a1a;
  background-color: #ffffff;
}

body {
  padding: 5% 7%;
}

h1.book-title {
  font-size: 2.2em;
  line-height: 1.25;
  font-weight: 700;
  text-align: center;
  margin-top: 15%;
  margin-bottom: 0.5em;
  color: #111111;
}

h2.book-subtitle {
  font-size: 1.2em;
  font-weight: normal;
  text-align: center;
  color: #555555;
  margin-bottom: 2em;
}

.book-meta-box {
  margin: 3em auto;
  padding: 1.5em;
  border-top: 1px solid #e0e0e0;
  border-bottom: 1px solid #e0e0e0;
  text-align: center;
  font-size: 0.9em;
  color: #666666;
}

.book-meta-box p {
  margin: 0.4em 0;
}

h1.chapter-title {
  font-size: 1.7em;
  line-height: 1.3;
  text-align: center;
  margin-top: 10%;
  margin-bottom: 1.5em;
  padding-bottom: 0.5em;
  border-bottom: 1px solid #e0e0e0;
  color: #222222;
  page-break-before: always;
}

p {
  margin-top: 0;
  margin-bottom: 1em;
  text-align: justify;
  text-justify: inter-word;
  hyphens: auto;
  -webkit-hyphens: auto;
}

hr {
  border: 0;
  height: 1px;
  background: #cccccc;
  margin: 2em auto;
  width: 40%;
}

.chapter-content {
  margin-top: 1em;
}

nav#toc ol {
  list-style-type: none;
  padding-left: 0;
}

nav#toc li {
  margin-bottom: 0.8em;
  border-bottom: 1px dotted #ccc;
  padding-bottom: 0.3em;
}

nav#toc a {
  color: #1a1a1a;
  text-decoration: none;
}

nav#toc a:hover {
  text-decoration: underline;
}

/* Apple Books Optimization */
@media (prefers-color-scheme: dark) {
  html, body {
    color: #e6e6e6;
    background-color: #121212;
  }
  h1.book-title, h1.chapter-title {
    color: #f5f5f5;
    border-color: #333333;
  }
  h2.book-subtitle, .book-meta-box {
    color: #aaaaaa;
    border-color: #333333;
  }
  nav#toc a {
    color: #e6e6e6;
  }
  hr {
    background: #444444;
  }
}
`;

export async function generateEpub(JSZipClass, storyId, storyTitle, chapters) {
  const zip = new JSZipClass();
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const safeTitle = escapeXml(storyTitle || `Story_${storyId}`);
  const bookId = `urn:fanfiction:${storyId}`;

  // 1. mimetype (MUST BE UNCOMPRESSED and first file)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.folder('META-INF').file('container.xml', containerXml);

  const oebps = zip.folder('OEBPS');

  // 3. CSS
  oebps.file('style.css', CSS_CONTENT);

  // 4. Title Page (title.xhtml)
  const titleXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="de" lang="de">
<head>
  <meta charset="UTF-8"/>
  <title>${safeTitle}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="titlepage" class="titlepage">
    <h1 class="book-title">${safeTitle}</h1>
    <h2 class="book-subtitle">FanFiction.net Story</h2>
    <div class="book-meta-box">
      <p><strong>Story-ID:</strong> ${escapeXml(storyId)}</p>
      <p><strong>Kapitelanzahl:</strong> ${chapters.length}</p>
      <p><strong>Quelle:</strong> <a href="https://www.fanfiction.net/s/${escapeXml(storyId)}/1/">fanfiction.net/s/${escapeXml(storyId)}</a></p>
      <p><strong>Generiert:</strong> ${new Date().toLocaleDateString('de-DE')}</p>
      <p><small>Optimiert für Apple Books &amp; e-Reader</small></p>
    </div>
  </section>
</body>
</html>`;
  oebps.file('title.xhtml', titleXhtml);

  // 5. Navigation Document (nav.xhtml - EPUB 3 requirement)
  const navListItems = chapters.map((chap, i) => {
    const chapTitle = escapeXml(chap.title || `Kapitel ${i + 1}`);
    return `        <li><a href="chapter_${i + 1}.xhtml">${chapTitle}</a></li>`;
  }).join('\n');

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="de" lang="de">
<head>
  <meta charset="UTF-8"/>
  <title>Inhaltsverzeichnis</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1 class="chapter-title">Inhaltsverzeichnis</h1>
    <ol>
      <li><a href="title.xhtml">Titelblatt</a></li>
${navListItems}
    </ol>
  </nav>
</body>
</html>`;
  oebps.file('nav.xhtml', navXhtml);

  // 6. NCX (toc.ncx - for EPUB 2 backward compatibility)
  const ncxNavPoints = chapters.map((chap, i) => {
    const chapTitle = escapeXml(chap.title || `Kapitel ${i + 1}`);
    return `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 2}">
      <navLabel><text>${chapTitle}</text></navLabel>
      <content src="chapter_${i + 1}.xhtml"/>
    </navPoint>`;
  }).join('\n');

  const ncxContent = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${safeTitle}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-0" playOrder="1">
      <navLabel><text>Titelblatt</text></navLabel>
      <content src="title.xhtml"/>
    </navPoint>
${ncxNavPoints}
  </navMap>
</ncx>`;
  oebps.file('toc.ncx', ncxContent);

  // 7. Individual Chapter files (chapter_1.xhtml, chapter_2.xhtml...)
  chapters.forEach((chap, i) => {
    const chapNum = i + 1;
    const chapTitle = chap.title || `Kapitel ${chapNum}`;
    const xhtmlContent = cleanHtmlToXhtml(chap.content);

    const chapterFileContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="de" lang="de">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="chapter" class="chapter">
    <h1 class="chapter-title">${escapeXml(chapTitle)}</h1>
    <div class="chapter-content">
      ${xhtmlContent}
    </div>
  </section>
</body>
</html>`;
    oebps.file(`chapter_${chapNum}.xhtml`, chapterFileContent);
  });

  // 8. Package Document (content.opf)
  const manifestItems = [
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapters.map((_, i) => `<item id="chap_${i + 1}" href="chapter_${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
  ].join('\n    ');

  const spineItems = [
    `<itemref idref="titlepage"/>`,
    ...chapters.map((_, i) => `<itemref idref="chap_${i + 1}"/>`)
  ].join('\n    ');

  const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0" prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">${bookId}</dc:identifier>
    <dc:title>${safeTitle}</dc:title>
    <dc:language>de</dc:language>
    <dc:creator>FanFiction.net</dc:creator>
    <dc:publisher>ff-downloader (Apple Books Edition)</dc:publisher>
    <meta property="dcterms:modified">${nowIso}</meta>
    <meta property="ibooks:specified-fonts">true</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;
  oebps.file('content.opf', opfContent);

  // Generate EPUB binary (zip with DEFLATE)
  const epubUint8Array = await zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  return epubUint8Array;
}
