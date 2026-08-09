import type { TemplateRecord } from './types';

export const OFFICIAL_TEMPLATE_INDEX_URL = 'https://www.pcc.gov.tw/content/index?eid=10146&lang=1&type=C';

// Seed only. Production should refresh via PCC watcher and keep immutable historical versions.
// Verified against the PCC official index on 2026-08-09.
export const templateRegistry: TemplateRecord[] = [
  {
    id: 'tender-instructions',
    name: '投標須知範本',
    category: 'common',
    officialDate: '114/12/31',
    sourceUrl: OFFICIAL_TEMPLATE_INDEX_URL,
    status: 'active',
  },
  {
    id: 'service-contract',
    name: '勞務採購契約範本',
    category: 'service',
    officialDate: '114/12/31',
    sourceUrl: OFFICIAL_TEMPLATE_INDEX_URL,
    status: 'active',
  },
  {
    id: 'goods-contract',
    name: '財物採購契約範本',
    category: 'goods',
    officialDate: '114/12/30',
    sourceUrl: OFFICIAL_TEMPLATE_INDEX_URL,
    status: 'active',
  },
  {
    id: 'construction-contract',
    name: '工程採購契約範本',
    category: 'construction',
    officialDate: '114/12/30',
    sourceUrl: OFFICIAL_TEMPLATE_INDEX_URL,
    status: 'active',
  },
];
