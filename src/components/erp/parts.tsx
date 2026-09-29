'use client';
import { useActions } from './actions';
import { useErp } from './context';
import { ConfirmButton } from './ui';
import type { Purchase } from './types';

// Действие над заявкой прямо в строке: согласовать или принять остаток.
export function PurchaseAction({ p }: { p: Purchase }) {
  const acts = useActions();
  const { openDrawer } = useErp();
  if (p.status === 'requested' && acts.canDecide) return <ConfirmButton tone="plain" label="Согласовать" confirmLabel="Да, согласовать" onConfirm={() => acts.approve(p.id).then(() => undefined)} />;
  if (['ordered', 'partial'].includes(p.status) && acts.canDecide) return <ConfirmButton tone="plain" label="Принять" confirmLabel="Да, принять остаток" onConfirm={() => acts.receiveRest(p).then(() => undefined)} />;
  return <button type="button" className="btn" onClick={e => { e.stopPropagation(); openDrawer({ kind: 'purchase', id: p.id }); }}>Открыть</button>;
}
