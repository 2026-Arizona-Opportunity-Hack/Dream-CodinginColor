import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator,saveUser} from '../lib/auth.js';
import {PERMISSIONS} from '../lib/permissions.js';
import {signIn} from '../tests/auth-support.js';
import {createRouter} from '../lib/api-router.js';
export const password='SyntheticMentor123!',origin='https://mentor.example.test';
export async function mentorFixture(){
 const db=await createIsolatedDatabase();await db.transaction(migrate);const store=createSqlStore(db);
 const admin={...await bootstrapAdministrator(store,{name:'Synthetic mentor admin',email:'mentor-admin@example.test',password}),administrator:true,permissions:[...PERMISSIONS]};
 const board=async(name)=>saveUser(store,admin,{name:`Synthetic ${name}`,email:`${name}@example.test`,password,roleId:'board-member',boardMember:true},new Date());
 const tx=work=>db.transaction(work),router=createRouter({database:db,store,origin});
 const session=user=>signIn(store,{email:user.email,password},'192.0.2.90',new Date());
 const call=async(path,method='GET',input={},auth,headers={})=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;this.headersSent=true;return this;}};
  const request={method,query:{...input,route:path},body:input,headers:{origin,'content-type':'application/json',...(auth?{cookie:`__Host-colorloop=${auth.token}`,'x-csrf-token':auth.csrfToken}:{}),...headers},socket:{remoteAddress:'192.0.2.90'}};await router(request,res);return res;};
 return {db,store,admin,board,tx,session,call};
}
