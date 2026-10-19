import { Router } from 'express';
import { requireAuth,requireAdmin } from '../auth.js';
import { queryAdministration,proposeAdministration } from '../administration.js';
import { integrationServicesStatus,ownerAction,uploadAdministrationImage } from '../administration-services.js';
import { crmAction } from '../crm.js';

export const administrationRouter=Router();
administrationRouter.use('/administration',requireAuth,requireAdmin);
administrationRouter.get('/administration',async(req,res)=>res.json(await queryAdministration(req.user,req.query)));
administrationRouter.post('/administration/commands',(req,res)=>res.json(proposeAdministration(req.user,req.body||{})));
administrationRouter.get('/administration/integrations',async(req,res)=>res.json(await integrationServicesStatus(req.user)));
administrationRouter.post('/administration/integrations/twitch',async(req,res)=>res.json(await ownerAction(req)));
administrationRouter.post('/administration/crm',async(req,res)=>res.json(await crmAction(req.user,req.body||{})));
administrationRouter.post('/administration/images',async(req,res)=>res.json(await uploadAdministrationImage(req.user,req.body)));
