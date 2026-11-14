import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionIdentity, validateCorrections, loadVerificationHistory } from '../src/lib/verificationCorrections.js';
const identity={full_name:' Corrected Name ',phone:'09123456789',gender:'Female',dob:'2000-01-01',business_name:'House',address:'Manila',gov_id_number:'1234',property_type:'Apartment'};
test('correction whitelist excludes email/role and validates User/Owner input',()=>{
 assert.equal(correctionIdentity({email:'protected',role:'ADMIN'}).role,undefined);
 for(const role of ['RENTER','LANDLORD'])assert.equal(validateCorrections(identity,role).full_name,'Corrected Name');
 for(const invalid of [{...identity,dob:'2999-01-01'},{...identity,dob:'2001-02-29'},{...identity,phone:'abcd12345678'},{...identity,full_name:''}])assert.throws(()=>validateCorrections(invalid,'RENTER'));
 assert.throws(()=>validateCorrections({...identity,business_name:''},'LANDLORD'));
});
test('history pagination remains read-only, filters ownership and preserves previous decisions',async()=>{
 const rows=Array.from({length:53},(_,i)=>({revision:String(i),user_id:'member',reason:'original feedback',profile_snapshot:{full_name:'Original name'}}));
 let reads=0;
 const client={from(table){assert.equal(table,'boardmate_verification_submissions');const q={select(){return q;},eq(key,value){assert.equal(key,'user_id');assert.equal(value,'member');return q;},order(){return q;},async range(start,end){reads++;return {data:rows.slice(start,end+1)};}};return q;}};
 const result=await loadVerificationHistory(client,'member');assert.equal(result.length,53);assert.equal(reads,2);assert.equal(result[0].reason,'original feedback');
 rows[0].user_id='other';await assert.rejects(loadVerificationHistory(client,'member'),/ownership/);
});
