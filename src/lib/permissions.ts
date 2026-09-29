// Клиентское зеркало правил из API (src/app/api/v1/[resource]/route.ts и session.ts).
// Служит только для того, чтобы не показывать недоступные действия; настоящая проверка остаётся на сервере.
export type Ability = 'write' | 'decide';

const WRITE_ROLES = ['super_admin', 'director', 'project_manager', 'construction_manager', 'foreman', 'procurement_manager', 'warehouse_manager', 'finance_manager', 'accountant'];
// «Согласовать заявку» и «Принять поставку» на сервере разрешены только этим ролям.
const DECIDE_ROLES = ['director', 'super_admin', 'project_manager', 'procurement_manager'];

export function can(role: string | undefined | null, ability: Ability): boolean {
  if (!role) return false;
  return (ability === 'write' ? WRITE_ROLES : DECIDE_ROLES).includes(role);
}

export const roleLabel: Record<string, string> = {
  super_admin: 'Администратор',
  director: 'Директор',
  project_manager: 'Руководитель проекта',
  construction_manager: 'Начальник участка',
  foreman: 'Прораб',
  procurement_manager: 'Снабженец',
  warehouse_manager: 'Кладовщик',
  finance_manager: 'Финансовый менеджер',
  accountant: 'Бухгалтер',
  read_only: 'Просмотр',
};
