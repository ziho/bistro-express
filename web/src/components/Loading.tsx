import { TomatoMascot } from './Illustrations';

export function Loading({ label = '正在摆盘…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <TomatoMascot className="loading-mascot" />
      <span>{label}</span>
    </div>
  );
}
