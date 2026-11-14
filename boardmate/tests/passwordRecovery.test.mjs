import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordRecovery, recoveryRequestMessage, recoveryErrorMessage } from '../src/lib/passwordRecovery.js';

function fixture(email='member@gmail.com') {
 let time=1_800_000_000_000, session=null, storedPassword='old-password', updated=0, requests=0;
 const user={ id:'member', email }, calls=[];
 const client={ auth:{
  resetPasswordForEmail:async destination=>{ requests++; calls.push(['request',destination]); return {}; },
  verifyOtp:async args=>{ calls.push(['verify',args]); if(args.token!=='012345') return { error:{code:'otp_expired'} }; session={access_token:'recovery-only',expires_at:time/1000+3600}; return {data:{user,session}}; },
  getSession:async()=>({data:{session}}),getUser:async()=>({data:{user}}),
  updateUser:async ({password})=>{ updated++; storedPassword=password; return {data:{user}}; },
  signOut:async options=>{ calls.push(['logout',options.scope]); session=null; return {}; },
  signInWithPassword:async ({password})=>({error:password===storedPassword?null:{code:'invalid_credentials'}}),
 }};
 return { client,calls,controller:createPasswordRecovery(client,()=>time),advance:ms=>{time+=ms;},stats:()=>({updated,requests}) };
}
for (const [role,email] of [['User','member@gmail.com'],['Owner','owner@outlook.com']]) test(`${role}: recovery targets actual normalized email, updates password, signs out, and new password logs in (mock Auth)`,async()=>{
 const f=fixture(email);
 assert.equal(await f.controller.request(` ${email.toUpperCase()} `),recoveryRequestMessage);
 assert.deepEqual(f.calls[0],['request',email]);
 await f.controller.verify('012345');
 assert.deepEqual(f.calls[1],['verify',{email,token:'012345',type:'recovery'}]);
 await f.controller.reset('new-password','new-password');
 assert.equal(f.stats().updated,1);
 assert.ok(f.calls.some(c=>c[0]==='logout'&&c[1]==='global'));
 assert.equal((await f.client.auth.signInWithPassword({password:'new-password'})).error,null);
 assert.ok((await f.client.auth.signInWithPassword({password:'old-password'})).error);
 await assert.rejects(f.controller.reset('another-pass','another-pass'),e=>e.code==='recovery_session_required');
});
test('unknown addresses and account-specific request errors have identical generic response',async()=>{
 for(const response of [{},{error:{code:'user_not_found',message:'No account'}},{error:{status:500,message:'SMTP details'}}]) {
  const f=fixture('unknown@yahoo.com');f.client.auth.resetPasswordForEmail=async()=>response;
  assert.equal(await f.controller.request('unknown@yahoo.com'),recoveryRequestMessage);
 }
});
test('incorrect/expired codes cannot update a password; verify requires six digits',async()=>{
 const f=fixture();await f.controller.request('member@gmail.com');
 await assert.rejects(f.controller.verify('12345'));
 await assert.rejects(f.controller.verify('999999'),e=>e.code==='otp_expired');
 await assert.rejects(f.controller.reset('new-password','new-password'),e=>e.code==='recovery_session_required');
 assert.equal(f.stats().updated,0);
 assert.match(recoveryErrorMessage({code:'otp_expired'}),/incorrect or expired/);
});
test('cooldown, resend and server limits; resend clears previous recovery proof',async()=>{
 const f=fixture();await f.controller.request('member@gmail.com');await f.controller.verify('012345');
 await assert.rejects(f.controller.request('member@gmail.com'),e=>e.code==='cooldown');
 f.advance(60001);await f.controller.request('member@gmail.com');
 await assert.rejects(f.controller.reset('new-password','new-password'));
 assert.equal(f.stats().requests,2);
 f.advance(60001);f.client.auth.resetPasswordForEmail=async()=>({error:{status:429}});
 await assert.rejects(f.controller.request('member@gmail.com'),e=>e.status===429);
 assert.match(recoveryErrorMessage({status:429}),/Too many/);
});
test('ordinary existing session, mismatched email/user/token and expired recovery grant are denied',async()=>{
 const f=fixture();
 await assert.rejects(f.controller.reset('new-password','new-password'));
 await f.controller.request('member@gmail.com');await f.controller.verify('012345');
 f.client.auth.getUser=async()=>({data:{user:{id:'other',email:'member@gmail.com'}}});
 await assert.rejects(f.controller.reset('new-password','new-password'),e=>e.code==='recovery_session_required');
 const g=fixture();await g.controller.request('member@gmail.com');await g.controller.verify('012345');
 g.advance(600001);await assert.rejects(g.controller.reset('new-password','new-password'));
 assert.equal(g.stats().updated,0);
 const h=fixture();await h.controller.request('member@gmail.com');
 h.client.auth.verifyOtp=async()=>({data:{session:{access_token:'x',expires_at:9999999999},user:{id:'x',email:'other@gmail.com'}}});
 await assert.rejects(h.controller.verify('012345'));
});
test('password confirmation, policy, cancellation and session invalidation',async()=>{
 const f=fixture();await f.controller.request('member@gmail.com');await f.controller.verify('012345');
 await assert.rejects(f.controller.reset('new-password','different'),e=>e.code==='password_mismatch');
 await assert.rejects(f.controller.reset('short','short'),e=>e.code==='invalid_password');
 await assert.rejects(f.controller.reset('x'.repeat(73),'x'.repeat(73)),e=>e.code==='invalid_password');
 await f.controller.cancel();await assert.rejects(f.controller.reset('new-password','new-password'));
 assert.equal(f.stats().updated,0);
});

test('swapped sessions and invalid server sessions cannot change passwords',async()=>{
 for(const method of ['getSession','getUser']){
  const f=fixture();await f.controller.request('member@gmail.com');await f.controller.verify('012345');
  f.client.auth[method]=async()=>method==='getSession'?{data:{session:{access_token:'ordinary-session'}}}:{error:{code:'bad_jwt'}};
  await assert.rejects(f.controller.reset('new-password','new-password'),e=>e.code==='recovery_session_required');
  assert.equal(f.stats().updated,0);
 }
});
test('server password policy failure does not claim success; local cleanup follows global signout failure',async()=>{
 const f=fixture();await f.controller.request('member@gmail.com');await f.controller.verify('012345');
 const update=f.client.auth.updateUser;
 f.client.auth.updateUser=async()=>({error:{code:'weak_password',message:'Password does not meet policy'}});
 await assert.rejects(f.controller.reset('new-password','new-password'),e=>e.code==='weak_password');
 f.client.auth.updateUser=update;
 f.client.auth.signOut=async options=>{f.calls.push(['logout',options.scope]);return options.scope==='global'?{error:{status:503}}:{};};
 await f.controller.reset('new-password','new-password');
 assert.deepEqual(f.calls.slice(-2),[['logout','global'],['logout','local']]);
});
