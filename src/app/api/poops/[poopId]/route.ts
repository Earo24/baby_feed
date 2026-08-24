import { NextResponse } from 'next/server';
import { deleteById, updateRow, PoopRow } from '@/storage/database/sqlite';

export async function PUT(request: Request, { params }: { params: Promise<{ poopId: string }> }) {
  try {
    const { poopId } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    for (const key of ['color', 'consistency', 'note', 'started_at', 'recorder_name']) if (body[key] !== undefined) updates[key] = body[key];
    if (!Object.keys(updates).length) return NextResponse.json({ success: false, error: '没有需要更新的字段' }, { status: 400 });
    const data = updateRow<PoopRow>('poop_records', poopId, updates);
    if (!data) return NextResponse.json({ success: false, error: '记录不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '更新大便记录失败' }, { status: 500 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ poopId: string }> }) {
  try { deleteById('poop_records', (await params).poopId); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '删除大便记录失败' }, { status: 500 }); }
}
