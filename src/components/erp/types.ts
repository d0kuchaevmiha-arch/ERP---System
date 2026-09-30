import type { Overview } from '@/lib/overview';

export type Data = Overview;
export type Project = Data['projects'][number];
export type Task = Data['tasks'][number];
export type Purchase = Data['purchases'][number];
export type Material = Data['materials'][number];
export type Expense = Data['expenses'][number];
export type Contract = Data['contracts'][number];
export type Counterparty = Data['counterparties'][number];
export type Movement = Data['movements'][number];
export type AuditRow = Data['audit'][number];
export type BudgetLine = Data['budgets'][number];

export type User = { name: string; role: string; email: string } | null;

export type ViewKey = 'today' | 'projects' | 'money' | 'supply' | 'refs' | 'sync';
export type Nav = { view: ViewKey; sub: string };

export type DrawerKind = 'project' | 'task' | 'purchase' | 'material' | 'expense' | 'contract' | 'counterparty' | 'notes';
export type DrawerRef = { kind: DrawerKind; id: string } | null;

export type CreateKind = 'project' | 'task' | 'budget' | 'expense' | 'material' | 'purchase' | 'supplier' | 'contract' | 'movement' | 'receive' | 'progress' | 'login';
export type CreateState = { kind: CreateKind; values: Record<string, string> } | null;
