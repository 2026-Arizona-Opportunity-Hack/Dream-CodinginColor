import {saveUser,validatePassword,verifyPassword} from './auth.js';
import {createSqlStore} from './retention-sql-store.js';
import {assertJudgeDatabase} from './judge-deployment.js';
import {JUDGE_PERMISSIONS} from './judge-provision.js';
import {DataError} from './data-validation.js';
export const JUDGE_LOGIN_EMAIL='judge123@gmail.com';
export async function updateJudgeAccount(database,configuration,privateConfig,index,password){
 validatePassword(password);
 if(password.length<20)throw new DataError('JUDGE_PASSWORD_POLICY','Use at least 20 characters.');
 const entry=privateConfig.judges?.[index];
 if(!entry||entry.email.toLowerCase()===JUDGE_LOGIN_EMAIL)throw new DataError('JUDGE_UPDATE_REFUSED','Choose an existing, not-yet-updated judge entry.');
 return database.transaction(async query=>{
  await assertJudgeDatabase(query,configuration);
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const operator=(await query("SELECT u.* FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=$1 AND u.active AND r.active AND r.id='administrator'",[privateConfig.operator.email.toLowerCase()])).rows[0];
  if(!operator||!await verifyPassword(privateConfig.operator.password,operator.password_hash))throw new DataError('JUDGE_UPDATE_REFUSED','Private operator credentials must match an active judge-database administrator.');
  const target=(await query('SELECT * FROM users WHERE email=$1 AND active FOR UPDATE',[entry.email.toLowerCase()])).rows[0];
  if(!target||target.id===operator.id||target.board_member||target.role_id==='administrator')throw new DataError('JUDGE_UPDATE_REFUSED','Target must be an existing active judge account.');
  const permissions=(await query('SELECT permission_name FROM role_permissions WHERE role_id=$1',[target.role_id])).rows.map(r=>r.permission_name);
  if(permissions.length!==JUDGE_PERMISSIONS.length||!permissions.every(p=>JUDGE_PERMISSIONS.includes(p)))throw new DataError('JUDGE_UPDATE_REFUSED','Target role must retain the restricted Judge Demo permissions.');
  const store=createSqlStore({transaction:work=>work(query)});
  await saveUser(store,{id:operator.id,roleId:'administrator',administrator:true},{id:target.id,email:JUDGE_LOGIN_EMAIL,password},new Date(),true);
  return {id:target.id,email:JUDGE_LOGIN_EMAIL};
 });
}
