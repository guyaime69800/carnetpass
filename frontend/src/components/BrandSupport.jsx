import { getBrandSupport } from '../services/brandSupport';
import { selectHotlines } from '../../shared/brand-hotlines.js';

export default function BrandSupport({ brand, category, contactPacks = [], range }) {
  const old=getBrandSupport(brand,category);
  const fallback=old?.phone?{services:{unspecified:{observations:[{phone:old.phone,source:'Relevé historique CarnetPass',sourceUrl:old.source,country:'FR',recordedOn:'2026-10-20',manufacturerVerified:false,service:/technique|assistance/i.test(old.label)?'technical_professional':'unspecified'}]}}}:null;
  const packs=contactPacks.some(Boolean)?contactPacks:[fallback];
  const professional=selectHotlines(packs,{country:'FR',service:'technical_professional',range,category}).filter(c=>!c.conflict);
  const general=selectHotlines(packs,{country:'FR',service:'unspecified',range,category}).filter(c=>!c.conflict);
  const contact=professional[0]||general[0]||(!contactPacks.some(Boolean)&&old?.phone?{phone:old.phone,sourceUrl:old.source}:null);
  return <aside className="technical-catalog-brand-support" aria-label={`Assistance ${brand}`}>
    {contact?<><strong>Hotline : <a href={`tel:${contact.phone.replace(/[^+\d]/g,'')}`}>{contact.phone}</a></strong>
      {contact.sourceUrl&&/^https?:\/\//i.test(contact.sourceUrl)&&<p><a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Coordonnées et source ↗</a></p>}</>:<p>Hotline non renseignée</p>}
  </aside>;
}
