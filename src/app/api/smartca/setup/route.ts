import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { getCertificate, isConfigured } from '@/lib/vnpt-smartca';

/**
 * POST /api/smartca/setup
 * Body: { cccd: string, enable: boolean }
 * - Nếu enable=true: gọi get_certificate để lấy serial, lưu caUserId + caSerialNumber + caEnabled=true
 * - Nếu enable=false: chỉ đặt caEnabled=false
 */
export async function POST(req: Request) {
  try {
    const s = await requireAuth(['DOCTOR', 'CONCLUDER', 'ADMIN']);
    const { cccd, enable } = await req.json();

    if (!enable) {
      await prisma.user.update({
        where: { id: s.sub },
        data: { caEnabled: false },
      });
      return NextResponse.json({ ok: true, message: 'Đã tắt ký số VNPT SmartCA' });
    }

    if (!cccd || !/^\d{9,13}$/.test(cccd.toString().trim())) {
      return NextResponse.json({ error: 'CCCD không hợp lệ (9-13 chữ số)' }, { status: 400 });
    }

    if (!isConfigured()) {
      return NextResponse.json({
        error: 'Hệ thống chưa cấu hình VNPT SmartCA. Liên hệ admin để set VNPT_SCA_SP_ID và VNPT_SCA_SP_PASSWORD.',
      }, { status: 500 });
    }

    // Gọi API VNPT lấy chứng thư
    const txId = `SETUP_${s.sub}_${Date.now()}`;
    const certs = await getCertificate(cccd.trim(), txId);

    if (certs.length === 0) {
      return NextResponse.json({
        error: 'Không tìm thấy chứng thư số SmartCA đang hoạt động cho CCCD này. Kiểm tra lại CCCD hoặc đăng ký SmartCA với VNPT.',
      }, { status: 404 });
    }

    // Ưu tiên cert có service_type = SMARTCA
    const cert = certs.find((c) => c.service_type === 'SMARTCA') || certs[0];

    await prisma.user.update({
      where: { id: s.sub },
      data: {
        caUserId: cccd.trim(),
        caSerialNumber: cert.serial_number,
        caEnabled: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: s.sub,
        action: 'SMARTCA_SETUP',
        detail: JSON.stringify({ cert_subject: cert.cert_subject, valid_to: cert.cert_valid_to }),
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Đã kích hoạt ký số VNPT SmartCA',
      cert: {
        subject: cert.cert_subject,
        validFrom: cert.cert_valid_from,
        validTo: cert.cert_valid_to,
        serial: cert.serial_number,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lỗi' }, { status: 500 });
  }
}
