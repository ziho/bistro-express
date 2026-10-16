import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 'drawer' slides from the bottom on small screens; 'dialog' is centred. */
  variant?: 'drawer' | 'dialog';
}

/** Accessible modal built on <dialog>: focus trap, Esc to close, inert background. */
export function Sheet({ open, onClose, title, children, footer, variant = 'dialog' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
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
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet-inner">
          <header className="sheet-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
