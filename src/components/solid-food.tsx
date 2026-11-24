'use client';

import { useState, type FormEvent } from 'react';
import { Utensils, X } from 'lucide-react';

import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  formatSolidFoodAmount,
  normalizeSolidFoodInput,
  SOLID_FOOD_UNIT_OPTIONS,
  type NormalizedSolidFoodInput,
  type SolidFoodRecord,
} from '@/lib/solid-food';

type SolidFoodUnitInput = (typeof SOLID_FOOD_UNIT_OPTIONS)[number]['value'];

interface SolidFoodRecordRowProps {
  record: SolidFoodRecord;
}

interface SolidFoodFormProps {
  recorderName: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: NormalizedSolidFoodInput) => Promise<{
    success: boolean;
    error?: string;
  }>;
}

function getCurrentTimeInputValue(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function buildSolidFoodStartedAt(
  time: string,
  usePreviousDay: boolean,
  now: Date = new Date(),
): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;

  const startedAt = new Date(now.getTime());
  if (Number.isNaN(startedAt.getTime())) return null;
  if (usePreviousDay) startedAt.setDate(startedAt.getDate() - 1);
  startedAt.setHours(Number(match[1]), Number(match[2]), 0, 0);

  return startedAt.toISOString();
}

export function SolidFoodRecordRow({ record }: SolidFoodRecordRowProps) {
  const amount = formatSolidFoodAmount(record.amount_value, record.amount_unit);
  const time = new Date(record.started_at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="flex min-w-0 items-start gap-3 px-4 py-3"
      style={{ backgroundColor: 'var(--app-surface)' }}
    >
      <div className="flex shrink-0 items-center gap-2 pt-1" aria-hidden="true">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--app-success)' }} />
        <Utensils className="size-4 shrink-0" style={{ color: 'var(--app-success)' }} strokeWidth={1.5} />
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full flex-1 basis-24 truncate text-base" style={{ color: 'var(--app-text)' }}>
            {record.food_name}
          </span>
          {amount ? (
            <span className="shrink-0 text-sm" style={{ color: 'var(--app-success)' }}>
              {amount}
            </span>
          ) : null}
          {record.recorder_name ? (
            <span className="min-w-0 max-w-full truncate text-sm" style={{ color: 'var(--app-text-faint)' }}>
              {record.recorder_name}
            </span>
          ) : null}
        </div>
        <time
          className="shrink-0 text-sm tabular-nums"
          dateTime={record.started_at}
          style={{ color: 'var(--app-text-faint)' }}
        >
          {time}
        </time>
        {record.note ? (
          <p className="col-span-2 min-w-0 truncate text-sm" style={{ color: 'var(--app-text-secondary)' }}>
            {record.note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SolidFoodForm({
  recorderName,
  submitting,
  onClose,
  onSubmit,
}: SolidFoodFormProps) {
  const [foodName, setFoodName] = useState('');
  const [amountValue, setAmountValue] = useState('');
  const [amountUnit, setAmountUnit] = useState<SolidFoodUnitInput>('g');
  const [time, setTime] = useState(getCurrentTimeInputValue);
  const [usePreviousDay, setUsePreviousDay] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const nameInvalid = error === '请输入食物名称';
  const amountInvalid = error === '食用量必须大于 0';
  const unitInvalid = error === '无效的食用量单位';
  const timeInvalid = error === '无效的记录时间';
  const formError = error && !nameInvalid && !amountInvalid && !unitInvalid && !timeInvalid ? error : '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError('');
    const startedAt = buildSolidFoodStartedAt(time, usePreviousDay);
    if (startedAt === null) {
      setError('无效的记录时间');
      return;
    }

    const normalized = normalizeSolidFoodInput({
      recorder_name: recorderName,
      food_name: foodName,
      amount_value: amountValue,
      amount_unit: amountUnit,
      note,
      started_at: startedAt,
    });

    if (!normalized.success) {
      setError(normalized.error);
      return;
    }

    try {
      const result = await onSubmit(normalized.data);
      if (result.success) {
        onClose();
        return;
      }
      setError(result.error || '保存失败，请重试');
    } catch {
      setError('保存失败，请重试');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'var(--app-overlay)' }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="solid-food-title"
        className="w-full max-w-sm rounded-t-2xl p-6 pb-8"
        style={{ backgroundColor: 'var(--app-sheet)', borderColor: 'var(--app-border)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Utensils size={18} color="var(--app-success)" />
            <h2 id="solid-food-title" className="text-base font-medium" style={{ color: 'var(--app-text)' }}>
              记录辅食
            </h2>
          </div>
          <button
            type="button"
            className="p-1"
            style={{ color: 'var(--app-text-faint)' }}
            aria-label="关闭辅食记录"
            disabled={submitting}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <form className="flex min-h-0 max-h-[calc(90dvh-7rem)] flex-col" onSubmit={handleSubmit} noValidate>
          <FieldGroup className="min-h-0 flex-1 gap-4 overflow-y-auto">
            <Field data-invalid={nameInvalid}>
              <FieldLabel htmlFor="solid-food-name" style={{ color: 'var(--app-text-secondary)' }}>
                食物名称
              </FieldLabel>
              <Input
                id="solid-food-name"
                value={foodName}
                onChange={(event) => setFoodName(event.target.value)}
                placeholder="如：米糊、南瓜泥"
                required
                maxLength={80}
                aria-invalid={nameInvalid}
                className="h-12 px-4 text-base"
                style={{
                  backgroundColor: 'var(--app-surface)',
                  borderColor: 'var(--app-border)',
                  color: 'var(--app-text)',
                }}
              />
              {nameInvalid ? <FieldError style={{ color: 'var(--app-danger)' }}>{error}</FieldError> : null}
            </Field>

            <FieldGroup className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
              <Field data-invalid={amountInvalid}>
                <FieldLabel htmlFor="solid-food-amount" style={{ color: 'var(--app-text-secondary)' }}>
                  食用量（选填）
                </FieldLabel>
                <Input
                  id="solid-food-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={amountValue}
                  onChange={(event) => setAmountValue(event.target.value)}
                  placeholder="30"
                  aria-invalid={amountInvalid}
                  className="h-12 px-4 text-base tabular-nums"
                  style={{
                    backgroundColor: 'var(--app-surface)',
                    borderColor: 'var(--app-border)',
                    color: 'var(--app-text)',
                  }}
                />
                {amountInvalid ? <FieldError style={{ color: 'var(--app-danger)' }}>{error}</FieldError> : null}
              </Field>
              <Field data-invalid={unitInvalid}>
                <FieldLabel htmlFor="solid-food-unit" style={{ color: 'var(--app-text-secondary)' }}>
                  单位
                </FieldLabel>
                <Select
                  value={amountUnit}
                  onValueChange={(value) => setAmountUnit(value as SolidFoodUnitInput)}
                >
                  <SelectTrigger
                    id="solid-food-unit"
                    aria-invalid={unitInvalid}
                    className="h-12 w-full px-3 text-base"
                    style={{
                      backgroundColor: 'var(--app-surface)',
                      borderColor: 'var(--app-border)',
                      color: 'var(--app-text)',
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                    <SelectGroup>
                      {SOLID_FOOD_UNIT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {unitInvalid ? <FieldError style={{ color: 'var(--app-danger)' }}>{error}</FieldError> : null}
              </Field>
            </FieldGroup>

            <FieldGroup className="grid grid-cols-[minmax(0,1.2fr)_minmax(7.5rem,0.8fr)] gap-3">
              <Field>
                <FieldLabel id="solid-food-day-label" style={{ color: 'var(--app-text-secondary)' }}>
                  日期
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  value={usePreviousDay ? 'yesterday' : 'today'}
                  onValueChange={(value) => {
                    if (value) setUsePreviousDay(value === 'yesterday');
                  }}
                  variant="outline"
                  className="grid h-12 w-full grid-cols-2"
                  aria-labelledby="solid-food-day-label"
                >
                  <ToggleGroupItem
                    value="today"
                    className="h-12 w-full min-w-0 px-2"
                    style={{
                      backgroundColor: usePreviousDay ? 'var(--app-surface)' : 'var(--app-primary-soft)',
                      borderColor: 'var(--app-border)',
                      color: usePreviousDay ? 'var(--app-text-secondary)' : 'var(--app-primary-strong)',
                    }}
                  >
                    今天
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="yesterday"
                    className="h-12 w-full min-w-0 px-2"
                    style={{
                      backgroundColor: usePreviousDay ? 'var(--app-primary-soft)' : 'var(--app-surface)',
                      borderColor: 'var(--app-border)',
                      color: usePreviousDay ? 'var(--app-primary-strong)' : 'var(--app-text-secondary)',
                    }}
                  >
                    昨天
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field data-invalid={timeInvalid}>
                <FieldLabel htmlFor="solid-food-time" style={{ color: 'var(--app-text-secondary)' }}>
                  时间
                </FieldLabel>
                <Input
                  id="solid-food-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                  aria-invalid={timeInvalid}
                  className="h-12 px-3 text-base tabular-nums"
                  style={{
                    backgroundColor: 'var(--app-surface)',
                    borderColor: 'var(--app-border)',
                    color: 'var(--app-text)',
                    WebkitAppearance: 'none',
                  }}
                />
                {timeInvalid ? <FieldError style={{ color: 'var(--app-danger)' }}>{error}</FieldError> : null}
              </Field>
            </FieldGroup>

            <Field>
              <FieldLabel htmlFor="solid-food-note" style={{ color: 'var(--app-text-secondary)' }}>
                备注（选填）
              </FieldLabel>
              <Textarea
                id="solid-food-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="如：第一次尝试"
                maxLength={200}
                rows={3}
                className="min-h-20 resize-none px-4 py-3 text-base"
                style={{
                  backgroundColor: 'var(--app-surface)',
                  borderColor: 'var(--app-border)',
                  color: 'var(--app-text)',
                }}
              />
            </Field>

            {formError ? <FieldError style={{ color: 'var(--app-danger)' }}>{formError}</FieldError> : null}
          </FieldGroup>

          <div className="mt-5 flex shrink-0 flex-col gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl py-4 text-lg font-medium text-app-on-accent transition-transform active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: 'var(--app-success)' }}
            >
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {submitting ? '保存中' : '确认'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
