import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motionExitDuration } from '../lib/motion';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 'drawer' slides from the bottom on small screens; 'dialog' is centred. */
  variant?: 'drawer' | 'dialog';
}

/** Native modal semantics close immediately. CSS can finish a visual exit without
 * retaining focus or blocking the next sheet (e.g. summary → shopping preview).
 * Browsers without discrete transitions simply close immediately. */
export function Sheet({ open, onClose, title, children, footer, variant = 'dialog' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [present, setPresent] = useState(open);
  const committedOpen = useRef(false);
  const session = useRef(0);
  // Reopening starts a fresh child session even during the previous visual exit.
  // A cancelled form/calendar therefore keeps its original reset-on-open behavior.
  const contentSession = open && !committedOpen.current ? session.current + 1 : session.current;
  useLayoutEffect(() => {
    if (open && !committedOpen.current) session.current += 1;
    committedOpen.current = open;
  }, [open]);
  const lastOpenContent = useRef({ title, children, footer });
  if (open) lastOpenContent.current = { title, children, footer };
  const content = open ? { title, children, footer } : lastOpenContent.current;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      dialog.inert = false;
      dialog.removeAttribute('aria-hidden');
      setPresent(true);
      if (!dialog.open) dialog.showModal();
      return;
    }
    // close() restores focus now, rather than waiting for a decorative transition.
    if (dialog.open) dialog.close();
    dialog.inert = true;
    dialog.setAttribute('aria-hidden', 'true');
    if (!present) return;
    const timer = window.setTimeout(() => setPresent(false), motionExitDuration());
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`sheet sheet-${variant}`}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (open && event.target === ref.current) onClose();
      }}
    >
      {(open || present) && (
        <div key={contentSession} className="sheet-inner">
          <header className="sheet-header">
            <h2 id={titleId}>{content.title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="sheet-body">{content.children}</div>
          {content.footer && <footer className="sheet-footer">{content.footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
