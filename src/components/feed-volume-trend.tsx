'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Rectangle,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from '@/components/ui/chart';

type Granularity = 'day' | 'week' | 'month';

interface TrendEventCounts {
  poop_count: number;
  medication_count: number;
  solid_food_count: number;
  awake_count: number;
  awake_minutes: number;
}

interface FeedTrendPoint {
  period_start: string;
  label: string;
  total_ml: number;
  average_daily_ml: number;
  measured_day_count: number;
  feed_count: number;
  measured_count: number;
  events?: TrendEventCounts;
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
  day: 30,
  week: 12,
  month: 12,
};

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: '按天',
  week: '按周',
  month: '按月',
};

const EVENT_TYPES = [
  { key: 'poop_count', label: '便便', color: '#B8A08A' },
  { key: 'medication_count', label: '吃药', color: '#8B9EAF' },
  { key: 'solid_food_count', label: '辅食', color: '#6F9B78' },
  { key: 'awake_count', label: '清醒', color: '#7BAF8E' },
] as const satisfies ReadonlyArray<{
  key: keyof TrendEventCounts;
  label: string;
  color: string;
}>;

const EMPTY_EVENTS: TrendEventCounts = {
  poop_count: 0,
  medication_count: 0,
  solid_food_count: 0,
  awake_count: 0,
  awake_minutes: 0,
};

const SHARED_CHART_TOP_MARGIN = 56;
const EVENT_PLOT_TOP = SHARED_CHART_TOP_MARGIN;

const chartConfig = {
  volume: { label: '平均每天奶量', color: '#E3B87A' },
  feed_count: { label: '喂奶次数', color: '#A89888' },
  measured_count: { label: '有奶量记录次数', color: '#A89888' },
} satisfies ChartConfig;

function formatXAxisLabel(granularity: Granularity, label: unknown): string {
  if (typeof label !== 'string') return '';

  const monthDayMatch = label.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (monthDayMatch) {
    const [, month, day] = monthDayMatch;
    return granularity === 'month' ? `${month}月` : `${month}/${day}`;
  }

  const monthMatch = label.match(/^(?:\d{4}年)?(\d{1,2})月$/);
  if (monthMatch) return `${monthMatch[1]}月`;

  return label;
}

function shouldShowXAxisLabel(
  granularity: Granularity,
  index: number,
  pointCount: number,
): boolean {
  const lastIndex = pointCount - 1;
  if (index === lastIndex) return true;

  if (granularity === 'day') {
    const dayLabelStep = 5;
    return index % dayLabelStep === 0;
  }

  if (granularity === 'week') {
    const weekLabelStep = 2;
    return index % weekLabelStep === 0;
  }

  const monthLabelStep = 2;
  return index % monthLabelStep === 0;
}

type TrendBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: FeedTrendPoint;
};

function TrendBarWithEvents({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = '#E3B87A',
  payload,
}: TrendBarShapeProps) {
  const events = payload?.events ?? EMPTY_EVENTS;
  const centerX = x + width / 2;
  const markerY = height > 0 ? Math.max(EVENT_PLOT_TOP, y - 10) : EVENT_PLOT_TOP;

  return (
    <g>
      <Rectangle x={x} y={y} width={width} height={height} fill={fill} radius={[6, 6, 0, 0]} />
      {EVENT_TYPES.map((event, index) => (
        events[event.key] > 0 ? (
          <circle
            key={event.key}
            cx={centerX + (index - 1.5) * 10}
            cy={markerY}
            r={3.5}
            fill={event.color}
            aria-label={`${event.label}${events[event.key]}次`}
          />
        ) : null
      ))}
    </g>
  );
}

type TrendLineDotProps = {
  cx?: number;
  cy?: number;
  payload?: FeedTrendPoint;
};

function TrendLineDot({ cx = 0, cy = 0, payload }: TrendLineDotProps) {
  const events = payload?.events ?? EMPTY_EVENTS;

  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill="#D9917A" stroke="#FFFCF8" strokeWidth={2} />
      {EVENT_TYPES.map((event, index) => (
        events[event.key] > 0 ? (
          <circle
            key={event.key}
            cx={cx + (index - 1.5) * 8}
            cy={cy - 10}
            r={3}
            fill={event.color}
            aria-label={`${event.label}${events[event.key]}次`}
          />
        ) : null
      ))}
    </g>
  );
}

type TrendTooltipProps = Pick<TooltipProps<number, string>, 'active' | 'payload'> & {
  granularity: Granularity;
};

