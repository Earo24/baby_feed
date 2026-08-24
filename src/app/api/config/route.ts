import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ database: 'sqlite', path: process.env.SQLITE_PATH || 'data/baby-feed.sqlite' });
}
