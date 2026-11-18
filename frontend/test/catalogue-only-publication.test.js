import test from 'node:test';
import assert from 'node:assert/strict';
import {collectorCatalogAllowed,collectorDocumentAllowed} from '../server/lib/collector-document-policy.js';
import {catalogPayload,catalogAccess} from '../server/lib/platform-catalog-documents.js';
import {indexPlatformDocument} from '../server/lib/platform-document-rag.js';
const entry=()=>({id:'fixture',status:'approved',reviewed_by:'responsible-admin',sha256:'a'.repeat(64),manufacturer:'Fixture',model_name:'Model A',model_reference:'1234',distribution_confirmed_at:null,rag_status:'pending',
 collector_ingestion_key:'fixture',collector_metadata:{testDocument:false,phases:{storedR2:true,validated:false,indexed:false},
 identity:{manufacturer:'Fixture',model:'Model A',reference:'1234',variant:'Model A indoor'},
 rights:{status:'not_established',evidence:[]},validation:{humanValidation:'pending',distributionConfirmed:false},
 catalogPublication:{authorized:true,scope:'catalogue_only',authorizedBy:'responsible-admin',authorizedAt:'2026-11-05T12:00:00Z'},
 documentaryReview:{equipmentAssociation:'verified_in_manufacturer_validity_table',sourceSha256:'a'.repeat(64),reference:'1234',variant:'Model A indoor',versionConflict:null,evidence:{pdfPages:[1,7],note:'Explicit model and reference in manufacturer table'}}}});
test('catalogue authorisation does not assert rights or enable Shiba',async()=>{
 const e=entry();assert.equal(collectorCatalogAllowed(e),true);assert.equal(collectorDocumentAllowed(e),false);
 const db={from(){throw Error('INDEX_MUST_NOT_TOUCH_DB');}};
 assert.deepEqual(await indexPlatformDocument(db,e),{status:'validation_required'});
 const payload=catalogPayload([e],[]);assert.equal(payload.documents.length,1);
 assert.equal(payload.documents[0].document_provenance.rightsStatus,'not_established');
 assert.equal(payload.documents[0].document_provenance.catalogueOnly,true);
 assert.ok(!('collector_metadata' in payload.documents[0]));assert.ok(!('reviewed_by' in payload.documents[0]));
 assert.equal(e.collector_metadata.validation.distributionConfirmed,false);assert.equal(e.rag_status,'pending');
});
test('withdrawal, unresolved revision, actor mismatch and neighbouring identities fail closed',()=>{
 for(const change of [e=>e.status='pending_review',e=>e.collector_metadata.catalogPublication.authorized=false,
  e=>e.collector_metadata.catalogPublication.authorizedBy='other',e=>e.collector_metadata.catalogPublication.authorizedAt='invalid',
  e=>e.collector_metadata.documentaryReview.versionConflict='unresolved',e=>e.model_reference='1235',e=>e.model_name='Model B',
  e=>e.collector_metadata.identity.variant='Model A outdoor',e=>e.sha256='b'.repeat(64),
  e=>e.collector_metadata.documentaryReview.evidence.pdfPages=[0],e=>e.collector_metadata.phases.storedR2=false,e=>e.collector_metadata.testDocument=true]){
  const e=entry();change(e);assert.equal(collectorCatalogAllowed(e),false);assert.equal(catalogPayload([e],[]).documents.length,0);
 }
});
test('catalogue access still requires a verified account; incomplete MFA never grants founder override',async()=>{
 let companyCalls=0;const access=await catalogAccess({headers:{authorization:'Bearer fixture'}},{},
  async()=>({user:{id:'founder'},role:'founder',mfaRequired:true}),async()=>{companyCalls++;return null;});
 assert.equal(access,null);assert.equal(companyCalls,1);
});
