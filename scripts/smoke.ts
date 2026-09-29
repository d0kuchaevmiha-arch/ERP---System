import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Set DEMO_PASSWORD');
let cookie = '';
async function call(path:string, body?:Record<string,unknown>, expected=201) {
  const r = await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
  const json = await r.json(); assert.equal(r.status,expected,`${path}: ${JSON.stringify(json)}`); return json;
}
async function main() {
const login = await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'director@monolit.local',password})});
assert.equal(login.status,200,'login'); cookie=login.headers.get('set-cookie')?.split(';')[0]||''; assert.ok(cookie);
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
await call('/api/v1/receive',{purchaseId:purchase.id,warehouseId:warehouse.id,quantity:10});
await call('/api/v1/movements',{materialId:material.id,warehouseId:warehouse.id,projectId:project.id,taskId:task.id,type:'issue',quantity:3});
await call('/api/v1/progress',{taskId:task.id,progress:75,actualQuantity:3});
await call('/api/v1/expenses',{projectId:project.id,category:'Работы',description:'Тестовые монтажные работы',amount:'250.00'});
const overview=await call('/api/v1/overview',undefined,200);
const row=overview.projects.find((x:{id:string})=>x.id===project.id); assert.ok(row); assert.equal(row.budget,10000); assert.equal(row.actual,550);
const balance=overview.materials.find((x:{id:string})=>x.id===material.id); assert.equal(balance.balance,7);
await call('/api/v1/movements',{materialId:material.id,warehouseId:warehouse.id,projectId:project.id,type:'issue',quantity:100},400);
assert.ok(overview.audit.some((x:{entityId:string})=>x.entityId===project.id));
console.log('PASS: project → budget → task → purchase → approval → receipt → stock issue → progress → expense → plan/fact → audit → insufficient stock');
}
main().catch(e=>{console.error(e);process.exitCode=1});
