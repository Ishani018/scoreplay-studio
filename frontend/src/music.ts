export type NoteEvent = { midi: number; beat: number; length: number; part: number; velocity: number };
export type ScoreData = { title: string; composer: string; parts: string[]; events: NoteEvent[]; beats: number; bpm: number };
const children = (element: Element, name: string) => Array.from(element.children).filter((item) => item.localName === name);
const child = (element: Element | null, name: string) => element ? children(element, name)[0] ?? null : null;
const value = (element: Element | null) => element?.textContent?.trim() ?? '';
const positive = (element: Element | null, fallback: number) => { const number = Number(value(element)); return Number.isFinite(number) && number > 0 ? number : fallback; };
const steps: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseMusicXml(xml: string): ScoreData {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (Array.from(doc.getElementsByTagName('*')).some((element) => element.localName === 'parsererror')) throw new Error('That file is not readable MusicXML.');
  const root = doc.documentElement;
  if (!['score-partwise', 'score-timewise'].includes(root.localName)) throw new Error('This XML is not a MusicXML score. Export as MusicXML and try again.');
  if (root.localName === 'score-timewise') throw new Error('This MusicXML uses timewise layout. Export it as partwise MusicXML and try again.');
  const partNames = new Map<string, string>();
  const partList = child(root, 'part-list');
  if (partList) for (const scorePart of children(partList, 'score-part')) {
    const id = scorePart.getAttribute('id');
    if (id) partNames.set(id, value(child(scorePart, 'part-name')) || `Part ${partNames.size + 1}`);
  }
  const parts = children(root, 'part');
  if (!parts.length) throw new Error('No instrument parts were found in this score.');
  const events: NoteEvent[] = [];
  let totalBeats = 0;
  const sound = Array.from(root.getElementsByTagName('*')).find((element) => element.localName === 'sound' && element.hasAttribute('tempo'));
  const perMinute = Array.from(root.getElementsByTagName('*')).find((element) => element.localName === 'per-minute');
  let bpm = Number(sound?.getAttribute('tempo')) || Number(value(perMinute)) || 80;
  parts.forEach((part, partIndex) => {
    let absoluteBeat = 0;
    let divisions = 1;
    const id = part.getAttribute('id') ?? '';
    if (!partNames.has(id)) partNames.set(id, `Part ${partIndex + 1}`);
    for (const measure of children(part, 'measure')) {
      let cursor = 0; let furthest = 0; let lastOnset = 0;
      for (const item of Array.from(measure.children)) {
        if (item.localName === 'attributes') { divisions = positive(child(item, 'divisions'), divisions); continue; }
        if (item.localName === 'backup' || item.localName === 'forward') {
          const delta = positive(child(item, 'duration'), 0) / divisions;
          cursor += item.localName === 'backup' ? -delta : delta; furthest = Math.max(furthest, cursor); continue;
        }
        if (item.localName !== 'note') continue;
        const length = positive(child(item, 'duration'), 1) / divisions;
        const chordTone = !!child(item, 'chord');
        const onset = chordTone ? lastOnset : cursor;
        if (!chordTone) lastOnset = onset;
        if (!child(item, 'rest')) {
          const pitch = child(item, 'pitch'); const step = value(child(pitch, 'step')); const octave = Number(value(child(pitch, 'octave'))); const alter = Number(value(child(pitch, 'alter')) || '0');
          if (step in steps && Number.isFinite(octave)) events.push({ midi: (octave + 1) * 12 + steps[step] + alter, beat: absoluteBeat + onset, length: Math.max(0.08, length), part: partIndex, velocity: Math.max(0.35, Math.min(1, (Number(value(child(item, 'velocity'))) || 82) / 100)) });
        }
        if (!chordTone) cursor += length;
        furthest = Math.max(furthest, cursor);
      }
      absoluteBeat += Math.max(furthest, 0.25);
    }
    totalBeats = Math.max(totalBeats, absoluteBeat);
  });
  if (!events.length) throw new Error('No pitched notes were found in the score.');
  events.sort((a, b) => a.beat - b.beat || a.part - b.part);
  const composer = Array.from(root.getElementsByTagName('*')).find((element) => element.localName === 'creator' && element.getAttribute('type') === 'composer');
  return { title: value(child(root, 'work-title')) || value(child(root, 'movement-title')) || 'Untitled score', composer: value(composer) || 'Unknown composer', parts: [...partNames.values()], events, beats: Math.max(totalBeats, ...events.map((note) => note.beat + note.length)), bpm };
}

export function transposeMusicXml(xml: string, semitones: number): string {
  if (!semitones) return xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const names = [['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]] as const;
  for (const note of Array.from(doc.getElementsByTagName('*')).filter((element) => element.localName === 'note')) {
    const pitch = child(note, 'pitch'); if (!pitch) continue;
    const stepEl = child(pitch, 'step'); const octaveEl = child(pitch, 'octave'); if (!stepEl || !octaveEl) continue;
    const base = steps[value(stepEl)]; const oldOctave = Number(value(octaveEl)); const oldAlter = Number(value(child(pitch, 'alter')) || '0');
    if (!Number.isFinite(base) || !Number.isFinite(oldOctave)) continue;
    const midi = (oldOctave + 1) * 12 + base + oldAlter + semitones; const octave = Math.floor(midi / 12) - 1; const [step, alter] = names[((midi % 12) + 12) % 12];
    stepEl.textContent = step; octaveEl.textContent = String(octave);
    let alterEl = child(pitch, 'alter');
    if (alter && !alterEl) { alterEl = doc.createElementNS(pitch.namespaceURI, 'alter'); pitch.insertBefore(alterEl, octaveEl); }
    if (alterEl) { if (alter) alterEl.textContent = String(alter); else pitch.removeChild(alterEl); }
  }
  return new XMLSerializer().serializeToString(doc);
}

function pitchXml(midi: number) {
  const names = [['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]] as const;
  const [step, alter] = names[((midi % 12) + 12) % 12];
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
}

export function createDemoMusicXml() {
  const tune = [60,64,67,72,69,72,76,72,65,69,72,77,67,71,74,79];
  const bass = [36,43,41,43];
  const measures = Array.from({ length: 4 }, (_, measureIndex) => {
    const high = tune.slice(measureIndex * 4, measureIndex * 4 + 4).map((midi) => `<note>${pitchXml(midi)}<duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join('');
    const low = [0,1,2,3].map((beat) => `<note>${pitchXml(bass[measureIndex] + [0,4,7,4][beat])}<duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>`).join('');
    return `<measure number="${measureIndex + 1}"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${high}<backup><duration>4</duration></backup>${low}${measureIndex === 0 ? '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type><sound tempo="72"/></direction>' : ''}</measure>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Practice Etude</work-title></work><identification><creator type="composer">Original Scoreplay study</creator></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
