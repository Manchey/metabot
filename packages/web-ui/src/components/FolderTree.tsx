import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type FolderTreeNode, ApiError } from '../lib/api';

interface Props {
  activePath?: string;
}

export function FolderTree({ activePath }: Props) {
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    let live = true;
    api.folderTree()
      .then((t) => { if (live) setTree(t); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return; // App-level handler bounces
        if (live) setErr(e instanceof Error ? e.message : 'failed');
      });
    return () => { live = false; };
  }, [loc.pathname]);

  if (err) return <div className="sidebar-section">tree unavailable · {err}</div>;
  if (!tree) return <div className="sidebar-section">loading tree…</div>;

  const totalDocs = countDocs(tree);

  return (
    <>
      <div className="sidebar-section">
        <span>folders</span>
        <span className="count">{totalDocs} docs</span>
      </div>
      <ul className="tree">
        <NodeRow
          node={tree}
          depth={0}
          activePath={activePath}
          onPick={(p) => nav('/memory' + p)}
        />
      </ul>
    </>
  );
}

function countDocs(n: FolderTreeNode): number {
  return n.document_count + n.children.reduce((sum, c) => sum + countDocs(c), 0);
}

interface RowProps {
  node: FolderTreeNode;
  depth: number;
  activePath?: string;
  onPick(path: string): void;
}

function NodeRow({ node, depth, activePath, onPick }: RowProps) {
  // Auto-expand if the active path lives inside this subtree.
  const inside = !!activePath && (activePath === node.path || activePath.startsWith(node.path === '/' ? '/' : node.path + '/'));
  const [open, setOpen] = useState(depth === 0 || inside);

  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);

  const hasChildren = node.children.length > 0;
  const active = activePath === node.path;
  const label = depth === 0 ? '/' : node.name;

  return (
    <li>
      <div
        className={'tree-row' + (active ? ' active' : '')}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o);
          onPick(node.path);
        }}
        role="button"
      >
        <span className="chev">{hasChildren ? (open ? '−' : '+') : '·'}</span>
        <span className="name">{label}</span>
        <span className="count">{node.document_count || ''}</span>
      </div>
      {open && hasChildren && (
        <ul className="tree-children">
          {node.children.map((c) => (
            <NodeRow key={c.id} node={c} depth={depth + 1} activePath={activePath} onPick={onPick} />
          ))}
        </ul>
      )}
    </li>
  );
}
