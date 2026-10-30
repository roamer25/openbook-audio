const clean = text => String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const nodes = (root, name) => Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name);
const xml = text => new DOMParser().parseFromString(text, 'application/xml');
const decode = text => { try { return decodeURIComponent(text); } catch { return text; } };

function target(base, href) {
  try {
    const url = new URL(href, 'https://epub.invalid/' + base);
    if (url.origin !== 'https://epub.invalid') return null;
    return { path: decode(url.pathname.slice(1)), fragment: decode(url.hash.slice(1)) };
  } catch { return null; }
}

// Produce text and anchor offsets together so links inside a single XHTML file
// can jump to their actual passage instead of always jumping to the file start.
function readDocument(source) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('script,style,nav,svg,noscript').forEach(node => node.remove());
  // Only explicit note semantics/classes are removed. Ordinary asides, numbered
  // prose and unmarked paragraphs remain part of the book.
  const noteTypes=new Set(['footnote','footnotes','endnote','endnotes','rearnote','rearnotes']);
  const notes=Array.from(doc.querySelectorAll('*')).filter(node=>
    (node.getAttribute('epub:type')||'').split(/\s+/).some(type=>noteTypes.has(type))||
    (node.getAttribute('role')||'').split(/\s+/).some(role=>['doc-footnote','doc-endnote','doc-endnotes'].includes(role))||
    Array.from(node.classList).some(name=>['footnote','footnotes','endnote','endnotes'].includes(name.toLowerCase())));
  const noteIds=new Set(notes.flatMap(node=>[node.id,...Array.from(node.querySelectorAll('[id]'),child=>child.id)]).filter(Boolean));
  for(const node of Array.from(doc.querySelectorAll('*'))){
    const types=(node.getAttribute('epub:type')||'').split(/\s+/),roles=(node.getAttribute('role')||'').split(/\s+/);
    const href=node.getAttribute('href')||'';
    if(types.includes('noteref')||roles.includes('doc-noteref')||roles.includes('doc-backlink')||(href.startsWith('#')&&noteIds.has(decode(href.slice(1)))))node.remove();
  }
  for(const note of notes){if(note===doc.body||note===doc.documentElement)doc.body.replaceChildren();else note.remove()}
  const heading = clean(doc.querySelector('h1,h2,h3,h4,h5,h6')?.textContent);
  const anchors = new Map(),headings=[];
  let raw = '';
  const block = /^(H[1-6]|P|DIV|SECTION|ARTICLE|LI|BLOCKQUOTE|PRE|TR|DT|DD)$/;
  const boundary = () => { if (raw && !raw.endsWith('\n\n')) raw += '\n\n'; };
  function walk(node) {
    if (node.nodeType === 3) { raw += node.textContent; return; }
    if (node.nodeType !== 1) return;
    if (block.test(node.tagName)) boundary();
    const headingSpan=/^H[1-6]$/.test(node.tagName)?{title:clean(node.textContent),start:raw.length}:null;
    for (const id of [node.id, node.getAttribute('name')]) if (id && !anchors.has(id)) anchors.set(id, raw.length);
    if (node.tagName === 'BR') raw += '\n';
    else node.childNodes.forEach(walk);
    if(headingSpan){headingSpan.end=raw.length;headings.push(headingSpan)}
    if (block.test(node.tagName)) boundary();
  }
  walk(doc.body);
  const text = clean(raw);
  for (const [id, rawOffset] of anchors) {
    let offset = clean(raw.slice(0, rawOffset)).length;
    while (/\s/.test(text[offset] || '') && offset < text.length) offset++;
    anchors.set(id, offset);
  }
  for(const span of headings){span.start=clean(raw.slice(0,span.start)).length;while(span.start<text.length&&/\s/.test(text[span.start]))span.start++;span.end=clean(raw.slice(0,span.end)).length}
  return { text, anchors, heading, headings };
}

function htmlContents(source, path, isNav) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const nav = Array.from(doc.querySelectorAll('nav')).find(node =>
    (node.getAttribute('epub:type') || '').split(/\s+/).includes('toc') || node.getAttribute('role') === 'doc-toc');
  if (isNav && !nav) return [];
  const scope = nav || doc.body;
  return Array.from(scope.querySelectorAll('a[href]')).map(a => {
    const destination = target(path, a.getAttribute('href'));
    let depth = 0;
    for (let parent = a.parentElement; parent && parent !== scope; parent = parent.parentElement)
      if (parent.tagName === 'OL' || parent.tagName === 'UL') depth++;
    return { title: clean(a.textContent), depth: Math.max(0, depth - 1), ...destination };
  }).filter(entry => entry.path && entry.title);
}

