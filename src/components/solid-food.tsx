'use client';

import { useState, type FormEvent } from 'react';
import { Utensils, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
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
      style={{ backgroundColor: '#FFFCF8' }}
    >
      <div className="flex shrink-0 items-center gap-2 pt-1" aria-hidden="true">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: '#6F9B78' }} />
        <Utensils className="size-4 shrink-0" style={{ color: '#6F9B78' }} strokeWidth={1.5} />
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full flex-1 basis-24 truncate text-base" style={{ color: '#3D3229' }}>
            {record.food_name}
          </span>
          {amount ? (
            <span className="shrink-0 text-sm" style={{ color: '#6F9B78' }}>
              {amount}
            </span>
          ) : null}
          {record.recorder_name ? (
            <span className="min-w-0 max-w-full truncate text-sm" style={{ color: '#BFB3A8' }}>
              {record.recorder_name}
            </span>
          ) : null}
        </div>
        <time
          className="shrink-0 text-sm tabular-nums"
          dateTime={record.started_at}
          style={{ color: '#BFB3A8' }}
        >
          {time}
        </time>
        {record.note ? (
          <p className="col-span-2 min-w-0 truncate text-sm" style={{ color: '#8B7E74' }}>
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
    <Drawer
      open
      fixed
      repositionInputs
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DrawerContent
        className="mx-auto max-h-[90dvh] w-full max-w-md overflow-hidden"
        style={{ backgroundColor: '#FFF9F2', borderColor: '#EDE5DC' }}
      >
        <DrawerHeader className="relative shrink-0 flex-row items-start justify-between gap-4 px-5 pb-3 pt-2 text-left">
          <div className="min-w-0">
            <DrawerTitle className="text-base" style={{ color: '#3D3229' }}>
              记录辅食
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              填写食物、分量和记录时间
            </DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              style={{ color: '#8B7E74' }}
              aria-label="关闭辅食记录"
              disabled={submitting}
            >
              <X data-icon="inline-start" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit} noValidate>
          <FieldGroup className="min-h-0 flex-1 gap-5 overflow-y-auto px-5 pb-5 pt-2">
            <Field data-invalid={nameInvalid}>
              <FieldLabel htmlFor="solid-food-name" style={{ color: '#8B7E74' }}>
                食物名称
              </FieldLabel>
              <Input
                id="solid-food-name"
                value={foodName}
                onChange={(event) => setFoodName(event.target.value)}
                placeholder="如：米糊、南瓜泥"
                required
                autoFocus
                maxLength={80}
                aria-invalid={nameInvalid}
                className="h-12 px-4 text-base"
                style={{
                  backgroundColor: '#FFFCF8',
                  borderColor: '#EDE5DC',
                  color: '#3D3229',
                }}
              />
              {nameInvalid ? <FieldError style={{ color: '#E8836B' }}>{error}</FieldError> : null}
            </Field>

            <FieldGroup className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
              <Field data-invalid={amountInvalid}>
                <FieldLabel htmlFor="solid-food-amount" style={{ color: '#8B7E74' }}>
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
                    backgroundColor: '#FFFCF8',
                    borderColor: '#EDE5DC',
                    color: '#3D3229',
                  }}
                />
                {amountInvalid ? <FieldError style={{ color: '#E8836B' }}>{error}</FieldError> : null}
              </Field>
              <Field data-invalid={unitInvalid}>
                <FieldLabel htmlFor="solid-food-unit" style={{ color: '#8B7E74' }}>
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
                      backgroundColor: '#FFFCF8',
                      borderColor: '#EDE5DC',
                      color: '#3D3229',
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC' }}>
                    <SelectGroup>
                      {SOLID_FOOD_UNIT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {unitInvalid ? <FieldError style={{ color: '#E8836B' }}>{error}</FieldError> : null}
              </Field>
            </FieldGroup>

            <FieldGroup className="grid grid-cols-[minmax(0,1.2fr)_minmax(7.5rem,0.8fr)] gap-3">
              <Field>
                <FieldLabel id="solid-food-day-label" style={{ color: '#8B7E74' }}>
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
                      backgroundColor: usePreviousDay ? '#FFFCF8' : '#FFF3E6',
                      borderColor: '#EDE5DC',
                      color: usePreviousDay ? '#8B7E74' : '#C49556',
                    }}
                  >
                    今天
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="yesterday"
                    className="h-12 w-full min-w-0 px-2"
                    style={{
                      backgroundColor: usePreviousDay ? '#FFF3E6' : '#FFFCF8',
                      borderColor: '#EDE5DC',
                      color: usePreviousDay ? '#C49556' : '#8B7E74',
                    }}
                  >
                    昨天
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field data-invalid={timeInvalid}>
                <FieldLabel htmlFor="solid-food-time" style={{ color: '#8B7E74' }}>
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
                    backgroundColor: '#FFFCF8',
                    borderColor: '#EDE5DC',
                    color: '#3D3229',
                    WebkitAppearance: 'none',
                  }}
                />
                {timeInvalid ? <FieldError style={{ color: '#E8836B' }}>{error}</FieldError> : null}
              </Field>
            </FieldGroup>

            <Field>
              <FieldLabel htmlFor="solid-food-note" style={{ color: '#8B7E74' }}>
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
                  backgroundColor: '#FFFCF8',
                  borderColor: '#EDE5DC',
                  color: '#3D3229',
                }}
              />
            </Field>

            {formError ? <FieldError style={{ color: '#E8836B' }}>{formError}</FieldError> : null}
          </FieldGroup>

          <DrawerFooter className="shrink-0 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
            <Button
              type="submit"
              disabled={submitting}
              className="h-14 w-full text-base active:scale-[0.97]"
              style={{ backgroundColor: '#6F9B78', color: '#FFFCF8' }}
            >
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {submitting ? '保存中' : '确认'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
