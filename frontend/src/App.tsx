import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Tone from 'tone';
import ScoreView from './ScoreView';
import { createDemoMusicXml, parseMusicXml, transposeMusicXml, type NoteEvent } from './music';

const SAMPLE_XML = createDemoMusicXml();
const PIANO_URLS = {
  A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3', A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3', A7: 'A7.mp3', C8: 'C8.mp3',
};
// Tone.js expects ASCII accidentals in note names (for example, C#4).
const pitchNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToNote = (midi: number) => `${pitchNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const formatTime = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;


export default function App() {
  const [xml, setXml] = useState(SAMPLE_XML);
  const [title, setTitle] = useState('Practice Etude');
  const [composer, setComposer] = useState('Original Scoreplay study');
  const [tempo, setTempo] = useState(72);
  const [transpose, setTranspose] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mutedParts, setMutedParts] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState('Practice Etude');
  const [sourceKind, setSourceKind] = useState<'demo' | 'musicxml' | 'pdf'>('demo');
  const [omrMessage, setOmrMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [backendReady, setBackendReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(78);
  const fileInput = useRef<HTMLInputElement>(null);
  const sampler = useRef<Tone.Sampler | null>(null);
  const timer = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const startRef = useRef(0);
  const offsetRef = useRef(0);
  const score = useMemo(() => parseMusicXml(xml), [xml]);
  const renderedXml = useMemo(() => transposeMusicXml(xml, transpose), [xml, transpose]);
  const duration = Math.max(1, score.beats * 60 / tempo);
  const currentBeat = Math.min(score.beats, elapsed * tempo / 60);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  useEffect(() => {
    fetch('/api/health').then((response) => response.ok ? response.json() : null).then((result) => setBackendReady(!!result?.omrReady)).catch(() => setBackendReady(false));
  }, []);
  useEffect(() => {
    const gain = sampler.current?.volume;
    if (gain) gain.value = volumeToDb(volume);
  }, [volume]);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); sampler.current?.releaseAll(); sampler.current?.dispose(); }, []);

  function volumeToDb(value: number) { return value <= 0 ? -60 : 20 * Math.log10(value / 100); }

  function clearTimer() { if (timer.current) window.clearInterval(timer.current); timer.current = null; }

  async function getPiano() {
    if (!sampler.current) {
      sampler.current = new Tone.Sampler({ urls: PIANO_URLS, release: 1, baseUrl: 'https://tonejs.github.io/audio/salamander/' }).toDestination();
      sampler.current.volume.value = volumeToDb(volume);
    }
    await Tone.start();
    await Tone.loaded();
    return sampler.current;
  }

  async function startPlayback(from = elapsedRef.current) {
    try {
      clearTimer();
      setLoadingAudio(true);
      const piano = await getPiano();
      setLoadingAudio(false);
      const selected: NoteEvent[] = score.events.filter((event) => !mutedParts.has(event.part));
      if (!selected.length) throw new Error('Turn on at least one part to play this score.');
      const beatSeconds = 60 / tempo;
      offsetRef.current = Math.max(0, from);
      startRef.current = performance.now();
      const initialSeconds = offsetRef.current;
      let index = selected.findIndex((event) => event.beat * beatSeconds >= initialSeconds);
      if (index < 0) index = selected.length;
      setPlaying(true);
      const tick = () => {
        const nowElapsed = initialSeconds + (performance.now() - startRef.current) / 1000;
        const audioNow = Tone.now();
        while (index < selected.length && selected[index].beat * beatSeconds <= nowElapsed + 0.12) {
          const event = selected[index++];
          const eventTime = Math.max(audioNow + 0.005, audioNow + event.beat * beatSeconds - nowElapsed);
          const noteName = midiToNote(event.midi + transpose);
          piano.triggerAttackRelease(noteName, Math.max(0.06, event.length * beatSeconds * 0.94), eventTime, event.velocity);
        }
        setElapsed(Math.min(duration, nowElapsed));
        elapsedRef.current = Math.min(duration, nowElapsed);
        if (nowElapsed >= duration) {
          clearTimer(); piano.releaseAll(); setPlaying(false);
          if (loop) { elapsedRef.current = 0; setElapsed(0); window.setTimeout(() => startPlayback(0), 120); }
        }
      };
      tick();
      timer.current = window.setInterval(tick, 35);
    } catch (error) {
      setLoadingAudio(false); setPlaying(false);
      setNotice(error instanceof Error ? error.message : 'Piano samples could not be loaded. Check your internet connection.');
      window.setTimeout(() => setNotice(''), 4800);
    }
  }

  function pausePlayback() {
    clearTimer(); sampler.current?.releaseAll();
    const next = Math.min(duration, offsetRef.current + (performance.now() - startRef.current) / 1000);
    elapsedRef.current = next; setElapsed(next); setPlaying(false);
  }

  function togglePlayback() { if (playing) pausePlayback(); else void startPlayback(elapsedRef.current); }

  function changeTempo(value: number) {
    const seconds = playing
      ? offsetRef.current + (performance.now() - startRef.current) / 1000
      : elapsedRef.current;
    const beat = Math.min(score.beats, seconds * tempo / 60);
    if (playing) {
      clearTimer(); sampler.current?.releaseAll(); setPlaying(false);
    }
    const next = beat * 60 / value;
    elapsedRef.current = next; offsetRef.current = next; setElapsed(next);
    setTempo(value);
  }

  async function loadFile(file: File) {
    setNotice(''); setOmrMessage('');
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (file.size > 20 * 1024 * 1024) { setNotice('Choose a file smaller than 20 MB.'); return; }
    if (!['pdf', 'musicxml', 'xml', 'mxl'].includes(extension ?? '')) { setNotice('Upload a PDF, MusicXML, or compressed MusicXML score.'); return; }
    pausePlayback(); setElapsed(0); elapsedRef.current = 0;
    try {
      let sourceXml: string;
      let kind: 'pdf' | 'musicxml';
      if (extension === 'pdf' || extension === 'mxl') {
        setOmrMessage(extension === 'pdf' ? 'Reading printed notation on the score server…' : 'Opening compressed MusicXML…');
        const form = new FormData(); form.append('file', file);
        const response = await fetch('/api/recognize', { method: 'POST', body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Could not read that file.');
        sourceXml = result.musicxml; kind = extension === 'pdf' ? 'pdf' : 'musicxml';
      } else {
        setOmrMessage('Loading MusicXML…'); sourceXml = await file.text(); kind = 'musicxml';
      }
      const parsed = parseMusicXml(sourceXml);
      setXml(sourceXml); setTitle(parsed.title); setComposer(parsed.composer); setTempo(Math.round(parsed.bpm)); setTranspose(0); setMutedParts(new Set()); setFileName(file.name); setSourceKind(kind); setElapsed(0); elapsedRef.current = 0;
      setOmrMessage(kind === 'pdf' ? `Recognized ${parsed.events.length.toLocaleString()} notes across ${parsed.parts.length} parts. Check the engraving for OMR mistakes.` : 'Score loaded and ready to play.');
      window.setTimeout(() => setOmrMessage(''), 8000);
    } catch (error) {
      setOmrMessage(''); setNotice(error instanceof Error ? error.message : 'The score could not be loaded.'); window.setTimeout(() => setNotice(''), 6000);
    }
  }

  function selectPart(index: number) {
    if (playing) pausePlayback();
    setMutedParts((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  }

  const timeRatio = Math.min(1, elapsed / duration);
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Scoreplay Studio home"><span className="brand-mark">♫</span><span><b>scoreplay</b><small>STUDIO</small></span></a>
      <nav className="top-nav"><a className="active" href="#workspace">Workspace</a><a href="#how-it-works">How it works</a><button className="text-button" onClick={() => fileInput.current?.click()}>Open a score <span>↗</span></button><div className="avatar">S</div></nav>
    </header>

    <main id="workspace">
      <section className="welcome-row"><div><div className="eyebrow"><span className="status-dot"/> YOUR PRACTICE SPACE</div><h1>Hear every part.<br/><em>Play it your way.</em></h1><p>Bring the full arrangement on your page to life.</p></div><button className="upload-button" onClick={() => fileInput.current?.click()}><span>↑</span> Upload sheet music</button><input ref={fileInput} type="file" accept=".pdf,.musicxml,.xml,.mxl" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.currentTarget.value = ''; }}/></section>

      {notice && <div className="notice error-notice"><span>!</span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
      {omrMessage && <div className="notice info-notice"><span className={omrMessage.startsWith('Reading') ? 'spinner small' : 'success-check'}>{omrMessage.startsWith('Reading') ? '' : '✓'}</span>{omrMessage}</div>}

      <div className="studio-grid">
        <section className="main-column">
          <div className="score-card">
            <div className="score-heading"><div><div className="score-kicker">{sourceKind === 'pdf' ? 'RECOGNIZED PDF SCORE' : sourceKind === 'musicxml' ? 'MUSICXML SCORE' : 'ORIGINAL PRACTICE SCORE'}</div><h2>{title}</h2><div className="score-byline">{composer}<i/> {score.parts.length} {score.parts.length === 1 ? 'part' : 'parts'}<i/> {fileName}</div></div><div className="score-badges"><span className="quality"><span/> SCORE READY</span><button className="round-tool" aria-label="Open score file" onClick={() => fileInput.current?.click()}>↗</button></div></div>
            {sourceKind === 'pdf' && <div className="recognition-note"><span>✦</span><div><b>Read from your PDF</b><small>Optical recognition can miss notes. Review the score while it plays.</small></div></div>}
            <div className={`score-scroll ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void loadFile(file); }}>
              <ScoreView xml={renderedXml} title={title} transpose={transpose} currentBeat={currentBeat} playing={playing}/>
              {dragging && <div className="drop-cover"><span>↓</span><b>Drop your score here</b></div>}
            </div>
            <div className="score-card-foot"><span><b>♫</b> Sheet notation rendered from the score file</span><button onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}>PLAYBACK CONTROLS <span>↓</span></button></div>
          </div>

          <div className="player-card">
            <button className={`play-button ${playing ? 'is-playing' : ''}`} onClick={togglePlayback} aria-label={playing ? 'Pause score' : 'Play score'} disabled={loadingAudio}>{loadingAudio ? <span className="spinner light"/> : playing ? <span className="pause-glyph">Ⅱ</span> : <span className="play-glyph">▶</span>}</button>
            <div className="player-copy"><strong>{loadingAudio ? 'Loading piano samples…' : playing ? 'Playing full arrangement' : elapsed > 0 ? 'Playback paused' : 'Ready when you are'}</strong><small>{playing ? 'FOLLOW ALONG WITH THE SCORE' : 'SAMPLED GRAND PIANO · ALL PARTS'}</small></div>
            <div className="progress-wrap"><span>{formatTime(elapsed)}</span><input aria-label="Seek through score" type="range" min="0" max="1000" value={Math.round(timeRatio * 1000)} style={{ '--fill': `${timeRatio * 100}%` } as CSSProperties} onChange={(event) => { const next = duration * Number(event.target.value) / 1000; if (playing) pausePlayback(); elapsedRef.current = next; setElapsed(next); }} onPointerUp={() => { if (playing) void startPlayback(elapsedRef.current); }}/><span>{formatTime(duration)}</span></div>
            <button className={`player-icon ${loop ? 'selected' : ''}`} onClick={() => setLoop((value) => !value)} aria-label="Toggle loop">⟳</button>
          </div>
        </section>

        <aside className="side-column">
          <section className="panel settings-panel"><div className="panel-title"><div><span className="panel-icon">☷</span><h3>Make it yours</h3></div><button className="subtle-button" onClick={() => { changeTempo(72); setTranspose(0); setMutedParts(new Set()); setVolume(78); }}>Reset</button></div>
            <div className="setting-block"><div className="setting-label"><span>Tempo</span><strong>♩ {tempo} <small>BPM</small></strong></div><input className="tempo-slider" type="range" min="40" max="180" value={tempo} onChange={(event) => changeTempo(Number(event.target.value))}/><div className="scale-labels"><span>40 BPM</span><span>110</span><span>180 BPM</span></div></div>
            <div className="setting-block transpose-block"><div className="setting-label"><span>Transpose</span><strong>{transpose === 0 ? 'Concert pitch' : `${transpose > 0 ? '+' : ''}${transpose} semitones`}</strong></div><div className="stepper"><button onClick={() => { if (playing) pausePlayback(); setTranspose((value) => Math.max(-12, value - 1)); }} aria-label="Lower pitch">−</button><div><b>{transpose > 0 ? '+' : ''}{transpose}</b><small>SEMITONES</small></div><button onClick={() => { if (playing) pausePlayback(); setTranspose((value) => Math.min(12, value + 1)); }} aria-label="Raise pitch">+</button></div><div className="pitch-context">Score and playback transpose together</div></div>
            <div className="setting-block volume-block"><div className="setting-label"><span>Volume</span><strong>{volume}%</strong></div><input className="volume-slider" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))}/></div>
          </section>

          <section className="panel parts-panel"><div className="panel-title"><div><span className="panel-icon">♬</span><h3>Arrangement</h3></div><button className="subtle-button" onClick={() => setMutedParts(new Set())}>Unmute all</button></div><p>Choose which parts to hear.</p><div className="part-list">{score.parts.map((part, index) => <button key={`${index}-${part}`} className={`part-row ${mutedParts.has(index) ? 'muted' : ''}`} onClick={() => selectPart(index)}><span className={`part-color color-${index % 4}`}/><span>{part}</span><span className="mute-state">{mutedParts.has(index) ? 'MUTED' : 'ON'}</span><span className={`toggle ${!mutedParts.has(index) ? 'on' : ''}`}><i/></span></button>)}</div><div className="part-foot"><span>{score.events.length.toLocaleString()} notes detected</span><span>{score.parts.length} {score.parts.length === 1 ? 'part' : 'parts'}</span></div></section>

          <section className="panel upload-panel"><div className="panel-title"><div><span className="panel-icon">▤</span><h3>Bring a score</h3></div></div><button className="upload-drop" onClick={() => fileInput.current?.click()}><span className="upload-cloud">↑</span><b>Choose a score file</b><small>PDF, MusicXML, or MXL<br/>up to 20 MB</small><span className="privacy-note">{backendReady ? 'PDF recognition server is ready' : 'PDF recognition runs on your score server'}</span></button><div className="file-library"><span className="file-art">♫</span><span><b>{fileName}</b><small>{sourceKind === 'demo' ? 'Sample arrangement' : sourceKind === 'pdf' ? 'PDF · recognized score' : 'MusicXML arrangement'}</small></span><span className="file-more">•••</span></div></section>
        </aside>
      </div>
      <section className="how-row" id="how-it-works"><div><span>01</span><b>Upload a score</b><small>PDF recognition or MusicXML import</small></div><i/><div><span>02</span><b>Read every part</b><small>See the full score as written</small></div><i/><div><span>03</span><b>Shape the playback</b><small>Change tempo, pitch, and balance</small></div></section>
    </main>
    <footer className="site-footer"><span>scoreplay <i>studio</i></span><span>Made for the music in your head.</span><span>PDF recognition by Audiveris</span></footer>
  </div>;
}
