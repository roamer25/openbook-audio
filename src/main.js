
import { PhononTTS } from 'phonon-tts';

const $ = id => document.getElementById(id);
const synth = window.speechSynthesis;

let aiPlayer = null;
let aiEngine = null;
let aiVoiceCache = {};
let aiBusy = false;
let aiMode = false;

let sections = [];
let title = '';
let sectionIndex = 0;
let charIndex = 0;
let playing = false;
let paused = false;
let token = 0;
let voiceList = [];
let utterance = null;
let started = false;
let watchdog = null;

const status = text => {
  $('status').textContent = text;
};

const normalize = text =>
  text.replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

function setBook(name, parts) {
  stop();
  title = name;
  sections = parts.filter(part => part.text.trim());
  sectionIndex = 0;
  charIndex = 0;

  $('filename').textContent = name;
  $('bookTitle').textContent = name;
  $('chapters').replaceChildren();

  sections.forEach((part, index) => {
    $('chapters').add(
      new Option(`${index + 1}. ${part.title}`, String(index))
    );
  });

  display();
  status(`Ready: ${sections.length} section(s).`);
}

function display() {
  const part = sections[sectionIndex];

  $('reader').textContent = part
    ? part.text
    : 'Your book’s text will appear here.';

  $('chapters').value = String(sectionIndex);
  progress();
}

function progress() {
  const part = sections[sectionIndex];

  $('seek').value = part
    ? Math.round((charIndex / part.text.length) * 100)
    : 0;

  $('progress').textContent = part
    ? `Section ${sectionIndex + 1}/${sections.length} · ${Math.min(charIndex, part.text.length).toLocaleString()}/${part.text.length.toLocaleString()} characters`
    : 'No book loaded';
}

function stop() {
  if (aiPlayer) {
    aiPlayer.pause();
    aiPlayer.removeAttribute('src');
    aiPlayer.load();
  }

  aiBusy = false;
  token++;
  playing = false;
  paused = false;
  started = false;

  clearTimeout(watchdog);
  utterance = null;
  synth?.cancel();

  $('play').textContent = '▶';
}


async function loadAI() {
  if (aiEngine) return aiEngine;

  status('Loading AI narration engine…');

  aiEngine = await PhononTTS.load({
    lang: 'en'
  });

  status('AI narration engine ready.');
  return aiEngine;
}

async function speakAI(text) {
  const currentToken = token;
  let url = null;

  try {
    aiBusy = true;
    status('Generating natural narration…');

    const engine = await loadAI();
    if (currentToken !== token) {
      aiBusy = false;
      return;
    }

    const voice = $('voice').value || 'default';

    const wav = await engine.synthWav(text, {
      voice
    });

    if (currentToken !== token) {
      aiBusy = false;
      return;
    }

    if (!aiPlayer) {
      aiPlayer = new Audio();
    }

    url = URL.createObjectURL(wav);
    aiPlayer.src = url;
    aiPlayer.playbackRate = Number($('speed').value) || 1;

    aiPlayer.onended = () => {
      URL.revokeObjectURL(url);
      aiBusy = false;

      if (playing && currentToken === token) {
        nextChunk();
      }
    };

    await aiPlayer.play();
    status('Playing AI narration.');
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    aiBusy = false;
    playing = false;
    status(`AI error: ${error.message}`);
    console.error(error);
  }
}

function nextChunk() {
  if (!playing || !sections.length) return;

  const part = sections[sectionIndex];
  if (!part) return;

  if (charIndex >= part.text.length) {
    if (sectionIndex + 1 >= sections.length) {
      stop();
      status('Finished reading.');
      return;
    }

    sectionIndex++;
    charIndex = 0;
    display();
  }

  const text = sections[sectionIndex].text;
  const remaining = text.slice(charIndex);

  const match = remaining.slice(0, 400)
    .match(/^.{80,350}?[.!?](?:\s|$)/s);

  const chunk = match
    ? match[0]
    : remaining.slice(0, 300);

  charIndex += chunk.length;
  progress();

  if (aiMode) {
    speakAI(chunk);
  } else {
    speakBrowser(chunk);
  }
}

function speakBrowser(text) {
  const currentToken = token;
  const speech = new SpeechSynthesisUtterance(text);

  utterance = speech;
  speech.rate = Number($('speed').value) || 1;

  const selected = voiceList.find(
    voice => voice.name === $('voice').value
  );

  if (selected) speech.voice = selected;

  speech.onend = () => {
    if (playing && currentToken === token) {
      nextChunk();
    }
  };

  speech.onerror = event => {
    if (event.error !== 'canceled') {
      status(`Speech error: ${event.error}`);
    }
  };

  synth.speak(speech);
}

