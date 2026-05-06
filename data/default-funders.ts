/**
 * Default funder list. Used to seed master_default_funders on first run, and
 * cloned into a new company when it's created (master admin can opt out).
 *
 * This is a starter set — master admin can add/remove from /master/funders.
 */

export interface DefaultFunderSeed {
  name: string;
  submissionMethod: 'email' | 'portal';
  supportsReverseConsolidation: boolean;
  minRevenue: number;
  maxPositions: number;
  minCreditTier: 'unknown' | 'under_550' | '550_599' | '600_649' | '650_plus';
  notes?: string;
  tiers: string[]; // tier names — created if not present
  contacts: { name: string; email?: string; phone?: string; isPrimary?: boolean }[];
  restrictedStates: string[];
  restrictedIndustries: string[];
}

export const DEFAULT_TIERS = ['Tier 1 (A Paper)', 'Tier 2 (B Paper)', 'Tier 3 (C Paper)', 'Reverse Specialist'];

export const DEFAULT_FUNDERS: DefaultFunderSeed[] = [
  {
    name: 'Sample Funder A — Premium',
    submissionMethod: 'email',
    supportsReverseConsolidation: false,
    minRevenue: 50000,
    maxPositions: 1,
    minCreditTier: '650_plus',
    notes: 'A-paper only. Strong credit, low position count.',
    tiers: ['Tier 1 (A Paper)'],
    contacts: [{ name: 'Submissions', email: 'submissions@example-a.com', isPrimary: true }],
    restrictedStates: ['CA', 'NY'],
    restrictedIndustries: ['Cannabis / CBD', 'Gambling'],
  },
  {
    name: 'Sample Funder B — Mid Market',
    submissionMethod: 'email',
    supportsReverseConsolidation: true,
    minRevenue: 25000,
    maxPositions: 3,
    minCreditTier: '550_599',
    notes: 'Flexible mid-market. Reverse consolidations welcome.',
    tiers: ['Tier 2 (B Paper)', 'Reverse Specialist'],
    contacts: [{ name: 'ISO Desk', email: 'iso@example-b.com', isPrimary: true }],
    restrictedStates: [],
    restrictedIndustries: ['Auto Sales', 'Gambling'],
  },
  {
    name: 'Sample Funder C — High Risk',
    submissionMethod: 'email',
    supportsReverseConsolidation: false,
    minRevenue: 15000,
    maxPositions: 5,
    minCreditTier: 'unknown',
    notes: 'Last-resort funder. Higher factor rates expected.',
    tiers: ['Tier 3 (C Paper)'],
    contacts: [
      { name: 'Submissions', email: 'deals@example-c.com', isPrimary: true },
      { name: 'Underwriting', phone: '555-0100' },
    ],
    restrictedStates: ['CA'],
    restrictedIndustries: [],
  },
  {
    name: 'Sample Funder D — Reverse Specialist',
    submissionMethod: 'email',
    supportsReverseConsolidation: true,
    minRevenue: 30000,
    maxPositions: 99,
    minCreditTier: 'under_550',
    notes: 'Specializes in consolidation. Will take stacked positions.',
    tiers: ['Reverse Specialist'],
    contacts: [{ name: 'Deals', email: 'deals@example-d.com', isPrimary: true }],
    restrictedStates: ['NY', 'NJ', 'CT'],
    restrictedIndustries: [],
  },
  {
    name: 'Sample Funder E — Portal Only',
    submissionMethod: 'portal',
    supportsReverseConsolidation: false,
    minRevenue: 40000,
    maxPositions: 2,
    minCreditTier: '600_649',
    notes: 'Portal submission only — no email. Login at example-e.com/iso',
    tiers: ['Tier 1 (A Paper)', 'Tier 2 (B Paper)'],
    contacts: [{ name: 'ISO Support', email: 'support@example-e.com' }],
    restrictedStates: [],
    restrictedIndustries: ['Restaurant'],
  },
];
