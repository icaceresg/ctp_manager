import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {managerNavigation} from '../client/src/navigation.js';

const root=fileURLToPath(new URL('../',import.meta.url));
test('the selected candidate ships neither PC implementation nor mobile administration modules',()=>{
 for(const filename of [
  'server/routes/pc-check.js','server/pc-check-http.js','server/pc-check.js','server/pc-check-vulnerable-drivers.catalog.json',
  'client/src/pages/PcCheckPage.jsx','client/src/operations/PcCheckPanel.jsx','client/src/operations/pc-check.css',
  'server/mobile-safety-services.js','server/mobile-safety-contract.js','server/erasure-local.js',
  'client/src/pages/AdministrationSafetyPage.jsx','client/src/pages/AvatarModerationPanel.jsx',
 ])assert.equal(fs.existsSync(path.join(root,filename)),false,filename);
 const registration=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
 assert.doesNotMatch(registration,/pcCheck|pc-check|mobile-safety/);
 const app=fs.readFileSync(path.join(root,'client/src/main.jsx'),'utf8');
 const player=fs.readFileSync(path.join(root,'client/src/pages/PlayerWorkspacePage.jsx'),'utf8');
 assert.doesNotMatch(app+player,/pc-check|PcCheck|AdministrationSafetyPage/);
 const launcher=fs.readFileSync(path.join(root,'scripts/dev-local-stack.mjs'),'utf8');
 assert.doesNotMatch(launcher,/PC_CHECK|managerPcCheck|pc-check/);
 for(const item of managerNavigation(()=>true,true,true,true))assert.ok(!item.to.startsWith('/pc-check'));
});
