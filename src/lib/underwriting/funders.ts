/**
 * MCA funder / lender name dictionary used by the Underwriting scrub.
 *
 * This is a plain lookup table — NO AI, no network calls. A bank
 * descriptor is normalized (uppercased, punctuation stripped) and then
 * tested for the alias substrings below. A hit is the single strongest
 * signal that a recurring debit is an existing merchant cash advance.
 *
 * Aliases are matched as substrings of the normalized description, so keep
 * them specific enough to avoid false positives ("CAPITAL" alone is far
 * too generic and lives in WEAK_MCA_HINTS instead).
 *
 * Adding a funder: append to MCA_FUNDERS. Nothing else needs to change.
 */

export interface FunderEntry {
  /** Display name shown in the scrub results. */
  name: string;
  /** Normalized substrings that identify this funder in a bank descriptor. */
  aliases: string[];
}

/**
 * Known MCA / daily-and-weekly-debit funders and their common ACH
 * originator names. Ordered roughly by how often they show up on
 * statements — first match wins, so put more specific names first.
 */
export const MCA_FUNDERS: FunderEntry[] = [
  { name: 'Rapid Finance', aliases: ['RAPID FINANCE', 'RAPID CAPITAL', 'RAPIDADVANCE', 'RAPID ADVANCE'] },
  { name: 'OnDeck', aliases: ['ONDECK', 'ON DECK CAPITAL'] },
  { name: 'Forward Financing', aliases: ['FORWARD FINANCING', 'FORWARDLINE'] },
  { name: 'Fora Financial', aliases: ['FORA FINANCIAL', 'FORA FIN'] },
  { name: 'Kapitus', aliases: ['KAPITUS', 'STRATEGIC FUNDING'] },
  { name: 'Credibly', aliases: ['CREDIBLY', 'RETAIL CAPITAL'] },
  { name: 'CAN Capital', aliases: ['CAN CAPITAL', 'CANCAPITAL'] },
  { name: 'Reliant Funding', aliases: ['RELIANT FUNDING', 'RELIANT CAP'] },
  { name: 'Everest Business Funding', aliases: ['EVEREST BUSINESS', 'EVEREST FUNDING', 'EBF HOLDINGS', 'EBF PARTNERS'] },
  { name: 'Libertas Funding', aliases: ['LIBERTAS'] },
  { name: 'Fox Business Funding', aliases: ['FOX BUSINESS', 'FOX CAPITAL', 'FOX FUNDING'] },
  { name: 'Elevate Funding', aliases: ['ELEVATE FUNDING'] },
  { name: 'Cloudfund', aliases: ['CLOUDFUND', 'CLOUD FUND'] },
  { name: 'IOU Financial', aliases: ['IOU FINANCIAL', 'IOU CENTRAL'] },
  { name: 'National Funding', aliases: ['NATIONAL FUNDING'] },
  { name: 'Newtek', aliases: ['NEWTEK'] },
  { name: 'Expansion Capital', aliases: ['EXPANSION CAPITAL'] },
  { name: 'Mulligan Funding', aliases: ['MULLIGAN'] },
  { name: 'Bitty Advance', aliases: ['BITTY ADVANCE', 'BITTYADVANCE', 'BITTY'] },
  { name: 'Velocity Capital', aliases: ['VELOCITY CAPITAL', 'VELOCITY GROUP'] },
  { name: 'Wynwood Capital', aliases: ['WYNWOOD'] },
  { name: 'Slate Advance', aliases: ['SLATE ADVANCE'] },
  { name: 'Torro', aliases: ['TORRO ', 'TORRO'] },
  { name: 'Fundbox', aliases: ['FUNDBOX'] },
  { name: 'BlueVine', aliases: ['BLUEVINE', 'BLUE VINE'] },
  { name: 'Square Loans', aliases: ['SQUARE LOANS', 'SQUARE CAPITAL', 'SQUARE FINANCIAL'] },
  { name: 'PayPal Working Capital', aliases: ['PAYPAL WORKING', 'PAYPAL LOANBUILDER', 'LOANBUILDER'] },
  { name: 'Shopify Capital', aliases: ['SHOPIFY CAPITAL'] },
  { name: 'Clearco', aliases: ['CLEARCO', 'CLEARBANC'] },
  { name: 'Headway Capital', aliases: ['HEADWAY CAPITAL'] },
  { name: 'Greenbox Capital', aliases: ['GREENBOX', 'GREEN BOX CAPITAL'] },
  { name: 'Yellowstone Capital', aliases: ['YELLOWSTONE'] },
  { name: 'World Business Lenders', aliases: ['WORLD BUSINESS LENDERS', 'WBL '] },
  { name: 'Pearl Capital', aliases: ['PEARL CAPITAL', 'PEARL BETA', 'PEARL DELTA'] },
  { name: 'ByzFunder', aliases: ['BYZFUNDER', 'BYZ FUNDER'] },
  { name: 'Diesel Funding', aliases: ['DIESEL FUNDING'] },
  { name: 'Legend Advance', aliases: ['LEGEND ADVANCE', 'LEGEND FUNDING'] },
  { name: 'Lendini', aliases: ['LENDINI'] },
  { name: 'LG Funding', aliases: ['LG FUNDING'] },
  { name: 'Queen Funding', aliases: ['QUEEN FUNDING'] },
  { name: 'Samson MCA', aliases: ['SAMSON MCA', 'SAMSON HORUS', 'SAMSON GROUP'] },
  { name: 'Spartan Capital', aliases: ['SPARTAN CAPITAL'] },
  { name: 'Unique Funding Solutions', aliases: ['UNIQUE FUNDING'] },
  { name: 'Vitalcap', aliases: ['VITALCAP', 'VITAL CAP'] },
  { name: 'Arsenal Funding', aliases: ['ARSENAL FUNDING'] },
  { name: 'BizFund', aliases: ['BIZFUND', 'BIZ FUND'] },
  { name: 'Cedar Advance', aliases: ['CEDAR ADVANCE'] },
  { name: 'Dynasty Capital', aliases: ['DYNASTY CAPITAL'] },
  { name: 'First Down Funding', aliases: ['FIRST DOWN FUNDING'] },
  { name: 'Flexibility Capital', aliases: ['FLEXIBILITY CAPITAL'] },
  { name: 'FundKite', aliases: ['FUNDKITE', 'FUND KITE'] },
  { name: 'Fundry', aliases: ['FUNDRY', 'ENVIRONMENTAL FUNDING'] },
  { name: 'Global Funding Experts', aliases: ['GLOBAL FUNDING EXPERTS', 'GFE HOLDINGS'] },
  { name: 'Green Note Capital', aliases: ['GREEN NOTE'] },
  { name: 'Idea Financial', aliases: ['IDEA FINANCIAL'] },
  { name: 'InAdvance Capital', aliases: ['INADVANCE CAPITAL', 'IN ADVANCE CAPITAL'] },
  { name: 'Influx Capital', aliases: ['INFLUX CAPITAL'] },
  { name: 'Jet Capital', aliases: ['JET CAPITAL'] },
  { name: 'Kalamata Capital', aliases: ['KALAMATA'] },
  { name: 'Knight Capital Funding', aliases: ['KNIGHT CAPITAL'] },
  { name: 'Last Chance Funding', aliases: ['LAST CHANCE FUNDING', 'LCF GROUP'] },
  { name: 'Lendr', aliases: ['LENDR '] },
  { name: 'Merchant Capital Source', aliases: ['MERCHANT CAPITAL SOURCE'] },
  { name: 'Nexi / NextWave', aliases: ['NEXTWAVE FUNDING', 'NEXI FUNDING'] },
  { name: 'Parkview Advance', aliases: ['PARKVIEW ADVANCE'] },
  { name: 'Pinnacle Business Funding', aliases: ['PINNACLE BUSINESS FUNDING'] },
  { name: 'Proto Financial', aliases: ['PROTO FINANCIAL'] },
  { name: 'Reef Capital', aliases: ['REEF CAPITAL'] },
  { name: 'Rocket Capital', aliases: ['ROCKET CAPITAL'] },
  { name: 'Silverline Services', aliases: ['SILVERLINE SERVICES'] },
  { name: 'Specialty Capital', aliases: ['SPECIALTY CAPITAL'] },
  { name: 'Vader Mountain Capital', aliases: ['VADER MOUNTAIN'] },
  { name: 'Wall Street Funding', aliases: ['WALL STREET FUNDING'] },
  { name: 'White Road Capital', aliases: ['WHITE ROAD CAPITAL', 'WRC FUNDING'] },
  { name: 'Advance Servicing / ACS', aliases: ['ADVANCE SERVICING', 'ACS ADVANCE'] },
  { name: 'Merchant Cash & Capital', aliases: ['MERCHANT CASH AND CAPITAL', 'MERCHANT CASH & CAPITAL', 'BIZFI'] },
  { name: 'Berkshire Capital Funding', aliases: ['BERKSHIRE CAPITAL FUNDING'] },
  { name: 'Cardinal Equity', aliases: ['CARDINAL EQUITY'] },
  { name: 'Alpine Advance', aliases: ['ALPINE ADVANCE'] },
  { name: 'Atlas Advance', aliases: ['ATLAS ADVANCE'] },
  { name: 'Bluestar Advance', aliases: ['BLUESTAR ADVANCE', 'BLUE STAR ADVANCE'] },
  { name: 'Emerald Capital', aliases: ['EMERALD CAPITAL'] },
  { name: 'Fenix Capital Funding', aliases: ['FENIX CAPITAL'] },
  { name: 'Fundamental Capital', aliases: ['FUNDAMENTAL CAPITAL'] },
  { name: 'Highland Hill Capital', aliases: ['HIGHLAND HILL'] },
  { name: 'Maxim Commercial', aliases: ['MAXIM COMMERCIAL'] },
  { name: 'Mantis Funding', aliases: ['MANTIS FUNDING'] },
  { name: 'Meged Funding', aliases: ['MEGED'] },
  { name: 'Nano Capital', aliases: ['NANO CAPITAL'] },
  { name: 'Pluto Capital', aliases: ['PLUTO CAPITAL'] },
  { name: 'Radiant Advance', aliases: ['RADIANT ADVANCE'] },
  { name: 'Ruby Capital', aliases: ['RUBY CAPITAL'] },
  { name: 'Sky Capital', aliases: ['SKY CAPITAL'] },
  { name: 'Sunrise Funding', aliases: ['SUNRISE FUNDING'] },
  { name: 'Vivian Capital', aliases: ['VIVIAN CAPITAL'] },
  { name: 'Wide Merchant Group', aliases: ['WIDE MERCHANT'] },
  { name: 'Fundworks', aliases: ['FUNDWORKS', 'THE FUNDWORKS'] },
  { name: 'Backd', aliases: ['BACKD', 'BACK D FUNDING'] },
  { name: 'Enova / The Business Backer', aliases: ['BUSINESS BACKER', 'HEADWAY '] },
  { name: 'Biz2Credit', aliases: ['BIZ2CREDIT', 'BIZ2 CREDIT', 'ITRIA', 'ITRIA VENTURES'] },
  { name: 'Fundation', aliases: ['FUNDATION'] },
  { name: 'Balboa Capital', aliases: ['BALBOA CAPITAL'] },
  { name: 'CFG Merchant Solutions', aliases: ['CFG MERCHANT', 'CFGMS'] },
  { name: 'Vox Funding', aliases: ['VOX FUNDING'] },
  { name: 'Cash Cloud / Bluevine', aliases: ['CASH CLOUD'] },
  { name: 'Uplyft Capital', aliases: ['UPLYFT'] },
  { name: 'Simply Funding', aliases: ['SIMPLY FUNDING'] },
  { name: 'Sellers Funding', aliases: ['SELLERSFUNDING', 'SELLERS FUNDING'] },
  { name: '8 Fig', aliases: ['8 FIG', 'EIGHT FIG'] },
  { name: 'Kickfurther', aliases: ['KICKFURTHER'] },
  { name: 'Payability', aliases: ['PAYABILITY'] },
  { name: 'Nuula / Nav', aliases: ['NUULA'] },
  { name: 'Lendio', aliases: ['LENDIO'] },
  { name: 'Kabbage', aliases: ['KABBAGE', 'AMEX KABBAGE'] },
];

