import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'protocolRegistry.json');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export class ProtocolRegistryService {
  constructor() {
    this.entries = this.loadRegistry();
  }

  loadRegistry() {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw);
  }

  all() {
    return [...this.entries];
  }

  getById(id) {
    const key = normalize(id);
    return this.entries.find((entry) => normalize(entry.id) === key) || null;
  }

  findByProjectName(name) {
    const key = normalize(name);
    if (!key) return null;
    return this.entries.find((entry) => {
      const names = [entry.id, entry.name, ...(entry.aliases || [])].map(normalize);
      return names.some((candidate) => key.includes(candidate) || candidate.includes(key));
    }) || null;
  }

  resolveSourceUrl(name) {
    const match = this.findByProjectName(name);
    return match?.sourceUrl || match?.appUrl || null;
  }

  resolveAppUrl(name) {
    const match = this.findByProjectName(name);
    return match?.appUrl || match?.sourceUrl || null;
  }
}

export default ProtocolRegistryService;