function ncxContents(source, path) {
  const doc = xml(source);
  return nodes(doc, 'navPoint').map(point => {
    const content = Array.from(point.children).find(node => node.localName === 'content');
    const label = Array.from(point.children).find(node => node.localName === 'navLabel');
    let depth = 0;
    for (let parent = point.parentElement; parent; parent = parent.parentElement) if (parent.localName === 'navPoint') depth++;
    return { title: clean(label?.textContent), depth, ...target(path, content?.getAttribute('src') || '') };
  }).filter(entry => entry.path && entry.title);
}

export async function importEpub(file) {
  if (!window.JSZip) throw Error('EPUB parser unavailable. Connect to the internet and reload.');
  const zip = await window.JSZip.loadAsync(file);
  const container = zip.file('META-INF/container.xml');
  if (!container) throw Error('Not a valid EPUB.');
  const root = nodes(xml(await container.async('text')), 'rootfile')[0];
  const opfPath = root?.getAttribute('full-path');
  const opf = opfPath && zip.file(opfPath);
  if (!opf) throw Error('EPUB contents missing.');
  const doc = xml(await opf.async('text'));
  const manifest = new Map(nodes(doc, 'item').map(item => [item.getAttribute('id'), item]));
  const spine = nodes(doc, 'spine')[0];
  const parts = [], locations = new Map();
  for (const ref of nodes(doc, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || !/html|xml/.test(item.getAttribute('media-type') || '') || (item.getAttribute('properties') || '').split(/\s+/).includes('nav')) continue;
    const link = target(opfPath, item.getAttribute('href'));
    const entry = link && zip.file(link.path);
    if (!entry) continue;
    const content = readDocument(await entry.async('text'));
    if (!content.text) continue;
    locations.set(link.path, { index: parts.length, anchors: content.anchors });
    parts.push({ title: content.heading || `Section ${parts.length + 1}`, text: content.text, headings:content.headings });
  }
  if (!parts.length) throw Error('No readable chapters found.');

  const resolveEntries = entries => entries.flatMap(entry => {
    const location = locations.get(entry.path);
    if (!location || (entry.fragment && !location.anchors.has(entry.fragment))) return [];
    const offset = entry.fragment ? location.anchors.get(entry.fragment) : 0;
    if (offset >= parts[location.index].text.length) return [];
    return [{ title: entry.title, depth: entry.depth, sectionIndex: location.index, charIndex: offset }];
  });
  let contents = [];
  // EPUB 3 navigation, followed by EPUB 2 NCX, then a legacy HTML contents page.
  for (const item of manifest.values()) {
    if (!(item.getAttribute('properties') || '').split(/\s+/).includes('nav')) continue;
    const link = target(opfPath, item.getAttribute('href'));
    const entry = link && zip.file(link.path);
    if (entry) contents = resolveEntries(htmlContents(await entry.async('text'), link.path, true));
    if (contents.length) break;
  }
  if (!contents.length) {
    const ncx = manifest.get(spine?.getAttribute('toc')) || Array.from(manifest.values()).find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
    const link = ncx && target(opfPath, ncx.getAttribute('href'));
    const entry = link && zip.file(link.path);
    if (entry) contents = resolveEntries(ncxContents(await entry.async('text'), link.path));
  }
  if (!contents.length) {
    const refs = nodes(doc, 'reference').filter(ref => ref.getAttribute('type') === 'toc');
    const candidates = [...refs, ...Array.from(manifest.values()).filter(item => /(?:^|[/_.-])(?:toc|contents)(?:[/_.-]|$)/i.test(item.getAttribute('href') || ''))];
    for (const item of candidates) {
      const link = target(opfPath, item.getAttribute('href'));
      const entry = link && zip.file(link.path);
      if (entry) contents = resolveEntries(htmlContents(await entry.async('text'), link.path, false));
      if (contents.length) break;
    }
  }
  // Normalize duplicates while preserving the publisher's nesting and ordering.
  const seen = new Set();
  contents = contents.filter(entry => {
    const key = `${entry.sectionIndex}:${entry.charIndex}:${entry.title}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const contentsSource = contents.length ? 'Book table of contents' : 'Headings and reading sections';
  for (let i = 0; i < parts.length; i++) {
    const first = contents.find(entry => entry.sectionIndex === i);
    if (first) parts[i].title = first.title;
  }
  if (!contents.length) contents = parts.map((part, i) => ({ title: part.title, depth: 0, sectionIndex: i, charIndex: 0 }));
  return { name: clean(nodes(doc, 'title')[0]?.textContent) || file.name, parts, contents, contentsSource };
}
