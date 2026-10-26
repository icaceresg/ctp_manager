import test from 'node:test';
import assert from 'node:assert/strict';
import { profileChanges } from '../client/src/pages/userProfileModel.js';

const profile = { username:'Jugador',email:'jugador@example.invalid',gamertag:'José Pérez',activision_id:'José#1234567',platform:'PC',discord:null,twitter:null,bio:null,birthdate:null,role:'player',manager_version:3 };
const form = changes => ({...Object.fromEntries(Object.entries(profile).map(([key,value])=>[key,value??''])),...changes});
test('editing only ActivisionID preserves Unicode, optional suffix, and other account data',()=>{
  for (const value of ['José Pérez','José#1234567','王者','Jose\u0301']) {
    const previous = {...profile,activision_id:'Anterior#123'};
    assert.deepEqual(profileChanges(previous,form({activision_id:` ${value} `})),{activision_id:value});
  }
  assert.deepEqual(profileChanges(profile,form({activision_id:''})),{activision_id:''});
  assert.deepEqual(profileChanges(profile,form({activision_id:' José#1234567 '})),{});
});
test('the account form cannot smuggle roles, wins or another target in its patch',()=>{
  assert.deepEqual(profileChanges(profile,form({activision_id:'Nuevo',role:'admin',wins:999,user_id:'another-id',manager_version:900})),{activision_id:'Nuevo'});
  assert.equal(profile.manager_version,3);
});
