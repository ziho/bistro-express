import { CheckCircle2, CircleAlert } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motionExitDuration } from '../lib/motion';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}
const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

function ToastMessage({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const lifetime = window.setTimeout(() => setLeaving(true), 3800);
    return () => window.clearTimeout(lifetime);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const exit = window.setTimeout(() => onDone(item.id), motionExitDuration());
    return () => window.clearTimeout(exit);
  }, [leaving, item.id, onDone]);
  return (
    <div className={`toast toast-${item.tone}`} data-leaving={leaving || undefined}>
      {item.tone === 'error' ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <span>{item.message}</span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: Tone = 'info') => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev.slice(-2), { id, tone, message }]);
  }, []);
  const remove = useCallback((id: number) => setItems((prev) => prev.filter((item) => item.id !== id)), []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((item) => <ToastMessage key={item.id} item={item} onDone={remove} />)}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
