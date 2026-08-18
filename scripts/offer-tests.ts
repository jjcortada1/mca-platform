/**
 * Offer Generator tests.
 *
 * The email builder is a pure function, so it is worth pinning: this is
 * customer-facing copy that leaves the building, and a regression here is
 * only ever noticed by a merchant.
 *
 * Run: npm run test:offers
 */

import {
  buildOfferEmailHtml, buildOfferEmailText, emptyOfferEmailInput,
  emptyOffer, emptyPrepay, esc, requirementList, MAX_OFFERS,
  type OfferEmailInput,
} from '../src/lib/offers/email';

let failures = 0;
let checks = 0;

function check(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* ── escaping ── */
section('Escaping');
{
  check('escapes angle brackets', esc('<b>') === '&lt;b&gt;');
  check('escapes quotes and ampersands', esc(`a&"b'`) === 'a&amp;&quot;b&#039;');
  check('null becomes empty', esc(null) === '');

  const input = emptyOfferEmailInput();
  input.businessName = '<img src=x onerror=alert(1)>';
  const html = buildOfferEmailHtml(input);
  check(
    'a business name containing markup cannot inject a tag',
    !html.includes('<img src=x') && html.includes('&lt;img src=x'),
  );

  const notes = emptyOfferEmailInput();
  notes.notes = 'line one\n<script>evil()</script>';
  const notesHtml = buildOfferEmailHtml(notes);
  check('notes keep line breaks as <br>', notesHtml.includes('line one<br>'));
  check('notes escape markup', !notesHtml.includes('<script>') && notesHtml.includes('&lt;script&gt;'));
}

/* ── optional fields stay out ── */
section('Blank optional fields are omitted');
{
  const input = emptyOfferEmailInput();
  input.offers[0] = { ...emptyOffer(), amount: '$150,000', term: '36 Weeks' };
  const html = buildOfferEmailHtml(input);

  check('shows the fields that were filled', html.includes('$150,000') && html.includes('36 Weeks'));
  check('omits the Factor Rate row entirely', !html.includes('Factor Rate'));
  check('omits the Position row entirely', !html.includes('>Position<'));
  check('omits the Advisor block', !html.includes('>Advisor<'));
  check('omits the Notes block', !html.includes('>Notes<'));
  check('omits the Prepay block', !html.includes('Prepay Discounts'));

  // An all-blank offer must still render its card, with the placeholder.
  const blank = buildOfferEmailHtml(emptyOfferEmailInput());
  check('an empty offer still renders a card', blank.includes('Offer details will appear here.'));
}

/* ── whitespace-only is treated as blank ── */
section('Whitespace-only values count as blank');
{
  const input = emptyOfferEmailInput();
  input.offers[0] = { ...emptyOffer(), amount: '   ', term: '\t' };
  const html = buildOfferEmailHtml(input);
  check('a spaces-only amount does not produce a row', html.includes('Offer details will appear here.'));
}

/* ── singular vs plural wording ── */
section('Wording switches on offer count');
{
  const one = emptyOfferEmailInput();
  one.offers[0].amount = '$100,000';
  const oneHtml = buildOfferEmailHtml(one);
  check('single offer is labelled "Offer"', oneHtml.includes('>Offer<'));
  check('single offer omits "Offer 1"', !oneHtml.includes('Offer 1'));
  check(
    'single-offer instructions do not ask for an offer number',
    oneHtml.includes('Reply with your driver’s license') && !oneHtml.includes('offer number'),
  );
  check('single-offer intro is singular', oneHtml.includes('your approved funding terms'));

  const two = emptyOfferEmailInput();
  two.offers = [{ ...emptyOffer(), amount: '$100,000' }, { ...emptyOffer(), amount: '$80,000' }];
  const twoHtml = buildOfferEmailHtml(two);
  check('two offers are numbered', twoHtml.includes('Offer 1') && twoHtml.includes('Offer 2'));
  check('multi-offer instructions ask for the offer number', twoHtml.includes('offer number'));
  check('multi-offer intro is plural', twoHtml.includes('available funding offers'));
}

/* ── field ordering in the card ── */
section('Card field order matches the original tool');
{
  const input = emptyOfferEmailInput();
  input.offers[0] = {
    amount: '$150,000', term: '36 Weeks', buyRate: '1.35', originationFee: '4%',
    factorRate: '1.40', payment: '$5,833', paymentFrequency: 'Weekly', position: '1st Position',
  };
  const html = buildOfferEmailHtml(input);
  const order = ['Funding Amount', 'Term', 'Payment', 'Payment Frequency', 'Origination Fee', 'Buy Rate', 'Factor Rate', 'Position'];
  const positions = order.map((l) => html.indexOf(`>${l}<`));
  check('every labelled row is present', positions.every((p) => p >= 0), JSON.stringify(positions));
  check(
    'rows appear in the documented order',
    positions.every((p, i) => i === 0 || p > positions[i - 1]),
    JSON.stringify(positions),
  );
  check(
    '"Payment" and "Payment Frequency" are distinct rows',
    html.indexOf('>Payment<') !== html.indexOf('>Payment Frequency<'),
  );
}

/* ── prepay discounts ── */
section('Prepay discounts');
{
  const input = emptyOfferEmailInput();
  input.prepays = [emptyPrepay()];
  check('an entirely blank prepay row is dropped', !buildOfferEmailHtml(input).includes('Prepay Discounts'));

  input.prepays = [{ term: '30 Days', rate: '1.25', payback: '$187,500' }];
  const html = buildOfferEmailHtml(input);
  check('a filled prepay row renders', html.includes('Prepay Discounts') && html.includes('30 Days'));
  check('rate and payback are separated', html.includes('&nbsp;|&nbsp;'));

  const rateOnly = emptyOfferEmailInput();
  rateOnly.prepays = [{ term: '30 Days', rate: '1.25', payback: '' }];
  check(
    'no separator when only one of rate/payback is set',
    !buildOfferEmailHtml(rateOnly).includes('&nbsp;|&nbsp;'),
  );

  const noTerm = emptyOfferEmailInput();
  noTerm.prepays = [{ term: '', rate: '1.25', payback: '' }];
  check('a prepay with no term falls back to "Option 1"', buildOfferEmailHtml(noTerm).includes('Option 1'));
}

/* ── requirements ── */
section('Requirements');
{
  const input = emptyOfferEmailInput();
  check(
    'AR + CC default on, bank verification off',
    JSON.stringify(requirementList(input)) ===
      JSON.stringify(['Accounts Receivables Report', 'Credit Card Processing Statement, if applicable']),
  );

  input.needAR = false;
  input.needCC = false;
  input.needBankVerification = false;
  check('all three off leaves the list empty', requirementList(input).length === 0);
  check('and drops the whole block from the email', !buildOfferEmailHtml(input).includes('Additional Requirements'));

  input.otherRequirement = '  Landlord waiver  ';
  const reqs = requirementList(input);
  check('a custom requirement is trimmed and appended', reqs.length === 1 && reqs[0] === 'Landlord waiver');
}

/* ── advisor block ── */
section('Advisor block');
{
  const nameOnly = emptyOfferEmailInput();
  nameOnly.advisorName = 'JJ';
  const h1 = buildOfferEmailHtml(nameOnly);
  check('name alone renders the block', h1.includes('>Advisor<') && h1.includes('<strong>JJ</strong>'));
  check('no separator when only the name is set', !h1.slice(h1.indexOf('>Advisor<')).includes('&nbsp;|&nbsp;'));

  const both = emptyOfferEmailInput();
  both.advisorName = 'JJ';
  both.advisorPhone = '(305) 555-0199';
  const h2 = buildOfferEmailHtml(both);
  check('name + phone are separated', h2.slice(h2.indexOf('>Advisor<')).includes('&nbsp;|&nbsp;'));

  const phoneOnly = emptyOfferEmailInput();
  phoneOnly.advisorPhone = '(305) 555-0199';
  const h3 = buildOfferEmailHtml(phoneOnly);
  check('phone alone renders without a leading separator', h3.includes('(305) 555-0199'));
  check('phone alone still shows the block', h3.includes('>Advisor<'));
}

/* ── logo travels with the email ── */
section('Branding');
{
  const html = buildOfferEmailHtml(emptyOfferEmailInput());
  check('the logo is embedded as a data URI, not a link', html.includes('src="data:image/png;base64,'));
  check('no http(s) asset references at all', !/src="https?:/.test(html));
  check('closing line is present', html.includes('Cortada Capital Group appreciates the opportunity'));
}

/* ── plain-text fallback ── */
section('Plain-text fallback');
{
  const input: OfferEmailInput = emptyOfferEmailInput();
  input.businessName = 'ABC Holdings LLC';
  input.offers = [
    { ...emptyOffer(), amount: '$150,000', term: '36 Weeks', paymentFrequency: 'Weekly' },
    { ...emptyOffer(), amount: '$80,000' },
  ];
  input.prepays = [{ term: '30 Days', rate: '1.25', payback: '$187,500' }];
  input.notes = 'Funds wire same day.';
  input.advisorName = 'JJ';
  input.advisorEmail = 'jj@example.com';

  const text = buildOfferEmailText(input);
  check('contains no HTML tags', !/<[a-z/]/i.test(text));
  check('names the business', text.includes('ABC Holdings LLC'));
  check('numbers both offers', text.includes('Offer 1') && text.includes('Offer 2'));
  check('omits blank fields', !text.includes('Factor Rate'));
  check('includes prepay discounts', text.includes('PREPAY DISCOUNTS') && text.includes('30 Days'));
  check('includes requirements', text.includes('ADDITIONAL REQUIREMENTS'));
  check('includes notes', text.includes('Funds wire same day.'));
  check('includes the advisor', text.includes('JJ') && text.includes('jj@example.com'));

  const single = emptyOfferEmailInput();
  single.offers[0].amount = '$50,000';
  const singleText = buildOfferEmailText(single);
  check('single offer is unnumbered in text too', singleText.includes('\nOffer\n') && !singleText.includes('Offer 1'));
}

/* ── invariants ── */
section('Invariants');
{
  check('offer cap is 4', MAX_OFFERS === 4);
  const a = buildOfferEmailHtml(emptyOfferEmailInput());
  const b = buildOfferEmailHtml(emptyOfferEmailInput());
  check('the builder is deterministic', a === b);
  check('output width is pinned at 390px for mail clients', a.includes('width="390"'));
}

console.log(`\n${failures === 0 ? '✓ PASS' : '✗ FAIL'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
