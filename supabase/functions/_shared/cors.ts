// Shared CORS headers for functions called directly from the browser
// (send-email, provision-mailbox). inbound-email is called by Resend's
// servers, not a browser, so it doesn't need these.
export const corsHeaders = {
  // TODO: once the web app has a fixed origin, replace "*" with it -
  // left open while the frontend URL is still moving during onboarding.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
