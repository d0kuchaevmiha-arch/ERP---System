'use client';
import { useErp } from './context';
import { ClientTime } from './ui';
import { auditActionLabel, auditEntityLabel } from './format';
import type { AuditRow, Data } from './types';

export function describeAudit(data: Data, row: AuditRow) {
  const id = row.entityId || '';
  let name = '';
  switch (row.entityType) {
    case 'purchase': name = data.purchases.find(x => x.id === id)?.number || ''; break;
    case 'task': name = data.tasks.find(x => x.id === id)?.name || ''; break;
    case 'project': name = data.projects.find(x => x.id === id)?.name || ''; break;
    case 'expense': name = data.expenses.find(x => x.id === id)?.description || ''; break;
    case 'material': name = data.materials.find(x => x.id === id)?.name || ''; break;
    case 'contract': name = data.contracts.find(x => x.id === id)?.number || ''; break;
  }
  const who = data.people.find(p => p.id === row.actorId)?.name || 'Система';
  return { who, action: auditActionLabel[row.action] || row.action, entity: auditEntityLabel[row.entityType] || row.entityType, name };
}

// Пометки на полях: журнал изменений с автором и временем. Без projectId — по всем объектам.
export function Marginalia({ projectId, limit = 12 }: { projectId?: string; limit?: number }) {
  const { data, openDrawer } = useErp();
  const ids = new Set<string>();
  if (projectId) {
    ids.add(projectId);
    data.tasks.filter(t => t.projectId === projectId).forEach(t => ids.add(t.id));
    data.purchases.filter(t => t.projectId === projectId).forEach(t => ids.add(t.id));
    data.expenses.filter(t => t.projectId === projectId).forEach(t => ids.add(t.id));
    data.contracts.filter(t => t.projectId === projectId).forEach(t => ids.add(t.id));
  }
  const rows = data.audit.filter(a => !projectId || (a.entityId && ids.has(a.entityId))).slice(0, limit);
  const open = (r: AuditRow) => {
    const id = r.entityId; if (!id) return;
    if (r.entityType === 'purchase') openDrawer({ kind: 'purchase', id });
    else if (r.entityType === 'task') openDrawer({ kind: 'task', id });
    else if (r.entityType === 'project') openDrawer({ kind: 'project', id });
    else if (r.entityType === 'expense') openDrawer({ kind: 'expense', id });
    else if (r.entityType === 'material') openDrawer({ kind: 'material', id });
    else if (r.entityType === 'contract') openDrawer({ kind: 'contract', id });
  };
  return (
    <section className="margin" aria-label="Замечания и изменения">
      <h2 className="margin-title">Замечания и изменения</h2>
      {rows.length === 0 ? (
        <p className="muted small">Изменений пока нет. Здесь появятся согласования, приёмки и внесённое выполнение — с автором и временем.</p>
      ) : (
        <ol className="margin-list">
          {rows.map(r => {
            const d = describeAudit(data, r);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => open(r)}>
                  <span className="margin-time"><ClientTime value={r.createdAt} /></span>
                  <span className="margin-text"><b>{d.action}</b> · {d.entity}{d.name ? ` «${d.name}»` : ''}</span>
                  <span className="margin-who">{d.who}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
