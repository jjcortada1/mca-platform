/**
 * Merchant offer email builder.
 *
 * This is a straight port of the standalone Cortada Offer Generator, kept
 * as a PURE function so it can be unit-tested and so the React layer never
 * has to reach into the DOM to produce the email (the original read its
 * values back out of <input> elements).
 *
 * The markup below is EMAIL html, not app html: tables, inline styles, no
 * classes, fixed 390px width. Gmail and Outlook strip <style> blocks and
 * most modern CSS, so none of this can be refactored into the design
 * system without the merchant seeing an unstyled wall of text. Treat the
 * inline styles as load-bearing.
 */

import { CORTADA_EMAIL_LOGO_DATA_URI } from './logo';

export interface Offer {
  amount: string;
  term: string;
  buyRate: string;
  originationFee: string;
  factorRate: string;
  payment: string;
  paymentFrequency: string;
  position: string;
}

export interface Prepay {
  term: string;
  rate: string;
  payback: string;
}

export interface OfferEmailInput {
  businessName: string;
  offers: Offer[];
  prepays: Prepay[];
  needAR: boolean;
  needCC: boolean;
  needBankVerification: boolean;
  otherRequirement: string;
  advisorName: string;
  advisorPhone: string;
  advisorEmail: string;
  notes: string;
}

export const MAX_OFFERS = 4;

export function emptyOffer(): Offer {
  return { amount: '', term: '', buyRate: '', originationFee: '', factorRate: '', payment: '', paymentFrequency: '', position: '' };
}

export function emptyPrepay(): Prepay {
  return { term: '', rate: '', payback: '' };
}

export function emptyOfferEmailInput(): OfferEmailInput {
  return {
    businessName: '',
    offers: [emptyOffer()],
    prepays: [],
    needAR: true,
    needCC: true,
    needBankVerification: false,
    otherRequirement: '',
    advisorName: '',
    advisorPhone: '',
    advisorEmail: '',
    notes: '',
  };
}

/**
 * Every merchant-supplied string goes through this before it lands in the
 * email. The output is pasted into a mail composer as rich HTML, so an
 * unescaped business name containing markup would travel with the message.
 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function nl2br(v: string): string {
  return esc(v).replace(/\n/g, '<br>');
}

function has(v: string): boolean {
  return String(v ?? '').trim().length > 0;
}

function offerCard(o: Offer, i: number, total: number): string {
  const fields: [string, string][] = [
    ['Funding Amount', o.amount],
    ['Term', o.term],
    ['Payment', o.payment],
    ['Payment Frequency', o.paymentFrequency],
    ['Origination Fee', o.originationFee],
    ['Buy Rate', o.buyRate],
    ['Factor Rate', o.factorRate],
    ['Position', o.position],
  ];
  const rows = fields
    .filter(([, v]) => has(v))
    .map(([l, v]) => `
    <tr>
      <td style="padding:6px 0;color:#6f7784;font-size:11px;font-weight:700;">${esc(l)}</td>
      <td style="padding:6px 0;color:#1d2735;font-size:12px;font-weight:800;text-align:right;">${esc(v)}</td>
    </tr>`)
    .join('');

  return `
    <div style="margin-top:${i === 0 ? '10px' : '12px'};border:1px solid #dfe4ec;border-radius:10px;overflow:hidden;background:#ffffff;">
      <div style="background:#f6f6f7;padding:9px 11px;border-bottom:1px solid #dfe4ec;">
        <span style="font-size:12px;font-weight:800;color:#25375f;">${total === 1 ? 'Offer' : `Offer ${i + 1}`}</span>
      </div>
      <div style="padding:7px 11px 9px;">
        ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table>` : '<div style="font-size:11px;color:#8b939d;">Offer details will appear here.</div>'}
      </div>
    </div>`;
}

function prepayBlock(prepays: Prepay[]): string {
  const items = prepays.filter((p) => has(p.term) || has(p.rate) || has(p.payback));
  if (!items.length) return '';
  return `
    <div style="margin-top:13px;">
      <div style="font-size:11px;color:#25375f;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Prepay Discounts</div>
      <div style="border:1px solid #e1e5ec;border-radius:8px;overflow:hidden;background:#fafafa;">
        ${items.map((p, i) => `
          <div style="padding:8px 10px;${i ? 'border-top:1px solid #e1e5ec;' : ''}">
            <div style="font-size:12px;color:#1d2735;font-weight:800;">${esc(p.term || `Option ${i + 1}`)}</div>
            <div style="margin-top:3px;font-size:11px;color:#6f7784;line-height:1.4;">
              ${has(p.rate) ? `Rate: <strong style="color:#1d2735;">${esc(p.rate)}</strong>` : ''}
              ${has(p.rate) && has(p.payback) ? ' &nbsp;|&nbsp; ' : ''}
              ${has(p.payback) ? `Payback: <strong style="color:#1d2735;">${esc(p.payback)}</strong>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

/** The stipulations list, in the fixed order the original tool used. */
export function requirementList(input: OfferEmailInput): string[] {
  const reqs: string[] = [];
  if (input.needAR) reqs.push('Accounts Receivables Report');
  if (input.needCC) reqs.push('Credit Card Processing Statement, if applicable');
  if (input.needBankVerification) reqs.push('Bank Verification');
  if (has(input.otherRequirement)) reqs.push(input.otherRequirement.trim());
  return reqs;
}

