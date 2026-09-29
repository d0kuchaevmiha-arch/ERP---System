'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useErp } from './context';
import type { CreateKind } from './types';
import { BRAND } from '@/lib/brand';

type Field = { name: string; label: string; type?: string; options?: string; required?: boolean };

const fields: Record<CreateKind, Field[]> = {
  project: [{ name: 'name', label: 'Название объекта', required: true }, { name: 'code', label: 'Шифр объекта', required: true }, { name: 'address', label: 'Адрес' }, { name: 'contractValue', label: 'Сумма договора, ₽', type: 'number' }, { name: 'forecast', label: 'Прогноз себестоимости, ₽', type: 'number' }, { name: 'endDate', label: 'Плановая дата окончания', type: 'date' }],
  task: [{ name: 'projectId', label: 'Объект', options: 'projects', required: true }, { name: 'name', label: 'Название работы или этапа', required: true }, { name: 'kind', label: 'Тип', options: 'kinds' }, { name: 'parentId', label: 'Родительский этап', options: 'tasks' }, { name: 'startDate', label: 'Начало', type: 'date' }, { name: 'endDate', label: 'Окончание', type: 'date' }, { name: 'plannedCost', label: 'Плановая стоимость, ₽', type: 'number' }],
  budget: [{ name: 'projectId', label: 'Объект', options: 'projects', required: true }, { name: 'category', label: 'Статья бюджета', options: 'categories', required: true }, { name: 'amount', label: 'Плановая сумма, ₽', type: 'number', required: true }, { name: 'taskId', label: 'Этап или работа', options: 'tasks' }, { name: 'period', label: 'Период, например 2026-05' }],
  expense: [{ name: 'projectId', label: 'Объект', options: 'projects', required: true }, { name: 'taskId', label: 'Этап или работа', options: 'tasks' }, { name: 'category', label: 'Статья затрат', options: 'categories', required: true }, { name: 'description', label: 'Основание расхода', required: true }, { name: 'amount', label: 'Сумма, ₽', type: 'number', required: true }, { name: 'incurredAt', label: 'Дата', type: 'date' }],
  material: [{ name: 'name', label: 'Наименование', required: true }, { name: 'sku', label: 'Артикул', required: true }, { name: 'category', label: 'Категория' }, { name: 'unit', label: 'Единица измерения', options: 'units', required: true }, { name: 'minStock', label: 'Неснижаемый остаток', type: 'number' }, { name: 'price', label: 'Цена за единицу, ₽', type: 'number' }],
  purchase: [{ name: 'projectId', label: 'Объект', options: 'projects', required: true }, { name: 'materialId', label: 'Материал', options: 'materials', required: true }, { name: 'warehouseId', label: 'Склад', options: 'warehouses' }, { name: 'supplierId', label: 'Поставщик', options: 'suppliers' }, { name: 'quantity', label: 'Количество', type: 'number', required: true }, { name: 'unitPrice', label: 'Цена за единицу, ₽', type: 'number', required: true }, { name: 'dueAt', label: 'Нужно к дате', type: 'date' }, { name: 'note', label: 'Комментарий' }],
  supplier: [{ name: 'name', label: 'Название компании', required: true }, { name: 'inn', label: 'ИНН' }, { name: 'contact', label: 'Контакт' }, { name: 'kind', label: 'Тип контрагента', options: 'partyKinds' }],
  contract: [{ name: 'number', label: 'Номер договора', required: true }, { name: 'projectId', label: 'Объект', options: 'projects' }, { name: 'counterpartyId', label: 'Контрагент', options: 'counterparties', required: true }, { name: 'kind', label: 'Вид договора', required: true }, { name: 'amount', label: 'Сумма, ₽', type: 'number', required: true }, { name: 'signedAt', label: 'Дата подписания', type: 'date' }],
  movement: [{ name: 'warehouseId', label: 'Склад', options: 'warehouses', required: true }, { name: 'materialId', label: 'Материал', options: 'materials', required: true }, { name: 'projectId', label: 'Объект', options: 'projects' }, { name: 'taskId', label: 'Этап или работа', options: 'tasks' }, { name: 'type', label: 'Операция', options: 'movementTypes', required: true }, { name: 'quantity', label: 'Количество', type: 'number', required: true }, { name: 'note', label: 'Основание' }],
  receive: [{ name: 'purchaseId', label: 'Заказ', options: 'orders', required: true }, { name: 'warehouseId', label: 'Склад', options: 'warehouses', required: true }, { name: 'quantity', label: 'Количество к приёмке', type: 'number', required: true }],
  progress: [{ name: 'taskId', label: 'Работа', options: 'tasks', required: true }, { name: 'progress', label: 'Готовность, %', type: 'number', required: true }, { name: 'actualQuantity', label: 'Выполненный объём', type: 'number' }],
  login: [{ name: 'email', label: 'Электронная почта', type: 'email', required: true }, { name: 'password', label: 'Пароль', type: 'password', required: true }],
};
const title: Record<CreateKind, string> = { project: 'Создать объект', task: 'Создать работу', budget: 'Добавить статью бюджета', expense: 'Внести расход', material: 'Создать материал', purchase: 'Создать заявку на материал', supplier: 'Добавить контрагента', contract: 'Создать договор', movement: 'Внести движение материала', receive: 'Принять поставку', progress: 'Внести выполнение', login: 'Войти в систему' };
const submitLabel: Record<CreateKind, string> = { project: 'Создать объект', task: 'Создать работу', budget: 'Добавить статью', expense: 'Внести расход', material: 'Создать материал', purchase: 'Создать заявку', supplier: 'Добавить контрагента', contract: 'Создать договор', movement: 'Внести движение', receive: 'Принять поставку', progress: 'Внести выполнение', login: 'Войти' };
const done: Record<CreateKind, string> = { project: 'Объект создан', task: 'Работа создана', budget: 'Статья бюджета добавлена', expense: 'Расход внесён', material: 'Материал создан', purchase: 'Заявка создана и ушла на согласование', supplier: 'Контрагент добавлен', contract: 'Договор создан', movement: 'Движение внесено', receive: 'Поставка принята', progress: 'Выполнение внесено', login: 'Вход выполнен' };
const resource: Record<CreateKind, string> = { project: 'projects', task: 'tasks', budget: 'budgets', expense: 'expenses', material: 'materials', purchase: 'purchases', supplier: 'suppliers', contract: 'contracts', movement: 'movements', receive: 'receive', progress: 'progress', login: 'auth' };

