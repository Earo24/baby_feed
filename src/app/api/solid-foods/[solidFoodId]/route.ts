import { NextRequest, NextResponse } from 'next/server';
import { deleteById } from '@/storage/database/sqlite';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ solidFoodId: string }> },
) {
  try {
    const { solidFoodId } = await params;
    deleteById('solid_food_records', solidFoodId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '删除辅食记录失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
