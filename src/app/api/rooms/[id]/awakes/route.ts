import { NextResponse } from 'next/server';
import { getAwakes, insertAwake } from '@/storage/database/sqlite';
import { getChinaCycleStart } from '@/storage/database/time';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: room_id } = await params;
    const body = await request.json();
    const data = insertAwake({ room_id, recorder_name: body.recorder_name || null, note: body.note || null, started_at: body.started_at || new Date().toISOString() });
    return NextResponse.json({ success: true, data });
  } catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '添加清醒记录失败' }, { status: 500 }); }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const days = parseInt(new URL(request.url).searchParams.get('days') || '1', 10); return NextResponse.json({ success: true, data: getAwakes((await params).id, getChinaCycleStart(days)) }); }
  catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '获取清醒记录失败' }, { status: 500 }); }
}
