import { useEffect, useState } from 'react';
import { api, ApiError, type DocumentSummary } from '../lib/api';
import { FolderTree } from '../components/FolderTree';
import { DocRow } from '../components/DocRow';

export function Home() {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.listDocuments(50)
      .then(({ documents }) => { if (live) setDocs(documents); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, []);

  return (
    <div className="main">
      <aside className="sidebar">
        <FolderTree />
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">recent activity</div>
            <h1>last 50 documents</h1>
          </div>
          <span className="crumbs">/ memory</span>
        </div>
        {err && <div className="state err">{err}</div>}
        {!err && !docs && <div className="state"><span className="cursor">loading</span></div>}
        {!err && docs && docs.length === 0 && (
          <div className="state">no documents yet · create one with <code>metabot memory create</code></div>
        )}
        {!err && docs && docs.map((d, i) => <DocRow key={d.id} doc={d} index={i} />)}
      </div>
    </div>
  );
}
