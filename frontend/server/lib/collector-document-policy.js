// Bridge-origin records need documentary validation in addition to publication.
// Legacy manually managed records retain their existing authorization checks.
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
// Catalogue consultation is an explicit administrative decision, separate from
// rights evidence and Shiba validation. Never reuse this gate in the indexer.
export function collectorCatalogAllowed(entry) {
  if (collectorDocumentAllowed(entry)) return true;
  const m=entry.collector_metadata,p=m?.catalogPublication,t=m?.documentaryReview,i=m?.identity;
  return entry.status==='approved' && m?.testDocument!==true && m?.phases?.storedR2===true
    && p?.authorized===true && p.scope==='catalogue_only' && !!p.authorizedBy
    && p.authorizedBy===entry.reviewed_by && Number.isFinite(Date.parse(p.authorizedAt||''))
    && t?.equipmentAssociation==='verified_in_manufacturer_validity_table'
    && t.sourceSha256===entry.sha256 && !t.versionConflict
    && Array.isArray(t.evidence?.pdfPages) && t.evidence.pdfPages.length>0
    && t.evidence.pdfPages.every(n=>Number.isInteger(n)&&n>0)
    && typeof t.evidence.note==='string' && t.evidence.note.length>=10
    && !!i?.reference && !!i?.variant && !!i?.model
    && i.reference===t.reference && i.reference===entry.model_reference
    && norm(i.variant)===norm(t.variant) && norm(i.model)===norm(entry.model_name)
    && norm(i.manufacturer)===norm(entry.manufacturer);
}
export function collectorDocumentAllowed(entry,reference) {
  const m=entry.collector_metadata;
  if(!m)return !entry.collector_ingestion_key;
  if (collectorDelegatedTechnicalAllowed(entry, reference)) return true;
  const v=m.validation;
  return m.testDocument!==true&&m.phases?.validated===true&&m.phases?.storedR2===true
    &&v?.humanValidation==='validated'&&v.manufacturerApplicability==='verified'
    &&v.distributionConfirmed===true&&v.sha256===entry.sha256&&!!v.validatedBy&&!!v.validatedAt
    &&Array.isArray(v.evidence)&&v.evidence.length>0&&v.evidence.every(e=>Number.isInteger(e.pdfPage)&&e.pdfPage>0)
    &&norm(m.identity?.reference)===norm(entry.model_reference)
    &&norm(m.identity?.manufacturer)===norm(entry.manufacturer)
    &&!!m.identity?.variant&&norm(v.variant)===norm(m.identity.variant)
    &&v.reference===m.identity.reference&&(!reference||norm(reference)===norm(m.identity.reference));
}
// Technical delegation is separate from a human review and from copyright evidence.
export function collectorDelegatedTechnicalAllowed(entry, reference) {
 const m=entry.collector_metadata,t=m?.technicalVerification,a=m?.processingAuthorization,i=m?.identity;
 return entry.status==='approved' && m?.testDocument!==true && m?.phases?.storedR2===true
  && m?.phases?.associated===true && t?.status==='verified' && t.sha256===entry.sha256
  && a?.scope==='catalogue_and_shiba' && a?.basis==='guy_delegation_20261105'
  && !!a.authorizedBy && a.authorizedBy===entry.reviewed_by && Number.isFinite(Date.parse(a.authorizedAt||''))
  && ['manufacturer_validity_table','manufacturer_explicit_designation'].includes(t.method)
  && Array.isArray(t.evidence) && t.evidence.length>0
  && t.evidence.every(e=>Number.isInteger(e.pdfPage)&&e.pdfPage>0&&typeof e.quote==='string'&&e.quote.includes(i?.reference))
  && !t.versionConflict && m?.rights?.status!=='restricted' && m?.rights?.status!=='prohibited'
  && !!i?.manufacturer && !!i?.model && !!i?.reference && !!i?.variant
  && t.reference===i.reference && t.variant===i.variant
  && i.reference===entry.model_reference && norm(i.model)===norm(entry.model_name)
  && norm(i.manufacturer)===norm(entry.manufacturer)
  && (!reference || norm(reference)===norm(i.reference));
}
export function collectorDocumentsShareVariant(entries) {
  const collected=entries.filter(e=>e.collector_metadata);
  if(!collected.length)return true;
  const first=collected[0].collector_metadata.identity;
  if(!first?.variant)return false;
  return entries.every(e=>e.collector_metadata
    ? norm(e.collector_metadata.identity?.variant)===norm(first.variant)
    : norm(e.model_name)===norm(first.model));
}
export function recordCollectorValidation(entry,proof,reviewerId,pageCount,now=new Date().toISOString()) {
  const m=entry.collector_metadata;
  if(!m?.identity||m.testDocument||proof?.applicabilityConfirmed!==true
    ||proof.reference!==m.identity.reference||proof.variant!==m.identity.variant
    ||typeof proof.note!=='string'||proof.note.trim().length<10||proof.note.length>1000
    ||!Array.isArray(proof.pages)||!proof.pages.length||proof.pages.length>20
    ||!proof.pages.every(p=>Number.isInteger(p)&&p>0&&p<=pageCount)||!reviewerId)throw Error('DOCUMENTARY_PROOF_REQUIRED');
  return {...m,phases:{...m.phases,validated:true},validation:{humanValidation:'validated',manufacturerApplicability:'verified',sha256:entry.sha256,reference:proof.reference,variant:proof.variant,distributionConfirmed:true,validatedBy:reviewerId,validatedAt:now,evidence:[...new Set(proof.pages)].map(pdfPage=>({pdfPage,note:proof.note.trim()}))}};
}
