export const SWIPE_DELETE_WIDTH = 80;
export const SWIPE_DELETE_THRESHOLD = 40;

export interface SwipeDeleteState {
  activePointerId: number | null;
  startX: number;
  startOffset: number;
  offset: number;
}

export function createSwipeDeleteState(offset = 0): SwipeDeleteState {
  return {
    activePointerId: null,
    startX: 0,
    startOffset: offset,
    offset,
  };
}

export function beginSwipeDelete(
  state: SwipeDeleteState,
  pointerId: number,
  clientX: number,
): SwipeDeleteState {
  if (state.activePointerId !== null) return state;
  return {
    activePointerId: pointerId,
    startX: clientX,
    startOffset: state.offset,
    offset: state.offset,
  };
}

export function moveSwipeDelete(
  state: SwipeDeleteState,
  pointerId: number,
  clientX: number,
): SwipeDeleteState {
  if (state.activePointerId !== pointerId) return state;
  const distance = clientX - state.startX;
  return {
    ...state,
    offset: Math.max(-SWIPE_DELETE_WIDTH, Math.min(0, state.startOffset + distance)),
  };
}

export function commitSwipeDelete(
  state: SwipeDeleteState,
  pointerId: number,
): SwipeDeleteState {
  if (state.activePointerId !== pointerId) return state;
  const offset = state.offset < -SWIPE_DELETE_THRESHOLD ? -SWIPE_DELETE_WIDTH : 0;
  return createSwipeDeleteState(offset);
}

export function cancelSwipeDelete(
  state: SwipeDeleteState,
  pointerId: number,
): SwipeDeleteState {
  if (state.activePointerId !== pointerId) return state;
  return createSwipeDeleteState(state.startOffset);
}
