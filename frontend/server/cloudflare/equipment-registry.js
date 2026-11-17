import { env } from 'cloudflare:workers';
import { equipmentMetadataRegistry } from '../lib/equipment-metadata.generated.js';
import manifest from './rag-manifest.json' with { type: 'json' };
import { loadPrivateRag } from './rag-loader.js';

export const generatedEquipmentRegistry = equipmentMetadataRegistry.map(entry => ({
  equipmentData: entry.equipmentData,
  async loadRagData() {
    const record = manifest.find(item => item.equipmentId === entry.equipmentData.equipmentId);
    return loadPrivateRag(env.ASSETS, record);
  },
}));