export function buildOfferEmailHtml(input: OfferEmailInput): string {
  const business = input.businessName.trim();
  const advisorName = input.advisorName.trim();
  const advisorPhone = input.advisorPhone.trim();
  const advisorEmail = input.advisorEmail.trim();
  const notes = input.notes.trim();
  const offers = input.offers;

  const reqs = requirementList(input);
  const reqBlock = reqs.length ? `
    <div style="margin-top:13px;">
      <div style="font-size:11px;color:#142e6b;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Additional Requirements Prior to Funding</div>
      <div style="border-left:3px solid #142e6b;padding-left:10px;">
        ${reqs.map((rq) => `<div style="font-size:12px;line-height:1.45;color:#2d3746;margin:2px 0;">${esc(rq)}</div>`).join('')}
      </div>
    </div>` : '';

  const advisor = (advisorName || advisorPhone || advisorEmail) ? `
    <div style="margin-top:13px;padding-top:10px;border-top:1px solid #e3e7ee;">
      <div style="font-size:10px;color:#7a828d;text-transform:uppercase;letter-spacing:.06em;font-weight:800;">Advisor</div>
      <div style="margin-top:4px;font-size:12px;color:#1d2735;line-height:1.45;">
        ${advisorName ? `<strong>${esc(advisorName)}</strong>` : ''}
        ${advisorPhone ? `${advisorName ? ' &nbsp;|&nbsp; ' : ''}${esc(advisorPhone)}` : ''}
        ${advisorEmail ? `<br>${esc(advisorEmail)}` : ''}
      </div>
    </div>` : '';

  const notesBlock = notes ? `
    <div style="margin-top:13px;background:#f7f8fb;border:1px solid #e1e5ec;border-radius:8px;padding:9px 10px;">
      <div style="font-size:10px;color:#7a828d;text-transform:uppercase;letter-spacing:.06em;font-weight:800;margin-bottom:4px;">Notes</div>
      <div style="font-size:12px;color:#2d3746;line-height:1.45;">${nl2br(notes)}</div>
    </div>` : '';

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="390" style="width:390px;max-width:390px;border-collapse:collapse;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1d2735;">
    <tr><td style="padding:0;">
      <div style="padding:10px 16px 6px;text-align:center;background:#ffffff;">
        <img src="${CORTADA_EMAIL_LOGO_DATA_URI}" alt="Cortada Capital Group" style="width:148px;max-width:74%;height:auto;display:block;margin:0 auto;">
      </div>

      <div style="padding:8px 16px 4px;text-align:center;">
        <div style="font-size:20px;line-height:1.15;color:#25375f;font-weight:800;">Congratulations!</div>
        <div style="margin-top:3px;font-size:17px;line-height:1.25;color:#1d2735;font-weight:700;">Your funding request has been approved.</div>
        ${business ? `<div style="margin-top:6px;font-size:14px;color:#1d2735;font-weight:800;">${esc(business)}</div>` : ''}
        <div style="margin-top:7px;font-size:12px;color:#6f7784;line-height:1.45;text-align:left;">${offers.length > 1 ? 'We’ve outlined the available funding offers below. Review the terms and let me know which one best fits your business.' : 'We’ve outlined your approved funding terms below for review.'}</div>
      </div>

      <div style="padding:0 16px 14px;">
        <div style="margin-top:7px;font-size:10px;color:#7a828d;text-transform:uppercase;letter-spacing:.07em;font-weight:800;">Approved Funding Terms</div>
        ${offers.map((o, i) => offerCard(o, i, offers.length)).join('')}

        ${prepayBlock(input.prepays)}

        <div style="margin-top:13px;background:#f7f8fa;border:1px solid #dfe3e8;border-radius:10px;padding:11px 12px;">
          <div style="font-size:12px;color:#25375f;font-weight:700;line-height:1.5;">${offers.length > 1 ? 'Reply with the offer number you would like to move forward with, along with your driver’s license and voided check, so we can send contracts and move forward with funding.' : 'Reply with your driver’s license and voided check so we can send contracts and move forward with funding.'}</div>
        </div>

        ${reqBlock}
        ${notesBlock}
        ${advisor}
      </div>

      <div style="padding:9px 16px 11px;border-top:1px solid #e4e8ef;font-size:10px;color:#7a828d;line-height:1.4;">
        Cortada Capital Group appreciates the opportunity to work with your business.
      </div>
    </td></tr>
  </table>`;
}

/**
 * Plain-text fallback that ships alongside the HTML on the clipboard, so
 * pasting into a plain-text composer still produces a readable offer
 * instead of a blank message.
 */
export function buildOfferEmailText(input: OfferEmailInput): string {
  const lines: string[] = [];
  lines.push('Congratulations!');
  lines.push('Your funding request has been approved.');
  if (has(input.businessName)) lines.push(input.businessName.trim());
  lines.push('');
  lines.push('APPROVED FUNDING TERMS');

  const labelled: [string, keyof Offer][] = [
    ['Funding Amount', 'amount'],
    ['Term', 'term'],
    ['Payment', 'payment'],
    ['Payment Frequency', 'paymentFrequency'],
    ['Origination Fee', 'originationFee'],
    ['Buy Rate', 'buyRate'],
    ['Factor Rate', 'factorRate'],
    ['Position', 'position'],
  ];

  input.offers.forEach((o, i) => {
    lines.push('');
    lines.push(input.offers.length === 1 ? 'Offer' : `Offer ${i + 1}`);
    for (const [label, key] of labelled) {
      if (has(o[key])) lines.push(`  ${label}: ${o[key]}`);
    }
  });

  const prepays = input.prepays.filter((p) => has(p.term) || has(p.rate) || has(p.payback));
  if (prepays.length) {
    lines.push('');
    lines.push('PREPAY DISCOUNTS');
    prepays.forEach((p, i) => {
      const bits = [has(p.rate) ? `Rate: ${p.rate}` : '', has(p.payback) ? `Payback: ${p.payback}` : '']
        .filter(Boolean).join('  |  ');
      lines.push(`  ${p.term || `Option ${i + 1}`}${bits ? ` — ${bits}` : ''}`);
    });
  }

  lines.push('');
  lines.push(input.offers.length > 1
    ? 'Reply with the offer number you would like to move forward with, along with your driver’s license and voided check, so we can send contracts and move forward with funding.'
    : 'Reply with your driver’s license and voided check so we can send contracts and move forward with funding.');

  const reqs = requirementList(input);
  if (reqs.length) {
    lines.push('');
    lines.push('ADDITIONAL REQUIREMENTS PRIOR TO FUNDING');
    for (const rq of reqs) lines.push(`  - ${rq}`);
  }

  if (has(input.notes)) {
    lines.push('');
    lines.push('NOTES');
    lines.push(input.notes.trim());
  }

  if (has(input.advisorName) || has(input.advisorPhone) || has(input.advisorEmail)) {
    lines.push('');
    lines.push('ADVISOR');
    const head = [input.advisorName.trim(), input.advisorPhone.trim()].filter(Boolean).join('  |  ');
    if (head) lines.push(head);
    if (has(input.advisorEmail)) lines.push(input.advisorEmail.trim());
  }

  lines.push('');
  lines.push('Cortada Capital Group appreciates the opportunity to work with your business.');
  return lines.join('\n');
}
