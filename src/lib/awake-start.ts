export type AwakeStartResult<T> =
  | { status: 'synced'; record: T; created: boolean }
  | { status: 'create-failed' }
  | { status: 'sync-failed'; record: T; created: boolean };

export interface PendingAwakeStart<T> {
  roomId: string;
  record: T;
}

export function getPendingAwakeRecord<T>(
  pending: PendingAwakeStart<T> | null,
  roomId: string,
): T | null {
  return pending?.roomId === roomId ? pending.record : null;
}

interface AwakeStartOptions<T> {
  pendingRecord: T | null;
  createRecord: () => Promise<T>;
  refreshRoom: () => Promise<boolean>;
}

export async function coordinateAwakeStart<T>({
  pendingRecord,
  createRecord,
  refreshRoom,
}: AwakeStartOptions<T>): Promise<AwakeStartResult<T>> {
  let record = pendingRecord;
  let created = false;

  if (record === null) {
    try {
      record = await createRecord();
      created = true;
    } catch {
      return { status: 'create-failed' };
    }
  }

  try {
    if (!await refreshRoom()) {
      return { status: 'sync-failed', record, created };
    }
  } catch {
    return { status: 'sync-failed', record, created };
  }

  return { status: 'synced', record, created };
}
