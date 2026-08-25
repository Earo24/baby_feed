import { NextRequest, NextResponse } from 'next/server';
import { getActiveAwake, getAwakes, getFeeds, getLastFeed, getMedications, getPoops, getRoomById, getSolidFoods } from '@/storage/database/sqlite';
import { getChinaCycleStart } from '@/storage/database/time';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const room = getRoomById(id);
    if (!room) {
      return NextResponse.json({ success: false, error: '房间不存在' }, { status: 404 });
    }

    const dayStartISO = getChinaCycleStart();
    return NextResponse.json({
      success: true,
      data: {
        ...room,
        feeds: getFeeds(id, dayStartISO, 50),
        poops: getPoops(id, dayStartISO).slice(0, 50),
        medications: getMedications(id, dayStartISO).slice(0, 50),
        awakes: getAwakes(id, dayStartISO).slice(0, 50),
        solid_foods: getSolidFoods(id, dayStartISO).slice(0, 50),
        activeAwake: getActiveAwake(id) || null,
        lastFeed: getLastFeed(id) || null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
