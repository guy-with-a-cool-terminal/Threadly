// Admin-only: register a domain into the system, one time per domain -
// creates the client if new, and either imports the domain from Resend (if
// it was already added and verified directly on resend.com, the normal
// flow when DNS is configured through Resend's own UI) or registers it with
// Resend for the first time. This is deliberately separate from
// provision-mailbox: configuring a domain is a one-off per client, creating
// a mailbox on an already-configured domain should be as simple as picking
// the domain and typing a name.

import { supabaseAdmin, supabaseAsCaller } from "../_shared/supabaseAdmin.ts";
import { resendClientFor } from "../_shared/resend.ts";
import { corsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface AddDomainBody {
  clientId?: string;
  newClientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  domainName: string;
  resendAccountLabel: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  const callerClient = supabaseAsCaller(authHeader);
  const { data: userResult, error: userError } = await callerClient.auth.getUser();
  if (userError || !userResult?.user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const { data: isAdmin } = await callerClient.rpc("is_admin");
  if (!isAdmin) return jsonResponse({ error: "Admin only" }, 403);

  let body: AddDomainBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.domainName || !body.resendAccountLabel) {
    return jsonResponse({ error: "domainName and resendAccountLabel are required" }, 400);
  }
  if (!body.clientId && !body.newClientName) {
    return jsonResponse({ error: "Provide clientId (existing) or newClientName (new client)" }, 400);
  }

  const admin = supabaseAdmin();

  // 1. Resolve the client.
  let clientId = body.clientId ?? null;
  if (!clientId) {
    const { data: client, error: clientError } = await admin
      .from("clients")
      .insert({ name: body.newClientName, email: body.clientEmail ?? null, phone: body.clientPhone ?? null })
      .select("id")
      .single();
    if (clientError || !client) {
      return jsonResponse({ error: `Failed to create client: ${clientError?.message}` }, 500);
    }
    clientId = client.id as string;
  }

  // 2. Resolve the domain - reuse if already registered here, else import
  // it from Resend if it's already there, else register it fresh.
  const domainName = body.domainName.toLowerCase().trim();
  const { data: existingDomain } = await admin
    .from("domains")
    .select("id, status, dns_records")
    .eq("domain_name", domainName)
    .maybeSingle();

  if (existingDomain) {
    return jsonResponse({
      ok: true,
      clientId,
      domainId: existingDomain.id,
      domain: { status: existingDomain.status, dns_records: existingDomain.dns_records },
      alreadyRegistered: true,
    });
  }

  let resend;
  try {
    resend = await resendClientFor(body.resendAccountLabel);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }

  const { data: domainsList, error: listError } = await resend.domains.list();
  if (listError) {
    return jsonResponse({ error: `Failed to check existing Resend domains: ${JSON.stringify(listError)}` }, 502);
  }
  const alreadyOnResend = domainsList?.data.find((d) => d.name === domainName);

  let resendDomainId: string;
  let resendStatus: string;
  let resendRecords: unknown;

  if (alreadyOnResend) {
    const { data: full, error: getError } = await resend.domains.get(alreadyOnResend.id);
    if (getError || !full) {
      return jsonResponse({ error: `Failed to load existing Resend domain: ${JSON.stringify(getError)}` }, 502);
    }
    resendDomainId = full.id;
    resendStatus = full.status;
    resendRecords = full.records;
  } else {
    const { data: createdDomain, error: resendError } = await resend.domains.create({ name: domainName });
    if (resendError || !createdDomain) {
      return jsonResponse({ error: `Resend domain creation failed: ${JSON.stringify(resendError)}` }, 502);
    }
    resendDomainId = createdDomain.id;
    resendStatus = createdDomain.status ?? "pending";
    resendRecords = createdDomain.records ?? null;
  }

  const { data: domainRow, error: domainInsertError } = await admin
    .from("domains")
    .insert({
      client_id: clientId,
      domain_name: domainName,
      resend_account_label: body.resendAccountLabel,
      resend_domain_id: resendDomainId,
      status: resendStatus,
      dns_records: resendRecords,
    })
    .select("id")
    .single();
  if (domainInsertError || !domainRow) {
    return jsonResponse({ error: `Failed to save domain: ${domainInsertError?.message}` }, 500);
  }

  return jsonResponse({
    ok: true,
    clientId,
    domainId: domainRow.id,
    domain: { status: resendStatus, dns_records: resendRecords },
    alreadyRegistered: false,
  });
});
