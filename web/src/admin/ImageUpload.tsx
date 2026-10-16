import { ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { api, ApiError, mediaUrl } from '../api/client';

interface Props {
  assetId: string | null;
  onChange: (id: string | null) => void;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const MAX_BYTES = 20 * 1024 * 1024;

export function ImageUpload({ assetId, onChange }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('图片不能超过 20MB');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ id: string }>('POST', '/admin/media', { form });
      onChange(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '上传失败');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="image-upload">
      <div className="image-upload-preview">
        {assetId ? <img src={mediaUrl(assetId, 'thumb')} alt="当前图片预览" /> : <span className="muted small">暂无图片</span>}
        {busy && <span className="image-upload-busy">处理中…</span>}
      </div>
      <div className="image-upload-actions">
        <label htmlFor={inputId} className={`btn btn-ghost ${busy ? 'is-disabled' : ''}`}>
          <ImagePlus aria-hidden="true" />
          {assetId ? '换一张' : '上传照片'}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {assetId && (
          <button type="button" className="btn btn-ghost btn-danger" onClick={() => onChange(null)} disabled={busy}>
            <Trash2 aria-hidden="true" />
            移除
          </button>
        )}
      </div>
      <p className="muted small">支持 JPEG / PNG / WebP / iPhone HEIC，最大 20MB；会自动转正方向并去除位置信息。</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
