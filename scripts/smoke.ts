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

// Минимальный SSE-клиент на fetch: next(event) ждёт ближайшее событие с этим именем.
async function openEvents(cookie: string) {
  const ctrl = new AbortController();
  const r = await fetch(base+'/api/sync/events',{headers:{cookie,accept:'text/event-stream'},signal:ctrl.signal});
  assert.equal(r.status,200,'SSE');
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  return {
    async next(name: string, timeoutMs: number): Promise<{maxSeq:number}> {
      const until = Date.now()+timeoutMs;
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const block = buf.slice(0,i); buf = buf.slice(i+2);
          const ev = block.match(/^event: (.+)$/m)?.[1]; const data = block.match(/^data: (.+)$/m)?.[1];
          if (ev === name && data) return JSON.parse(data);
          continue;
        }
        const left = until-Date.now(); if (left <= 0) throw new Error(`SSE: нет события ${name} за ${timeoutMs} мс`);
        const chunk = await Promise.race([reader.read(), new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error(`SSE: нет события ${name} за ${timeoutMs} мс`)),left))]);
        if (chunk.done) throw new Error('SSE: поток закрыт');
        buf += chunk.value;
      }
    },
    // Дочитать поток до закрытия сервером (события пропускаются); false — не закрылся за timeoutMs.
    async untilClosed(timeoutMs: number) {
      const timeout = new Promise<'timeout'>(res => setTimeout(() => res('timeout'), timeoutMs));
      for (;;) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (chunk === 'timeout') return false;
        if (chunk.done) return true;
      }
    },
    close() { ctrl.abort(); },
  };
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

// Реальное время (P2): прораб подписан на SSE, директор вносит расход → сигнал ≤ 5 с.
const stream=await openEvents(fcookie);
await stream.next('ready',5000);
const t0=Date.now();
await call('/api/v1/expenses',{projectId:project.id,category:'Работы',description:'Сигнал реального времени',amount:'1.00'});
const signal=await stream.next('changes',5000);
const latency=Date.now()-t0;
assert.ok(signal.maxSeq>0); assert.ok(latency<=5000,`сигнал через ${latency} мс`);

// Идемпотентность (P2): тот же Idempotency-Key → одна запись и тот же ответ.
const key=crypto.randomUUID();
const idem=async()=>{ const r=await fetch(base+'/api/v1/expenses',{method:'POST',headers:{'Content-Type':'application/json',cookie,'Idempotency-Key':key},body:JSON.stringify({projectId:project.id,category:'Работы',description:`Идемпотентный расход ${tag}`,amount:'2.00'})}); assert.equal(r.status,201); return (await r.json()).data; };
const [first,second]=[await idem(),await idem()]; assert.equal(first.id,second.id);
const after=await call('/api/v1/overview',undefined,200);
assert.equal(after.expenses.filter((e:{description:string})=>e.description===`Идемпотентный расход ${tag}`).length,1);

// Офлайн-ввод (P4): устройство прораба → вход устройства → push (applied, конфликт остатка, online_only) → повтор → разбор.
const fpass=`smoke-${tag}-password`;
const sync={'Content-Type':'application/json','X-Sync-Protocol':'1'};
const dev=await fetch(base+'/api/auth/device',{method:'POST',headers:sync,body:JSON.stringify({email:created.user.email,password:fpass,deviceName:`smoke ${tag}`,appVersion:'smoke'})});
assert.equal(dev.status,201,'регистрация устройства'); const {token}=await dev.json();
const auth={...sync,Authorization:`Bearer ${token}`};
const verify=async(pass:string)=>fetch(base+'/api/auth/device/verify',{method:'POST',headers:auth,body:JSON.stringify({password:pass})});
assert.equal((await verify(fpass)).status,200,'вход устройства');
assert.equal((await (await verify('неверный-пароль')).json()).error.code,'bad_password');
const expenseId=crypto.randomUUID(), issueId=crypto.randomUUID();
const at=new Date(Date.now()-60_000).toISOString();
const ops=[
  {opId:crypto.randomUUID(),command:'expenses.create',payload:{id:expenseId,projectId:project.id,category:'Прочее',description:`Офлайн-расход ${tag}`,amount:'10.00'},deviceCreatedAt:at},
  {opId:crypto.randomUUID(),command:'movements.create',payload:{id:issueId,materialId:material.id,warehouseId:warehouse.id,type:'issue',quantity:10},deviceCreatedAt:at},
  {opId:crypto.randomUUID(),command:'budgets.create',payload:{projectId:project.id,category:'Прочее',amount:'1.00'},deviceCreatedAt:at},
];
const push=async()=>{ const r=await fetch(base+'/api/sync/push',{method:'POST',headers:auth,body:JSON.stringify({ops})}); assert.equal(r.status,200,'push'); return (await r.json()).results; };
const pushed=await push();
assert.deepEqual(pushed.map((x:{status:string})=>x.status),['applied','conflict','rejected']);
assert.equal(pushed[0].entityId,expenseId); assert.equal(pushed[1].error.code,'insufficient_stock'); assert.equal(pushed[2].error.code,'online_only');
assert.deepEqual(await push(),pushed,'повтор пакета — те же ответы');
assert.equal((await fetch(base+'/api/sync/push',{method:'POST',headers:sync,body:JSON.stringify({ops})})).status,401,'push без токена');
assert.equal((await fetch(base+'/api/sync/push',{method:'POST',headers:{...auth,'X-Sync-Protocol':'0'},body:JSON.stringify({ops})})).status,426,'push со старым протоколом');
const conflicts=(await call('/api/v1/overview',undefined,200)).conflicts;
assert.ok(conflicts.some((c:{id:string;status:string})=>c.id===pushed[1].conflictId&&c.status==='open'),'конфликт в «Требует решения»');
await call('/api/v1/conflict-resolve',{conflictId:pushed[1].conflictId,quantity:2});
await call('/api/v1/conflict-discard',{conflictId:pushed[1].conflictId,comment:'повтор'},409);
const settled=await push(); assert.equal(settled[1].status,'applied'); assert.equal(settled[1].entityId,issueId);
const stock=(await call('/api/v1/overview',undefined,200)).materials.find((x:{id:string})=>x.id===material.id); assert.equal(stock.balance,5);

await request(cookie,'PATCH',`/api/admin/users/${created.user.id}`,{isActive:false});
await request(fcookie,'GET','/api/v1/overview',undefined,401); // блокировка рвёт сессию
assert.equal(await stream.untilClosed(5000),true,'SSE заблокированного пользователя закрывается');
stream.close();
assert.equal((await (await verify(fpass)).json()).error.code,'device_revoked','блокировка отзывает устройство');

console.log(`PASS: anonymous 401 → project → budget → task → purchase → approval (+409 repeat) → receipt → stock issue → progress → expense → plan/fact → audit → insufficient stock → user create → temp password → change → no access 403 → grant → SSE signal in ${latency} ms → idempotent repeat → device verify → push applied/conflict/online_only (+repeat, 401, 426) → conflict resolve → block → device revoked`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
