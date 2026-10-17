import { useQueryClient } from '@tanstack/react-query';
import { DoorOpen } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { keys, useSession } from '../api/queries';
import { Logo, OfflineBanner } from '../components/AppShell';
import { TableForTwo } from '../components/Illustrations';
import { Loading } from '../components/Loading';

const WRONG_LINES = ['好像不是这天，再想想？', '暗号未对上，想想那个特别的日子', '不是这天，慢慢想，不着急'];

function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/gate')) return '/';
  return next;
}

export function GatePage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [message, setMessage] = useState<{ tone: 'wrong' | 'locked' | 'error'; text: string } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const wrongCount = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (message?.tone === 'wrong') inputRef.current?.focus();
  }, [message]);

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setTimeout(() => {
      setLockedUntil(0);
      setMessage(null);
    }, Math.max(0, lockedUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [lockedUntil]);

  if (session.isPending) return <Loading />;
  if (session.data?.guest) return <Navigate to={safeNext(params.get('next'))} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) {
      setMessage({ tone: 'error', text: '先选一个日期吧' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api('POST', '/auth/gate', { json: { date } });
      await queryClient.invalidateQueries({ queryKey: keys.session });
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_date') {
        const line = WRONG_LINES[wrongCount.current % WRONG_LINES.length]!;
        wrongCount.current += 1;
        setMessage({ tone: 'wrong', text: line });
        setShakeKey((k) => k + 1);
      } else if (err instanceof ApiError && err.status === 429) {
        const seconds = Number((err.details as { retryAfter?: number } | undefined)?.retryAfter) || 60;
        setLockedUntil(Date.now() + Math.max(1, seconds) * 1000);
        setMessage({ tone: 'locked', text: err.message });
      } else {
        setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : '出了点小问题，请稍后再试' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <OfflineBanner />
      <div className="gate-card" key={shakeKey} data-shake={shakeKey > 0 ? 'true' : undefined}>
        <Logo />
        <TableForTwo className="gate-art" />
        <h1 className="gate-title">入嚟坐，两个人的小馆</h1>
        <p className="gate-sub">先对个暗号：只有我们知道的那个日子</p>
        <form onSubmit={submit} className="gate-form" noValidate>
          <label htmlFor="gate-date" className="field-label">
            暗号日期
          </label>
          <input
            ref={inputRef}
            id="gate-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-describedby={message ? 'gate-msg' : undefined}
            aria-invalid={message?.tone === 'wrong' ? true : undefined}
            required
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || lockedUntil > Date.now()}>
            <DoorOpen aria-hidden="true" />
            {busy ? '对暗号中…' : '入嚟坐'}
          </button>
          <p id="gate-msg" className={`gate-msg gate-msg-${message?.tone ?? 'none'}`} role="alert">
            {message?.text ?? ''}
          </p>
        </form>
      </div>
    </div>
  );
}
