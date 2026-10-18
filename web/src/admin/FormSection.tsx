import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';

export function FormSection({ title, summary, open, onToggle, children }: {
  title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const id = useId();
  return <section className="form-section">
    <button type="button" className="form-section-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span><strong>{title}</strong><span className="form-section-summary">{summary}</span></span>
      <ChevronDown aria-hidden="true" className={open ? 'is-flipped' : ''} />
    </button>
    <div id={id} className="form-section-body" hidden={!open}>{children}</div>
  </section>;
}
