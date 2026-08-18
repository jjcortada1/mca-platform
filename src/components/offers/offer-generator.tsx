'use client';

import { useMemo, useState } from 'react';
import {
  Card, CardContent, Button, Input, Textarea, Field, Select, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Plus, Trash2, Copy, RotateCcw } from 'lucide-react';
import {
  MAX_OFFERS, emptyOffer, emptyPrepay, emptyOfferEmailInput,
  buildOfferEmailHtml, buildOfferEmailText,
  type Offer, type Prepay, type OfferEmailInput,
} from '@/lib/offers/email';

/**
 * Merchant Offer Generator.
 *
 * A port of the standalone Cortada offer builder into the CRM. Same output,
 * same field set; what changes is that the email markup now comes from a
 * pure function in @/lib/offers/email rather than being assembled by
 * reading values back out of the DOM.
 *
 * Deliberately has NO persistence, matching the other generator tools
 * (Doc Request, Reverse Consolidation): it formats an email and puts it on
 * the clipboard. Nothing about a merchant is stored by using it.
 */
export function OfferGenerator() {
  const toast = useToast();
  const [form, setForm] = useState<OfferEmailInput>(() => emptyOfferEmailInput());

  const html = useMemo(() => buildOfferEmailHtml(form), [form]);

  function patch(p: Partial<OfferEmailInput>) {
    setForm((f) => ({ ...f, ...p }));
  }
  function patchOffer(i: number, key: keyof Offer, value: string) {
    setForm((f) => ({ ...f, offers: f.offers.map((o, j) => (j === i ? { ...o, [key]: value } : o)) }));
  }
  function patchPrepay(i: number, key: keyof Prepay, value: string) {
    setForm((f) => ({ ...f, prepays: f.prepays.map((p, j) => (j === i ? { ...p, [key]: value } : p)) }));
  }

  async function copyEmail() {
    const plain = buildOfferEmailText(form);
    try {
      if (navigator.clipboard && typeof window !== 'undefined' && 'ClipboardItem' in window) {
        const Ctor = (window as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem;
        await navigator.clipboard.write([
          new Ctor({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        // Firefox and Safari without ClipboardItem: select a hidden
        // contenteditable node and let execCommand carry the rich markup.
        const holder = document.createElement('div');
        holder.contentEditable = 'true';
        holder.style.position = 'fixed';
        holder.style.left = '-9999px';
        holder.innerHTML = html;
        document.body.appendChild(holder);
        const range = document.createRange();
        range.selectNodeContents(holder);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand('copy');
        sel?.removeAllRanges();
        holder.remove();
      }
      toast.success('Offer email copied — paste straight into Gmail or Outlook.');
    } catch {
      toast.error('Copy failed. Open in Chrome or Edge and allow clipboard access.');
    }
  }

  const offerFields: { key: keyof Offer; label: string; placeholder: string; optional?: boolean }[] = [
    { key: 'amount', label: 'Approved Amount', placeholder: '$150,000' },
    { key: 'term', label: 'Term', placeholder: '36 Weeks' },
    { key: 'buyRate', label: 'Buy Rate', placeholder: '1.35' },
    { key: 'originationFee', label: 'Origination Fee', placeholder: '4%' },
    { key: 'factorRate', label: 'Factor Rate', placeholder: '1.40', optional: true },
    { key: 'payment', label: 'Payment', placeholder: '$5,833', optional: true },
    { key: 'position', label: 'Position', placeholder: '1st Position', optional: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Offer Generator"
        description="Build one or more approved-offer emails for a merchant. Blank optional fields stay out of the email."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        {/* ── Builder ── */}
        <div className="space-y-4 min-w-0">
          <Card>
            <CardContent className="p-5 space-y-4">
              <Field label="Business Name">
                <Input
                  value={form.businessName}
                  onChange={(e) => patch({ businessName: e.target.value })}
                  placeholder="ABC Holdings LLC"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Offers */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Funding Offers
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={form.offers.length >= MAX_OFFERS}
                  onClick={() => patch({ offers: [...form.offers, emptyOffer()] })}
                  title={form.offers.length >= MAX_OFFERS ? `Maximum ${MAX_OFFERS} offers` : 'Add another offer'}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add offer
                </Button>
              </div>

              {form.offers.map((o, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">
                      {form.offers.length === 1 ? 'Offer' : `Offer ${i + 1}`}
                    </span>
                    {form.offers.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => patch({ offers: form.offers.filter((_, j) => j !== i) })}
                        title="Remove this offer"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {offerFields.map((f) => (
                      <Field key={f.key} label={f.optional ? `${f.label} (optional)` : f.label}>
                        <Input
                          value={o[f.key]}
                          onChange={(e) => patchOffer(i, f.key, e.target.value)}
                          placeholder={f.placeholder}
                        />
                      </Field>
                    ))}
                    <Field label="Payment Frequency (optional)">
                      <Select
                        value={o.paymentFrequency}
                        onChange={(e) => patchOffer(i, 'paymentFrequency', e.target.value)}
                      >
                        <option value="">Select</option>
                        <option value="Daily">Daily</option>
                        <option value="Weekly">Weekly</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Prepay discounts */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Prepay Discounts
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patch({ prepays: [...form.prepays, emptyPrepay()] })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add discount
                </Button>
              </div>

              {form.prepays.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  None added — the prepay section is left out of the email entirely.
                </p>
              )}

              {form.prepays.map((p, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">Prepay Discount {i + 1}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => patch({ prepays: form.prepays.filter((_, j) => j !== i) })}
                      title="Remove this discount"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Prepay Term">
                      <Input value={p.term} onChange={(e) => patchPrepay(i, 'term', e.target.value)} placeholder="30 Days" />
                    </Field>
                    <Field label="Prepay Rate (optional)">
                      <Input value={p.rate} onChange={(e) => patchPrepay(i, 'rate', e.target.value)} placeholder="1.25" />
                    </Field>
                    <Field label="Prepay Payback (optional)">
                      <Input value={p.payback} onChange={(e) => patchPrepay(i, 'payback', e.target.value)} placeholder="$187,500" />
                    </Field>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Requirements */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                Additional Requirements Prior to Funding
              </h3>
              <div className="flex flex-wrap gap-2">
                {([
                  ['needAR', 'Accounts Receivables Report'],
                  ['needCC', 'Credit Card Processing Statement, if applicable'],
                  ['needBankVerification', 'Bank Verification'],
                ] as const).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[12px] font-medium cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={form[key]}
                      onChange={(e) => patch({ [key]: e.target.checked } as Partial<OfferEmailInput>)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <Field label="Other Requirement (optional)">
                <Input
                  value={form.otherRequirement}
                  onChange={(e) => patch({ otherRequirement: e.target.value })}
                  placeholder="Additional stipulation"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Advisor + notes */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Advisor</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Advisor Name (optional)">
                  <Input value={form.advisorName} onChange={(e) => patch({ advisorName: e.target.value })} placeholder="JJ" />
                </Field>
                <Field label="Advisor Phone (optional)">
                  <Input value={form.advisorPhone} onChange={(e) => patch({ advisorPhone: e.target.value })} placeholder="(305) 555-0199" />
                </Field>
              </div>
              <Field label="Advisor Email (optional)">
                <Input value={form.advisorEmail} onChange={(e) => patch({ advisorEmail: e.target.value })} placeholder="name@cortadacapitalgroup.com" />
              </Field>
              <Field label="Notes (optional)">
                <Textarea
                  value={form.notes}
                  onChange={(e) => patch({ notes: e.target.value })}
                  placeholder="Add anything the merchant should know about the offer."
                  rows={4}
                />
              </Field>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button onClick={copyEmail}>
              <Copy className="h-4 w-4 mr-1.5" /> Copy email
            </Button>
            <Button variant="outline" onClick={() => setForm(emptyOfferEmailInput())}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Clear
            </Button>
          </div>
        </div>

        {/* ── Live merchant preview ── */}
        <div className="min-w-0">
          <div className="xl:sticky xl:top-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">Merchant Preview</h3>
                <p className="text-[12px] text-muted-foreground">
                  Copies as rich email content — the merchant sees exactly this.
                </p>
              </div>
              <Button size="sm" onClick={copyEmail}>
                <Copy className="h-4 w-4 mr-1.5" /> Copy
              </Button>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4 overflow-x-auto">
              {/* The preview is the SAME markup that goes on the clipboard —
                  rendering anything else here would let the two drift. It is
                  generated locally from this form's own state, never from a
                  server response, so there is nothing untrusted to inject. */}
              <div
                className="mx-auto bg-white shadow-sm"
                style={{ width: 390, maxWidth: '100%' }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
