export interface LatestRequestToken {
  key: string;
  generation: number;
}

export interface LatestRequestGate {
  begin: (key: string) => LatestRequestToken;
  invalidate: () => void;
  isLatest: (token: LatestRequestToken) => boolean;
}

export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;

  return {
    begin(key) {
      generation += 1;
      return { key, generation };
    },
    invalidate() {
      generation += 1;
    },
    isLatest(token) {
      return token.generation === generation;
    },
  };
}

export interface RequestState {
  roomGate: LatestRequestGate;
  historyGate: LatestRequestGate;
  setActiveRoomId: (roomId: string | null) => void;
  setHistoryDays: (days: number) => void;
  matchesHistory: (roomId: string, days: number) => boolean;
}

export function createRequestState(initialHistoryDays: number): RequestState {
  let activeRoomId: string | null = null;
  let historyDays = initialHistoryDays;

  return {
    roomGate: createLatestRequestGate(),
    historyGate: createLatestRequestGate(),
    setActiveRoomId(roomId) {
      activeRoomId = roomId;
    },
    setHistoryDays(days) {
      historyDays = days;
    },
    matchesHistory(roomId, days) {
      return activeRoomId === roomId && historyDays === days;
    },
  };
}

export interface HistorySnapshot<
  TFeed = unknown,
  TPoop = unknown,
  TMedication = unknown,
  TAwake = unknown,
  TSolidFood = unknown,
> {
  feeds: TFeed[];
  poops: TPoop[];
  medications: TMedication[];
  awakes: TAwake[];
  solidFoods: TSolidFood[];
}

interface HistoryResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

type HistoryFetcher = (url: string) => Promise<HistoryResponse>;

interface HistoryPayload {
  success?: boolean;
  data?: unknown;
}

export async function fetchHistorySnapshot<
  TFeed = unknown,
  TPoop = unknown,
  TMedication = unknown,
  TAwake = unknown,
  TSolidFood = unknown,
>(
  roomId: string,
  days: number,
  fetcher: HistoryFetcher = fetch,
): Promise<HistorySnapshot<TFeed, TPoop, TMedication, TAwake, TSolidFood>> {
  const roomPath = encodeURIComponent(roomId);
  const endpoints = ['feeds', 'poops', 'medications', 'awakes', 'solid-foods'] as const;
  const payloads = await Promise.all(endpoints.map(async (endpoint) => {
    const response = await fetcher(`/api/rooms/${roomPath}/${endpoint}?days=${days}`);
    const payload = await response.json() as HistoryPayload;
    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      throw new Error('history request failed');
    }
    return payload.data;
  }));

  return {
    feeds: payloads[0] as TFeed[],
    poops: payloads[1] as TPoop[],
    medications: payloads[2] as TMedication[],
    awakes: payloads[3] as TAwake[],
    solidFoods: payloads[4] as TSolidFood[],
  };
}
