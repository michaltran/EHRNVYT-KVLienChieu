import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { requestSign } from '@/lib/vnpt-smartca';

/**
 * POST /api/smartca/sign/start
 * Body: {
 *   targetType: 'CLINICAL_EXAM' | 'CONCLUSION',
 *   targetId: string,          // examClinical.id hoặc healthRecord.id
 *   payload: string,           // chuỗi sẽ được hash (VD: "examId|specialty|findings|classification|timestamp")
 *   description?: string,
 * }
 *
 * Response: { txId, tranCode, message }
 * User vào app VNPT SmartCA trên điện thoại để xác nhận.
 * Sau đó gọi /api/smartca/sign/status để polling.
 */
export async function POST(req: Request) {
  try {
    const s = await requireAuth(['DOCTOR', 'CONCLUDER']);
    const user = await prisma.user.findUnique({ where: { id: s.sub } });

    if (!user?.caEnabled || !user.caUserId || !user.caSerialNumber) {
      return NextResponse.json({
        error: 'Chưa kích hoạt ký số VNPT SmartCA. Vào Hồ sơ → Kích hoạt SmartCA.',
      }, { status: 400 });
    }

    const { targetType, targetId, payload, description } = await req.json();
    if (!targetType || !targetId || !payload) {
      return NextResponse.json({ error: 'Thiếu tham số' }, { status: 400 });
    }

    // Tính hash SHA256 của payload
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const docId = `${targetType}_${targetId.slice(0, 10)}_${Date.now()}`;
    const txId = `KSK_${s.sub.slice(0, 8)}_${Date.now()}`;

    // Gọi VNPT sign
    const vnptRes = await requestSign({
      userCccd: user.caUserId,
      transactionId: txId,
      transactionDesc: description || `Ký sổ KSK định kỳ - ${user.fullName}`,
      serialNumber: user.caSerialNumber,
      files: [
        { doc_id: docId, data_to_be_signed: hash, file_type: 'pdf', sign_type: 'hash' },
      ],
    });

    // Lưu giao dịch để tracking
    const transaction = await prisma.caSignTransaction.create({
      data: {
        userId: s.sub,
        targetType,
        targetId,
        docId,
        tranCode: vnptRes.tran_code,
        vnptTranId: vnptRes.transaction_id,
        status: 'PENDING',
        dataHash: hash,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: s.sub,
        action: 'SMARTCA_SIGN_START',
        target: transaction.id,
        detail: JSON.stringify({ targetType, targetId, docId, tranCode: vnptRes.tran_code }),
      },
    });

    return NextResponse.json({
      ok: true,
      txId: transaction.id,
      tranCode: vnptRes.tran_code,
      message: 'Đã gửi yêu cầu ký. Vui lòng mở app VNPT SmartCA trên điện thoại để xác nhận.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lỗi' }, { status: 500 });
  }
}
