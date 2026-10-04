import { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
type Props = { xml: string; title: string; transpose: number };
export default function ScoreView({ xml, title, transpose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false; const target = host.current; if (!target) return;
    target.replaceChildren(); setState('loading');
    const renderer = new OpenSheetMusicDisplay(target, { autoResize: true, backend: 'svg', drawTitle: false, drawComposer: false, drawCredits: false, drawPartNames: true, pageFormat: 'Endless', newSystemFromXML: true, followCursor: false });
    renderer.load(xml).then(() => { if (cancelled) return; renderer.render(); setState('ready'); }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; target.replaceChildren(); };
  }, [xml, transpose]);
  return <div className="score-frame"><div className="score-meta"><span>{title}</span><span>{transpose === 0 ? 'CONCERT PITCH' : `TRANSPOSED ${transpose > 0 ? '+' : ''}${transpose}`}</span></div>{state === 'loading' && <div className="score-message"><span className="spinner"/>Engraving score…</div>}{state === 'error' && <div className="score-message error">This score could not be engraved. Try exporting as MusicXML.</div>}<div className={`osmd-host ${state === 'loading' ? 'is-loading' : ''}`} ref={host}/>{state === 'ready' && <div className="score-foot"><span>Rendered from the score’s notation data</span><span>SCROLL TO CONTINUE</span></div>}</div>;
}
