import Dexie, { type Table } from 'dexie';
import type { ProcurementCase, TemplateRecord } from './types';

class ProcurementDB extends Dexie {
  cases!: Table<ProcurementCase, string>;
  templates!: Table<TemplateRecord, string>;

  constructor() {
    super('GovProcureAssistant');
    this.version(1).stores({
      cases: 'id, title, category, updatedAt, securityLevel',
      templates: 'id, category, officialDate, status',
    });
  }
}

export const db = new ProcurementDB();

export async function upsertCase(procurementCase: ProcurementCase) {
  await db.cases.put({ ...procurementCase, updatedAt: new Date().toISOString() });
}

export async function listCases() {
  return db.cases.orderBy('updatedAt').reverse().toArray();
}

export async function deleteCase(id: string) {
  await db.cases.delete(id);
}
