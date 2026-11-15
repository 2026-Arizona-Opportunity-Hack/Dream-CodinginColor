import 'dotenv/config';
import { bootstrapAdministrator } from '../lib/auth.js';
import { getStore } from '../lib/retention-store.js';
import { close } from '../lib/db.js';
if(process.env.BOOTSTRAP_ADMIN !== 'true')throw new Error('Explicit BOOTSTRAP_ADMIN=true is required for this operator command.');
try {
  await bootstrapAdministrator(getStore(),{name:process.env.ADMIN_NAME,email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  console.log('Administrator created. Remove the bootstrap password from the environment.');
}catch{console.error('Bootstrap failed. Verify migrations, an empty account store, and the operator environment privately.');process.exitCode=1;}
finally{await close();}
