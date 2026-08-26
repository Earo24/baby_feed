import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/storage/database/sqlite';

export async function GET() {
  try {
    checkDatabaseHealth();
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'unhealthy' }, { status: 503 });
  }
}
