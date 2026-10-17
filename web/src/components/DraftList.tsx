import { FilePen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatDateLabel } from '../../../shared/time';
import { OUTING_LABEL, outingKind } from '../../../shared/venue';
import { deleteDraft, draftHasContent, listDrafts } from '../lib/drafts';

/** Unfinished drafts stored on this device only. */
export function DraftList() {
  const [drafts, setDrafts] = useState(() => listDrafts().filter(draftHasContent));
  if (drafts.length === 0) return null;
  return (
    <section className="draft-list" aria-labelledby="drafts-title">
      <h2 id="drafts-title" className="section-title">
        <FilePen aria-hidden="true" />
        还没定好的
      </h2>
      <p className="muted small">刚才拣到一半的都在这里。草稿记在这台设备上，确认后大家才看得到。</p>
      <ul>
        {drafts.map((d) => {
          const count = d.mode === 'home' ? d.dishIds.length : d.candidateIds.length;
          const href = d.planId ? `/plans/${d.planId}/edit` : `/plans/new?draft=${encodeURIComponent(d.key)}`;
          return (
            <li key={d.key} className="draft-item">
              <Link to={href} className="draft-link">
                <strong>{d.mealLabel || (outingKind(d) === 'treat' ? '待定的小安排' : '待定的一餐')}</strong>
                <span className="muted small">
                  {formatDateLabel(d.date)} · {OUTING_LABEL[outingKind(d)]} · {d.planId ? '修改中' : '新安排'} · {count} 项
                </span>
              </Link>
              <button
                type="button"
                className="icon-btn"
                aria-label={`删除草稿 ${d.mealLabel || '待定的一餐'}`}
                onClick={() => {
                  deleteDraft(d.key);
                  setDrafts((prev) => prev.filter((x) => x.key !== d.key));
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
