import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { getSignStatus } from '@/lib/vnpt-smartca';

/**
 * GET /api/smartca/sign/status?txId=xxx
 *
 * Trả về:
 *   { status: 'PENDING' | 'COMPLETED' | 'REJECTED' | ... }
 *   Khi COMPLETED: đồng thời cập nhật ExamClinical/HealthRecord với signature_value
 */
export async function GET(req: Request) {
  try {
    const s = await requireAuth(['DOCTOR', 'CONCLUDER']);
    const { searchParams } = new URL(req.url);
    const txId = searchParams.get('txId');
    if (!txId) return NextResponse.json({ error: 'Thiếu txId' }, { status: 400 });

    const tx = await prisma.caSignTransaction.findUnique({ where: { id: txId } });
    if (!tx) return NextResponse.json({ error: 'Không tìm thấy giao dịch' }, { status: 404 });
    if (tx.userId !== s.sub) return NextResponse.json({ error: 'Không có quyền' }, { status: 403 });

    // Đã xong trước đó
    if (tx.status !== 'PENDING') {
      return NextResponse.json({
        status: tx.status,
        signatureValue: tx.signatureValue,
        errorMessage: tx.errorMessage,
      });
    }

    // Poll VNPT
    if (!tx.tranCode) {
      return NextResponse.json({ status: 'FAILED', errorMessage: 'Thiếu tran_code' });
    }
    const result = await getSignStatus(tx.tranCode);

    // Hết hạn: sau 10 phút chưa xong coi như EXPIRED
    const age = Date.now() - new Date(tx.createdAt).getTime();
    if (!result && age > 10 * 60 * 1000) {
      await prisma.caSignTransaction.update({
        where: { id: tx.id },
        data: { status: 'EXPIRED', errorMessage: 'Hết thời gian chờ (10 phút)' },
      });
      return NextResponse.json({ status: 'EXPIRED' });
    }

    if (!result) {
      return NextResponse.json({ status: 'PENDING' });
    }

    // Có signature_value → ký thành công
    const sig = result.signatures[0];
    const signatureValue = sig?.signature_value ?? null;

    if (!signatureValue) {
      return NextResponse.json({ status: 'PENDING' });
    }

    await prisma.caSignTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'COMPLETED',
        signatureValue,
        completedAt: new Date(),
      },
    });

    // Áp dụng chữ ký vào ExamClinical hoặc HealthRecord
    const user = await prisma.user.findUnique({ where: { id: s.sub } });
    const sigLabel = `VNPT-SmartCA: ${signatureValue.slice(0, 60)}...`; // placeholder để hiển thị

    if (tx.targetType === 'CLINICAL_EXAM') {
      // targetId có thể là "recordId::specialty" hoặc id thật của ExamClinical
      let recordId = tx.targetId;
      let specialty: any = null;
      if (tx.targetId.includes('::')) {
        [recordId, specialty] = tx.targetId.split('::');
      }

      if (specialty) {
        // Upsert ExamClinical
        await prisma.examClinical.upsert({
          where: { recordId_specialty: { recordId, specialty } },
          create: {
            recordId,
            specialty,
            signedAt: new Date(),
            signatureDataUrl: `CA:${signatureValue}`,
            doctorId: s.sub,
            doctorNameSnapshot: user?.fullName,
            doctorTitleSnapshot: user?.jobTitle,
          },
          update: {
            signedAt: new Date(),
            signatureDataUrl: `CA:${signatureValue}`,
            doctorId: s.sub,
            doctorNameSnapshot: user?.fullName,
            doctorTitleSnapshot: user?.jobTitle,
          },
        });
      } else {
        // targetId là examClinical.id
        await prisma.examClinical.update({
          where: { id: tx.targetId },
          data: {
            signedAt: new Date(),
            signatureDataUrl: `CA:${signatureValue}`,
            doctorId: s.sub,
            doctorNameSnapshot: user?.fullName,
            doctorTitleSnapshot: user?.jobTitle,
          },
        });
      }
    } else if (tx.targetType === 'CONCLUSION') {
      await prisma.healthRecord.update({
        where: { id: tx.targetId },
        data: {
          concluderSignedAt: new Date(),
          concluderSignatureDataUrl: `CA:${signatureValue}`,
          concluderId: s.sub,
          concluderNameSnapshot: user?.fullName,
          concluderTitleSnapshot: user?.jobTitle,
          status: 'COMPLETED',
          finalizedAt: new Date(),
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: s.sub,
        action: 'SMARTCA_SIGN_COMPLETED',
        target: tx.id,
      },
    });

    return NextResponse.json({ status: 'COMPLETED', signatureValue });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lỗi' }, { status: 500 });
  }
}
