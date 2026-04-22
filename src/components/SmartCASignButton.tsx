'use client';

import { useState, useEffect, useRef } from 'react';

type Props = {
  targetType: 'CLINICAL_EXAM' | 'CONCLUSION';
  targetId: string;
  payload: string;               // chuỗi được hash để ký (mô tả nội dung)
  description?: string;
  disabled?: boolean;
  onSuccess?: () => void;
  label?: string;
};

/**
 * Nút ký VNPT SmartCA:
 * 1. Click → POST /api/smartca/sign/start → lấy txId
 * 2. Hiển thị "Chờ xác nhận trên app điện thoại..." + polling mỗi 3s
 * 3. Khi COMPLETED → gọi onSuccess()
 */
export default function SmartCASignButton({
  targetType, targetId, payload, description, disabled, onSuccess, label,
}: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [txId, setTxId] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  async function start() {
    setState('pending'); setMsg('Đang gửi yêu cầu ký đến VNPT SmartCA...');
    try {
      const res = await fetch('/api/smartca/sign/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, payload, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi');

      setTxId(data.txId);
      setMsg('📱 Mở ứng dụng VNPT SmartCA trên điện thoại để xác nhận. Đang chờ...');
      poll(data.txId);
    } catch (e: any) {
      setState('error'); setMsg('❌ ' + e.message);
    }
  }

  function poll(id: string) {
    let attempts = 0;
    const maxAttempts = 200; // ~10 phút với interval 3s

    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(pollingRef.current!);
        setState('error');
        setMsg('❌ Hết thời gian chờ. Thử lại.');
        return;
      }

      try {
        const res = await fetch(`/api/smartca/sign/status?txId=${id}`);
        const data = await res.json();

        if (data.status === 'COMPLETED') {
          clearInterval(pollingRef.current!);
          setState('success');
          setMsg('✅ Đã ký thành công!');
          if (onSuccess) onSuccess();
        } else if (data.status === 'REJECTED' || data.status === 'EXPIRED' || data.status === 'FAILED') {
          clearInterval(pollingRef.current!);
          setState('error');
          setMsg('❌ ' + (data.errorMessage || data.status));
        }
        // PENDING: tiếp tục poll
      } catch (e) {
        // silent — tiếp tục poll
      }
    }, 3000);
  }

  function cancel() {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setState('idle'); setMsg(''); setTxId(null);
  }

  return (
    <div className="space-y-2">
      {state === 'idle' && (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="btn-primary flex items-center gap-2"
        >
          <span>🔐</span>
          <span>{label || 'Ký số VNPT SmartCA'}</span>
        </button>
      )}

      {state === 'pending' && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3">
          <div className="flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <div className="text-sm text-blue-900">{msg}</div>
          </div>
          <button onClick={cancel} className="btn-secondary text-xs mt-2">Hủy</button>
        </div>
      )}

      {state === 'success' && (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-900">
          {msg}
        </div>
      )}

      {state === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
          <div className="text-red-800">{msg}</div>
          <button onClick={() => { setState('idle'); setMsg(''); }} className="btn-secondary text-xs mt-2">Thử lại</button>
        </div>
      )}
    </div>
  );
}
