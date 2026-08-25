import { NextRequest, NextResponse } from 'next/server';
import { normalizeSolidFoodInput } from '@/lib/solid-food';
import { getRoomById, getSolidFoods, insertSolidFood } from '@/storage/database/sqlite';
import { getChinaCycleStart } from '@/storage/database/time';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    if (!getRoomById(roomId)) {
      return NextResponse.json({ success: false, error: '房间不存在' }, { status: 404 });
    }

    const result = normalizeSolidFoodInput(await request.json());
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    const record = insertSolidFood({ room_id: roomId, ...result.data });
    return NextResponse.json({ success: true, data: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : '添加辅食记录失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    const parsedDays = Number.parseInt(new URL(request.url).searchParams.get('days') || '1', 10);
    const days = Number.isNaN(parsedDays) ? 1 : Math.min(Math.max(parsedDays, 1), 30);
    const records = getSolidFoods(roomId, getChinaCycleStart(days));
    return NextResponse.json({ success: true, data: records });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取辅食记录失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
