import type { TemplateRecord } from './types';

export const OFFICIAL_TEMPLATE_INDEX_URL = 'https://www.pcc.gov.tw/content/index?eid=10146&lang=1&type=C';
export const PCC_CANDIDATE_PULL_REQUESTS_URL = 'https://github.com/Harry5450/gov-procurement-assistant/pulls?q=is%3Apr+head%3Aautomation%2Fpcc-template-update+sort%3Aupdated-desc';
export const PCC_TEMPLATE_WATCHER_ACTIONS_URL = 'https://github.com/Harry5450/gov-procurement-assistant/actions/workflows/pcc-template-watcher.yml';
export const PCC_TEMPLATE_PROMOTION_ACTIONS_URL = 'https://github.com/Harry5450/gov-procurement-assistant/actions/workflows/pcc-template-promote.yml';

// Only versions approved for production output belong here. The PCC watcher
// archives candidates but never edits this active registry automatically.
// Verified against the archived official files and writer tests on 2026-08-28.
export const templateRegistry: TemplateRecord[] = [
  {
    id: 'tender-instructions',
    name: '投標須知範本',
    category: 'common',
    officialDate: '115/07/27',
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
