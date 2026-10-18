import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { splitTags } from '../../../shared/restaurant';
import { SUGGESTED_VENUE_TAGS } from '../../../shared/venueTags';

interface Props {
  value: string[];
  draft: string;
  onDraft: (value: string) => void;
  onChange: (value: string[]) => void;
  suggestions: string[];
  error?: string;
}

/** One input for creating and finding tags. Pending text also participates in the form save. */
export function VenueTagField({ value, draft, onDraft, onChange, suggestions, error }: Props) {
  const current = value;
  const [more, setMore] = useState(false);
  const needle = draft.trim().toLowerCase();
  const choices = [...new Set([...suggestions, ...SUGGESTED_VENUE_TAGS])]
    .filter((t) => !current.includes(t) && (!needle || t.toLowerCase().includes(needle)));
  const shown = choices.slice(0, needle || more ? 12 : 6);
  const add = (raw: string) => {
    onChange([...new Set([...current, ...splitTags(raw)])]);
    onDraft('');
  };
  const pick = (tag: string) => { onChange([...new Set([...current, tag])]); onDraft(''); };
  return (
    <div className="field venue-tags">
      <label className="field-label" htmlFor="item-tags">分类标签 <span className="muted small">（可多选）</span></label>
      {current.length > 0 && <div className="chip-row selected-tags" role="group" aria-label="已选分类标签">
        {current.map((tag) => <button key={tag} type="button" className="chip chip-removable" aria-label={`移除标签 ${tag}`}
          onClick={() => onChange(current.filter((t) => t !== tag))}><span>{tag}</span><X aria-hidden="true" /></button>)}
      </div>}
      <div className="venue-tag-input">
        <input id="item-tags" className="input" value={draft} placeholder="搜索或添加标签"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'item-tags-hint item-tags-err' : 'item-tags-hint'}
          onChange={(e) => onDraft(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(draft); }
          }} />
        <button type="button" className="btn btn-ghost" disabled={!draft.trim()} onClick={() => add(draft)} aria-label="添加标签"><Plus aria-hidden="true" /></button>
      </div>
      <p id="item-tags-hint" className="field-hint">菜系、餐品、特色都放这里。输入后回车添加。</p>
      {choices.length > 0 && <div className="chip-row" role="group" aria-label="可用标签，点一下添加">
        {shown.map((tag) => <button key={tag} type="button" className="chip chip-tag" onClick={() => pick(tag)}>{tag}</button>)}
        {!needle && choices.length > 6 && <button type="button" className="chip" aria-expanded={more} onClick={() => setMore(!more)}>{more ? '收起推荐' : '更多标签'}</button>}
      </div>}
      {error && <p id="item-tags-err" className="field-error">{error}</p>}
    </div>
  );
}
