'use client';

import { useState } from 'react';
import SignaturePad from '@/components/SignaturePad';

type Props = {
  fullName: string; email: string; jobTitle: string;
  savedSignature: string | null;
  caUserId: string | null;
  caSerialNumber: string | null;
  caEnabled: boolean;
};

export default function DoctorProfileClient(props: Props) {
  const [sig, setSig] = useState<string | null>(props.savedSignature);
  const [title, setTitle] = useState(props.jobTitle);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // SmartCA state
  const [cccd, setCccd] = useState(props.caUserId ?? '');
  const [caMsg, setCaMsg] = useState('');
  const [caLoading, setCaLoading] = useState(false);
  const [caInfo, setCaInfo] = useState<any>(null);

  async function saveProfile() {
    setLoading(true); setMsg('');
    const res = await fetch('/api/doctor/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataUrl: sig, jobTitle: title }),
    });
    setLoading(false);
    setMsg(res.ok ? '✅ Đã lưu' : '❌ Lỗi');
  }

  async function enableSmartCA() {
    if (!cccd.match(/^\d{9,13}$/)) {
      setCaMsg('❌ CCCD không hợp lệ (9-13 chữ số)');
      return;
    }
    setCaLoading(true); setCaMsg('Đang kết nối VNPT SmartCA...');
    try {
      const res = await fetch('/api/smartca/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cccd, enable: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaMsg('✅ ' + data.message);
      setCaInfo(data.cert);
    } catch (e: any) {
      setCaMsg('❌ ' + e.message);
    } finally {
      setCaLoading(false);
    }
  }

  async function disableSmartCA() {
    if (!confirm('Tắt ký số VNPT SmartCA?')) return;
    setCaLoading(true);
    await fetch('/api/smartca/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: false }),
    });
    setCaLoading(false);
    setCaMsg('Đã tắt ký số');
    window.location.reload();
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800">Thông tin & chữ ký</h1>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500">Họ tên</div>
            <div className="font-medium">{props.fullName}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Email</div>
            <div className="font-mono text-sm">{props.email}</div>
          </div>
        </div>
        <div>
          <label className="label">Chức danh (hiển thị khi ký)</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="VD: BS CKI Nội khoa - Khoa Nội" />
        </div>
      </div>

      {/* VNPT SmartCA section */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #EAF3FB 0%, #ffffff 100%)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🔐</span>
          <h2 className="font-semibold">Ký số VNPT SmartCA</h2>
          {props.caEnabled && <span className="badge bg-green-100 text-green-700">Đã kích hoạt</span>}
        </div>
        <p className="text-sm text-slate-600 mb-3">
          Tích hợp với chứng thư số VNPT SmartCA để ký điện tử có giá trị pháp lý. Khi kích hoạt, các chữ ký của bạn sẽ được xác thực qua app VNPT SmartCA trên điện thoại thay vì chữ ký canvas/ảnh.
        </p>

        {props.caEnabled && caInfo === null ? (
          <div className="bg-white border border-green-200 rounded p-3 mb-3 text-sm">
            <div><strong>CCCD:</strong> {props.caUserId}</div>
            <div><strong>Serial chứng thư:</strong> <span className="font-mono text-xs">{props.caSerialNumber}</span></div>
            <button onClick={disableSmartCA} disabled={caLoading} className="btn-secondary mt-2 text-xs">
              Tắt ký số
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="label">Số CCCD/CMND đã đăng ký SmartCA với VNPT</label>
              <input
                className="input font-mono"
                value={cccd}
                onChange={(e) => setCccd(e.target.value.trim())}
                placeholder="Ví dụ: 048085000123"
              />
            </div>
            <button onClick={enableSmartCA} disabled={caLoading} className="btn-primary">
              {caLoading ? 'Đang kiểm tra...' : 'Kích hoạt ký số SmartCA'}
            </button>
            <p className="text-xs text-slate-500">
              Hệ thống sẽ gọi VNPT để xác minh chứng thư số. Nếu chưa có tài khoản SmartCA, liên hệ VNPT để đăng ký.
            </p>
          </div>
        )}

        {caMsg && <div className="text-sm mt-3 bg-white p-2 rounded border">{caMsg}</div>}
        {caInfo && (
          <div className="bg-white border border-green-200 rounded p-3 mt-3 text-xs space-y-1">
            <div><strong>Chứng thư:</strong> {caInfo.subject}</div>
            <div><strong>Hiệu lực:</strong> {new Date(caInfo.validFrom).toLocaleDateString('vi-VN')} → {new Date(caInfo.validTo).toLocaleDateString('vi-VN')}</div>
            <div><strong>Serial:</strong> <span className="font-mono">{caInfo.serial}</span></div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Chữ ký mẫu (offline)</h2>
        <p className="text-sm text-slate-600 mb-3">
          Dùng khi không có mạng hoặc VNPT SmartCA gặp sự cố. Ký vào ô dưới HOẶC upload ảnh PNG.
        </p>
        <SignaturePad value={sig} onChange={setSig} savedSignature={null} />
      </div>

      <div className="flex gap-2">
        <button onClick={saveProfile} className="btn-primary" disabled={loading}>
          {loading ? 'Đang lưu...' : 'Lưu chữ ký mẫu & chức danh'}
        </button>
        {msg && <span className="text-sm self-center">{msg}</span>}
      </div>
    </div>
  );
}
