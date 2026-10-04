import { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

type Props = { xml: string; title: string; transpose: number; currentBeat: number; playing: boolean };

function positionAtOrBefore(positions: number[], beat: number) {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (positions[middle] <= beat + 0.0001) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export default function ScoreView({ xml, title, transpose, currentBeat, playing }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<OpenSheetMusicDisplay | null>(null);
  const cursorPositions = useRef<number[]>([]);
  const cursorIndex = useRef(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentMeasure, setCurrentMeasure] = useState('1');

  useEffect(() => {
    let cancelled = false;
    const target = host.current;
    if (!target) return;
    target.replaceChildren();
    setState('loading');
    const display = new OpenSheetMusicDisplay(target, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: true,
      pageFormat: 'Endless',
      newSystemFromXML: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: '#db7b5d', alpha: 0.34, follow: true }],
    });
    renderer.current = display;

    display.load(xml).then(() => {
      if (cancelled) return;
      display.render();
      const cursor = display.cursor;
      cursor.reset();
      const iterator = cursor.Iterator.clone();
      const positions: number[] = [];
      let steps = 0;
      while (!iterator.EndReached && steps < 100_000) {
        // OSMD uses whole-note timestamps; the player timeline uses quarter-note beats.
        positions.push(iterator.currentTimeStamp.RealValue * 4);
        iterator.moveToNext();
        steps += 1;
      }
      cursorPositions.current = positions.length ? positions : [0];
      cursorIndex.current = 0;
      cursor.hide();
      setCurrentMeasure(String(cursor.Iterator.CurrentMeasure?.MeasureNumber ?? 1));
      setState('ready');
    }).catch(() => {
      if (!cancelled) setState('error');
    });

    return () => {
      cancelled = true;
      display.cursor.hide();
      display.dispose();
      renderer.current = null;
      cursorPositions.current = [];
      target.replaceChildren();
    };
  }, [xml, transpose]);

  useEffect(() => {
    const display = renderer.current;
    if (!display || state !== 'ready') return;
    const cursor = display.cursor;
    const positions = cursorPositions.current;
    const targetIndex = positionAtOrBefore(positions, Math.max(0, currentBeat));

    while (cursorIndex.current < targetIndex) {
      cursor.next();
      cursorIndex.current += 1;
    }
    while (cursorIndex.current > targetIndex) {
      cursor.previous();
      cursorIndex.current -= 1;
    }

    if (playing || currentBeat > 0.001) cursor.show();
    else cursor.hide();

    const measure = String(cursor.Iterator.CurrentMeasure?.MeasureNumber ?? 1);
    setCurrentMeasure((previous) => previous === measure ? previous : measure);
  }, [currentBeat, playing, state]);

  return <div className="score-frame">
    <div className="score-meta">
      <span>{title}</span>
      <div className="score-meta-right">
        <span className={`score-position ${playing ? 'is-playing' : ''}`} aria-live="polite">
          <i aria-hidden="true" />{playing ? 'PLAYING' : 'POSITION'} · BAR {currentMeasure}
        </span>
        <span>{transpose === 0 ? 'CONCERT PITCH' : `TRANSPOSED ${transpose > 0 ? '+' : ''}${transpose}`}</span>
      </div>
    </div>
    {state === 'loading' && <div className="score-message"><span className="spinner"/>Engraving score…</div>}
    {state === 'error' && <div className="score-message error">This score could not be engraved. Try exporting as MusicXML.</div>}
    <div className={`osmd-host ${state === 'loading' ? 'is-loading' : ''}`} ref={host}/>
    {state === 'ready' && <div className="score-foot"><span>Rendered from the score’s notation data</span><span>SCROLL TO CONTINUE</span></div>}
  </div>;
}
