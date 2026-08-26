'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

type Granularity = 'day' | 'week' | 'month';

interface FeedTrendPoint {
  period_start: string;
  label: string;
  total_ml: number;
  feed_count: number;
  measured_count: number;
}

interface FeedStatsResponse {
  success: boolean;
  data?: {
    granularity: Granularity;
    bucket_count: number;
    points: FeedTrendPoint[];
  };
  error?: string;
}

export interface FeedVolumeTrendProps {
  roomId: string;
  todayTotalMl: number;
  refreshKey: string;
}

const RANGE_BY_GRANULARITY: Record<Granularity, number> = {
  day: 90,
  week: 12,
  month: 12,
};

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: '按天',
  week: '按周',
  month: '按月',
};

const chartConfig = {
  volume: { label: '奶量', color: '#E3B87A' },
  feed_count: { label: '喂奶次数', color: '#A89888' },
  measured_count: { label: '有奶量记录次数', color: '#A89888' },
} satisfies ChartConfig;

function formatTooltipLabel(label: unknown): string {
  return typeof label === 'string' ? label : '';
}

function formatValue(value: unknown): string {
  return typeof value === 'number' ? `${value} ml` : String(value ?? '');
}

export function FeedVolumeTrend({ roomId, todayTotalMl, refreshKey }: FeedVolumeTrendProps) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [points, setPoints] = useState<FeedTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const range = RANGE_BY_GRANULARITY[granularity];
        const response = await fetch(
          `/api/rooms/${encodeURIComponent(roomId)}/feed-stats?granularity=${granularity}&range=${range}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as FeedStatsResponse;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || '奶量趋势加载失败');
        }
        if (cancelled || requestId !== requestIdRef.current) return;
        setPoints(payload.data.points);
      } catch (cause) {
        if (cancelled || controller.signal.aborted || requestId !== requestIdRef.current) return;
        setError(cause instanceof Error ? cause.message : '奶量趋势加载失败');
        setPoints([]);
      } finally {
        if (!cancelled && !controller.signal.aborted && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [granularity, refreshKey, retryNonce, roomId]);

  const maxTotalMl = useMemo(
    () => Math.max(0, ...points.map((point) => point.total_ml)),
    [points],
  );
  const measuredCount = useMemo(
    () => points.reduce((sum, point) => sum + point.measured_count, 0),
    [points],
  );
  const shouldSampleLabels = granularity === 'day' && points.length > 30;

  const retry = () => {
    setRetryNonce((value) => value + 1);
  };

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-2xl bg-[#FFFCF8] p-4" aria-label="奶量趋势">
      <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm" style={{ color: '#8F7968' }}>今日总量</span>
          <strong className="text-xl font-semibold tabular-nums" style={{ color: '#3D3229' }}>
            {todayTotalMl} ml
          </strong>
        </div>
        <div className="flex max-w-full flex-wrap gap-1 rounded-xl bg-[#FFF3E6] p-1" role="group" aria-label="趋势粒度">
          {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={granularity === option}
              onClick={() => setGranularity(option)}
              className="min-h-10 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D9917A]"
              style={{
                backgroundColor: granularity === option ? '#D9917A' : '#FFF3E6',
                color: granularity === option ? '#FFFFFF' : '#8F7968',
              }}
            >
              {GRANULARITY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm" style={{ color: '#A89888' }}>加载中</p>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
          <p className="text-sm" style={{ color: '#C96F5B' }}>{error}</p>
          <button
            type="button"
            onClick={retry}
            className="min-h-10 rounded-lg px-4 text-sm"
            style={{ backgroundColor: '#FFF3E6', color: '#C96F5B' }}
          >
            重试
          </button>
        </div>
      ) : measuredCount === 0 ? (
        <p className="py-12 text-center text-sm" style={{ color: '#A89888' }}>暂无可统计奶量</p>
      ) : (
        <ChartContainer config={chartConfig} className="h-56 w-full min-w-0">
          <BarChart data={points} margin={{ top: 8, right: 4, left: -16, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#F1E5D8" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval={0}
              tickFormatter={(value, index) => {
                if (!shouldSampleLabels || index % 10 === 0 || index === points.length - 1) {
                  return formatTooltipLabel(value);
                }
                return '';
              }}
              tick={{ fill: '#A89888', fontSize: 10 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={42}
              tick={{ fill: '#A89888', fontSize: 10 }}
              tickFormatter={(value) => `${value}`}
            />
            <ChartTooltip
              cursor={{ fill: '#FFF3E6' }}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatTooltipLabel(label)}
                  formatter={(value, name) => {
                    const labels: Record<string, string> = {
                      volume: '总奶量',
                      total_ml: '总奶量',
                      feed_count: '喂奶次数',
                      measured_count: '有奶量记录次数',
                    };
                    const key = String(name);
                    const display = key === 'total_ml' || key === 'volume' ? formatValue(value) : `${value ?? 0} 次`;
                    return [display, labels[key] || key];
                  }}
                />
              }
            />
            <Bar dataKey="total_ml" name="volume" radius={[6, 6, 0, 0]}>
              {points.map((point) => (
                <Cell
                  key={point.period_start}
                  fill={point.total_ml > 0 && point.total_ml === maxTotalMl ? '#D9917A' : '#E3B87A'}
                />
              ))}
            </Bar>
            <Bar dataKey="feed_count" name="feed_count" fill="transparent" barSize={0} />
            <Bar dataKey="measured_count" name="measured_count" fill="transparent" barSize={0} />
          </BarChart>
        </ChartContainer>
      )}
    </section>
  );
}
