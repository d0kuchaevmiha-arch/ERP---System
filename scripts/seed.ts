import { seedDemo } from '../src/lib/seed';
import { pool } from '../src/db';
seedDemo().then(()=>console.log('Demo data ready. Login: director@monolit.local; password: DEMO_PASSWORD from environment.')).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
