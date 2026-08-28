import Dexie, { type Table } from 'dexie';
import { normalizeProcurementCase } from './case-workflow';
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
    // v2 only adds workflow metadata and field provenance.  The existing
    // indexes remain valid; the upgrade normalizes each old flat case without
    // replacing user-entered values or touching template records.
    this.version(2)
      .stores({
        cases: 'id, title, category, updatedAt, securityLevel, workflowStage, intakeMode',
        templates: 'id, category, officialDate, status',
      })
      .upgrade((transaction) =>
        transaction.table('cases').toCollection().modify((record) => {
          Object.assign(record, normalizeProcurementCase(record as Partial<ProcurementCase>));
        }),
      );
  }
}

export const db = new ProcurementDB();

export async function upsertCase(procurementCase: ProcurementCase) {
  const normalized = normalizeProcurementCase(procurementCase);
  await db.cases.put({ ...normalized, updatedAt: new Date().toISOString() });
}

export async function listCases() {
  const cases = await db.cases.orderBy('updatedAt').reverse().toArray();
  return cases.map((procurementCase) => normalizeProcurementCase(procurementCase));
}

export async function deleteCase(id: string) {
  await db.cases.delete(id);
}
