import test from 'node:test';
import assert from 'node:assert/strict';
import { accountRoleOptions,administratorGrant } from '../public/js/account-forms.js';
import { fixture,request,password } from './retention-support.js';

test('board accounts default to board-member; general accounts require explicit selection and administrator confirmation',()=>{
 const roles=[{name:'administrator',label:'Administrator'},{name:'board-member',label:'Board member'}];
 assert.equal(accountRoleOptions(roles,true)[0][0],'board-member');
 assert.equal(accountRoleOptions(roles)[0][0],'');
 assert.equal(accountRoleOptions([roles[0]],true)[0][0],'');
 assert.throws(()=>administratorGrant({roleId:''},'roleId',()=>true),/Choose/);
 let confirmations=0;
 assert.throws(()=>administratorGrant({roleId:'administrator'},'roleId',()=>{confirmations++;return false;}),/not granted/);
 assert.equal(confirmations,1);
 assert.equal(administratorGrant({role:'administrator'},'role',()=>true).confirmAdministrator,true);
 assert.equal(administratorGrant({roleId:'board-member'},'roleId',()=>assert.fail()).roleId,'board-member');
});

test('backend requires administrator grant confirmation, validates role references and disallows caller permissions',async()=>{
 const {store,session}=await fixture();
 const account={name:'Synthetic new account',email:'new-account@example.test',password,roleId:'administrator'};
 const denied=await request(store,'users','POST',account,session);
 assert.equal(denied.statusCode,400);assert.equal(denied.body.error.code,'ADMINISTRATOR_CONFIRMATION_REQUIRED');
 const granted=await request(store,'users','POST',{...account,confirmAdministrator:true},session);
 assert.equal(granted.statusCode,201);
 assert.equal((await request(store,'users','POST',{...account,email:'unknown@example.test',roleId:'absent-role'},session)).statusCode,404);
 assert.equal((await request(store,'users','POST',{...account,permissions:['users.manage']},session)).statusCode,400);
 const invalid=await request(store,'roles','POST',{name:'Invalid',permissions:['unrecognized.permission']},session);
 assert.equal(invalid.statusCode,400);
});
