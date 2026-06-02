import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { getSyncConfig, decodeCredentials, syncCompanyToSheet } from '@/lib/sheets/sync';
import { getAccessToken, getSpreadsheet } from '@/lib/sheets/client';

export const runtime = 'nodejs';

/**
 * POST /api/settings/sheet-sync/action
 * body: { action: 'test' | 'force' }
 *  - test: verifies credentials + that the service account can read the sheet
 *  - force: runs a full sync now
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const { action } = await req.json();

    const cfg = await getSyncConfig(ctx.companyId);
    if (!cfg) return NextResponse.json({ ok: false, error: 'Not configured yet.' }, { status: 400 });

    if (action === 'test') {
      const sa = decodeCredentials(cfg.encryptedCredentials);
      if (!sa) return NextResponse.json({ ok: false, error: 'No valid credentials saved.' });
      if (!cfg.spreadsheetId) return NextResponse.json({ ok: false, error: 'No spreadsheet ID saved.' });
      try {
        const token = await getAccessToken(sa);
        const meta = await getSpreadsheet(token, cfg.spreadsheetId);
        return NextResponse.json({ ok: true, title: meta.title, tabs: meta.sheets });
      } catch (e) {
        return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (action === 'force') {
      // Manual "Sync now" includes the manual-only tabs (funder contacts).
      const result = await syncCompanyToSheet(ctx.companyId, { manual: true });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e) { return apiError(e); }
}
