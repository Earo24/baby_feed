import { NextRequest, NextResponse } from 'next/server';
import { deleteById, updateFeed } from '@/storage/database/sqlite';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ feedId: string }> }) {
  try {
    const { feedId } = await params;
    const body = await request.json();
    const updates: Parameters<typeof updateFeed>[1] = {};
    if (body.amount_ml !== undefined) updates.amount_ml = body.amount_ml;
    if (body.started_at !== undefined) updates.started_at = body.started_at;
    if (body.feeder_name !== undefined) updates.feeder_name = body.feeder_name;
    if (body.note !== undefined) updates.note = body.note;
    if (!Object.keys(updates).length) return NextResponse.json({ success: false, error: '没有需要更新的字段' }, { status: 400 });
    const data = updateFeed(feedId, updates);
    if (!data) return NextResponse.json({ success: false, error: '记录不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '未知错误' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ feedId: string }> }) {
  try {
    deleteById('feed_records', (await params).feedId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '未知错误' }, { status: 500 });
  }
}
