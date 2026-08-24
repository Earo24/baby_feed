import { NextRequest, NextResponse } from 'next/server';
import { getRoomByCode, insertRoom } from '@/storage/database/sqlite';

// POST /api/rooms - Create a new room or join existing room
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, code } = body;

    // If code is provided, try to join existing room
    if (code) {
      const existingRoom = getRoomByCode(String(code).trim().toUpperCase());

      if (existingRoom) {
        return NextResponse.json({ success: true, data: existingRoom });
      }

      // Room not found, create new with this code
      const newRoom = insertRoom({ code: String(code).trim().toUpperCase(), name: name || '宝宝' });
      return NextResponse.json({ success: true, data: newRoom });
    }

    // No code provided, create new room with auto-generated code
    const roomCode = generateRoomCode();
    const newRoom = insertRoom({ code: roomCode, name: name || '宝宝' });
    return NextResponse.json({ success: true, data: newRoom });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
