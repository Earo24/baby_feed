import { NextRequest, NextResponse } from 'next/server';
import { getFeeds, getRoomById, insertFeed } from '@/storage/database/sqlite';
import { getChinaCycleStart } from '@/storage/database/time';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    const body = await request.json();
    const { feeder_name, feed_type, duration_minutes, amount_ml, note, started_at } = body;

    if (!feed_type) return NextResponse.json({ success: false, error: '缺少喂奶类型' }, { status: 400 });
    if (!['left', 'right', 'bottle', 'formula'].includes(feed_type)) {
      return NextResponse.json({ success: false, error: '无效的喂奶类型' }, { status: 400 });
    }
    if (!getRoomById(roomId)) return NextResponse.json({ success: false, error: '房间不存在' }, { status: 404 });

    const record = insertFeed({
      room_id: roomId,
      feeder_name: feeder_name || null,
      feed_type,
      duration_minutes: duration_minutes || null,
      amount_ml: amount_ml || null,
      note: note || null,
      started_at: started_at || new Date().toISOString(),
    });
    return NextResponse.json({ success: true, data: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '1', 10), 1), 30);
    return NextResponse.json({ success: true, data: getFeeds(roomId, getChinaCycleStart(days), 500) });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