function play() {
  if (!sections.length) {
    status('Import a book first.');
    return;
  }

  if (paused) {
    paused = false;
    playing = true;

    if (aiMode) {
      aiPlayer?.play();
    } else {
      synth.resume();
    }

    $('play').textContent = 'Ⅱ';
    return;
  }

  if (playing) {
    paused = true;
    playing = false;

    if (aiMode) {
      aiPlayer?.pause();
    } else {
      synth.pause();
    }

    $('play').textContent = '▶';
    return;
  }

  playing = true;
  paused = false;
  $('play').textContent = 'Ⅱ';
  nextChunk();
}

function skip(direction) {
  if (!sections.length) return;

  stop();

  sectionIndex = Math.max(
    0,
    Math.min(sections.length - 1, sectionIndex + direction)
  );

  charIndex = 0;
  display();
  play();
}

function extractHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,svg').forEach(el => el.remove());
  return normalize(doc.body.textContent || '');
}

async function importEPUB(file) {
  if (!window.JSZip) {
    throw new Error('EPUB library unavailable.');
  }

  const zip = await JSZip.loadAsync(file);
  const container = zip.file('META-INF/container.xml');
  if (!container) throw new Error('Invalid EPUB file.');

  const xml = new DOMParser().parseFromString(
    await container.async('text'), 'application/xml'
  );

  const root = xml.getElementsByTagName('rootfile')[0];
  const opfPath = root?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB contents missing.');

  const opf = new DOMParser().parseFromString(
    await zip.file(opfPath).async('text'), 'application/xml'
  );

  const manifest = new Map(
    Array.from(opf.getElementsByTagName('item')).map(item => [
      item.getAttribute('id'),
      item.getAttribute('href')
    ])
  );

  const folder = opfPath.split('/').slice(0, -1).join('/');
  const parts = [];

  for (const item of opf.getElementsByTagName('itemref')) {
    const href = manifest.get(item.getAttribute('idref'));
    if (!href) continue;

    const path = [folder, href.split('#')[0]]
      .filter(Boolean).join('/');

    const entry = zip.file(path);
    if (!entry) continue;

    const text = extractHTML(await entry.async('text'));
    if (text) {
      parts.push({
        title: `Chapter ${parts.length + 1}`,
        text
      });
    }
  }

  if (!parts.length) throw new Error('No readable chapters found.');
  return parts;
}

async function importPDF(file) {
  if (!window.pdfjsLib) {
    throw new Error('PDF library unavailable.');
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer())
  }).promise;

  const parts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = normalize(
      content.items.map(item => item.str || '').join(' ')
    );

    if (text) parts.push({ title: `Page ${i}`, text });
  }

  if (!parts.length) {
    throw new Error('PDF contains no selectable text.');
  }

  return parts;
}

$('upload').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    status(`Opening ${file.name}…`);
    const ext = file.name.split('.').pop().toLowerCase();
    let parts;

    if (ext === 'epub') {
      parts = await importEPUB(file);
    } else if (ext === 'pdf') {
      parts = await importPDF(file);
    } else if (ext === 'txt' || ext === 'md') {
      parts = [{
        title: 'Document',
        text: normalize(await file.text())
      }];
    } else {
      throw new Error('Choose an EPUB, PDF, TXT, or MD file.');
    }

    setBook(file.name, parts);
  } catch (error) {
    status(`Import error: ${error.message}`);
  }

  event.target.value = '';
});

$('play').addEventListener('click', play);

$('stop').addEventListener('click', () => {
  stop();
  status('Stopped.');
});

$('back').addEventListener('click', () => skip(-1));
$('next').addEventListener('click', () => skip(1));

$('chapters').addEventListener('change', event => {
  stop();
  sectionIndex = Number(event.target.value);
  charIndex = 0;
  display();
});

$('speed').addEventListener('input', event => {
  if (aiPlayer) {
    aiPlayer.playbackRate = Number(event.target.value);
  }
});

$('seek').addEventListener('change', event => {
  if (!sections.length) return;

  stop();
  charIndex = Math.floor(
    sections[sectionIndex].text.length *
    Number(event.target.value) / 100
  );
  progress();
});

$('voice').addEventListener('change', event => {
  stop();
  aiMode = ['easton', 'edwin'].includes(event.target.value);
  status(aiMode ? 'AI narrator selected.' : 'iPhone narrator selected.');
});

function refreshVoices() {
  voiceList = synth?.getVoices() || [];
}

refreshVoices();
if (synth) synth.onvoiceschanged = refreshVoices;

status('Open a book to begin.');
