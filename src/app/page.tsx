'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Utensils } from 'lucide-react';

import { SolidFoodForm, SolidFoodRecordRow } from '@/components/solid-food';
import { FeedVolumeTrend } from '@/components/feed-volume-trend';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { createRequestState, fetchHistorySnapshot } from '@/lib/request-state';
import type { NormalizedSolidFoodInput, SolidFoodRecord } from '@/lib/solid-food';

// Types
interface FeedRecord {
  id: string;
  feeder_name: string | null;
  feed_type: string;
  duration_minutes: number | null;
  amount_ml: number | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

interface LastFeed {
  id: string;
  feed_type: string;
  started_at: string;
  amount_ml: number | null;
}

interface PoopRecord {
  id: string;
  recorder_name: string | null;
  color: string | null;
  consistency: string | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

interface MedicationRecord {
  id: string;
  recorder_name: string | null;
  medicine_name: string | null;
  dosage: string | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

interface AwakeRecord {
  id: string;
  recorder_name: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

interface RoomData {
  id: string;
  code: string;
  name: string;
  created_at: string;
  feeds: FeedRecord[];
  poops: PoopRecord[];
  medications: MedicationRecord[];
  awakes: AwakeRecord[];
  solid_foods: SolidFoodRecord[];
  lastFeed: LastFeed | null;
  activeAwake: AwakeRecord | null;
}

// Utility
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function toLocalTimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getElapsedDisplay(dateStr: string): { value: string; unit: string; urgent: boolean } {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours >= 3) return { value: `${diffHours}`, unit: '小时', urgent: true };
  if (diffHours >= 1) return { value: `${diffHours}`, unit: `小时${diffMinutes % 60}分`, urgent: false };
  if (diffMinutes >= 1) return { value: `${diffMinutes}`, unit: '分钟', urgent: false };
  return { value: '0', unit: '分钟', urgent: false };
}

function getElapsedShort(startStr: string, endStr: string): string {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diffMs = end.getTime() - start.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours >= 1) return `${diffHours}h${diffMinutes % 60}m`;
  return `${diffMinutes}m`;
}

// Flat SVG Icons
function BottleIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6v3l1.5 1.5V20a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V6.5L9 5V2z" />
      <line x1="9" y1="2" x2="15" y2="2" />
      <line x1="10" y1="10" x2="14" y2="10" />
    </svg>
  );
}

function ShareIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function LogoutIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// Haptic feedback - compatible with iPhone
function haptic(style: 'light' | 'medium' | 'heavy' = 'medium') {
  if (typeof window === 'undefined' || !navigator) return;
  try {
    if (navigator.vibrate) {
      const ms = style === 'light' ? 5 : style === 'heavy' ? 20 : 10;
      navigator.vibrate(ms);
    }
  } catch {
    // Silently fail on unsupported browsers
  }
}

function CloseIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function BackIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ClockIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function HistoryIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 8 14" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
    </svg>
  );
}

function PoopIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18c0 1.5 1.5 3 6 3s6-1.5 6-3" />
      <path d="M7 14c-1.5 0-2.5 1-2.5 2s1 2 2.5 2h10c1.5 0 2.5-1 2.5-2s-1-2-2.5-2" />
      <path d="M9 10c-2 0-3 1.5-3 3h12c0-1.5-1-3-3-3" />
      <path d="M10 7c-1.5 0-2.5 1-2.5 2.5 0 .5.1.9.3 1.3h8.4c.2-.4.3-.8.3-1.3C16.5 8 15.5 7 14 7" />
      <path d="M12 3c-1 0-2 .8-2 2s1 2 2 2 2-.8 2-2-.8-2-2-2z" />
    </svg>
  );
}

function EyeOpenIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PillIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.5l-7 7" />
      <path d="M4 20l2.5-2.5" />
      <path d="M19.5 4.5A4.95 4.95 0 0 0 14 3L7.5 9.5a4.95 4.95 0 0 0 0 7 4.95 4.95 0 0 0 7 0L21 10a4.95 4.95 0 0 0 0-7 4.95 4.95 0 0 0-1.5 1.5z" />
    </svg>
  );
}

