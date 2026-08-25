'use client';

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

import {
  beginSwipeDelete,
  cancelSwipeDelete,
  commitSwipeDelete,
  createSwipeDeleteState,
  moveSwipeDelete,
  SWIPE_DELETE_WIDTH,
} from '@/lib/swipe-to-delete';

interface SwipeToDeleteProps {
  children?: ReactNode;
  deleteLabel: string;
  onDelete: () => void;
}

export function SwipeToDelete({ children, deleteLabel, onDelete }: SwipeToDeleteProps) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const gesture = useRef(createSwipeDeleteState());

  useEffect(() => {
    const timeout = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(timeout);
  }, []);

  const applyGesture = (next: ReturnType<typeof createSwipeDeleteState>, animate: boolean) => {
    gesture.current = next;
    setAnimating(animate);
    setOffset(next.offset);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const next = beginSwipeDelete(gesture.current, event.pointerId, event.clientX);
    if (next === gesture.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyGesture(next, false);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const next = moveSwipeDelete(gesture.current, event.pointerId, event.clientX);
    if (next === gesture.current) return;
    applyGesture(next, false);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const next = commitSwipeDelete(gesture.current, event.pointerId);
    if (next === gesture.current) return;
    applyGesture(next, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const abortPointer = (event: PointerEvent<HTMLDivElement>) => {
    const next = cancelSwipeDelete(gesture.current, event.pointerId);
    if (next === gesture.current) return;
    applyGesture(next, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const revealForKeyboard = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !event.currentTarget.matches(':focus-visible')) return;
    applyGesture(createSwipeDeleteState(-SWIPE_DELETE_WIDTH), true);
  };

  const closeAfterKeyboard = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    applyGesture(createSwipeDeleteState(), true);
  };

  return (
    <div
      aria-label={`记录操作：${deleteLabel}`}
      className="relative overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C95E49]"
      onBlur={closeAfterKeyboard}
      onFocus={revealForKeyboard}
      role="group"
      tabIndex={0}
    >
      <button
        aria-label={deleteLabel}
        className="absolute right-0 top-0 bottom-0 flex w-20 items-center justify-center text-sm font-medium text-white outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-white"
        onClick={onDelete}
        style={{ backgroundColor: '#E8836B' }}
        tabIndex={offset === -SWIPE_DELETE_WIDTH ? 0 : -1}
      >
        删除
      </button>
      <div
        className="relative"
        onLostPointerCapture={abortPointer}
        onPointerCancel={abortPointer}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          touchAction: 'pan-y',
          transform: `translateX(${offset}px)`,
          transition: animating ? 'transform 0.2s ease' : 'none',
        }}
      >
        {children}
      </div>
      {showHint && offset === 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-pulse"
          style={{ color: '#D8CEC4' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </div>
      ) : null}
    </div>
  );
}
