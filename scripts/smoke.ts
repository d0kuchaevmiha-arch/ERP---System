import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const password = process.env.DEMO_PASSWORD ?? '';
if (!password) throw new Error('Set DEMO_PASSWORD');

async function login(email: string, pass: string) {
  const r = await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
  const json = await r.json();
  assert.equal(r.status,200,`login ${email}: ${JSON.stringify(json)}`);
  const cookie = r.headers.get('set-cookie')?.split(';')[0] || ''; assert.ok(cookie);
  return { cookie, user: json.user };
}
async function request(cookie: string, method: string, path: string, body?: unknown, expected = 201) {
  const r = await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});
  const json = await r.json(); assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);
  return { json, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

async function main() {
// Без входа данные не отдаются (§5.2.2).
for (const path of ['/api/v1/overview','/api/v1/projects','/api/admin/users']) {
  const r = await fetch(base+path); assert.equal(r.status,401,`anonymous ${path}`);
}
const page = await fetch(base+'/',{redirect:'manual'}); assert.ok([302,303,307,308].includes(page.status),'anonymous / → /login');

const { cookie } = await login('director@monolit.local', password);
const call = async (path:string, body?:Record<string,unknown>, expected=201) => (await request(cookie, body?'POST':'GET', path, body, expected)).json;
const tag=Date.now().toString(36);
const project=(await call('/api/v1/projects',{name:`Тестовый объект ${tag}`,code:`TEST-${tag}`,forecast:'10000.00'})).data;
const budget=(await call('/api/v1/budgets',{projectId:project.id,category:'Материалы',amount:'10000.00'})).data; assert.equal(budget.projectId,project.id);
const task=(await call('/api/v1/tasks',{projectId:project.id,name:'Монтаж тестовой конструкции',kind:'work'})).data;
const material=(await call('/api/v1/materials',{sku:`T-${tag}`,name:'Тестовая арматура',unit:'кг',price:'100.00',minStock:2})).data;
const warehouse=(await call('/api/v1/warehouses',{name:`Тестовый склад ${tag}`,projectId:project.id})).data;
const supplier=(await call('/api/v1/suppliers',{name:`Тестовый поставщик ${tag}`,kind:'supplier'})).data;
const purchase=(await call('/api/v1/purchases',{projectId:project.id,materialId:material.id,warehouseId:warehouse.id,supplierId:supplier.id,quantity:10,unitPrice:'100.00'})).data;
assert.equal(purchase.status,'requested');
const order=(await call('/api/v1/approvals',{purchaseId:purchase.id,decision:'approve'})).data; assert.equal(order.status,'ordered');
await call('/api/v1/approvals',{purchaseId:purchase.id,decision:'approve'},409);
await call('/api/v1/receive',{purchaseId:purchase.id,warehouseId:warehouse.id,quantity:10});
await call('/api/v1/movements',{materialId:material.id,warehouseId:warehouse.id,projectId:project.id,taskId:task.id,type:'issue',quantity:3});
await call('/api/v1/progress',{taskId:task.id,progress:75,actualQuantity:3});
await call('/api/v1/expenses',{projectId:project.id,category:'Работы',description:'Тестовые монтажные работы',amount:'250.00'});
const overview=await call('/api/v1/overview',undefined,200);
const row=overview.projects.find((x:{id:string})=>x.id===project.id); assert.ok(row); assert.equal(row.budget,10000); assert.equal(row.actual,550);
const balance=overview.materials.find((x:{id:string})=>x.id===material.id); assert.equal(balance.balance,7);
await call('/api/v1/movements',{materialId:material.id,warehouseId:warehouse.id,projectId:project.id,type:'issue',quantity:100},400);
assert.ok(overview.audit.some((x:{entityId:string})=>x.entityId===project.id));

// Пользователи и доступы (P1): новый прораб → временный пароль → смена → нет доступа → доступ выдан.
const created=(await request(cookie,'POST','/api/admin/users',{name:`Прораб ${tag}`,email:`foreman-${tag}@smoke.local`,role:'foreman'})).json.data;
assert.equal(created.user.mustChangePassword,true);
const foreman=await login(created.user.email, created.temporaryPassword);
assert.equal(foreman.user.mustChangePassword,true);
await request(foreman.cookie,'GET','/api/v1/overview',undefined,403);
const changed=await request(foreman.cookie,'POST','/api/auth/password',{currentPassword:created.temporaryPassword,newPassword:`smoke-${tag}-password`});
const fcookie=changed.cookie!; assert.ok(fcookie);
await request(foreman.cookie,'GET','/api/v1/overview',undefined,401); // старая сессия отозвана
const fview=(await request(fcookie,'GET','/api/v1/overview',undefined,200)).json;
assert.equal(fview.projects.some((p:{id:string})=>p.id===project.id),false,'прораб без доступа не видит объект');
await request(fcookie,'POST','/api/v1/progress',{taskId:task.id,progress:80},403);
await request(cookie,'PUT',`/api/admin/users/${created.user.id}/access/${project.id}`,{permission:'edit'});
await request(fcookie,'POST','/api/v1/progress',{taskId:task.id,progress:80});
await request(cookie,'PATCH',`/api/admin/users/${created.user.id}`,{isActive:false});
await request(fcookie,'GET','/api/v1/overview',undefined,401); // блокировка рвёт сессию

console.log('PASS: anonymous 401 → project → budget → task → purchase → approval (+409 repeat) → receipt → stock issue → progress → expense → plan/fact → audit → insufficient stock → user create → temp password → change → no access 403 → grant → block');
}
main().catch(e=>{console.error(e);process.exitCode=1});
