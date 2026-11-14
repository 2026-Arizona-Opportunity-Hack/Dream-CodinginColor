import { bootstrapAdministrator, saveUser } from './auth.js';
import { createSqlStore } from './retention-sql-store.js';
import { createDonor, addDonation } from './donor-data.js';

export async function initializeSyntheticDemo(database, password) {
  if (!password || password.length < 15) throw new Error('Set DEMO_PASSWORD to at least 15 characters.');
  const store=createSqlStore(database);
  const admin={...await bootstrapAdministrator(store,{name:'Synthetic CIC administrator',email:'admin@example.test',password}),administrator:true};
  for (const [name,email] of [['Synthetic Board A','board-a@example.test'],['Synthetic Board B','board-b@example.test']]) {
    await saveUser(store,admin,{name,email,password,roleId:'board-member',boardMember:true},new Date());
  }
  const year=new Date().getUTCFullYear();
  for(const [index,name] of ['Synthetic Returning Donor','Synthetic Lapsed Donor','Synthetic New Donor'].entries()) {
    await database.transaction(async query=>{
      const donor=await createDonor(query,{donor_type:'person',display_name:name,normalized_email:`donor-${index}@example.test`,email_consent:true},admin.id);
      if(index!==2)await addDonation(query,{donor_id:donor.id,amount:'100.00',donation_date:`${year-2}-04-01`,source:'synthetic-demo',currency:'USD',status:'completed'});
      if(index!==1)await addDonation(query,{donor_id:donor.id,amount:'125.00',donation_date:`${year}-01-01`,source:'synthetic-demo',currency:'USD',status:'completed'});
    });
  }
  return store;
}