function TrendTooltip({ active, payload, granularity }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  if (!point) return null;
  const events = point.events ?? EMPTY_EVENTS;

  return (
    <div
      className="min-w-44 rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC', color: '#3D3229' }}
    >
      <p className="mb-1 font-medium">{point.label}</p>
      <p>{granularity === 'day' ? '当天奶量' : '平均每天奶量'}：{granularity === 'day' ? point.total_ml : point.average_daily_ml} ml</p>
      {granularity !== 'day' ? (
        <>
          <p>周期总量：{point.total_ml} ml</p>
          <p>有奶量记录天数：{point.measured_day_count} 天</p>
        </>
      ) : null}
      <p>喂奶次数：{point.feed_count} 次</p>
      <p>有奶量记录：{point.measured_count} 次</p>
      {EVENT_TYPES.slice(0, 3).map((event) =>
        events[event.key] > 0 ? (
          <p key={event.key} style={{ color: event.color }}>
            {event.label}：{events[event.key]} 次
          </p>
        ) : null,
      )}
      {events.awake_count > 0 || events.awake_minutes > 0 ? (
        <p style={{ color: '#7BAF8E' }}>
          清醒：{events.awake_count} 次 · {events.awake_minutes} 分钟
        </p>
      ) : null}
    </div>
  );
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
  const hasMeasuredData = useMemo(
    () => points.some((point) => {
      const events = point.events ?? EMPTY_EVENTS;
      return point.measured_count > 0
        || events.poop_count > 0
        || events.medication_count > 0
        || events.solid_food_count > 0
        || events.awake_count > 0
        || events.awake_minutes > 0;
    }),
    [points],
  );
  const retry = () => {
    setRetryNonce((value) => value + 1);
  };
  const volumeDataKey = granularity === 'day' ? 'total_ml' : 'average_daily_ml';

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
      ) : !hasMeasuredData ? (
        <p className="py-12 text-center text-sm" style={{ color: '#A89888' }}>暂无可统计奶量</p>
      ) : (
        <ChartContainer config={chartConfig} className="h-56 w-full min-w-0">
          {granularity === 'day' ? (
            <LineChart
              data={points}
              margin={{
                top: SHARED_CHART_TOP_MARGIN,
                right: 20,
                left: -16,
                bottom: 24,
              }}
            >
              <CartesianGrid vertical={false} stroke="#F1E5D8" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                height={40}
                angle={-25}
                textAnchor="end"
                tickFormatter={(value, index) => (
                  shouldShowXAxisLabel(granularity, index, points.length)
                    ? formatXAxisLabel(granularity, value)
                    : ''
                )}
                tick={{ fill: '#A89888', fontSize: 9 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={42}
                tick={{ fill: '#A89888', fontSize: 10 }}
                tickFormatter={(value) => `${value}`}
              />
              <ChartTooltip cursor={{ stroke: '#D9917A', strokeDasharray: '4 4' }} content={<TrendTooltip granularity={granularity} />} />
              <Line
                dataKey="total_ml"
                name="volume"
                type="monotone"
                stroke="#D9917A"
                strokeWidth={2.5}
                dot={<TrendLineDot />}
                activeDot={{ r: 5, fill: '#D9917A', stroke: '#FFFCF8', strokeWidth: 2 }}
                connectNulls
              />
              <Line dataKey="feed_count" name="feed_count" stroke="transparent" dot={false} />
              <Line dataKey="measured_count" name="measured_count" stroke="transparent" dot={false} />
            </LineChart>
          ) : (
            <BarChart
              data={points}
              margin={{
                top: SHARED_CHART_TOP_MARGIN,
                right: 20,
                left: -16,
                bottom: 4,
              }}
            >
              <CartesianGrid vertical={false} stroke="#F1E5D8" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                height={24}
                tickFormatter={(value, index) => (
                  shouldShowXAxisLabel(granularity, index, points.length)
                    ? formatXAxisLabel(granularity, value)
                    : ''
                )}
                tick={{ fill: '#A89888', fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={42}
                tick={{ fill: '#A89888', fontSize: 10 }}
                tickFormatter={(value) => `${value}`}
              />
              <ChartTooltip cursor={{ fill: '#FFF3E6' }} content={<TrendTooltip granularity={granularity} />} />
              <Bar dataKey={volumeDataKey} name="volume" shape={<TrendBarWithEvents />}>
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
          )}
        </ChartContainer>
      )}
      {!loading && !error && hasMeasuredData ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: '#8F7968' }}>
          {EVENT_TYPES.map((event) => (
            <span key={event.key} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: event.color }} aria-hidden="true" />
              {event.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