export default function Home() {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [feederName, setFeederName] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [babyName, setBabyName] = useState('');

  const [showFeedConfirm, setShowFeedConfirm] = useState(false);
  const [editTime, setEditTime] = useState('');
  const [editAmount, setEditAmount] = useState(120);
  const [usePrevDay, setUsePrevDay] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [showSolidFoodForm, setShowSolidFoodForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyFeeds, setHistoryFeeds] = useState<FeedRecord[]>([]);
  const [historySolidFoods, setHistorySolidFoods] = useState<SolidFoodRecord[]>([]);
  const [historyPoops, setHistoryPoops] = useState<PoopRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState(7);
  const [feedTrendRefreshNonce, setFeedTrendRefreshNonce] = useState(0);

  // Poop states
  const [showPoopConfirm, setShowPoopConfirm] = useState(false);
  const [poopTime, setPoopTime] = useState('');
  const [poopUsePrevDay, setPoopUsePrevDay] = useState(false);
  const [poopNote, setPoopNote] = useState('');

  // Medication states
  const [showMedConfirm, setShowMedConfirm] = useState(false);
  const [medTime, setMedTime] = useState('');
  const [medUsePrevDay, setMedUsePrevDay] = useState(false);
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');

  const [historyMedications, setHistoryMedications] = useState<MedicationRecord[]>([]);

  // Awake states
  const [confirmAwake, setConfirmAwake] = useState<AwakeRecord | null>(null);
  const [awakeTime, setAwakeTime] = useState('');
  const [awakeUsePrevDay, setAwakeUsePrevDay] = useState(false);
  const [awakeEndTime, setAwakeEndTime] = useState('');
  const [awakeEndUsePrevDay, setAwakeEndUsePrevDay] = useState(false);
  const [awakeNote, setAwakeNote] = useState('');
  const [historyAwakes, setHistoryAwakes] = useState<AwakeRecord[]>([]);
  const [awakeDuration, setAwakeDuration] = useState('');

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [requestState] = useState(() => createRequestState(historyDays));
  const btnScrollRef = useRef<HTMLDivElement>(null);
  const btnLoopJumping = useRef(false);
  const btnScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateBtnScales = useCallback(() => {
    const container = btnScrollRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;
    const items = container.querySelectorAll<HTMLElement>('[data-btn-type]');
    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const itemCenter = rect.left + rect.width / 2;
      const distance = Math.abs(itemCenter - containerCenter);
      const maxDist = containerRect.width * 0.55;
      const minScale = 0.5;
      const maxScale = 2.0;
      const t = Math.min(distance / maxDist, 1);
      const eased = t * t;
      const scale = maxScale - eased * (maxScale - minScale);
      // Directly set button dimensions instead of transform:scale for crisp rendering
      const btn = item.querySelector('button');
      if (btn) {
        const baseSize = 70;
        const size = Math.round(baseSize * scale);
        btn.style.width = `${size}px`;
        btn.style.height = `${size}px`;
        // Update font size proportionally (base 10px)
        const labels = btn.querySelectorAll('span');
        labels.forEach((label) => { label.style.fontSize = `${Math.round(10 * scale)}px`; });
        // Update SVG icon sizes (use stored original or current)
        const svgs = btn.querySelectorAll('svg');
        svgs.forEach((svg) => {
          if (!svg.dataset.baseSize) {
            svg.dataset.baseSize = svg.getAttribute('width') || '16';
          }
          const baseIcon = parseInt(svg.dataset.baseSize, 10);
          const iconSize = Math.round((baseIcon / baseSize) * size);
          svg.setAttribute('width', `${iconSize}`);
          svg.setAttribute('height', `${iconSize}`);
        });
      }
      item.dataset.scale = String(scale);
      item.style.opacity = `${1 - t * 0.4}`;
    });
  }, []);

  const checkBtnLoop = useCallback(() => {
    if (btnLoopJumping.current) return;
    const container = btnScrollRef.current;
    if (!container) return;
    const itemWidth = 140;
    const oneSet = itemWidth * 5;
    const scrollLeft = container.scrollLeft;
    const viewportCenter = scrollLeft + container.clientWidth / 2;
    const currentSet = Math.floor(viewportCenter / oneSet);
    if (currentSet !== 1) {
      btnLoopJumping.current = true;
      const offsetInSet = viewportCenter - currentSet * oneSet;
      const newCenter = oneSet + offsetInSet;
      // Disable snap during jump to prevent stutter
      container.style.scrollSnapType = 'none';
      container.scrollLeft = newCenter - container.clientWidth / 2;
      requestAnimationFrame(() => {
        updateBtnScales();
        requestAnimationFrame(() => {
          container.style.scrollSnapType = '';
          btnLoopJumping.current = false;
        });
      });
    }
  }, [updateBtnScales]);

  const onBtnScroll = useCallback(() => {
    requestAnimationFrame(() => {
      updateBtnScales();
    });
    // Debounce loop check: only jump back after scrolling stops
    if (btnScrollTimer.current) clearTimeout(btnScrollTimer.current);
    btnScrollTimer.current = setTimeout(() => {
      checkBtnLoop();
    }, 150);
  }, [updateBtnScales, checkBtnLoop]);

  const fetchRoom = useCallback(async (roomId: string) => {
    const requestToken = requestState.roomGate.begin(roomId);
    try {
      const res = await fetch(`/api/rooms/${roomId}`);
      const json = await res.json();
      if (!requestState.roomGate.isLatest(requestToken)) return;
      if (json.success) {
        requestState.setActiveRoomId(roomId);
        setRoom(json.data);
      } else {
        requestState.setActiveRoomId(null);
        requestState.setHistoryOpen(false);
        requestState.historyGate.invalidate();
        setHistoryLoading(false);
        setHistoryError(null);
        setShowHistory(false);
        localStorage.removeItem('feedRoomId');
        setShowSetup(true);
        setRoom(null);
      }
    } catch { /* keep existing data */ } finally {
      if (requestState.roomGate.isLatest(requestToken)) setLoading(false);
    }
  }, [requestState]);

  useEffect(() => {
    const savedRoomId = localStorage.getItem('feedRoomId');
    const savedFeederName = localStorage.getItem('feederName');
    if (savedFeederName) setFeederName(savedFeederName);
    if (savedRoomId) {
      fetchRoom(savedRoomId);
    } else {
      setLoading(false);
      setShowSetup(true);
    }
  }, []);

  // Scroll to feed button initially (middle set)
  useEffect(() => {
    const container = btnScrollRef.current;
    if (!container) return;
    const scrollToCenter = () => {
      // Find the feed button in the middle set (set index 1)
      const feedItems = container.querySelectorAll<HTMLElement>('[data-btn-type="feed"]');
      if (feedItems.length >= 2) {
        feedItems[1].scrollIntoView({ inline: 'center', behavior: 'auto' });
      }
      requestAnimationFrame(updateBtnScales);
    };
    const t1 = setTimeout(scrollToCenter, 50);
    const t2 = setTimeout(updateBtnScales, 300);
    const onResize = () => { updateBtnScales(); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', onResize); };
  }, [room?.id, updateBtnScales]);

  // Update active awake duration every second
  useEffect(() => {
    if (!room?.activeAwake) { setAwakeDuration(''); return; }
    const update = () => {
      const start = new Date(room.activeAwake!.started_at).getTime();
      const diff = Date.now() - start;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setAwakeDuration(h > 0 ? `${h}时${m}分` : `${m}分钟`);
    };
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [room?.activeAwake?.id]);

  useEffect(() => {
    if (!room) return;
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => fetchRoom(room.id), 30000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [room?.id]);

  const handleCreateRoom = async () => {
    try {
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: babyName || '宝宝' }) });
      const json = await res.json();
      if (json.success) {
        requestState.roomGate.invalidate();
        requestState.historyGate.invalidate();
        requestState.setActiveRoomId(json.data.id);
        requestState.setHistoryOpen(false);
        setHistoryLoading(false);
        setHistoryError(null);
        setShowHistory(false);
        localStorage.setItem('feedRoomId', json.data.id);
        setRoom({ ...json.data, feeds: [], poops: [], medications: [], awakes: [], solid_foods: [], lastFeed: null, activeAwake: null });
        setShowSetup(false);
      }
    } catch { /* silent */ }
  };

  const handleJoinRoom = async () => {
    if (!joinCode.trim()) return;
    try {
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: joinCode.trim().toUpperCase(), name: babyName || '宝宝' }) });
      const json = await res.json();
      if (json.success) {
        requestState.historyGate.invalidate();
        requestState.setActiveRoomId(json.data.id);
        requestState.setHistoryOpen(false);
        setHistoryLoading(false);
        setHistoryError(null);
        setShowHistory(false);
        localStorage.setItem('feedRoomId', json.data.id);
        fetchRoom(json.data.id);
        setShowSetup(false);
      }
    } catch { /* silent */ }
  };

  const handleQuickAdd = () => {
    if (!room || submitting) return;
    if (feederName) localStorage.setItem('feederName', feederName);
    const defaultAmount = room.lastFeed?.amount_ml || 120;
    setEditTime(toLocalTimeString(new Date()));
    setEditAmount(defaultAmount);
    setUsePrevDay(false);
    setShowFeedConfirm(true);
  };

  const handleConfirm = async () => {
    if (!room) return;
    setSubmitting(true);
    if (feederName) localStorage.setItem('feederName', feederName);
    try {
      const today = new Date();
      const [h, m] = editTime.split(':').map(Number);
      const dayOffset = usePrevDay ? -1 : 0;
      const startedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m);
      const res = await fetch(`/api/rooms/${room.id}/feeds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feed_type: 'formula', feeder_name: feederName || null, amount_ml: editAmount, started_at: startedAt.toISOString() }) });
      const json = await res.json();
      if (json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ } finally { setShowFeedConfirm(false); setSubmitting(false); }
  };

  const handleSkipConfirm = () => setShowFeedConfirm(false);

  const handleDeleteFeed = async (feedId: string) => {
    if (!room) return;
    try {
      const res = await fetch(`/api/feeds/${feedId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ }
  };

  const handleQuickAddSolidFood = () => {
    if (!room || submitting) return;
    if (feederName) localStorage.setItem('feederName', feederName);
    setShowSolidFoodForm(true);
  };

  const handleSubmitSolidFood = async (input: NormalizedSolidFoodInput) => {
    if (!room) return { success: false, error: '房间不存在' };
    setSubmitting(true);
    try {
      const res = await fetch(`/api/rooms/${room.id}/solid-foods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json.error || '保存失败，请重试' };
      }
      setFeedTrendRefreshNonce((value) => value + 1);
      await fetchRoom(room.id);
      return { success: true };
    } catch {
      return { success: false, error: '网络异常，请重试' };
    } finally {
      setSubmitting(false);
    }
  };

  const loadHistorySnapshot = useCallback(async (roomId: string, days: number) => {
    if (!requestState.matchesHistory(roomId, days)) return;
    const requestToken = requestState.historyGate.begin(`${roomId}:${days}`);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const snapshot = await fetchHistorySnapshot<
        FeedRecord,
        PoopRecord,
        MedicationRecord,
        AwakeRecord,
        SolidFoodRecord
      >(roomId, days);
      if (
        !requestState.historyGate.isLatest(requestToken)
        || !requestState.matchesHistory(roomId, days)
      ) return;
      setHistoryFeeds(snapshot.feeds);
      setHistoryPoops(snapshot.poops);
      setHistoryMedications(snapshot.medications);
      setHistoryAwakes(snapshot.awakes);
      setHistorySolidFoods(snapshot.solidFoods);
    } catch {
      if (
        requestState.historyGate.isLatest(requestToken)
        && requestState.matchesHistory(roomId, days)
      ) setHistoryError('加载失败，请重试');
    } finally {
      if (
        requestState.historyGate.isLatest(requestToken)
        && requestState.matchesHistory(roomId, days)
      ) setHistoryLoading(false);
    }
  }, [requestState]);

  const handleDeleteSolidFood = async (solidFoodId: string) => {
    if (!room) return;
    const deleteRoomId = room.id;
    const refreshServerState = () => {
      const context = requestState.getRefreshContext();
      if (context.roomId !== deleteRoomId) return [];
      return [
        fetchRoom(context.roomId),
        ...(context.showHistory ? [loadHistorySnapshot(context.roomId, context.days)] : []),
      ];
    };

    try {
      const res = await fetch(`/api/solid-foods/${solidFoodId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        await Promise.allSettled(refreshServerState());
        return;
      }
      setFeedTrendRefreshNonce((value) => value + 1);
      await Promise.all(refreshServerState());
    } catch {
      await Promise.allSettled(refreshServerState());
    }
  };

  const handleQuickAddPoop = () => {
    if (!room || submitting) return;
    if (feederName) localStorage.setItem('feederName', feederName);
    setPoopTime(toLocalTimeString(new Date()));
    setPoopUsePrevDay(false);
    setPoopNote('');
    setShowPoopConfirm(true);
  };

  const handleConfirmPoop = async () => {
    if (!room) return;
    setSubmitting(true);
    try {
      const today = new Date();
      const [h, m] = poopTime.split(':').map(Number);
      const dayOffset = poopUsePrevDay ? -1 : 0;
      const startedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m);
      const body: Record<string, unknown> = { recorder_name: feederName || null, started_at: startedAt.toISOString() };
      if (poopNote.trim()) body.note = poopNote.trim();
      const res = await fetch(`/api/rooms/${room.id}/poops`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (res.ok && json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ } finally { setShowPoopConfirm(false); setSubmitting(false); }
  };

  const handleDeletePoop = async (poopId: string) => {
    if (!room) return;
    try {
      const res = await fetch(`/api/poops/${poopId}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ }
  };

  // Medication handlers
  const handleQuickAddMed = () => {
    if (!room || submitting) return;
    if (feederName) localStorage.setItem('feederName', feederName);
    setMedTime(toLocalTimeString(new Date()));
    setMedUsePrevDay(false);
    setMedName('');
    setMedDosage('');
    setShowMedConfirm(true);
  };

  const handleConfirmMed = async () => {
    if (!room) return;
    setSubmitting(true);
    try {
      const today = new Date();
      const [h, m] = medTime.split(':').map(Number);
      const dayOffset = medUsePrevDay ? -1 : 0;
      const startedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m);
      const res = await fetch(`/api/rooms/${room.id}/medications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recorder_name: feederName || null, medicine_name: medName || null, dosage: medDosage || null, started_at: startedAt.toISOString() }),
      });
      const json = await res.json();
      setShowMedConfirm(false);
      if (res.ok && json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ } finally { setSubmitting(false); }
  };

  const handleDeleteMed = async (medId: string) => {
    if (!room) return;
    try {
      const res = await fetch(`/api/medications/${medId}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ }
  };

  // Awake handlers
  const handleQuickAddAwake = async () => {
    if (!room || submitting) return;
    setSubmitting(true);
    haptic('heavy');
    try {
      const now = new Date();
      const res = await fetch(`/api/rooms/${room.id}/awakes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recorder_name: feederName, started_at: now.toISOString() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ } finally { setSubmitting(false); }
  };

  const handleEndAwake = () => {
    if (!room?.activeAwake) return;
    haptic('medium');
    const awake = room.activeAwake;
    setConfirmAwake(awake);
    const st = new Date(awake.started_at);
    setAwakeTime(`${String(st.getHours()).padStart(2,'0')}:${String(st.getMinutes()).padStart(2,'0')}`);
    const now = new Date();
    setAwakeEndTime(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`);
    setAwakeUsePrevDay(false);
    setAwakeEndUsePrevDay(false);
  };

  const handleConfirmAwake = async () => {
    if (!confirmAwake || !room) return;
    setSubmitting(true);
    try {
      const now = new Date();
      // Parse start time
      const [sh, sm] = awakeTime.split(':').map(Number);
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (awakeUsePrevDay ? -1 : 0), sh, sm);
      // Parse end time
      const [eh, em] = awakeEndTime.split(':').map(Number);
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (awakeEndUsePrevDay ? -1 : 0), eh, em);
      const res = await fetch(`/api/awakes/${confirmAwake.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ started_at: startDate.toISOString(), ended_at: endDate.toISOString(), note: awakeNote || null }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setConfirmAwake(null);
        setAwakeNote('');
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ } finally { setSubmitting(false); }
  };

  const handleDeleteAwake = async (awakeId: string) => {
    if (!room) return;
    try {
      const res = await fetch(`/api/awakes/${awakeId}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok && json.success) {
        setFeedTrendRefreshNonce((value) => value + 1);
        await fetchRoom(room.id);
      }
    } catch { /* silent */ }
  };

  const handleLeaveRoom = () => {
    requestState.roomGate.invalidate();
    requestState.historyGate.invalidate();
    requestState.setActiveRoomId(null);
    requestState.setHistoryOpen(false);
    setHistoryLoading(false);
    setHistoryError(null);
    setShowHistory(false);
    localStorage.removeItem('feedRoomId');
    setRoom(null);
    setShowSetup(true);
  };

  const handleOpenHistory = async () => {
    if (!room) return;
    requestState.setHistoryDays(historyDays);
    requestState.setHistoryOpen(true);
    setShowHistory(true);
    await loadHistorySnapshot(room.id, historyDays);
  };

  const handleCloseHistory = () => {
    requestState.setHistoryOpen(false);
    setShowHistory(false);
  };

  const handleHistoryDaysChange = async (days: number) => {
    if (!room) return;
    requestState.setHistoryDays(days);
    setHistoryDays(days);
    await loadHistorySnapshot(room.id, days);
  };

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FFF9F2' }}>
        <div className="flex flex-col items-center gap-3">
          <BottleIcon size={32} color="#D4A76A" />
          <p className="text-sm" style={{ color: '#A89888' }}>加载中</p>
        </div>
      </div>
    );
  }

  // Setup
  if (showSetup || !room) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#FFF9F2' }}>
        <div className="w-full max-w-xs">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ backgroundColor: '#FFF3E6' }}>
              <BottleIcon size={28} color="#D4A76A" />
            </div>
            <h1 className="text-xl font-semibold" style={{ color: '#3D3229' }}>喂奶记录</h1>
            <p className="mt-1 text-sm" style={{ color: '#A89888' }}>家人一起记录，不再遗忘</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8B7E74' }}>你的称呼</label>
              <input
                type="text"
                value={feederName}
                onChange={(e) => setFeederName(e.target.value)}
                placeholder="妈妈、爸爸、奶奶"
                className="w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none transition-colors"
                style={{ borderColor: '#EDE5DC', color: '#3D3229', backgroundColor: '#FFFCF8' }}
                onFocus={(e) => e.target.style.borderColor = '#D4A76A'}
                onBlur={(e) => e.target.style.borderColor = '#EDE5DC'}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8B7E74' }}>宝宝昵称</label>
              <input
                type="text"
                value={babyName}
                onChange={(e) => setBabyName(e.target.value)}
                placeholder="小豆子"
                className="w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none transition-colors"
                style={{ borderColor: '#EDE5DC', color: '#3D3229', backgroundColor: '#FFFCF8' }}
                onFocus={(e) => e.target.style.borderColor = '#D4A76A'}
                onBlur={(e) => e.target.style.borderColor = '#EDE5DC'}
              />
            </div>

            <button
              onClick={() => { haptic('medium'); handleCreateRoom(); }}
              className="w-full py-3 rounded-xl text-white text-sm font-medium transition-transform active:scale-[0.98]"
              style={{ backgroundColor: '#D4A76A' }}
            >
              创建房间
            </button>
          </div>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ backgroundColor: '#EDE5DC' }} />
            <span className="text-xs" style={{ color: '#BFB3A8' }}>或加入房间</span>
            <div className="flex-1 h-px" style={{ backgroundColor: '#EDE5DC' }} />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="房间码"
              maxLength={6}
              className="flex-1 px-3.5 py-2.5 rounded-xl border text-sm text-center tracking-[0.3em] outline-none transition-colors"
              style={{ borderColor: '#EDE5DC', color: '#3D3229', backgroundColor: '#FFFCF8' }}
              onFocus={(e) => e.target.style.borderColor = '#D4A76A'}
              onBlur={(e) => e.target.style.borderColor = '#EDE5DC'}
            />
            <button
              onClick={() => { haptic('medium'); handleJoinRoom(); }}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-transform active:scale-[0.98]"
              style={{ backgroundColor: '#F0E6DA', color: '#8B7E74' }}
            >
              加入
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main
  const lastFeedElapsed = room.lastFeed ? getElapsedDisplay(room.lastFeed.started_at) : null;
  const todayTotalMl = room.feeds.reduce((sum, f) => sum + (f.amount_ml || 0), 0);
  const todayCount = room.feeds.length;
  const todaySolidFoodCount = room.solid_foods?.length || 0;
  const feedTrendRefreshKey = `${feedTrendRefreshNonce}:${room.feeds
    .map((feed) => `${feed.id}:${feed.amount_ml ?? ''}:${feed.started_at}`)
    .join('|')}`;

  return (
    <div className="min-h-screen pb-6" style={{ backgroundColor: '#FFF9F2', overscrollBehavior: 'none' }}>
      {/* Header - minimal */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: '#3D3229' }}>{room.name}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              haptic('light');
              if (navigator.share) {
                navigator.share({ title: '喂奶记录', text: `加入喂奶记录房间，房间码：${room.code}` });
              } else {
                navigator.clipboard.writeText(room.code);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#FFF3E6', color: '#C49556' }}
          >
            <ShareIcon size={14} color="#C49556" />
            {room.code}
          </button>
          <button onClick={() => { haptic('light'); handleLeaveRoom(); }} className="p-2 rounded-lg" style={{ color: '#C4B8AE' }}>
            <LogoutIcon size={18} />
          </button>
        </div>
      </div>

      {/* Elapsed Time - hero */}
      <div className="px-5 pt-10 pb-6 text-center">
        {room.lastFeed && lastFeedElapsed ? (
          <div>
            <p className="text-sm tracking-wide mb-4" style={{ color: '#A89888' }}>距上次喂奶</p>
            <div className="flex items-baseline justify-center gap-2">
              <span
                className="text-8xl font-light tabular-nums tracking-tight"
                style={{ color: lastFeedElapsed.urgent ? '#E8836B' : '#3D3229' }}
              >
                {lastFeedElapsed.value}
              </span>
              <span className="text-lg" style={{ color: lastFeedElapsed.urgent ? '#E8836B' : '#A89888' }}>
                {lastFeedElapsed.unit}
              </span>
            </div>
            {lastFeedElapsed.urgent && (
              <p className="text-base mt-4 font-medium" style={{ color: '#E8836B' }}>该喂奶啦</p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm tracking-wide mb-4" style={{ color: '#A89888' }}>还没有记录</p>
            <p className="text-3xl font-light" style={{ color: '#3D3229' }}>点击下方开始</p>
          </div>
        )}
      </div>

      {/* Today Stats - thin bar */}
      {(todayCount > 0 || todaySolidFoodCount > 0 || (room.poops && room.poops.length > 0) || (room.medications && room.medications.length > 0) || (room.awakes && room.awakes.length > 0)) && (
        <div className="mx-5 mb-6 py-3 rounded-xl" style={{ backgroundColor: '#FFFCF8' }}>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-semibold tabular-nums" style={{ color: '#3D3229' }}>{todayCount}</span>
              <span className="text-sm" style={{ color: '#A89888' }}>次</span>
            </div>
            <div className="flex shrink-0 items-center gap-6">
              <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#EDE5DC' }} />
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-semibold tabular-nums" style={{ color: '#D4A76A' }}>{todayTotalMl}</span>
                <span className="text-sm" style={{ color: '#A89888' }}>ml</span>
              </div>
            </div>
            {todaySolidFoodCount > 0 ? (
              <div className="flex shrink-0 items-center gap-6">
                <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#EDE5DC' }} />
                <div className="flex items-baseline gap-1">
                  <span className="text-sm" style={{ color: '#6F9B78' }}>辅食</span>
                  <span className="text-xl font-semibold tabular-nums" style={{ color: '#6F9B78' }}>{todaySolidFoodCount}</span>
                  <span className="text-sm" style={{ color: '#6F9B78' }}>次</span>
                </div>
              </div>
            ) : null}
            {room.poops && room.poops.length > 0 && (
              <div className="flex shrink-0 items-center gap-6">
                <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#EDE5DC' }} />
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-semibold tabular-nums" style={{ color: '#B8A08A' }}>{room.poops.length}</span>
                  <span className="text-sm" style={{ color: '#A89888' }}>便</span>
                </div>
              </div>
            )}
            {room.medications && room.medications.length > 0 && (
              <div className="flex shrink-0 items-center gap-6">
                <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#EDE5DC' }} />
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-semibold tabular-nums" style={{ color: '#8B9EAF' }}>{room.medications.length}</span>
                  <span className="text-sm" style={{ color: '#A89888' }}>药</span>
                </div>
              </div>
            )}
          </div>
          {room.awakes && room.awakes.length > 0 && (
            <div className="flex items-center justify-center gap-1 mt-1.5">
              <span className="text-sm" style={{ color: '#A89888' }}>清醒</span>
              <span className="text-base font-semibold tabular-nums" style={{ color: '#7BA68A' }}>
                {(() => {
                  const totalMin = room.awakes.reduce((acc: number, a: AwakeRecord) => {
                    if (!a.ended_at) return acc;
                    const diff = (new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 60000;
                    return acc + diff;
                  }, 0);
                  const h = Math.floor(totalMin / 60);
                  const m = Math.round(totalMin % 60);
                  return h > 0 ? `${h}h${m}m` : `${m}m`;
                })()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Feeder Name - inline */}
      <div className="px-5 mb-5 flex items-center gap-2.5">
        <span className="text-sm" style={{ color: '#A89888' }}>记录人</span>
        <input
          type="text"
          value={feederName}
          onChange={(e) => { setFeederName(e.target.value); if (e.target.value) localStorage.setItem('feederName', e.target.value); }}
          placeholder="谁在喂"
          className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
          style={{ borderColor: '#EDE5DC', color: '#3D3229', backgroundColor: 'transparent' }}
          onFocus={(e) => e.target.style.borderColor = '#D4A76A'}
          onBlur={(e) => e.target.style.borderColor = '#EDE5DC'}
        />
      </div>

      {/* Action Buttons - infinite ring scroll with center enlargement */}
      <div
        ref={btnScrollRef}
        onScroll={onBtnScroll}
        onTouchStart={(e: React.TouchEvent<HTMLDivElement>) => {
          const t = e.touches[0];
          const el = e.currentTarget as HTMLDivElement & { _touchStartY: number; _touchStartX: number };
          el._touchStartY = t.clientY;
          el._touchStartX = t.clientX;
        }}
        onTouchMove={(e: React.TouchEvent<HTMLDivElement>) => {
          const el = e.currentTarget as HTMLDivElement & { _touchStartY?: number; _touchStartX?: number };
          if (el._touchStartY != null && el._touchStartX != null) {
            const t = e.touches[0];
            const dy = Math.abs(t.clientY - el._touchStartY);
            const dx = Math.abs(t.clientX - el._touchStartX);
            if (dy > dx && dy > 5) {
              e.preventDefault();
            }
          }
        }}
        className="mb-4 overflow-x-auto overflow-y-hidden snap-x snap-mandatory hide-scrollbar"
        style={{
          height: 160,
          touchAction: 'pan-x',
          overscrollBehavior: 'none contain',
          WebkitOverflowScrolling: 'auto',
          position: 'relative',
        }}
      >
        <div
          className="flex items-center"
          style={{ paddingLeft: 'calc(50% - 70px)', paddingRight: 'calc(50% - 70px)', height: 160 }}
        >
          {[0, 1, 2].map((setIdx) => (
            <Fragment key={setIdx}>
              {/* Poop */}
              <div data-btn-type="poop" aria-hidden={setIdx !== 1 || undefined} className="snap-center flex-shrink-0 flex items-center justify-center" style={{ width: 140, height: 140 }}>
                <button
                  onClick={() => { haptic('medium'); handleQuickAddPoop(); }}
                  disabled={submitting}
                  tabIndex={setIdx === 1 ? 0 : -1}
                  className="rounded-full flex flex-col items-center justify-center text-white gap-1 disabled:opacity-50"
                  style={{ backgroundColor: '#C4A882', width: 70, height: 70 }}
                >
                  <PoopIcon size={16} color="white" />
                  <span className="text-[10px]">便便</span>
                </button>
              </div>

              {/* Awake */}
              <div data-btn-type="awake" aria-hidden={setIdx !== 1 || undefined} className="snap-center flex-shrink-0 flex items-center justify-center" style={{ width: 140, height: 140 }}>
                <button
                  onClick={() => { haptic('medium'); room.activeAwake ? handleEndAwake() : handleQuickAddAwake(); }}
                  disabled={submitting}
                  tabIndex={setIdx === 1 ? 0 : -1}
                  className="rounded-full flex flex-col items-center justify-center text-white gap-1 disabled:opacity-50"
                  style={{ backgroundColor: room.activeAwake ? '#6B9F7E' : '#7BAF8E', width: 70, height: 70 }}
                >
                  {room.activeAwake ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                      </svg>
                      <span className="text-[10px]">睡了</span>
                    </>
                  ) : (
                    <>
                      <EyeOpenIcon size={16} color="white" />
                      <span className="text-[10px]">清醒</span>
                    </>
                  )}
                </button>
              </div>

              {/* Feed */}
              <div data-btn-type="feed" aria-hidden={setIdx !== 1 || undefined} className="snap-center flex-shrink-0 flex items-center justify-center" style={{ width: 140, height: 140 }}>
                <button
                  onClick={() => { haptic('heavy'); handleQuickAdd(); }}
                  disabled={submitting}
                  tabIndex={setIdx === 1 ? 0 : -1}
                  className="rounded-full text-white font-medium flex flex-col items-center justify-center gap-1 disabled:opacity-50"
                  style={{ backgroundColor: '#D4A76A', width: 70, height: 70 }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2h8l1 7a5 5 0 0 1-10 0l1-7z"/>
                    <path d="M7 9c-1.5 1.5-2 4-2 6a5 5 0 0 0 5 5h4a5 5 0 0 0 5-5c0-2-.5-4.5-2-6"/>
                    <path d="M12 14v4"/>
                    <path d="M10 16h4"/>
                  </svg>
                  <span className="text-[10px]">{submitting ? '记录中' : '喂奶了'}</span>
                </button>
              </div>

              {/* Solid food */}
              <div data-btn-type="solid-food" aria-hidden={setIdx !== 1 || undefined} className="snap-center flex-shrink-0 flex items-center justify-center" style={{ width: 140, height: 140 }}>
                <button
                  onClick={() => { haptic('medium'); handleQuickAddSolidFood(); }}
                  disabled={submitting}
                  tabIndex={setIdx === 1 ? 0 : -1}
                  className="rounded-full flex flex-col items-center justify-center text-white gap-1 disabled:opacity-50"
                  style={{ backgroundColor: '#6F9B78', width: 70, height: 70 }}
                >
                  <Utensils size={16} />
                  <span className="text-[10px]">辅食</span>
                </button>
              </div>

              {/* Medication */}
              <div data-btn-type="med" aria-hidden={setIdx !== 1 || undefined} className="snap-center flex-shrink-0 flex items-center justify-center" style={{ width: 140, height: 140 }}>
                <button
                  onClick={() => { haptic('medium'); handleQuickAddMed(); }}
                  disabled={submitting}
                  tabIndex={setIdx === 1 ? 0 : -1}
                  className="rounded-full flex flex-col items-center justify-center text-white gap-1 disabled:opacity-50"
                  style={{ backgroundColor: '#9AADB8', width: 70, height: 70 }}
                >
                  <PillIcon size={16} color="white" />
                  <span className="text-[10px]">吃药</span>
                </button>
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {showSolidFoodForm ? (
        <SolidFoodForm
          recorderName={feederName}
          submitting={submitting}
          onClose={() => setShowSolidFoodForm(false)}
          onSubmit={handleSubmitSolidFood}
        />
      ) : null}

      {/* Active awake duration */}
      {room.activeAwake && (
        <div className="text-center mt-1">
          <span className="text-xs" style={{ color: '#7BAF8E' }}>
            已清醒 {awakeDuration}
          </span>
        </div>
      )}

      {/* Confirm Dialog */}
      {showFeedConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center px-4"
          style={{ backgroundColor: 'rgba(61,50,41,0.25)' }}
          onClick={() => { haptic('light'); handleSkipConfirm(); }}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-6"
            style={{ backgroundColor: '#FFFFFF' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {/* Time */}
            <div className="mb-4">
              <label className="flex items-center gap-1.5 text-sm mb-2" style={{ color: '#A89888' }}>
                <ClockIcon size={14} /> 时间
              </label>
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border text-base outline-none"
                style={{ borderColor: '#EDE5DC', color: '#3D3229', WebkitAppearance: 'none' }}
              />
              {(() => {
                const [eh, em] = editTime.split(':').map(Number);
                const now = new Date();
                return (eh * 60 + em) > (now.getHours() * 60 + now.getMinutes());
              })() && (
                <button
                  onClick={() => { haptic('light'); setUsePrevDay(!usePrevDay); }}
                  className="mt-2 text-sm px-3 py-1.5 rounded"
                  style={{
                    color: usePrevDay ? '#C49556' : '#A89888',
                    background: usePrevDay ? '#FFF3E6' : 'transparent',
                    border: usePrevDay ? '1px solid #EDE5DC' : '1px solid transparent',
                  }}
                >
                  {usePrevDay ? '✓ 记为昨天' : '记为昨天'}
                </button>
              )}
            </div>

            {/* Amount */}
            <div className="mb-5">
              <label className="flex items-center gap-1.5 text-sm mb-2" style={{ color: '#A89888' }}>
                <BottleIcon size={14} /> 奶量
              </label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { haptic('light'); setEditAmount(Math.max(10, editAmount - 10)); }}
                  className="w-11 h-11 rounded-lg text-base font-medium flex items-center justify-center transition-transform active:scale-90"
                  style={{ backgroundColor: '#FFF3E6', color: '#D4A76A' }}
                >
                  -
                </button>
                <div className="flex-1 text-center">
                  <span className="text-3xl font-semibold tabular-nums" style={{ color: '#3D3229' }}>{editAmount}</span>
                  <span className="text-sm ml-0.5" style={{ color: '#A89888' }}>ml</span>
                </div>
                <button
                  onClick={() => { haptic('light'); setEditAmount(Math.min(300, editAmount + 10)); }}
                  className="w-11 h-11 rounded-lg text-base font-medium flex items-center justify-center transition-transform active:scale-90"
                  style={{ backgroundColor: '#FFF3E6', color: '#D4A76A' }}
                >
                  +
                </button>
              </div>
              <div className="flex gap-2 mt-3 justify-center">
                {[60, 90, 120, 150, 180].map((v) => (
                  <button
                    key={v}
                    onClick={() => { haptic('light'); setEditAmount(v); }}
                    className="px-3 py-1.5 rounded-md text-sm transition-transform active:scale-95"
                    style={{
                      backgroundColor: editAmount === v ? '#D4A76A' : '#FFF3E6',
                      color: editAmount === v ? '#FFFFFF' : '#C49556',
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm */}
            <button
              onClick={() => { haptic('medium'); handleConfirm(); }}
              disabled={submitting}
              className="w-full py-4 rounded-xl text-white font-medium text-lg transition-transform active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: '#D4A76A' }}
            >
              {submitting ? '保存中' : '确认'}
            </button>
          </div>
        </div>
      )}

      {/* Poop Confirm Modal */}
      {showPoopConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }} onClick={() => setShowPoopConfirm(false)}>
          <div
            className="w-full max-w-sm rounded-t-2xl p-6 pb-8"
            style={{ backgroundColor: '#FFF9F2' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <PoopIcon size={18} color="#B8A08A" />
                <span className="text-base font-medium" style={{ color: '#3D3229' }}>便便记录</span>
              </div>
              <button onClick={() => setShowPoopConfirm(false)} className="p-1" style={{ color: '#BFB3A8' }}>
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Time */}
            <div className="mb-4">
              <label className="flex items-center gap-1.5 text-sm mb-2" style={{ color: '#A89888' }}>
                <ClockIcon size={14} /> 时间
              </label>
              <input
                type="time"
                value={poopTime}
                onChange={(e) => setPoopTime(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-base tabular-nums outline-none"
                style={{ backgroundColor: '#FFFCF8', color: '#3D3229', border: '1px solid #EDE5DC', WebkitAppearance: 'none' } as React.CSSProperties}
              />
              {(() => {
                const [eh, em] = poopTime.split(':').map(Number);
                const now = new Date();
                return (eh * 60 + em) > (now.getHours() * 60 + now.getMinutes());
              })() && (
                <button
                  onClick={() => { haptic('light'); setPoopUsePrevDay(!poopUsePrevDay); }}
                  className="mt-2 text-sm px-3 py-1.5 rounded"
                  style={{
                    color: poopUsePrevDay ? '#B8A08A' : '#A89888',
                    background: poopUsePrevDay ? '#F5EDE6' : 'transparent',
                    border: poopUsePrevDay ? '1px solid #EDE5DC' : '1px solid transparent',
                  }}
                >
                  {poopUsePrevDay ? '✓ 记为昨天' : '记为昨天'}
                </button>
              )}
            </div>

            {/* Note */}
            <div className="mb-5">
              <label className="text-sm mb-2 block" style={{ color: '#A89888' }}>备注（选填）</label>
              <input
                type="text"
                value={poopNote}
                onChange={(e) => setPoopNote(e.target.value)}
                placeholder="如：稀便、干便、正常…"
                className="w-full px-4 py-3 rounded-xl text-base outline-none"
                style={{ backgroundColor: '#FFFCF8', color: '#3D3229', border: '1px solid #EDE5DC' }}
              />
            </div>

            {/* Confirm */}
            <button
              onClick={() => { haptic('medium'); handleConfirmPoop(); }}
              disabled={submitting}
              className="w-full py-4 rounded-xl text-white font-medium text-lg transition-transform active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: '#B8A08A' }}
            >
              {submitting ? '保存中' : '确认'}
            </button>
          </div>
        </div>
      )}

      {/* Medication Confirm Modal */}
      {showMedConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }} onClick={() => setShowMedConfirm(false)}>
          <div
            className="w-full max-w-sm rounded-t-2xl p-6 pb-8"
            style={{ backgroundColor: '#FFF9F2' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <PillIcon size={18} color="#8B9EAF" />
                <span className="text-base font-medium" style={{ color: '#3D3229' }}>吃药记录</span>
              </div>
              <button onClick={() => setShowMedConfirm(false)} className="p-1" style={{ color: '#BFB3A8' }}>
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Time */}
            <div className="mb-4">
              <label className="flex items-center gap-1.5 text-sm mb-2" style={{ color: '#A89888' }}>
                <ClockIcon size={14} /> 时间
              </label>
              <input
                type="time"
                value={medTime}
                onChange={(e) => setMedTime(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-base tabular-nums outline-none"
                style={{ backgroundColor: '#FFFCF8', color: '#3D3229', border: '1px solid #EDE5DC', WebkitAppearance: 'none' } as React.CSSProperties}
              />
              {(() => {
                const [eh, em] = medTime.split(':').map(Number);
                const now = new Date();
                return (eh * 60 + em) > (now.getHours() * 60 + now.getMinutes());
              })() && (
                <button
                  onClick={() => { haptic('light'); setMedUsePrevDay(!medUsePrevDay); }}
                  className="mt-2 text-sm px-3 py-1.5 rounded"
                  style={{
                    color: medUsePrevDay ? '#8B9EAF' : '#A89888',
                    background: medUsePrevDay ? '#EEF2F6' : 'transparent',
                    border: medUsePrevDay ? '1px solid #EDE5DC' : '1px solid transparent',
                  }}
                >
                  {medUsePrevDay ? '✓ 记为昨天' : '记为昨天'}
                </button>
              )}
            </div>

            {/* Medicine name */}
            <div className="mb-3">
              <label className="text-sm mb-2 block" style={{ color: '#A89888' }}>药名（选填）</label>
              <input
                type="text"
                value={medName}
                onChange={(e) => setMedName(e.target.value)}
                placeholder="如：维生素D、益生菌…"
                className="w-full px-4 py-3 rounded-xl text-base outline-none"
                style={{ backgroundColor: '#FFFCF8', color: '#3D3229', border: '1px solid #EDE5DC' }}
              />
            </div>

            {/* Dosage */}
            <div className="mb-5">
              <label className="text-sm mb-2 block" style={{ color: '#A89888' }}>剂量（选填）</label>
              <input
                type="text"
                value={medDosage}
                onChange={(e) => setMedDosage(e.target.value)}
                placeholder="如：1滴、半包…"
                className="w-full px-4 py-3 rounded-xl text-base outline-none"
                style={{ backgroundColor: '#FFFCF8', color: '#3D3229', border: '1px solid #EDE5DC' }}
              />
            </div>

            {/* Confirm */}
            <button
              onClick={() => { haptic('medium'); handleConfirmMed(); }}
              disabled={submitting}
              className="w-full py-4 rounded-xl text-white font-medium text-lg transition-transform active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: '#8B9EAF' }}
            >
              {submitting ? '保存中' : '确认'}
            </button>
          </div>
        </div>
      )}

      {/* Awake Confirm Modal */}
      {confirmAwake && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center px-4"
          style={{ backgroundColor: 'rgba(61, 50, 41, 0.3)' }}
          onClick={() => setConfirmAwake(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl p-6 mb-0"
            style={{ backgroundColor: '#FFFCF8' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <EyeOpenIcon size={20} color="#7BA68C" />
                <span className="text-base font-medium" style={{ color: '#3D3229' }}>清醒记录</span>
              </div>
              <button onClick={() => setConfirmAwake(null)} className="p-1">
                <CloseIcon size={20} color="#A89888" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: '#A89888' }}>醒来的时间</label>
                <input
                  type="time"
                  value={awakeTime}
                  onChange={(e) => { setAwakeTime(e.target.value); haptic('light'); }}
                  className="w-full rounded-lg px-3 py-3 text-base outline-none"
                  style={{ backgroundColor: '#FFF3E6', color: '#3D3229', WebkitAppearance: 'none' } as React.CSSProperties}
                />
                {(() => {
                  const [sh, sm] = awakeTime.split(':').map(Number);
                  const now = new Date();
                  return (sh * 60 + sm) > (now.getHours() * 60 + now.getMinutes());
                })() && (
                  <button
                    onClick={() => { haptic('light'); setAwakeUsePrevDay(!awakeUsePrevDay); }}
                    className="mt-2 text-sm px-3 py-1.5 rounded"
                    style={{
                      color: awakeUsePrevDay ? '#7BA68C' : '#A89888',
                      background: awakeUsePrevDay ? '#F0F7F2' : 'transparent',
                      border: awakeUsePrevDay ? '1px solid #D4E2D9' : '1px solid transparent',
                    }}
                  >
                    {awakeUsePrevDay ? '✓ 记为昨天' : '记为昨天'}
                  </button>
                )}
              </div>
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: '#A89888' }}>入睡的时间</label>
                <input
                  type="time"
                  value={awakeEndTime}
                  onChange={(e) => { setAwakeEndTime(e.target.value); haptic('light'); }}
                  className="w-full rounded-lg px-3 py-3 text-base outline-none"
                  style={{ backgroundColor: '#FFF3E6', color: '#3D3229', WebkitAppearance: 'none' } as React.CSSProperties}
                />
                {(() => {
                  const [eh, em] = awakeEndTime.split(':').map(Number);
                  const now = new Date();
                  return (eh * 60 + em) > (now.getHours() * 60 + now.getMinutes());
                })() && (
                  <button
                    onClick={() => { haptic('light'); setAwakeEndUsePrevDay(!awakeEndUsePrevDay); }}
                    className="mt-2 text-sm px-3 py-1.5 rounded"
                    style={{
                      color: awakeEndUsePrevDay ? '#7BA68C' : '#A89888',
                      background: awakeEndUsePrevDay ? '#F0F7F2' : 'transparent',
                      border: awakeEndUsePrevDay ? '1px solid #D4E2D9' : '1px solid transparent',
                    }}
                  >
                    {awakeEndUsePrevDay ? '✓ 记为昨天' : '记为昨天'}
                  </button>
                )}
              </div>
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: '#A89888' }}>备注</label>
                <input
                  type="text"
                  value={awakeNote}
                  onChange={(e) => setAwakeNote(e.target.value)}
                  placeholder="如：精神好/哭闹"
                  className="w-full rounded-lg px-3 py-3 text-base outline-none"
                  style={{ backgroundColor: '#FFF3E6', color: '#3D3229' }}
                />
              </div>
            </div>

            <button
              onClick={() => { haptic('medium'); handleConfirmAwake(); }}
              disabled={submitting}
              className="w-full py-4 rounded-xl text-white font-medium text-lg transition-transform active:scale-[0.98] disabled:opacity-50 mt-5"
              style={{ backgroundColor: '#7BA68C' }}
            >
              {submitting ? '保存中' : '确认'}
            </button>
          </div>
        </div>
      )}

      {/* Today Records */}
      <div className="px-5">
        {(() => {
          const feedItems = room.feeds.map(f => ({ ...f, _type: 'feed' as const }));
          const poopItems = (room.poops || []).map(p => ({ ...p, _type: 'poop' as const }));
          const medItems = (room.medications || []).map(m => ({ ...m, _type: 'med' as const }));
          const solidFoodItems = (room.solid_foods || []).map(s => ({ ...s, _type: 'solid-food' as const }));
          const awakeItems = (room.awakes || []).map(a => ({ ...a, _type: 'awake' as const }));
          const allItems = [...feedItems, ...poopItems, ...medItems, ...solidFoodItems, ...awakeItems].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
          // Calculate feed intervals: map feed id -> interval string from previous feed
          const feedIntervalMap = new Map<string, string>();
          const allSortedFeeds = [...historyFeeds, ...room.feeds].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
          allSortedFeeds.forEach((f, i) => {
            if (i > 0) {
              const diffMs = new Date(f.started_at).getTime() - new Date(allSortedFeeds[i - 1].started_at).getTime();
              const diffMin = Math.round(diffMs / 60000);
              if (diffMin > 0) {
                if (diffMin >= 60) {
                  feedIntervalMap.set(f.id, `${Math.floor(diffMin / 60)}h${diffMin % 60}m`);
                } else {
                  feedIntervalMap.set(f.id, `${diffMin}m`);
                }
              }
            }
          });
          const hasRecords = allItems.length > 0;
          return (
            <>
              {hasRecords && (
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium" style={{ color: '#8B7E74' }}>今日</span>
                </div>
              )}
              {!hasRecords ? (
                <p className="text-center text-sm py-8" style={{ color: '#C4B8AE' }}>还没有今天的记录</p>
              ) : (
                <div className="space-y-2">
                  {allItems.map((item) => item._type === 'feed' ? (
                    <SwipeToDelete deleteLabel={`删除喂奶记录：${item.amount_ml ? `${item.amount_ml}ml` : '奶粉'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteFeed(item.id); }}>
                      <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#D4A76A' }} />
                        <span className="text-base" style={{ color: '#3D3229' }}>
                          {item.amount_ml ? `${item.amount_ml}ml` : '奶粉'}
                        </span>
                        {feedIntervalMap.has(item.id) && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: '#C49556', backgroundColor: '#FFF3E6' }}>
                            +{feedIntervalMap.get(item.id)}
                          </span>
                        )}
                        {item.feeder_name && (
                          <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.feeder_name}</span>
                        )}
                        <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>
                          {formatTime(item.started_at)}
                        </span>
                      </div>
                    </SwipeToDelete>
                  ) : item._type === 'poop' ? (
                    <SwipeToDelete deleteLabel={`删除便便记录：${item.note || '便便'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeletePoop(item.id); }}>
                      <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#B8A08A' }} />
                        <PoopIcon size={14} color="#B8A08A" />
                        <span className="text-base" style={{ color: '#3D3229' }}>
                          {item.note || '便便'}
                        </span>
                        {item.recorder_name && (
                          <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.recorder_name}</span>
                        )}
                        <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>
                          {formatTime(item.started_at)}
                        </span>
                      </div>
                    </SwipeToDelete>
                  ) : item._type === 'med' ? (
                    <SwipeToDelete deleteLabel={`删除吃药记录：${item.medicine_name || '吃药'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteMed(item.id); }}>
                      <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#8B9EAF' }} />
                        <PillIcon size={14} color="#8B9EAF" />
                        <span className="text-base" style={{ color: '#3D3229' }}>
                          {item.medicine_name || '吃药'}
                        </span>
                        {item.dosage && (
                          <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.dosage}</span>
                        )}
                        {item.recorder_name && (
                          <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.recorder_name}</span>
                        )}
                        <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>
                          {formatTime(item.started_at)}
                        </span>
                      </div>
                    </SwipeToDelete>
                  ) : item._type === 'solid-food' ? (
                    <SwipeToDelete deleteLabel={`删除辅食记录：${item.food_name}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteSolidFood(item.id); }}>
                      <SolidFoodRecordRow record={item} />
                    </SwipeToDelete>
                  ) : (
                    <SwipeToDelete deleteLabel={`删除清醒记录：${item.ended_at ? getElapsedShort(item.started_at, item.ended_at) : '进行中'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteAwake(item.id); }}>
                      <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#7BAF7B' }} />
                        <EyeOpenIcon size={14} color="#7BAF7B" />
                        <span className="text-base" style={{ color: '#3D3229' }}>
                          {item.ended_at ? `清醒 ${getElapsedShort(item.started_at, item.ended_at)}` : '清醒中...'}
                        </span>
                        {item.recorder_name && (
                          <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.recorder_name}</span>
                        )}
                        <span className="ml-auto text-sm tabular-nums" style={{ color: item.ended_at ? '#BFB3A8' : '#7BAF7B' }}>
                          {formatTime(item.started_at)}{item.ended_at ? `-${formatTime(item.ended_at)}` : ''}
                        </span>
                      </div>
                    </SwipeToDelete>
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* History Entry */}
      <div className="px-5 mt-4">
        <button
          onClick={() => { haptic('light'); handleOpenHistory(); }}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          style={{ backgroundColor: '#FFFCF8', color: '#A89888' }}
        >
          <HistoryIcon size={16} color="#A89888" />
          历史记录
        </button>
      </div>

      {/* History Overlay */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: '#FFF9F2' }}>
          <div className="flex items-center justify-between px-5 py-4">
            <button onClick={() => { haptic('light'); handleCloseHistory(); }} className="flex items-center gap-1 text-base" style={{ color: '#D4A76A' }}>
              <BackIcon size={18} color="#D4A76A" />
              返回
            </button>
            <span className="text-base font-medium" style={{ color: '#3D3229' }}>历史记录</span>
            <div className="w-12" />
          </div>

          <div className="px-5 pb-2">
            <FeedVolumeTrend roomId={room.id} todayTotalMl={todayTotalMl} refreshKey={feedTrendRefreshKey} />
          </div>

          <div className="flex gap-2 px-5 py-3 justify-center">
            {[{ label: '7天', value: 7 }, { label: '14天', value: 14 }, { label: '30天', value: 30 }].map((opt) => (
              <button
                key={opt.value}
                onClick={() => { haptic('light'); handleHistoryDaysChange(opt.value); }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-transform active:scale-95"
                style={{
                  backgroundColor: historyDays === opt.value ? '#D4A76A' : '#FFFCF8',
                  color: historyDays === opt.value ? '#FFFFFF' : '#A89888',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-8">
            {historyLoading ? (
              <p className="text-center text-sm py-12" style={{ color: '#A89888' }}>加载中</p>
            ) : historyError ? (
              <p role="alert" className="text-center text-sm py-12" style={{ color: '#C96F5B' }}>{historyError}</p>
            ) : (historyFeeds.length === 0 && historyPoops.length === 0 && historyMedications.length === 0 && historyAwakes.length === 0 && historySolidFoods.length === 0) ? (
              <p className="text-center text-sm py-12" style={{ color: '#A89888' }}>没有记录</p>
            ) : (
              (() => {
                type CombinedItem = (FeedRecord & { _type: 'feed' }) | (PoopRecord & { _type: 'poop' }) | (MedicationRecord & { _type: 'med' }) | (SolidFoodRecord & { _type: 'solid-food' }) | (AwakeRecord & { _type: 'awake' });
                const allItems: CombinedItem[] = [
                  ...historyFeeds.map(f => ({ ...f, _type: 'feed' as const })),
                  ...historyPoops.map(p => ({ ...p, _type: 'poop' as const })),
                  ...historyMedications.map(m => ({ ...m, _type: 'med' as const })),
                  ...historySolidFoods.map(s => ({ ...s, _type: 'solid-food' as const })),
                  ...historyAwakes.map(a => ({ ...a, _type: 'awake' as const })),
                ].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

                // Calculate global feed intervals across all history feeds (sorted by time asc)
                const globalHistoryFeedIntervalMap = new Map<string, string>();
                const allFeedsForInterval = [...historyFeeds, ...room.feeds].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
                allFeedsForInterval.forEach((f, i) => {
                  if (i > 0) {
                    const diffMs = new Date(f.started_at).getTime() - new Date(allFeedsForInterval[i - 1].started_at).getTime();
                    const diffMin = Math.round(diffMs / 60000);
                    if (diffMin > 0) {
                      if (diffMin >= 60) {
                        globalHistoryFeedIntervalMap.set(f.id, `${Math.floor(diffMin / 60)}h${diffMin % 60}m`);
                      } else {
                        globalHistoryFeedIntervalMap.set(f.id, `${diffMin}m`);
                      }
                    }
                  }
                });

                const grouped = new Map<string, CombinedItem[]>();
                const now = new Date();
                const todayCycleDate = new Date(now);
                if (now.getHours() < 8) todayCycleDate.setDate(todayCycleDate.getDate() - 1);
                const todayKey = todayCycleDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
                const yesterdayCycleDate = new Date(todayCycleDate);
                yesterdayCycleDate.setDate(yesterdayCycleDate.getDate() - 1);
                const yesterdayKey = yesterdayCycleDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

                for (const item of allItems) {
                  const itemDate = new Date(item.started_at);
                  const cycleDate = new Date(itemDate);
                  if (cycleDate.getHours() < 8) cycleDate.setDate(cycleDate.getDate() - 1);
                  const dateKey = cycleDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
                  let label = dateKey;
                  if (dateKey === todayKey) label = '今天';
                  else if (dateKey === yesterdayKey) label = '昨天';
                  if (!grouped.has(label)) grouped.set(label, []);
                  grouped.get(label)!.push(item);
                }

                return Array.from(grouped.entries()).map(([dateLabel, items]) => {
                  const feedItems = items.filter((i): i is FeedRecord & { _type: 'feed' } => i._type === 'feed');
                  const poopItems = items.filter(i => i._type === 'poop');
                  const medItems = items.filter(i => i._type === 'med');
                  const solidFoodItems = items.filter(i => i._type === 'solid-food');
                  const awakeItems = items.filter((i): i is AwakeRecord & { _type: 'awake' } => i._type === 'awake');
                  const totalMl = feedItems.reduce((s, f) => s + (f.amount_ml || 0), 0);
                  const awakeMin = awakeItems.reduce((s, a) => {
                    if (!a.ended_at) return s;
                    return s + (new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 60000;
                  }, 0);
                  const awakeStr = awakeMin > 0 ? (awakeMin >= 60 ? `${Math.floor(awakeMin/60)}h${Math.round(awakeMin%60)}m` : `${Math.round(awakeMin)}m`) : '';
                  const stats = `${feedItems.length}次 ${totalMl}ml${poopItems.length > 0 ? ` ${poopItems.length}便` : ''}${medItems.length > 0 ? ` ${medItems.length}药` : ''}${solidFoodItems.length > 0 ? ` ${solidFoodItems.length}辅` : ''}${awakeStr ? ` ${awakeStr}醒` : ''}`;
                  return (
                    <div key={dateLabel} className="mb-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium" style={{ color: '#3D3229' }}>{dateLabel}</span>
                        <span className="text-sm" style={{ color: '#A89888' }}>{stats}</span>
                      </div>
                      <div className="space-y-2">
                        {items.map((item) => item._type === 'feed' ? (
                          <SwipeToDelete deleteLabel={`删除喂奶记录：${item.amount_ml ? `${item.amount_ml}ml` : '奶粉'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteFeed(item.id); }}>
                            <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#D4A76A' }} />
                              <span className="text-base" style={{ color: '#3D3229' }}>{item.amount_ml ? `${item.amount_ml}ml` : '奶粉'}</span>
                              {globalHistoryFeedIntervalMap.has(item.id) && (
                                <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: '#C49556', backgroundColor: '#FFF3E6' }}>
                                  +{globalHistoryFeedIntervalMap.get(item.id)}
                                </span>
                              )}
                              {item.feeder_name && <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.feeder_name}</span>}
                              <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>{formatTime(item.started_at)}</span>
                            </div>
                          </SwipeToDelete>
                        ) : item._type === 'poop' ? (
                          <SwipeToDelete deleteLabel={`删除便便记录：${item.note || '便便'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeletePoop(item.id); }}>
                            <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#B8A08A' }} />
                              <PoopIcon size={14} color="#B8A08A" />
                              <span className="text-base" style={{ color: '#3D3229' }}>{item.note || '便便'}</span>
                              {item.recorder_name && <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.recorder_name}</span>}
                              <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>{formatTime(item.started_at)}</span>
                            </div>
                          </SwipeToDelete>
                        ) : item._type === 'med' ? (
                          <SwipeToDelete deleteLabel={`删除吃药记录：${item.medicine_name || '吃药'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteMed(item.id); }}>
                            <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#8B9EAF' }} />
                              <PillIcon size={14} color="#8B9EAF" />
                              <span className="text-base" style={{ color: '#3D3229' }}>{item.medicine_name || '吃药'}</span>
                              {item.dosage && <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.dosage}</span>}
                              {item.recorder_name && <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.recorder_name}</span>}
                              <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>{formatTime(item.started_at)}</span>
                            </div>
                          </SwipeToDelete>
                        ) : item._type === 'solid-food' ? (
                          <SwipeToDelete deleteLabel={`删除辅食记录：${item.food_name}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteSolidFood(item.id); }}>
                            <SolidFoodRecordRow record={item} />
                          </SwipeToDelete>
                        ) : (
                          <SwipeToDelete deleteLabel={`删除清醒记录：${item.note || '清醒'}，${formatTime(item.started_at)}`} key={item.id} onDelete={() => { haptic('medium'); handleDeleteAwake(item.id); }}>
                            <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#7BAF8E' }} />
                              <EyeOpenIcon size={14} color="#7BAF8E" />
                              <span className="text-base" style={{ color: '#3D3229' }}>{item.note || '清醒'}</span>
                              {item.recorder_name && <span className="text-sm" style={{ color: '#BFB3A8' }}>{item.recorder_name}</span>}
                              <span className="ml-auto text-sm tabular-nums" style={{ color: '#BFB3A8' }}>{formatTime(item.started_at)}</span>
                            </div>
                          </SwipeToDelete>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