export function CreateDialog({ kind, initial, onClose, onLogin }: { kind: CreateKind; initial: Record<string, string>; onClose: () => void; onLogin: (user: { name: string; role: string; email: string }) => void }) {
  const { data, post, notify, refresh } = useErp();
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>('input,select,textarea');
    first?.focus();
    return () => prev?.focus?.();
  }, []);

  const options = (key: string): [string, string][] => {
    switch (key) {
      case 'projects': return data.projects.map(x => [x.id, `${x.code} · ${x.name}`]);
      case 'materials': return data.materials.map(x => [x.id, `${x.name} (${x.unit})`]);
      case 'warehouses': return data.warehouses.map(x => [x.id, x.name]);
      case 'suppliers': return data.counterparties.filter(x => x.kind === 'supplier').map(x => [x.id, x.name]);
      case 'counterparties': return data.counterparties.map(x => [x.id, x.name]);
      case 'tasks': {
        const pid = form.projectId;
        return data.tasks.filter(x => !pid || x.projectId === pid).map(x => [x.id, `${x.code ? x.code + ' ' : ''}${x.name}${pid ? '' : ' — ' + x.project}`]);
      }
      case 'orders': return data.purchases.filter(x => ['ordered', 'partial'].includes(x.status)).map(x => [x.id, `${x.number} — осталось ${Number(x.quantity) - Number(x.receivedQuantity)} ${data.materials.find(m => m.id === x.materialId)?.unit || ''}`]);
      case 'kinds': return [['stage', 'Этап'], ['section', 'Раздел'], ['work', 'Работа'], ['subtask', 'Подзадача']];
      case 'categories': return ['Материалы', 'Работы', 'Техника', 'Оплата труда', 'Прочее'].map(x => [x, x]);
      case 'units': return ['шт', 'кг', 'т', 'м', 'м²', 'м³', 'л', 'комплект', 'час', 'маш.-час'].map(x => [x, x]);
      case 'partyKinds': return [['supplier', 'Поставщик'], ['customer', 'Заказчик'], ['contractor', 'Подрядчик']];
      case 'movementTypes': return [['receipt', 'Приход'], ['issue', 'Выдача на объект'], ['writeoff', 'Списание'], ['return', 'Возврат']];
      default: return [];
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (kind === 'login') {
        const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || 'Не удалось войти. Проверьте почту и пароль.');
        // Мог войти другой пользователь с другими объектами — перезагружаем страницу целиком.
        if (json.user?.mustChangePassword) { window.location.assign('/account/password'); return; }
        onLogin(json.user);
        await refresh();
        notify(done.login);
      } else {
        // Пустые значения не отправляем: API ждёт либо корректное значение, либо отсутствие поля.
        const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
        const r = await post(resource[kind], body);
        if (!r.ok) throw new Error(r.message || 'Операция не выполнена. Проверьте поля и повторите.');
        notify(done[kind]);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка. Повторите действие.');
    } finally { setBusy(false); }
  }

  function keyTrap(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const els = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,[href]') || []).filter(x => !x.hasAttribute('disabled'));
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={uid + 't'} onKeyDown={keyTrap}>
        <form onSubmit={submit}>
          <div className="modal-head">
            <div><small>{BRAND.name}</small><h2 id={uid + 't'} className="disp">{title[kind]}</h2></div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
          </div>
          <div className="modal-body">
            {error && <div className="form-error" role="alert">{error}</div>}
            {fields[kind].map((f, i) => {
              const id = `${uid}-${f.name}`;
              return (
                <div className="field" key={f.name}>
                  <label htmlFor={id}>{f.label}{f.required && <abbr title="обязательное поле"> *</abbr>}</label>
                  {f.options ? (
                    <select id={id} required={f.required} value={form[f.name] || ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}>
                      <option value="">{f.required ? 'Выберите значение' : 'Не указано'}</option>
                      {options(f.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : (
                    <input id={id} autoComplete={f.type === 'password' ? 'current-password' : f.type === 'email' ? 'username' : 'off'} required={f.required} type={f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} min={f.type === 'number' ? '0' : undefined} step={f.type === 'number' ? 'any' : undefined} value={form[f.name] || ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })} data-autofocus={i === 0 ? '' : undefined} />
                  )}
                </div>
              );
            })}
            {kind === 'login' && <p className="hint">Для записи данных нужна учётная запись. Пароль демо-доступа задаётся в DEMO_PASSWORD при развёртывании.</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Отмена</button>
            <button className="btn btn-mark" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : submitLabel[kind]}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
