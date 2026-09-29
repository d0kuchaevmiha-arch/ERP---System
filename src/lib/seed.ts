import { db } from '@/db';
import { organizations, users, projectAccess, counterparties, projects, tasks, budgetLines, expenses, materials, warehouses, stockMovements, purchases, approvals, notifications, contracts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/server/auth/password';

export async function seedDemo() {
  const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (existing.length) return;
  await db.transaction(async tx => {
    const [org] = await tx.insert(organizations).values({ name: 'ГК «Монолит»', inn: '7700000000' }).returning();
    const password = process.env.DEMO_PASSWORD || crypto.randomUUID();
    const [director] = await tx.insert(users).values({ organizationId: org.id, name: 'Александр Волков', email: 'director@monolit.local', passwordHash: hashPassword(password), role: 'director' }).returning();
    const [manager] = await tx.insert(users).values({ organizationId: org.id, name: 'Мария Соколова', email: 'manager@monolit.local', passwordHash: hashPassword(process.env.DEMO_PASSWORD || crypto.randomUUID()), role: 'project_manager' }).returning();
    const [customer, supplier] = await tx.insert(counterparties).values([
      { organizationId: org.id, name: 'ГК «Горизонт»', kind: 'customer', inn: '7701234567' },
      { organizationId: org.id, name: 'СтройКомплект', kind: 'supplier', inn: '7801234567' }
    ]).returning();
    const [p1,p2,p3] = await tx.insert(projects).values([
      { organizationId: org.id, code: 'PRJ-001', name: 'ЖК «Северный квартал»', address: 'Москва, ул. Полярная, 12', customerId: customer.id, managerId: manager.id, status: 'active', progress: 68, startDate: '2025-09-01', endDate: '2026-12-20', contractValue: '185000000', forecast: '142000000', description: 'Жилой комплекс, 2 корпуса · 18 400 м²' },
      { organizationId: org.id, code: 'PRJ-002', name: 'БЦ «Речной»', address: 'Москва, Береговой пр., 5', customerId: customer.id, managerId: manager.id, status: 'risk', progress: 42, startDate: '2025-11-10', endDate: '2027-03-15', contractValue: '126000000', forecast: '119500000', description: 'Деловой центр класса А · 9 200 м²' },
      { organizationId: org.id, code: 'PRJ-003', name: 'Логистический комплекс «Юг»', address: 'Московская обл., г. Домодедово', customerId: customer.id, managerId: manager.id, status: 'delayed', progress: 31, startDate: '2025-07-01', endDate: '2026-07-30', contractValue: '94000000', forecast: '80700000', description: 'Складской комплекс · 12 600 м²' }
    ]).returning();
    await tx.insert(projectAccess).values([p1,p2,p3].map(p=>({userId:manager.id,projectId:p.id,permission:'edit'})));
    const [foundation, frame, facade, electric] = await tx.insert(tasks).values([
      { projectId: p1.id, code: '1', name: 'Фундамент и подземная часть', kind: 'stage', startDate: '2025-09-01', endDate: '2026-01-30', progress: 100, status: 'done', plannedCost: '23500000' },
      { projectId: p1.id, code: '2', name: 'Монолитный каркас', kind: 'stage', startDate: '2026-01-15', endDate: '2026-08-30', progress: 74, status: 'active', plannedCost: '42000000' },
      { projectId: p1.id, code: '3', name: 'Фасадные работы', kind: 'stage', startDate: '2026-06-01', endDate: '2026-11-30', progress: 25, status: 'active', plannedCost: '31000000' },
      { projectId: p3.id, code: '1', name: 'Инженерные сети', kind: 'stage', startDate: '2026-01-10', endDate: '2026-04-20', progress: 42, status: 'delayed', plannedCost: '18000000' }
    ]).returning();
    await tx.insert(tasks).values([
      { projectId: p1.id, parentId: frame.id, code: '2.1', name: 'Армирование перекрытий', kind: 'work', startDate: '2026-03-01', endDate: '2026-06-30', progress: 82, status: 'active', plannedCost: '8500000', unit: 'м²' },
      { projectId: p1.id, parentId: frame.id, code: '2.2', name: 'Бетонирование 8–12 этажей', kind: 'work', startDate: '2026-05-01', endDate: '2026-08-15', progress: 61, status: 'active', plannedCost: '12200000', unit: 'м³' },
      { projectId: p3.id, parentId: electric.id, code: '1.1', name: 'Монтаж электрощитов', kind: 'work', startDate: '2026-02-01', endDate: '2026-04-01', progress: 35, status: 'delayed', plannedCost: '3600000' }
    ]);
    await tx.insert(budgetLines).values([
      { projectId: p1.id, category: 'Материалы', amount: '62000000' }, { projectId: p1.id, category: 'Работы', amount: '48000000' }, { projectId: p1.id, category: 'Техника', amount: '18000000' },
      { projectId: p2.id, category: 'Материалы', amount: '41000000' }, { projectId: p2.id, category: 'Работы', amount: '39000000' }, { projectId: p2.id, category: 'Техника', amount: '14000000' },
      { projectId: p3.id, category: 'Материалы', amount: '34000000' }, { projectId: p3.id, category: 'Работы', amount: '29000000' }, { projectId: p3.id, category: 'Техника', amount: '11000000' }
    ]);
    await tx.insert(expenses).values([
      { projectId: p1.id, taskId: foundation.id, category: 'Материалы', description: 'Бетон и арматура для фундамента', amount: '31200000', incurredAt: '2026-03-15', counterpartyId: supplier.id },
      { projectId: p1.id, taskId: frame.id, category: 'Работы', description: 'Монолитные работы, этап 2', amount: '28400000', incurredAt: '2026-04-12' },
      { projectId: p1.id, category: 'Техника', description: 'Аренда башенного крана', amount: '11300000', incurredAt: '2026-04-22' },
      { projectId: p2.id, category: 'Материалы', description: 'Сталь и металлопрокат', amount: '48000000', incurredAt: '2026-04-15', counterpartyId: supplier.id },
      { projectId: p2.id, category: 'Работы', description: 'Монтаж металлоконструкций', amount: '38200000', incurredAt: '2026-04-17' },
      { projectId: p2.id, category: 'Техника', description: 'Эксплуатация техники', amount: '14200000', incurredAt: '2026-04-19' },
      { projectId: p3.id, category: 'Материалы', description: 'Инженерные коммуникации', amount: '17300000', incurredAt: '2026-04-10' },
      { projectId: p3.id, category: 'Работы', description: 'Строительно-монтажные работы', amount: '15200000', incurredAt: '2026-04-11' }
    ]);
    const [rebar, concrete, cable] = await tx.insert(materials).values([
      { organizationId: org.id, sku: 'MAT-001', name: 'Арматура А500С Ø12', category: 'Металлопрокат', unit: 'т', minStock: '12', price: '68000' },
      { organizationId: org.id, sku: 'MAT-002', name: 'Бетон М300 B22.5', category: 'Бетон', unit: 'м³', minStock: '40', price: '5800' },
      { organizationId: org.id, sku: 'MAT-003', name: 'Кабель ВВГнг 3×2.5', category: 'Электрика', unit: 'м', minStock: '500', price: '135' }
    ]).returning();
    const [warehouse] = await tx.insert(warehouses).values({ organizationId: org.id, projectId: p1.id, name: 'Склад Северный квартал', location: 'Площадка 1, корпус А' }).returning();
    await tx.insert(stockMovements).values([
      { materialId: rebar.id, warehouseId: warehouse.id, projectId: p1.id, type: 'receipt', quantity: '8.5', note: 'Начальный остаток' },
      { materialId: concrete.id, warehouseId: warehouse.id, projectId: p1.id, type: 'receipt', quantity: '96', note: 'Начальный остаток' },
      { materialId: cable.id, warehouseId: warehouse.id, projectId: p1.id, type: 'receipt', quantity: '1200', note: 'Начальный остаток' }
    ]);
    const [,pendingPurchase] = await tx.insert(purchases).values([
      { organizationId: org.id, projectId: p1.id, materialId: rebar.id, warehouseId: warehouse.id, supplierId: supplier.id, number: 'ЗК-2026-041', quantity: '20', unitPrice: '68000', status: 'ordered', dueAt: '2026-03-15', note: 'Поставка арматуры для 9 этажа' },
      { organizationId: org.id, projectId: p1.id, materialId: concrete.id, warehouseId: warehouse.id, number: 'ЗК-2026-042', quantity: '60', unitPrice: '5800', status: 'requested', dueAt: '2026-06-15', note: 'Бетон для перекрытий' }
    ]).returning();
    await tx.insert(contracts).values({ organizationId: org.id, projectId: p1.id, counterpartyId: customer.id, number: 'ГП-2025/087', kind: 'customer', amount: '185000000', signedAt: '2025-08-20', status: 'active' });
    await tx.insert(approvals).values({ organizationId: org.id, entityType: 'purchase', entityId: pendingPurchase.id, assignedRole: 'director', status: 'pending', deadline: '2026-06-01' });
    await tx.insert(notifications).values([
      { userId: director.id, title: 'Перерасход по объекту «Речной»', body: 'Фактические затраты превышают бюджет проекта', href: '/projects/'+p2.id },
      { userId: director.id, title: 'Дефицит арматуры', body: 'Остаток ниже минимального на складе', href: '/warehouse' },
      { userId: director.id, title: 'Просроченная поставка', body: 'Заявка ЗК-2026-041 требует внимания', href: '/procurement' }
    ]);
  });
}
