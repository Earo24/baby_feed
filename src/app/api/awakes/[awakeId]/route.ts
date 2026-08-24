import { NextResponse } from 'next/server';
import { AwakeRow, deleteById, updateRow } from '@/storage/database/sqlite';

export async function PATCH(request: Request, { params }: { params: Promise<{ awakeId: string }> }) {
  try {
    const { awakeId } = await params; const body = await request.json(); const updates: Record<string, unknown> = {};
    for (const key of ['started_at', 'ended_at', 'note']) if (body[key] !== undefined) updates[key] = body[key];
    if (!Object.keys(updates).length) return NextResponse.json({ success: false, error: '没有需要更新的字段' }, { status: 400 });
    const data = updateRow<AwakeRow>('awake_records', awakeId, updates);
    if (!data) return NextResponse.json({ success: false, error: '记录不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '更新清醒记录失败' }, { status: 500 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ awakeId: string }> }) {
  try { deleteById('awake_records', (await params).awakeId); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '删除清醒记录失败' }, { status: 500 }); }
}
