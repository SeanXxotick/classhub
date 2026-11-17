import { Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { officeViewerUrl, readFile, sizeText, viewOf } from '../../data/files';
import type { ContentFile } from '../../data/models';
import { blobBase64, nativeApp } from '../../data/native';
import { saveFile, Spinner } from '../common';
import { useClass } from '../classroom/ClassContext';
import { SubPage } from '../classroom/SubPage';
import { ErrorBoundary, lazyWithReload } from '../ErrorBoundary';

// Loaded on the first PDF. After an update the old file is gone, so the page reloads once to get the new one.
const PdfPages = lazyWithReload(() => import('./PdfPages'));

/** /class/:classId/file/:contentId: an uploaded file, opened inside ClassHub where it can be. */
export function FileViewerScreen() {
  const { contentId = '' } = useParams();
  const { state } = useClass();
  const item = state.contents.find((c) => c.id === contentId);
  if (!state.loading && (!item || !item.file)) {
    return (
      <SubPage title="File">
        <p className="empty">This file was deleted.</p>
      </SubPage>
    );
  }
  return (
    <SubPage title={item?.title ?? 'File'} wide>
      {item?.file && <FileBody key={item.file.key} classId={state.classId} file={item.file} />}
    </SubPage>
  );
}

function FileBody({ classId, file }: { classId: string; file: ContentFile }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Office files: the viewer's address, or why it cannot show (then the file opens in another app instead).
  const [viewer, setViewer] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const view = viewOf(file);
  const native = nativeApp();
  // An Office file is shown by Microsoft's viewer, so it is only downloaded here when it is saved or shared.
  const lazy = view === 'OFFICE' && !viewerError;

  useEffect(() => {
    if (lazy) return;
    let cancelled = false;
    readFile(classId, file).then(
      (b) => !cancelled && setBlob(b),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [classId, file, lazy]);

  useEffect(() => {
    if (view !== 'OFFICE') return;
    let cancelled = false;
    officeViewerUrl(classId, file.key).then(
      (u) => !cancelled && setViewer(u),
      (e: Error) => !cancelled && setViewerError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [classId, file.key, view]);

  const [fetching, setFetching] = useState(false);
  /** The file itself: already here, or downloaded now (Office files in the viewer). */
  const contents = async (): Promise<Blob | null> => {
    if (blob) return blob;
    setFetching(true);
    try {
      const b = await readFile(classId, file);
      setBlob(b);
      return b;
    } catch (e) {
      setNotice((e as Error).message);
      return null;
    } finally {
      setFetching(false);
    }
  };
  const save = async () => {
    const b = await contents();
    if (b) await saveFile(file.name, b, setNotice).catch(() => setNotice('The file could not be saved.'));
  };
  const share = async () => {
    if (!native) return;
    const b = await contents();
    if (!b) return;
    await native.shareFile({ name: file.name, mimeType: file.mimeType, data: await blobBase64(b), title: file.name }).catch(() => setNotice('The file could not be shared.'));
  };
  const inViewer = view === 'OFFICE' && !viewerError;
  const buttons = inViewer || (blob && view !== 'OTHER' && view !== 'OFFICE');

  return (
    <div className="stack file-view">
      <div className="row file-view-bar">
        <span className="grow small muted file-view-name">{`${file.name} · ${sizeText(file.sizeBytes)}`}</span>
        {buttons && native && (
          <button type="button" className="btn outline small" disabled={fetching} onClick={share}>
            Share
          </button>
        )}
        {buttons && (
          <button type="button" className="btn outline small" disabled={fetching} onClick={save}>
            {fetching ? 'Getting the file…' : native ? 'Save' : 'Download'}
          </button>
        )}
      </div>
      {notice && (
        <p className="small muted" role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}
      {inViewer ? (
        viewer ? (
          <iframe className="file-view-office" src={viewer} title={file.name} allowFullScreen />
        ) : (
          <Spinner />
        )
      ) : error ? (
        <p className="empty">{error}</p>
      ) : !blob ? (
        <Spinner />
      ) : view === 'PDF' ? (
        <ErrorBoundary
          fallback={() => (
            <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
              <p style={{ margin: 0 }}>The PDF viewer could not load. Check your connection, then reload ClassHub.</p>
              <button type="button" className="btn solid block" onClick={() => window.location.reload()}>
                Reload
              </button>
              <button type="button" className="btn outline block" onClick={save}>
                {native ? 'Save to Downloads' : 'Download'}
              </button>
            </div>
          )}
        >
          <Suspense fallback={<Spinner />}>
            <PdfPages blob={blob} />
          </Suspense>
        </ErrorBoundary>
      ) : view === 'IMAGE' ? (
        <ImageView blob={blob} name={file.name} />
      ) : (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <p style={{ margin: 0 }}>{viewerError ? `${viewerError} It can still open in another app.` : 'This file opens in another app.'}</p>
          {native ? (
            <>
              <button type="button" className="btn solid block" onClick={share}>
                Open with another app
              </button>
              <button type="button" className="btn outline block" onClick={save}>
                Save to Downloads
              </button>
            </>
          ) : (
            <button type="button" className="btn solid block" onClick={save}>
              Download
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ImageView({ blob, name }: { blob: Blob; name: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img className="file-view-image" src={url} alt={name} /> : null;
}