/**
 * Weak hints — words that show up in MCA descriptors but ALSO in plenty of
 * ordinary business payments. On their own these never flag a position;
 * they only raise confidence once the cadence + fixed-amount test has
 * already passed.
 */
export const WEAK_MCA_HINTS: string[] = [
  'MERCHANT CASH',
  'CASH ADVANCE',
  'MERCHANT ADV',
  'MCA ',
  ' MCA',
  'DAILY PMT',
  'DAILY PAYMENT',
  'WEEKLY PMT',
  'ADVANCE PMT',
  'FUNDING LLC',
  'CAPITAL LLC',
  'CAPITAL FUNDING',
  'BUSINESS FUNDING',
  'BUSINESS ADVANCE',
  'FUNDING GROUP',
  'ADVANCE LLC',
];

/**
 * Recurring debits that are NOT advances. Anything whose descriptor hits
 * one of these is excluded from position detection outright — payroll,
 * insurance, rent, software, taxes, cards, utilities, processors, and
 * ordinary term loans all debit on a schedule too.
 */
export const NON_MCA_RECURRING: string[] = [
  // Payroll / HR
  'GUSTO', 'ADP ', 'PAYCHEX', 'PAYCOM', 'PAYLOCITY', 'TRINET', 'JUSTWORKS',
  'INTUIT PAYROLL', 'QUICKBOOKS PAY', 'SUREPAYROLL', 'WAVE PAYROLL', 'RIPPLING',
  'PAYROLL', 'DIRECT DEP',
  // Tax
  'IRS ', 'EFTPS', 'USATAXPYMT', 'DEPT OF REVENUE', 'DEPARTMENT OF REVENUE',
  'STATE TAX', 'FRANCHISE TAX', 'SALES TAX', 'TAX PYMT', 'TREASURY',
  // Insurance
  'INSURANCE', 'GEICO', 'PROGRESSIVE', 'STATE FARM', 'ALLSTATE', 'NATIONWIDE',
  'HARTFORD', 'TRAVELERS INS', 'BLUE CROSS', 'BLUE SHIELD', 'AETNA', 'CIGNA',
  'UNITEDHEALTH', 'HUMANA', 'NEXT INSURANCE', 'HISCOX', 'BIBERK',
  // Software / SaaS
  'INTUIT', 'QUICKBOOKS', 'ADOBE', 'MICROSOFT', 'GOOGLE ', 'GSUITE', 'DROPBOX',
  'SLACK', 'ZOOM', 'SALESFORCE', 'HUBSPOT', 'SHOPIFY *', 'GODADDY', 'SQUARESPACE',
  'MAILCHIMP', 'CONSTANT CONTACT', 'AMAZON WEB', 'AWS ', 'RINGCENTRAL',
  // Utilities / telecom
  'VERIZON', 'T MOBILE', 'TMOBILE', 'AT T ', 'ATT ', 'SPRINT', 'COMCAST',
  'SPECTRUM', 'XFINITY', 'CONED', 'CON EDISON', 'NATIONAL GRID', 'PSEG',
  'ELECTRIC', 'GAS COMPANY', 'WATER DEPT', 'UTILITY',
  // Cards / banks / ordinary credit
  'AMERICAN EXPRESS', 'AMEX EPAYMENT', 'CHASE CREDIT', 'CAPITAL ONE CRD',
  'DISCOVER E PAYMENT', 'CITI CARD', 'CARDMEMBER SERV', 'CREDIT CRD',
  'SBA LOAN', 'SBA EIDL', 'EIDL', 'MORTGAGE', 'AUTO LOAN', 'CAR PAYMENT',
  'ALLY FINANCIAL', 'TOYOTA FINANCIAL', 'FORD CREDIT', 'WELLS FARGO AUTO',
  // Processors / fees the merchant PAYS
  'FIRST DATA', 'FISERV', 'WORLDPAY', 'GLOBAL PAYMENTS', 'TSYS', 'ELAVON',
  'MERCHANT FEE', 'MERCHANT SVC', 'DISCOUNT FEE', 'INTERCHANGE',
  'STRIPE FEE', 'SQUARE FEE', 'CLOVER ', 'TOAST ',
  // Fuel / fleet
  'WEX ', 'COMDATA', 'FLEETCOR', 'FUELMAN', 'EFS LLC',
  // Landlord / leases
  'RENT ', 'LEASE PMT', 'PROPERTY MGMT', 'REALTY', 'STORAGE',
  // Retirement / benefits
  '401K', 'GUIDELINE', 'EMPOWER RET', 'PRINCIPAL LIFE', 'VOYA',
];

const NORMALIZE_RE = /[^A-Z0-9]+/g;

/** Uppercase + strip punctuation so aliases match reliably. */
export function normalizeDescription(raw: string): string {
  return ` ${String(raw || '').toUpperCase().replace(NORMALIZE_RE, ' ').trim()} `;
}

/** Returns the funder display name if the descriptor matches a known MCA. */
export function matchKnownFunder(rawDescription: string): string | null {
  const norm = normalizeDescription(rawDescription);
  for (const f of MCA_FUNDERS) {
    for (const alias of f.aliases) {
      if (norm.includes(normalizeDescription(alias).trim())) return f.name;
    }
  }
  return null;
}

/** True when the descriptor contains a soft MCA word (not proof on its own). */
export function hasWeakMcaHint(rawDescription: string): boolean {
  const norm = normalizeDescription(rawDescription);
  return WEAK_MCA_HINTS.some((h) => norm.includes(normalizeDescription(h).trim()));
}

/** True when the descriptor is a known non-advance recurring payment. */
export function isNonMcaRecurring(rawDescription: string): boolean {
  const norm = normalizeDescription(rawDescription);
  return NON_MCA_RECURRING.some((h) => norm.includes(normalizeDescription(h).trim()));
}
