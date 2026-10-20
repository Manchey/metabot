import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  api,
  ApiError,
  type DocumentSummary,
  type FolderTreeNode,
} from '../lib/api';
import { DocRow } from '../components/DocRow';

interface UserGroup {
  key: string;
  label: string;
  folders: FolderTreeNode[];
  docCount: number;
  kind: 'user' | 'shared';
}

// Hoist the children of any `agents/` subfolder so bot folders render directly
// under the user. Mirrors the server-side self-namespace model: writes land at
// `/users/<owner>/agents/<bot>/...` but the `agents/` segment is plumbing — the
// tree should show each bot as a peer of the user-level docs, not buried one
// level deeper. Non-`agents` siblings (user-level docs / folders) pass through.
function flattenAgentsLayer(userNode: FolderTreeNode): FolderTreeNode {
  const out: FolderTreeNode = { ...userNode, children: [] };
  for (const child of userNode.children) {
    if (child.name === 'agents' && child.path.endsWith('/agents') && child.children.length > 0) {
      out.children.push(...child.children);
    } else {
      out.children.push(child);
    }
  }
  return out;
}

// Pure client-side bucket: walk the top-level children of the folder tree and
// split into `/users/<name>` per-user groups + one synthetic "Shared / Public"
// group that aggregates everything else. NEVER narrows readableNamespaces — the
// server's read response is shown verbatim, just re-arranged by topic.
function bucketTree(root: FolderTreeNode): UserGroup[] {
  const users: UserGroup[] = [];
  const sharedFolders: FolderTreeNode[] = [];

  // Look for `/users` at depth-1; its children are the per-user roots.
  const usersFolder = root.children.find((c) => c.name === 'users' && c.path === '/users');
  if (usersFolder) {
    for (const rawUserNode of usersFolder.children) {
      const userNode = flattenAgentsLayer(rawUserNode);
      users.push({
        key: userNode.path,
        label: userNode.name,
        folders: [userNode],
        docCount: totalDocs(userNode),
        kind: 'user',
      });
    }
  }

  // Everything else at depth-1 (besides `/users`) goes into Shared / Public.
  for (const child of root.children) {
    if (child === usersFolder) continue;
    sharedFolders.push(child);
  }

  users.sort((a, b) => a.label.localeCompare(b.label));

  const sharedDocCount = sharedFolders.reduce((sum, f) => sum + totalDocs(f), 0);
  const shared: UserGroup = {
    key: '__shared__',
    label: 'Shared / Public',
    folders: sharedFolders,
    docCount: sharedDocCount,
    kind: 'shared',
  };

  return [shared, ...users];
}

function totalDocs(n: FolderTreeNode): number {
  return n.document_count + n.children.reduce((s, c) => s + totalDocs(c), 0);
}

export function UsersMemory() {
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    let live = true;
    api.folderTree()
      .then((t) => { if (live) setTree(t); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => (tree ? bucketTree(tree) : []), [tree]);

  // The URL "selected user" is encoded as ?u=<groupKey>. Default: first group.
  const params = new URLSearchParams(loc.search);
  const selectedKey = params.get('u') || groups[0]?.key || null;
  const selectedGroup = groups.find((g) => g.key === selectedKey) ?? groups[0] ?? null;

  return (
    <div className="main">
      <aside className="sidebar">
        <div className="sidebar-section">
          <span>users</span>
          <span className="count">{groups.length || '—'}</span>
        </div>
        {err && <div className="sidebar-section">tree unavailable · {err}</div>}
        {!err && !tree && <div className="sidebar-section">loading…</div>}
        {!err && tree && (
          <ul className="user-group-list">
            {groups.map((g) => {
              const active = g.key === selectedGroup?.key;
              return (
                <li
                  key={g.key}
                  className={'user-group-row' + (active ? ' active' : '') + (g.kind === 'shared' ? ' shared' : '')}
                  onClick={() => nav(`/users?u=${encodeURIComponent(g.key)}`)}
                  role="button"
                >
                  <span className="chev">{active ? '›' : '·'}</span>
                  <span className="name">{g.label}</span>
                  <span className="count">{g.docCount}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ padding: '0 18px', marginTop: 12, color: 'var(--bone-300)', fontSize: 11, lineHeight: 1.6 }}>
          presentation-only grouping. every <code style={{ color: 'var(--amber)' }}>@xvi</code> user sees the full set —
          server-side authorization is unchanged.
        </div>
      </aside>
      <div className="content">
        <div className="page-head">
          <div>
            <div className="kicker">memory · by user</div>
            <h1>{selectedGroup?.label ?? 'users'}</h1>
          </div>
          <span className="crumbs">/ users / {selectedGroup?.label ?? ''}</span>
        </div>
        {!err && tree && selectedGroup && <GroupView group={selectedGroup} />}
      </div>
    </div>
  );
}

function GroupView({ group }: { group: UserGroup }) {
  if (group.folders.length === 0) {
    return <div className="state">no folders in this group</div>;
  }

  return (
    <>
      <ul className="user-folder-list">
        {group.folders.map((f) => (
          <li key={f.id} className="user-folder">
            <Link to={`/memory${f.path}`} className="folder-link">
              <span className="name">{f.path}</span>
              <span className="count">{totalDocs(f)} docs</span>
            </Link>
            {f.children.length > 0 && (
              <ul className="user-folder-children">
                {f.children.map((c) => (
                  <li key={c.id}>
                    <Link to={`/memory${c.path}`} className="folder-link sub">
                      <span className="chev">·</span>
                      <span className="name">{c.name}</span>
                      <span className="count">{totalDocs(c)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <RecentDocsForGroup group={group} />
    </>
  );
}

// Eagerly fetch the first folder's documents so the page has content for
// power-users who want to skim before drilling in.
function RecentDocsForGroup({ group }: { group: UserGroup }) {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const first = group.folders[0];

  useEffect(() => {
    if (!first) { setDocs([]); return; }
    let live = true;
    setDocs(null);
    setErr(null);
    api.listDocumentsByFolder(first.id, 50)
      .then(({ documents }) => { if (live) setDocs(documents); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, [first?.id, group.key]);

  if (!first) return null;
  return (
    <div className="user-recent">
      <div className="user-recent-head">
        <span className="kicker">recent in {first.path}</span>
      </div>
      {err && <div className="state err">{err}</div>}
      {!err && !docs && <div className="state"><span className="cursor">loading</span></div>}
      {!err && docs && docs.length === 0 && (
        <div className="state">no documents at <code>{first.path}</code></div>
      )}
      {!err && docs && docs.map((d, i) => <DocRow key={d.id} doc={d} index={i} />)}
    </div>
  );
}
