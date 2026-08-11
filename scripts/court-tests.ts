import { discoverForm, mapFields, parseResults } from '@/lib/court/ny-webcivil';
import { businessNameVariants, personNameVariants, matchScore, toConfidence } from '@/lib/court/names';

// Form discovery + field mapping against a realistic WebCivil-style page.
const page = `<html><body>
<form name="form1" method="post" action="/webcivil/FCASSearchResults">
  <input type="hidden" name="csrfToken" value="abc123">
  <input type="hidden" name="param" value="P">
  <input type="text" name="txtPartyName" value="">
  <select name="cboCounty"><option value="">All</option><option value="31" selected>New York</option></select>
  <input type="submit" name="btnSubmit" value="Search">
</form></body></html>`;

const form = discoverForm(page, 'https://iapps.courts.state.ny.us/webcivil/FCASSearch?param=P');
if (!form) throw new Error('FAIL: no form discovered');
if (form.method !== 'POST') throw new Error(`FAIL: method ${form.method}`);
if (!form.action.endsWith('/webcivil/FCASSearchResults')) throw new Error(`FAIL: action ${form.action}`);
console.log('form:', form.method, form.action, form.fields.map(f => `${f.name}:${f.type}`).join(','));

const { body, mapping } = mapFields(form, { name: 'ACME LOGISTICS LLC', county: '31' });
if (body.txtPartyName !== 'ACME LOGISTICS LLC') throw new Error('FAIL: party name not mapped');
if (body.csrfToken !== 'abc123') throw new Error('FAIL: hidden token dropped — the server would reject this');
if (body.param !== 'P') throw new Error('FAIL: hidden state dropped');
console.log('mapping:', JSON.stringify(mapping));

// Results parsing, with columns in a non-obvious order.
const results = `<html><body><table>
<tr><th>Caption</th><th>Index Number</th><th>Court</th><th>County</th><th>Case Type</th><th>Date Filed</th><th>Status</th></tr>
<tr><td>MERCHANT CAP LLC v ACME LOGISTICS LLC</td><td><a href="FCASCaseInfo?index=650123-2025">650123/2025</a></td><td>Supreme</td><td>New York</td><td>Contract</td><td>03/14/2025</td><td>Disposed</td></tr>
<tr><td>ACME LOGISTICS LLC v SMITH</td><td><a href="FCASCaseInfo?index=651999-2024">651999/2024</a></td><td>Supreme</td><td>Kings</td><td>Commercial</td><td>11/02/2024</td><td>Active</td></tr>
</table></body></html>`;
const cases = parseResults(results, 'ACME LOGISTICS LLC');
if (cases.length !== 2) throw new Error(`FAIL: expected 2 cases, got ${cases.length}`);
if (cases[0].indexNumber !== '650123/2025') throw new Error(`FAIL: index ${cases[0].indexNumber}`);
if (cases[0].county !== 'New York') throw new Error(`FAIL: county ${cases[0].county}`);
if (cases[0].status !== 'Disposed') throw new Error(`FAIL: status ${cases[0].status}`);
if (!cases[0].url?.includes('FCASCaseInfo')) throw new Error('FAIL: case link not resolved');
console.log('cases:', cases.map(c => `${c.indexNumber} ${c.county} ${c.status}`).join(' | '));

// A page with no results must not be read as a parse failure.
const empty = parseResults('<html><body><p>No cases found matching your search.</p></body></html>', 'X');
if (empty.length !== 0) throw new Error('FAIL: phantom results from an empty page');

// Name variants.
const bv = businessNameVariants('ACME LOGISTICS AND FREIGHT LLC');
if (!bv.includes('ACME LOGISTICS AND FREIGHT LLC')) throw new Error('FAIL: exact business name missing');
if (!bv.some(v => !/LLC/.test(v))) throw new Error('FAIL: no suffix-stripped variant');
if (bv.length > 3) throw new Error('FAIL: too many variants — that is a burst of requests');
console.log('business variants:', JSON.stringify(bv));

const pv = personNameVariants('John', 'Smith');
if (pv[0] !== 'Smith, John') throw new Error(`FAIL: NY indexes Last, First — got ${pv[0]}`);
console.log('person variants:', JSON.stringify(pv));

// Scoring separates an exact hit from a coincidence.
const exact = matchScore('MERCHANT CAP LLC v ACME LOGISTICS LLC', 'ACME LOGISTICS LLC');
const loose = matchScore('ACME DINER INC v JONES', 'ACME LOGISTICS LLC');
if (toConfidence(exact) !== 'strong') throw new Error(`FAIL: exact caption scored ${exact}`);
if (toConfidence(loose) === 'strong') throw new Error(`FAIL: unrelated ACME scored as exact (${loose})`);
console.log(`scores: exact=${exact.toFixed(2)} (${toConfidence(exact)}), loose=${loose.toFixed(2)} (${toConfidence(loose)})`);

console.log('\n✅ COURT ADAPTER TESTS PASSED');
