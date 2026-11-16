import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Spinner } from '../common';

/**
 * A PDF inside ClassHub (pdf.js), loaded only when a PDF is opened. Pages are drawn as they come near the
 * screen and cleared when far away, so a long PDF does not use up a phone's memory. The legacy build, because
 * the modern one needs browser features that older Android phones do not have yet.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;

const ZOOMS = [1, 1.5, 2, 3];

export default function PdfPages({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loading: ReturnType<typeof pdfjs.getDocument> | null = null;
    (async () => {
      try {
        loading = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        const loaded = await loading.promise;
        const list = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const view = (await loaded.getPage(i)).getViewport({ scale: 1 });
          list.push({ w: view.width, h: view.height });
        }
        if (!cancelled) (setDoc(loaded), setSizes(list));
      } catch (e) {
        console.warn('PDF viewer:', String((e as Error)?.message));
        if (!cancelled) setError('This PDF could not be opened. Save it and open it in another app.');
      }
    })();
    return () => {
      cancelled = true;
      void (loading as ReturnType<typeof pdfjs.getDocument> | null)?.destroy();
    };
  }, [blob]);

  if (error) return <p className="empty">{error}</p>;
  if (!doc) return <Spinner />;
  return (
    <div className="pdf-view">
      <div className="pdf-zoom" role="group" aria-label="Zoom">
        <button type="button" className="btn outline small" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} aria-label="Zoom out">
          −
        </button>
        <span className="small muted">{`${Math.round(ZOOMS[zoom] * 100)}%`}</span>
        <button type="button" className="btn outline small" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)} aria-label="Zoom in">
          +
        </button>
        <span className="small muted">{`${sizes.length} page${sizes.length === 1 ? '' : 's'}`}</span>
      </div>
      <div className="pdf-pages">
        <div style={{ width: `${ZOOMS[zoom] * 100}%` }}>
          {sizes.map((size, i) => (
            <PdfPage key={i} doc={doc} number={i + 1} size={size} zoom={ZOOMS[zoom]} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfPage({ doc, number, size, zoom }: { doc: Doc; number: number; size: { w: number; h: number }; zoom: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '1200px 0px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const holder = box.current;
    if (!el || !holder) return;
    if (!near) {
      // Far from the screen: give the memory back.
      el.width = 0;
      el.height = 0;
      return;
    }
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let stopped = false;
    (async () => {
      const page = await doc.getPage(number);
      if (stopped) return;
      const scale = (holder.clientWidth * Math.min(window.devicePixelRatio || 1, 2)) / size.w;
      const viewport = page.getViewport({ scale });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      const rendering = page.render({ canvas: el, viewport });
      task = rendering;
      await rendering.promise.catch(() => undefined);
    })();
    return () => {
      stopped = true;
      task?.cancel();
    };
  }, [near, doc, number, size.w, zoom]);

  return (
    <div ref={box} className="pdf-page" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
      <canvas ref={canvas} aria-label={`Page ${number}`} />
    </div>
  );
}
