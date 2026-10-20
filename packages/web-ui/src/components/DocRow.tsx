import { Link } from 'react-router-dom';
import type { DocumentSummary } from '../lib/api';
import { formatRelative } from '../lib/format';
import { contentTypeBadge } from '../lib/format';

interface Props {
  doc: DocumentSummary;
  index: number;
}

export function DocRow({ doc, index }: Props) {
  const badgeClass = doc.content_type === 'text/html' ? 'badge html' : 'badge md';
  const slug = contentTypeBadge(doc.content_type);
  return (
    <Link to={`/memory${doc.path}`} className="doc-row">
      <span className="idx">{String(index + 1).padStart(3, '0')}</span>
      <span className="title">
        <span className={badgeClass}>{slug}</span>
        {doc.title}
        <span className="path">{doc.path}</span>
      </span>
      <span className="tags">
        {doc.tags.slice(0, 3).map((t) => (
          <span className="badge tag" key={t}>#{t}</span>
        ))}
      </span>
      <span className="ts" title={doc.updated_at}>{formatRelative(doc.updated_at)}</span>
    </Link>
  );
}
