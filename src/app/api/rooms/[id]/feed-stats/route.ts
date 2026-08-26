import { NextResponse } from 'next/server';
import { getRoomById, getFeedTrendRecords } from '@/storage/database/sqlite';
import {
  buildFeedTrend,
  getTrendBucketCount,
  getTrendRangeStart,
  type FeedTrendGranularity,
} from '@/lib/feed-stats';

const GRANULARITIES: FeedTrendGranularity[] = ['day', 'week', 'month'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getRoomById(id)) {
    return NextResponse.json({ success: false, error: '房间不存在' }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const granularityValue = search.get('granularity') || 'day';
  const granularity = granularityValue as FeedTrendGranularity;
  const maxCount = GRANULARITIES.includes(granularity) ? getTrendBucketCount(granularity) : 0;
  const rangeRaw = search.get('range');
  const range = rangeRaw === null ? maxCount : Number(rangeRaw);
  if (!GRANULARITIES.includes(granularity) || !Number.isInteger(range) || range < 1 || range > maxCount) {
    return NextResponse.json({ success: false, error: '无效的统计粒度或范围' }, { status: 400 });
  }

  const now = new Date();
  const records = getFeedTrendRecords(id, getTrendRangeStart(granularity, now));
  const allPoints = buildFeedTrend(granularity, now, records);
  const points = range === maxCount ? allPoints : allPoints.slice(-range);
  return NextResponse.json({
    success: true,
    data: { granularity, bucket_count: points.length, points },
  });
}
