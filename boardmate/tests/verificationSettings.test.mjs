import test from 'node:test';
import assert from 'node:assert/strict';
import { isVerificationNotification, restrictedVerificationMessage, isVerificationAccessError, correctedVerificationProfile } from '../src/lib/verificationSettings.js';
test('new and legacy account decision notifications select the settings section, without misrouting content notices',()=>{
 for(const target_type of ['profile','account_verification'])assert.equal(isVerificationNotification({target_type}),true);
 assert.equal(isVerificationNotification({title:'Your account has been approved'}),true);
 assert.equal(isVerificationNotification({target_type:'listing',title:'Your listing has been approved'}),false);
 assert.match(restrictedVerificationMessage,/Settings & Privacy → Account Verification/);
});
test('correction responses update only the intended current profile and preserve contact and verification fields',()=>{
 const current={id:'member',role:'LANDLORD',email:'owner@example.com'};
 assert.equal(correctedVerificationProfile(current,{id:'other'}),current);
 const result=correctedVerificationProfile(current,{id:'member',full_name:'Corrected',phone:'09123456789',verification_status:'pending',verification_revision:'new',id_document_path:'private/id',selfie_document_path:'private/selfie'});
 assert.equal(result.role,current.role);assert.equal(result.email,current.email);assert.equal(result.phone,'09123456789');assert.equal(result.verificationStatus,'pending');
});

test('denied restricted actions use contextual settings guidance without changing approved or unrelated errors',()=>{
 assert.equal(isVerificationAccessError({code:'42501'},'pending'),true);
 assert.equal(isVerificationAccessError({message:'Account must be approved'},'rejected'),true);
 assert.equal(isVerificationAccessError({message:'Network disconnected'},'pending'),false);
 assert.equal(isVerificationAccessError({code:'42501'},'approved'),false);
});
